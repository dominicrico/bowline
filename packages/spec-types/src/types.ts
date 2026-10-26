export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonSchema = { [key: string]: JsonValue };

export const EFFECTS = ["read", "write", "destructive", "external"] as const;
export type Effect = (typeof EFFECTS)[number];

/** Tier 2: one capability descriptor, as served inside a group document. */
export interface Capability {
  id: string;
  version: string;
  summary: string;
  /** BSig: parameters in, return type out. */
  sig: string;
  effect: Effect;
  idempotent: boolean;
  scopes: string[];
  async: "never" | "may" | "always";
  stepUp?: "required";
  dryRun?: boolean;
  latencyMs?: { p50: number; p95: number };
  http: { method: "POST"; path: string };
  openapi?: string;
}

/** The document behind a tier 1 `descriptors` URL. Named types are defined once per group. */
export interface GroupDocument {
  group: string;
  types: Record<string, string>;
  capabilities: Capability[];
}

export interface ManifestGroup {
  name: string;
  summary: string;
  effects: Effect[];
  descriptors: string;
}

/** Tier 1: the manifest at `/.well-known/bowline`. */
export interface Manifest {
  bowline: "0.1";
  server: { name: string; publisher: string; base: string };
  auth: { issuer: string; metadata: string; dpop: "required" };
  groups: ManifestGroup[];
  // shortcut: SPEC requires a JWS here, the server emits none yet; add signing with the key-management work after the v0.2 gate
  signature?: { alg: "EdDSA"; kid: string; value: string };
}

/** RFC 9457 problem details plus the Bowline extension members. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  bowline?: { retryable: boolean; field?: string; hint?: string; docs?: string; scope?: string };
}
