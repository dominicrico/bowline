import assert from "node:assert/strict";
import { test } from "node:test";
import { renderManifest } from "./render.ts";

test("renders one aligned line per group", () => {
  const out = renderManifest(
    {
      bowline: "0.1",
      server: { name: "x", publisher: "x", base: "https://x/b" },
      auth: { issuer: "x", metadata: "x", dpop: "required" },
      groups: [
        { name: "customers", summary: "Look up customers", effects: ["read", "write"], descriptors: "/d/a" },
        { name: "reports", summary: "Run reports", effects: ["read"], descriptors: "/d/b" },
      ],
    },
    "billing",
  );
  assert.equal(out, "billing.customers  Look up customers [read, write]\nbilling.reports    Run reports [read]");
});

test("renders a group's capabilities and types", async () => {
  const { renderGroup } = await import("./render.ts");
  const out = renderGroup({
    group: "invoices",
    types: { Receipt: "{ receiptId: id }" },
    capabilities: [
      { id: "invoices.send", version: "1.0.0", summary: "Email an invoice", sig: "send(invoiceId: id): Receipt", effect: "external", idempotent: false, scopes: ["invoices:send"], async: "never", stepUp: "required", http: { method: "POST", path: "/c" } },
    ],
  });
  assert.equal(out, "invoices.send  Email an invoice\n  send(invoiceId: id): Receipt  [external, step-up; scopes invoices:send]\ntypes:\n  Receipt = { receiptId: id }");
});
