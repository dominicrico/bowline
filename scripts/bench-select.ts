// Selection accuracy (docs/benchmark-protocol.md, "Selection accuracy"): 60 prompts x arms B1, M1, M2 on C1 at 25.
// The first client tool call is the model's pick. B1 counts only if the model described the right group first.
// Run: pnpm bench-select   (real requests, tool_choice auto; writes bench/results/select-<timestamp>.json)
import { mkdirSync, writeFileSync } from "node:fs";
import { toMcpTools } from "@bowline/bridges";
import { renderGroup, renderManifest } from "@bowline/client";
import { createDiscovery } from "@bowline/server";
import { prompts } from "../bench/prompts.ts";
import { catalog } from "../examples/billing/src/catalog.ts";

const MODEL = "claude-opus-5-5";
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error("ANTHROPIC_API_KEY is empty: set it in .env");

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown> };
type Reply = { content: Block[]; stop_reason: string; usage: { input_tokens: number } };

async function post(body: Record<string, unknown>): Promise<Reply> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...(process.env.ANTHROPIC_WORKSPACE_ID && { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }),
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, ...body }),
    }).catch((e: unknown) => e as Error);
    if (res instanceof Error) {
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
      throw res;
    }
    if (res.ok) return (await res.json()) as Reply;
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
    throw new Error(`messages ${res.status}: ${await res.text()}`);
  }
}

const tool = (name: string, description: string, input_schema: object) => ({ name, description, input_schema });
const d = createDiscovery(catalog);
const mcp = toMcpTools(d.documents.values()).map((t) => tool(t.name, t.description, t.inputSchema));
const b1Tools = [
  tool("bowline_describe", "Load the capability descriptors of one group.", { type: "object", properties: { group: { type: "string" } }, required: ["group"] }),
  tool("bowline_call", "Call a capability by id with JSON arguments.", { type: "object", properties: { capability: { type: "string" }, args: { type: "object" } }, required: ["capability", "args"] }),
];
const arms: Record<"B1" | "M1" | "M2", Record<string, unknown>> = {
  B1: { system: renderManifest(d.manifest, "billing"), tools: b1Tools },
  M1: { tools: mcp },
  M2: { tools: [{ type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" }, ...mcp.map((t) => ({ ...t, defer_loading: true }))] },
};

/** Runs one prompt on one arm until the model makes its first real call (at most 5 requests). */
async function run(arm: keyof typeof arms, prompt: string, expect: string) {
  const messages: unknown[] = [{ role: "user", content: prompt }];
  const described = new Set<string>();
  let inputTokens = 0;
  for (let turn = 1; turn <= 5; turn++) {
    const r = await post({ ...arms[arm], messages });
    inputTokens += r.usage.input_tokens;
    const uses = r.content.filter((x) => x.type === "tool_use");
    if (!uses.length) {
      if (r.stop_reason !== "pause_turn") return { picked: null, correct: false, turns: turn, inputTokens, note: "no tool call" };
      messages.push({ role: "assistant", content: r.content });
      continue;
    }
    // Answer every describe in the response; the first non-describe call is the pick, judged by what was described before it.
    const results: unknown[] = [];
    for (const use of uses) {
      if (arm === "B1" && use.name === "bowline_describe") {
        const group = String(use.input?.group ?? "").replace(/^billing\./, "");
        const doc = d.documents.get(group);
        if (doc) described.add(group);
        results.push({ type: "tool_result", tool_use_id: use.id, content: doc ? renderGroup(doc) : `unknown group ${group}`, ...(doc ? {} : { is_error: true }) });
        continue;
      }
      const picked = arm === "B1" ? String(use.input?.capability ?? "") : use.name!.replace("_", ".");
      const ok = picked === expect && (arm !== "B1" || described.has(expect.split(".")[0]!));
      return { picked, correct: ok, turns: turn, inputTokens, ...(arm === "B1" && picked === expect && !ok ? { note: "called without describing the group" } : {}) };
    }
    messages.push({ role: "assistant", content: r.content });
    messages.push({ role: "user", content: results });
  }
  return { picked: null, correct: false, turns: 5, inputTokens, note: "no call after 5 requests" };
}

// Small worker pool: 4 requests in flight.
const jobs = (["B1", "M1", "M2"] as const).flatMap((arm) => prompts.map((p, i) => ({ arm, i, ...p })));
const rows: (typeof jobs[number] & Awaited<ReturnType<typeof run>>)[] = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < jobs.length) {
    const j = jobs[next++]!;
    rows.push({ ...j, ...(await run(j.arm, j.prompt, j.expect)) });
  }
}));
rows.sort((a, b) => a.arm.localeCompare(b.arm) || a.i - b.i);

const accuracy = Object.fromEntries((["B1", "M1", "M2"] as const).map((a) => {
  const r = rows.filter((x) => x.arm === a);
  return [a, { correct: r.filter((x) => x.correct).length, of: r.length, pct: (100 * r.filter((x) => x.correct).length) / r.length }];
}));
const result = {
  catalog: "C1",
  capabilities: 25,
  model: MODEL,
  date: new Date().toISOString(),
  accuracy,
  // G4: B1 >= M1 minus 5 points.
  G4: accuracy.B1!.pct >= accuracy.M1!.pct - 5,
  rows,
};
mkdirSync("bench/results", { recursive: true });
const file = `bench/results/select-${result.date.replaceAll(":", "-")}.json`;
writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ accuracy, G4: result.G4 }, null, 2));
for (const r of rows.filter((x) => !x.correct)) console.log(r.arm, r.i, JSON.stringify(r.prompt), "expected", r.expect, "got", r.picked, r.note ?? "");
console.log(`wrote ${file}`);
