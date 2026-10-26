import assert from "node:assert/strict";
import { test } from "node:test";
import { BsigError, expand, parseSignature } from "./bsig.ts";

const LINE = {
  type: "object",
  properties: {
    description: { type: "string", minLength: 1, maxLength: 500 },
    quantity: { type: "integer" },
    unitPrice: { type: "number" },
  },
  required: ["description", "quantity", "unitPrice"],
  additionalProperties: false,
};
const ID = { type: "string", minLength: 1 };

const types = {
  Line: "{ description: string[1..500], quantity: int, unitPrice: number }",
  Invoice: "{ invoiceId: id, lines: Line[] }",
  Receipt: "{ receiptId: id }",
  SendResult: "{ invoiceId: id, sentTo: email, sentAt: datetime, receipt: Receipt }",
};

test("expands the create example from the spec", () => {
  const sig = parseSignature('create(customerId: id, lines: Line[1..100], dueDate?: date, currency = "EUR"): Invoice');
  assert.equal(sig.name, "create");
  const { input, output } = expand(sig, types);
  assert.deepEqual(input, {
    type: "object",
    properties: {
      customerId: ID,
      lines: { type: "array", items: { $ref: "#/$defs/Line" }, minItems: 1, maxItems: 100 },
      dueDate: { type: "string", format: "date" },
      currency: { type: "string", default: "EUR" },
    },
    required: ["customerId", "lines"],
    additionalProperties: false,
    $defs: { Line: LINE },
  });
  assert.deepEqual(output, {
    $ref: "#/$defs/Invoice",
    $defs: {
      Invoice: {
        type: "object",
        properties: { invoiceId: ID, lines: { type: "array", items: { $ref: "#/$defs/Line" } } },
        required: ["invoiceId", "lines"],
        additionalProperties: false,
      },
      Line: LINE,
    },
  });
});

test("expands the send example, with a string length bound and transitive types", () => {
  const { input, output } = expand(parseSignature("send(invoiceId: id, message?: string[..500]): SendResult"), types);
  assert.deepEqual(input.properties, { invoiceId: ID, message: { type: "string", maxLength: 500 } });
  assert.deepEqual(input.required, ["invoiceId"]);
  assert.deepEqual(Object.keys(output.$defs as object).sort(), ["Receipt", "SendResult"]);
});

test("expands enums, grouped arrays and inferred default types", () => {
  const sig = parseSignature('f(tags: (string)[1..5], mode: "a" | "b" = "a", flag = true, n = 3, ratio = 0.5, one: "x"): bool');
  const { input, output } = expand(sig);
  assert.deepEqual(input.properties, {
    tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
    mode: { enum: ["a", "b"], default: "a" },
    flag: { type: "boolean", default: true },
    n: { type: "integer", default: 3 },
    ratio: { type: "number", default: 0.5 },
    one: { const: "x" },
  });
  assert.deepEqual(input.required, ["tags", "one"]);
  assert.deepEqual(output, { type: "boolean" });
});

test("a second bound turns a length-bounded string into an array", () => {
  const { input } = expand(parseSignature("f(a: string[..50][..5], b: int[1..3]): bool"));
  assert.deepEqual(input.properties, {
    a: { type: "array", items: { type: "string", maxLength: 50 }, maxItems: 5 },
    b: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 3 },
  });
});

test("accepts no parameters, trailing commas and escaped strings", () => {
  assert.deepEqual(expand(parseSignature("ping(): bool")).input, { type: "object", properties: {}, additionalProperties: false });
  assert.doesNotThrow(() => parseSignature('f(a: id, b = "say \\"hi\\"",): bool'));
});

test("rejects bad input with a position", () => {
  assert.throws(() => parseSignature("get(id: id"), (e: Error) => e instanceof BsigError && /expected "\)" at 10/.test(e.message));
  assert.throws(() => parseSignature("f(a: id) bool"), /expected ":"/);
  assert.throws(() => parseSignature("f(a: id): bool extra"), /unexpected input/);
  assert.throws(() => parseSignature("f(a: id #): bool"), /unexpected character at 8/);
  assert.throws(() => parseSignature("f(a: string | int): bool"), /only unions of literals/);
  assert.throws(() => parseSignature('f(a: int = "x"): bool'), /does not fit/);
  assert.throws(() => parseSignature("f(a: string[5..1]): bool"), /range start/);
  assert.throws(() => parseSignature("f(a: string[5]): bool"), /expected "\.\."/);
  assert.throws(() => parseSignature("f(a: id, a: id): bool"), /duplicate/);
  assert.throws(() => parseSignature("f(a): bool"), /needs a type or a default/);
});

test("unknown type names fail on expansion, including inherited property names", () => {
  assert.throws(() => expand(parseSignature("f(a: Nope): bool"), {}), /unknown type "Nope"/);
  assert.throws(() => expand(parseSignature("f(a: constructor): bool"), {}), /unknown type "constructor"/);
});
