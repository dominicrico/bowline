// Idle cost per arm on C1 (docs/benchmark-protocol.md): input tokens added by the integration to a "Hello" request.
// Run: pnpm bench-idle   (loads ANTHROPIC_API_KEY from .env; writes bench/results/idle-<timestamp>.json)
import { mkdirSync, writeFileSync } from "node:fs";
import { toMcpTools } from "@bowline/bridges";
import { renderManifest } from "@bowline/client";
import { createDiscovery } from "@bowline/server";
import { catalog, catalog100 } from "../examples/billing/src/catalog.ts";

const MODEL = "claude-opus-5-5";
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error("ANTHROPIC_API_KEY is empty: set it in .env");

async function api(path: string, body: Record<string, unknown>): Promise<{ input_tokens?: number; usage?: { input_tokens: number } }> {
  const res = await fetch(`https://api.anthropic.com/v1/messages${path}`, {
    method: "POST",
    headers: {
      "x-api-key": key!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      ...(process.env.ANTHROPIC_WORKSPACE_ID && { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }),
    },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "Hello" }], ...body }),
  });
  if (!res.ok) throw new Error(`${path || "messages"} ${res.status}: ${await res.text()}`);
  return res.json() as never;
}
const count = async (body: Record<string, unknown>) => (await api("/count_tokens", body)).input_tokens!;
// M2 is measured on a real request that ends before any search (protocol, "To verify").
const usage = async (body: Record<string, unknown>) => (await api("", { max_tokens: 1, ...body })).usage!.input_tokens;

const tool = (name: string, description: string, input_schema: object) => ({ name, description, input_schema });
const b1Tools = [
  tool("bowline_describe", "Load the capability descriptors of one group.", { type: "object", properties: { group: { type: "string" } }, required: ["group"] }),
  tool("bowline_call", "Call a capability by id with JSON arguments.", { type: "object", properties: { capability: { type: "string" }, args: { type: "object" } }, required: ["capability", "args"] }),
];

const baseline = await count({});

async function measure(def: typeof catalog) {
  const d = createDiscovery(def);
  const mcp = toMcpTools(d.documents.values()).map((t) => tool(t.name, t.description, t.inputSchema));
  const search = { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" };
  const m2 = { tools: [search, ...mcp.map((t) => ({ ...t, defer_loading: true }))] };
  const b1 = { system: renderManifest(d.manifest, "billing"), tools: b1Tools };
  const arms = {
    B1: { total: await count(b1) },
    M1: { total: await count({ tools: mcp }) },
    M2: { total: await usage(m2), countTokens: await count(m2) },
  };
  const idle = {
    B1: { ...arms.B1, idle: arms.B1.total - baseline },
    M1: { ...arms.M1, idle: arms.M1.total - baseline },
    M2: { ...arms.M2, idle: arms.M2.total - baseline },
  };
  return { capabilities: mcp.length, idle, ratios: { "M1/B1": idle.M1.idle / idle.B1.idle, "M2/B1": idle.M2.idle / idle.B1.idle } };
}

const scales = { "25": await measure(catalog), "100": await measure(catalog100) };
const result = {
  catalog: "C1",
  model: MODEL,
  date: new Date().toISOString(),
  client: "raw fetch, anthropic-version 2023-06-01",
  baseline,
  scales,
  // G1 is M1/B1 at 25 (>= 3.0); G2 is a strictly higher M1/B1 at 100 than at 25.
  gates: {
    G1: scales["25"].ratios["M1/B1"] >= 3,
    G2: scales["100"].ratios["M1/B1"] > scales["25"].ratios["M1/B1"],
  },
};
mkdirSync("bench/results", { recursive: true });
const file = `bench/results/idle-${result.date.replaceAll(":", "-")}.json`;
writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2), `\nwrote ${file}`);
