import { expand, parseSignature, type Capability, type GroupDocument, type JsonSchema } from "@bowline/spec-types";

/** An MCP `tools/list` entry. `outputSchema` is omitted: Claude tool definitions have no field for it. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/** Effect class and idempotency, as the one short sentence the benchmark protocol adds to MCP descriptions. */
function effectSentence(c: Capability): string {
  return `Effect: ${c.effect}, ${c.idempotent ? "idempotent" : "not idempotent"}.`;
}

/** Bowline to MCP: one tool per capability. Dots become underscores, as Claude tool names disallow them. */
export function toMcpTools(docs: Iterable<GroupDocument>): McpTool[] {
  return [...docs].flatMap((doc) =>
    doc.capabilities.map((c) => ({
      name: c.id.replaceAll(".", "_"),
      description: `${c.summary}. ${effectSentence(c)}`,
      inputSchema: expand(parseSignature(c.sig), doc.types).input,
    })),
  );
}
