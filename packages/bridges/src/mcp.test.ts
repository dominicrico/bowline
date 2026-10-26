import assert from "node:assert/strict";
import { test } from "node:test";
import { toMcpTools } from "./mcp.ts";

test("maps capabilities to tools with expanded input and an effect sentence", () => {
  const [tool] = toMcpTools([
    {
      group: "invoices",
      types: {},
      capabilities: [
        { id: "invoices.void", version: "1.0.0", summary: "Void an unpaid invoice", sig: "void(invoiceId: id): bool", effect: "destructive", idempotent: true, scopes: ["invoices:void"], async: "never", http: { method: "POST", path: "/c" } },
      ],
    },
  ]);
  assert.equal(tool!.name, "invoices_void");
  assert.equal(tool!.description, "Void an unpaid invoice. Effect: destructive, idempotent.");
  assert.deepEqual(tool!.inputSchema.required, ["invoiceId"]);
  assert.deepEqual(tool!.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
});
