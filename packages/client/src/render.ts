import type { Manifest } from "@bowline/spec-types";

/** Tier 1 as model-facing text: one line per group, `<prefix>.<group>  <summary> [effects]`. */
export function renderManifest(m: Manifest, prefix: string): string {
  const names = m.groups.map((g) => `${prefix}.${g.name}`);
  const pad = Math.max(...names.map((n) => n.length));
  return m.groups.map((g, i) => `${names[i]!.padEnd(pad)}  ${g.summary} [${g.effects.join(", ")}]`).join("\n");
}
