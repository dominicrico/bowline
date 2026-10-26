import { sha256, type Capability, type GroupDocument, type Manifest } from "@bowline/spec-types";

export class DigestMismatchError extends Error {}

/** Fetches the tier 1 manifest from `<origin>/.well-known/bowline`. */
export async function fetchManifest(origin: string): Promise<Manifest> {
  const res = await fetch(`${origin}/.well-known/bowline`, { headers: { Accept: "application/bowline+json" } });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  return (await res.json()) as Manifest;
}

/** Fetches a group document and rejects it unless its bytes hash to the digest its URL names. */
export async function fetchGroupDocument(origin: string, path: string): Promise<{ digest: string; doc: GroupDocument }> {
  const digest = path.slice(path.lastIndexOf("@") + 1);
  const res = await fetch(origin + path, { headers: { Accept: "application/bowline+json" } });
  if (!res.ok) throw new Error(`descriptor ${res.status}`);
  const body = await res.text();
  if (sha256(body) !== digest) throw new DigestMismatchError(`${path}: body hashes to ${sha256(body)}`);
  return { digest, doc: JSON.parse(body) as GroupDocument };
}

export type PinStatus = "pinned" | "changed" | "unpinned";

/**
 * Consent state: the descriptor digest the user approved, per group, with the approved document kept so a
 * change can be diffed even after the server stops serving it. Only `pinned` groups may reach the model.
 */
export class Pins {
  private readonly approved = new Map<string, { digest: string; doc: GroupDocument }>();

  status(group: string, digest: string): PinStatus {
    const pin = this.approved.get(group);
    return pin === undefined ? "unpinned" : pin.digest === digest ? "pinned" : "changed";
  }

  approve(group: string, digest: string, doc: GroupDocument): void {
    this.approved.set(group, { digest, doc });
  }

  approvedDocument(group: string): GroupDocument | undefined {
    return this.approved.get(group)?.doc;
  }
}

export interface CapabilityChange {
  id: string;
  change: "added" | "removed" | "changed";
  fields?: string[];
  /** The effect class moved toward fewer safeguards, e.g. destructive to read. */
  effectDowngrade?: boolean;
}

const RANK: Record<Capability["effect"], number> = { read: 0, write: 1, destructive: 2, external: 2 };

/** What changed between the approved and the offered group document, for the re-consent prompt. */
export function diffGroups(before: GroupDocument, after: GroupDocument): CapabilityChange[] {
  const old = new Map(before.capabilities.map((c) => [c.id, c]));
  const changes: CapabilityChange[] = [];
  for (const c of after.capabilities) {
    const o = old.get(c.id);
    old.delete(c.id);
    if (!o) { changes.push({ id: c.id, change: "added" }); continue; }
    const keys = [...new Set([...Object.keys(o), ...Object.keys(c)])] as (keyof Capability)[];
    const fields = keys.filter((k) => JSON.stringify(o[k]) !== JSON.stringify(c[k]));
    if (fields.length) changes.push({ id: c.id, change: "changed", fields, ...(RANK[c.effect] < RANK[o.effect] || (o.stepUp && !c.stepUp) ? { effectDowngrade: true } : {}) });
  }
  for (const id of old.keys()) changes.push({ id, change: "removed" });
  if (JSON.stringify(before.types) !== JSON.stringify(after.types)) changes.push({ id: `${after.group}.*`, change: "changed", fields: ["types"] });
  return changes;
}
