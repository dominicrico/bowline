import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, sha256 } from "./digest.ts";

// The example from RFC 8785, section 3.2.2.
test("canonicalize matches the RFC 8785 example", () => {
  const input = JSON.parse(
    '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
      '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
  );
  assert.equal(
    canonicalize(input),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
      '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  );
});

test("canonicalize sorts keys and drops undefined members", () => {
  assert.equal(canonicalize({ b: 1, a: { d: undefined, c: [2, 1] } }), '{"a":{"c":[2,1]},"b":1}');
});

test("canonicalize rejects values JSON cannot carry", () => {
  assert.throws(() => canonicalize({ n: Infinity }), TypeError);
  assert.throws(() => canonicalize(() => 1), TypeError);
});

test("sha256 matches the known vector for abc", () => {
  assert.equal(sha256("abc"), "sha256-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
