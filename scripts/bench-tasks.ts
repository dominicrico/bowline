// Task cost per arm (docs/benchmark-protocol.md, "Task cost"): idle cost plus the disclosures a task needs.
// Computed without a model. B1 discloses the tier 2 text of each group the task touches; M1 discloses nothing
// more; M2 loads the task's own capabilities (stand-in for the search step). Disclosures are counted as
// extra text in the user message, so tool-result framing is not included.
// Run: pnpm bench-tasks   (writes bench/results/tasks-<timestamp>.json)
import { mkdirSync, writeFileSync } from "node:fs";
import { toMcpTools } from "@bowline/bridges";
import { renderGroup, renderManifest } from "@bowline/client";
import { createDiscovery } from "@bowline/server";
import { tasks } from "../bench/tasks.ts";
import { catalog, catalog100 } from "../examples/billing/src/catalog.ts";

const MODEL = "claude-opus-5-5";
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error("ANTHROPIC_API_KEY is empty: set it in .env");

async function count(body: Record<string, unknown>, disclosure = ""): Promise<number> {
  const content = disclosure ? [{ type: "text", text: "Hello" }, { type: "text", text: disclosure }] : "Hello";
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "x-api-key": key!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      ...(process.env.ANTHROPIC_WORKSPACE_ID && { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }),
    },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content }], ...body }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { input_tokens: number }).input_tokens;
}

const tool = (name: string, description: string, input_schema: object) => ({ name, description, input_schema });
const b1Tools = [
  tool("bowline_describe", "Load the capability descriptors of one group.", { type: "object", properties: { group: { type: "string" } }, required: ["group"] }),
  tool("bowline_call", "Call a capability by id with JSON arguments.", { type: "object", properties: { capability: { type: "string" }, args: { type: "object" } }, required: ["capability", "args"] }),
];
const search = { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" };

async function measure(def: typeof catalog) {
  const d = createDiscovery(def);
  const mcp = toMcpTools(d.documents.values()).map((t) => tool(t.name, t.description, t.inputSchema));
  const baseline = await count({});
  const m1 = (await count({ tools: mcp })) - baseline;
  const b1Base = { system: renderManifest(d.manifest, "billing"), tools: b1Tools };
  const rows = [];
  for (const t of tasks) {
    const groups = [...new Set(t.needs.map((id) => id.split(".")[0]!))];
    const b1 = (await count(b1Base, groups.map((g) => renderGroup(d.documents.get(g)!)).join("\n\n"))) - baseline;
    const loaded = new Set(t.needs.map((id) => id.replaceAll(".", "_")));
    const m2 = (await count({ tools: [search, ...mcp.map((x) => (loaded.has(x.name) ? x : { ...x, defer_loading: true }))] })) - baseline;
    rows.push({ task: t.id, groups: groups.length, B1: b1, M1: m1, M2: m2, pass: b1 <= m1 });
  }
  return rows;
}

const scales = { "25": await measure(catalog), "100": await measure(catalog100) };
const gated = (rows: typeof scales["25"]) => rows.filter((r) => r.groups <= 2);
const result = {
  catalog: "C1",
  model: MODEL,
  date: new Date().toISOString(),
  scales,
  // G3: B1 <= M1 for every task touching 2 or fewer groups (checked at both scales; the protocol names no scale).
  G3: { "25": gated(scales["25"]).every((r) => r.pass), "100": gated(scales["100"]).every((r) => r.pass) },
};
mkdirSync("bench/results", { recursive: true });
const file = `bench/results/tasks-${result.date.replaceAll(":", "-")}.json`;
writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
for (const [s, rows] of Object.entries(scales)) {
  console.log(`\nscale ${s}\ntask groups   B1    M1    M2`);
  for (const r of rows) console.log(`${String(r.task).padStart(4)} ${String(r.groups).padStart(6)} ${String(r.B1).padStart(5)} ${String(r.M1).padStart(5)} ${String(r.M2).padStart(5)}`);
}
console.log("\nG3", result.G3, `\nwrote ${file}`);
