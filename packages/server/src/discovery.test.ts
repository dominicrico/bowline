import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { canonicalize, sha256 } from "@bowline/spec-types";
import { createDiscovery, type DiscoveryDef } from "./discovery.ts";

const def: DiscoveryDef = {
  server: { name: "Example Billing", publisher: "did:web:billing.example.com", base: "https://billing.example.com/bowline/v1" },
  auth: { issuer: "https://auth.example.com", metadata: "https://auth.example.com/.well-known/oauth-authorization-server", dpop: "required" },
  groups: [
    {
      name: "customers",
      summary: "Look up and update customer records",
      capabilities: [
        { id: "customers.get", version: "1.0.0", summary: "Fetch one customer by id", sig: "get(customerId: id): Customer", effect: "read", idempotent: true, scopes: ["customers:read"], async: "never" },
        { id: "customers.update", version: "1.0.0", summary: "Change a customer's name or email", sig: "update(customerId: id, name?: string): Customer", effect: "write", idempotent: true, scopes: ["customers:write"], async: "never" },
      ],
    },
  ],
};

async function withServer<T>(d: ReturnType<typeof createDiscovery>, fn: (url: string) => Promise<T>): Promise<T> {
  const srv = createServer((req, res) => {
    if (!d.handle(req, res)) { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${(srv.address() as { port: number }).port}`);
  } finally {
    srv.close();
  }
}

test("manifest lists groups with effects and a digest-pinned descriptors path", () => {
  const { manifest, documents } = createDiscovery(def);
  const g = manifest.groups[0]!;
  assert.deepEqual(g.effects, ["read", "write"]);
  assert.equal(g.descriptors, `/bowline/v1/d/customers@${sha256(canonicalize(documents.get("customers")))}`);
  assert.equal(documents.get("customers")!.capabilities[0]!.http.path, "/bowline/v1/call/customers.get");
});

test("serves immutable descriptors with ETag and answers 304", async () => {
  const d = createDiscovery(def);
  await withServer(d, async (url) => {
    const path = d.manifest.groups[0]!.descriptors;
    const res = await fetch(url + path);
    const etag = res.headers.get("etag")!;
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(etag, `"${path.split("@")[1]}"`);
    assert.equal(sha256(await res.text()), path.split("@")[1]);
    const again = await fetch(url + path, { headers: { "If-None-Match": etag } });
    assert.equal(again.status, 304);
  });
});

test("manifest revalidates with a short max-age; unknown paths fall through", async () => {
  const d = createDiscovery(def);
  await withServer(d, async (url) => {
    const res = await fetch(`${url}/.well-known/bowline`);
    assert.equal(res.headers.get("cache-control"), "public, max-age=60");
    assert.equal(((await res.json()) as { bowline: string }).bowline, "0.1");
    assert.equal((await fetch(`${url}/bowline/v1/d/customers@sha256-00`)).status, 404);
  });
});

test("rejects bad definitions", () => {
  const bad = (cap: Partial<DiscoveryDef["groups"][0]["capabilities"][0]>) =>
    () => createDiscovery({ ...def, groups: [{ ...def.groups[0]!, capabilities: [{ ...def.groups[0]!.capabilities[0]!, ...cap }] }] });
  assert.throws(bad({ summary: "x".repeat(121) }), /over 120/);
  assert.throws(bad({ id: "invoices.get" }), /must start with/);
  assert.throws(bad({ sig: "get(" }));
});
