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
