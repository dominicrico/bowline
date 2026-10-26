import assert from "node:assert/strict";
import { test } from "node:test";
import { createDiscovery } from "@bowline/server";
import { expand, parseSignature } from "@bowline/spec-types";
import { catalog } from "./catalog.ts";

test("catalog has 5 groups of 5 and every signature expands with its group types", () => {
  const d = createDiscovery(catalog);
  assert.equal(d.manifest.groups.length, 5);
  for (const doc of d.documents.values()) {
    assert.equal(doc.capabilities.length, 5);
    for (const c of doc.capabilities) {
      const { input, output } = expand(parseSignature(c.sig), doc.types);
      assert.equal(input.type, "object");
      assert.ok(output);
    }
  }
});

test("destructive and external capabilities require step-up", () => {
  for (const doc of createDiscovery(catalog).documents.values())
    for (const c of doc.capabilities) assert.equal(c.stepUp === "required", c.effect === "destructive" || c.effect === "external");
});
