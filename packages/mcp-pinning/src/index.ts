// Prototype of docs/mcp-sep-signed-pinned-tools.md for the MCP TypeScript SDK. Structural types only: it works on the
// tool objects and `tools/list` results the SDK already produces, and does not import the SDK.
import { generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { canonicalize, sha256 } from "@bowline/spec-types";

/** Placeholders for the field names the proposal leaves open. Both live in `_meta` because the SDK's tool schema drops unknown top-level fields. */
export const DIGEST_KEY = "io.bowline/digest";
export const SIGNATURE_KEY = "io.bowline/tools-signature";

export interface McpTool {
  name: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface ToolsResult {
  tools: McpTool[];
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** `sha256-<hex>` over the RFC 8785 canonical JSON of the tool without its own digest. */
export function toolDigest(tool: McpTool): string {
  const { [DIGEST_KEY]: _omit, ...meta } = tool._meta ?? {};
  return sha256(canonicalize({ ...tool, _meta: Object.keys(meta).length ? meta : undefined }));
}

export function withDigest(tool: McpTool): McpTool {
  return { ...tool, _meta: { ...tool._meta, [DIGEST_KEY]: toolDigest(tool) } };
}

const listPayload = (tools: McpTool[]) => canonicalize(tools.map((t) => `${t.name}@${t._meta?.[DIGEST_KEY]}`).sort());

/** Detached EdDSA JWS (RFC 7515, RFC 7797 style: empty payload segment) over the sorted `name@digest` list. */
export function signList(tools: McpTool[], privateKey: KeyObject, kid: string): string {
  const header = b64u(JSON.stringify({ alg: "EdDSA", kid }));
  const input = `${header}.${b64u(listPayload(tools))}`;
  return `${header}..${sign(null, Buffer.from(input), privateKey).toString("base64url")}`;
}

/** Server side: a `tools/list` result whose tools carry digests and whose list is signed. */
export function signedToolsResult(tools: McpTool[], privateKey: KeyObject, kid: string): ToolsResult {
  const withDigests = tools.map(withDigest);
  return { tools: withDigests, _meta: { [SIGNATURE_KEY]: signList(withDigests, privateKey, kid) } };
}

export function verifyList(tools: McpTool[], jws: string, trusted: Record<string, KeyObject>): string | null {
  const [header, empty, sig] = jws.split(".");
  if (!header || empty !== "" || !sig) return "malformed signature";
  const kid = (JSON.parse(Buffer.from(header, "base64url").toString()) as { kid?: string }).kid;
  const key = kid === undefined ? undefined : trusted[kid];
  if (!key) return `untrusted key ${kid}`;
  const input = Buffer.from(`${header}.${b64u(listPayload(tools))}`);
  return verify(null, input, key, Buffer.from(sig, "base64url")) ? null : "signature does not match the tool list";
}

// shortcut: a fresh in-process Ed25519 pair; publisher key discovery (did:web) is an open question in the proposal
export const generateKeys = () => generateKeyPairSync("ed25519");

// Client side ------------------------------------------------------------------------------------------------------

export interface ToolChange {
  /** Top-level fields whose values differ, plus `_meta.<key>` entries. */
  fields: string[];
  /** An effect annotation moved toward fewer safeguards: destructiveHint true to false, or readOnlyHint false to true. */
  effectDowngrade: boolean;
}

export function diffTool(before: McpTool, after: McpTool): ToolChange {
  const strip = (t: McpTool) => {
    const { [DIGEST_KEY]: _d, ...meta } = t._meta ?? {};
    return { ...t, _meta: meta };
  };
  const a = strip(before) as Record<string, unknown>;
  const b = strip(after) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => canonicalize(a[k] ?? null) !== canonicalize(b[k] ?? null)).sort();
  const ann = (t: McpTool) => (t.annotations ?? {}) as { destructiveHint?: boolean; readOnlyHint?: boolean };
  const effectDowngrade = (ann(before).destructiveHint === true && ann(after).destructiveHint !== true) || (ann(before).readOnlyHint !== true && ann(after).readOnlyHint === true);
  return { fields, effectDowngrade };
}

export type Withheld = { name: string; reason: "unapproved" | "changed" | "digest-mismatch"; change?: ToolChange };

export interface GuardedList {
  /** Tools the model may see. */
  exposed: McpTool[];
  /** Tools held back until the user approves them again. */
  withheld: Withheld[];
  /** Set when the whole list was refused (bad or missing signature). `exposed` is then empty. */
  rejected?: string;
}

/** What the user approved, per tool name: the digest, and the definition so a later change can be shown as a diff. */
export class ToolPins {
  private readonly approved = new Map<string, { digest: string; tool: McpTool }>();

  approve(tool: McpTool): void {
    this.approved.set(tool.name, { digest: toolDigest(tool), tool });
  }

  approveAll(tools: McpTool[]): void {
    for (const t of tools) this.approve(t);
  }

  check(tool: McpTool): "pinned" | "changed" | "unapproved" {
    const pin = this.approved.get(tool.name);
    return !pin ? "unapproved" : pin.digest === toolDigest(tool) ? "pinned" : "changed";
  }

  approvedTool(name: string): McpTool | undefined {
    return this.approved.get(name)?.tool;
  }
}

export interface GuardOptions {
  pins: ToolPins;
  /** Publisher keys the user trusts, by `kid`. When set, an unsigned or badly signed list is refused. */
  trustedKeys?: Record<string, KeyObject>;
}

/**
 * Wraps the result of `client.listTools()`. Order of checks: signature of the whole list, each tool's own digest
 * (when the server sent one), then the user's pins. Only pinned tools are exposed.
 */
export function guardTools(result: ToolsResult, { pins, trustedKeys }: GuardOptions): GuardedList {
  const withheld: Withheld[] = [];
  const mismatched = new Set(result.tools.filter((t) => t._meta?.[DIGEST_KEY] !== undefined && t._meta[DIGEST_KEY] !== toolDigest(t)).map((t) => t.name));

  if (trustedKeys) {
    const jws = result._meta?.[SIGNATURE_KEY];
    const problem = typeof jws === "string" ? verifyList(result.tools, jws, trustedKeys) : "list is not signed";
    if (problem) return { exposed: [], withheld, rejected: problem };
  }

  const exposed: McpTool[] = [];
  for (const t of result.tools) {
    if (mismatched.has(t.name)) { withheld.push({ name: t.name, reason: "digest-mismatch" }); continue; }
    const status = pins.check(t);
    if (status === "pinned") exposed.push(t);
    else {
      const before = pins.approvedTool(t.name);
      withheld.push({ name: t.name, reason: status, ...(before ? { change: diffTool(before, t) } : {}) });
    }
  }
  return { exposed, withheld };
}
