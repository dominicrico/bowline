import type { GroupDocument, Manifest } from "@bowline/spec-types";

/** Tier 1 as model-facing text: one line per group, `<prefix>.<group>  <summary> [effects]`. */
export function renderManifest(m: Manifest, prefix: string): string {
  const names = m.groups.map((g) => `${prefix}.${g.name}`);
  const pad = Math.max(...names.map((n) => n.length));
  return m.groups.map((g, i) => `${names[i]!.padEnd(pad)}  ${g.summary} [${g.effects.join(", ")}]`).join("\n");
}

/** Tier 2 as model-facing text: what `bowline_describe(group)` returns. One entry per capability, then the group's types. */
export function renderGroup(doc: GroupDocument): string {
  const caps = doc.capabilities.map((c) => {
    const flags = [c.effect, c.idempotent ? "idempotent" : "", c.async !== "never" ? `async ${c.async}` : "", c.stepUp ? "step-up" : ""];
    return `${c.id}  ${c.summary}\n  ${c.sig}  [${flags.filter(Boolean).join(", ")}; scopes ${c.scopes.join(" ")}]`;
  });
  const types = Object.entries(doc.types).map(([n, d]) => `  ${n} = ${d}`);
  return [...caps, ...(types.length ? ["types:", ...types] : [])].join("\n");
}
