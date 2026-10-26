import { toMcpTools } from "@bowline/bridges";
import { createDiscovery } from "@bowline/server";
import { catalog, catalog100 } from "../examples/billing/src/catalog.ts";
const h = { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(process.env.ANTHROPIC_WORKSPACE_ID && { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }) };
const post = async (b: object) => (await (await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: h, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 1024, ...b }) })).json()) as any;
const search = { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" };
for (const [label, def] of [["25", catalog], ["100", catalog100]] as const) {
  const tools = [search, ...toMcpTools(createDiscovery(def).documents.values()).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema, defer_loading: true }))];
  const messages: any[] = [{ role: "user", content: "Void invoice inv_204 and refund its payment pay_77." }];
  for (let turn = 1; turn <= 3; turn++) {
    const r = await post({ tools, messages });
    if (r.type === "error") { console.log(label, turn, JSON.stringify(r)); break; }
    const kinds = r.content.map((c: any) => c.type + (c.name ? `:${c.name}` : ""));
    console.log(label, "turn", turn, "input", r.usage.input_tokens, "out", r.usage.output_tokens, "stop", r.stop_reason, kinds.join(" "));
    if (turn === 1) console.log(JSON.stringify(r.content).slice(0, 700));
    messages.push({ role: "assistant", content: r.content });
    const uses = r.content.filter((c: any) => c.type === "tool_use");
    if (!uses.length) break;
    messages.push({ role: "user", content: uses.map((u: any) => ({ type: "tool_result", tool_use_id: u.id, content: '{"ok":true}' })) });
  }
}
