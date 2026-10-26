import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog } from "../examples/billing/src/catalog.ts";
import { prompts } from "./prompts.ts";

test("60 prompts, every expected id exists, every capability is covered at least twice", () => {
  const ids = catalog.groups.flatMap((g) => g.capabilities.map((c) => c.id));
  assert.equal(prompts.length, 60);
  for (const id of ids) assert.ok(prompts.filter((p) => p.expect === id).length >= 2, id);
  for (const p of prompts) assert.ok(ids.includes(p.expect), p.expect);
});
