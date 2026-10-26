// Idle cost of the B1 arm (docs/benchmark-protocol.md): count_tokens(with integration) - count_tokens(without).
// Run: pnpm count-tier1   (loads ANTHROPIC_API_KEY from .env)
import { renderManifest } from "@bowline/client";
import { createDiscovery } from "@bowline/server";
import { catalog } from "../examples/billing/src/catalog.ts";

const MODEL = "claude-opus-5-5";
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error("ANTHROPIC_API_KEY is empty: set it in .env");

async function count(body: Record<string, unknown>): Promise<number> {
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "x-api-key": key!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      ...(process.env.ANTHROPIC_WORKSPACE_ID && { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }),
    },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "Hello" }], ...body }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { input_tokens: number }).input_tokens;
}

const tool = (name: string, description: string, properties: object, required: string[]) => ({
  name, description, input_schema: { type: "object", properties, required },
});
const tools = [
  tool("bowline_describe", "Load the capability descriptors of one group.", { group: { type: "string" } }, ["group"]),
  tool("bowline_call", "Call a capability by id with JSON arguments.", { capability: { type: "string" }, args: { type: "object" } }, ["capability", "args"]),
];

const tier1 = renderManifest(createDiscovery(catalog).manifest, "billing");
const base = await count({});
const withB1 = await count({ system: tier1, tools });
console.log(tier1);
console.log(`\nmodel ${MODEL}\nbaseline ${base}\nB1 ${withB1}\nidle cost ${withB1 - base} tokens`);
