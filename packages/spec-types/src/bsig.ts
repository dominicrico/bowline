import type { JsonSchema } from "./types.ts";

export class BsigError extends Error {}

export type Literal = string | number | boolean;

const PRIMS = ["id", "string", "email", "date", "datetime", "int", "number", "bool"] as const;
export type Prim = (typeof PRIMS)[number];
const isPrim = (s: string): s is Prim => (PRIMS as readonly string[]).includes(s);
const STRING_LIKE: readonly Prim[] = ["id", "string", "email"];

export type TypeNode =
  | { k: "prim"; name: Prim; minLength?: number; maxLength?: number }
  | { k: "named"; name: string }
  | { k: "enum"; values: Literal[] }
  | { k: "array"; item: TypeNode; minItems?: number; maxItems?: number }
  | { k: "object"; fields: Field[] };

export interface Field {
  name: string;
  optional: boolean;
  type: TypeNode;
  default?: Literal;
}

export interface Signature {
  name: string;
  params: Field[];
  returns: TypeNode;
}

// Lexer ---------------------------------------------------------------------------------------

interface Tok {
  kind: "id" | "num" | "str" | "p";
  text: string;
  at: number;
}

const TOKEN = /\s*(?:([A-Za-z_][A-Za-z0-9_]*)|(-?\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|(\.\.|[(){}[\],:?=|]))/y;

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  for (;;) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) {
      if (src.slice(i).trim() === "") return toks;
      throw new BsigError(`unexpected character at ${i + src.slice(i).search(/\S/)} in "${src}"`);
    }
    const at = i + m[0].search(/\S/);
    i += m[0].length;
    if (m[1] !== undefined) toks.push({ kind: "id", text: m[1], at });
    else if (m[2] !== undefined) toks.push({ kind: "num", text: m[2], at });
    else if (m[3] !== undefined) toks.push({ kind: "str", text: decode(m[3], at, src), at });
    else toks.push({ kind: "p", text: m[4] as string, at });
  }
}

// String literals use JSON escapes.
function decode(raw: string, at: number, src: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    throw new BsigError(`bad string escape at ${at} in "${src}"`);
  }
}

// Parser --------------------------------------------------------------------------------------

class Parser {
  toks: Tok[];
  src: string;
  i = 0;

  constructor(src: string) {
    this.src = src;
    this.toks = lex(src);
  }

  err(msg: string): BsigError {
    const at = this.toks[this.i]?.at ?? this.src.length;
    return new BsigError(`${msg} at ${at} in "${this.src}"`);
  }

  peekIs(text: string): boolean {
    const t = this.toks[this.i];
    return t?.kind === "p" && t.text === text;
  }

  eat(text: string): boolean {
    if (!this.peekIs(text)) return false;
    this.i++;
    return true;
  }

  expect(text: string): void {
    if (!this.eat(text)) throw this.err(`expected "${text}"`);
  }

  end(): void {
    if (this.i < this.toks.length) throw this.err("unexpected input");
  }

  ident(): string {
    const t = this.toks[this.i];
    if (t?.kind !== "id") throw this.err("expected a name");
    this.i++;
    return t.text;
  }

  tryLiteral(): Literal | undefined {
    const t = this.toks[this.i];
    if (t?.kind === "str") {
      this.i++;
      return t.text;
    }
    if (t?.kind === "num") {
      this.i++;
      return Number(t.text);
    }
    if (t?.kind === "id" && (t.text === "true" || t.text === "false")) {
      this.i++;
      return t.text === "true";
    }
    return undefined;
  }

  // type := unit ("|" unit)*, where a union may only combine literals
  type(): TypeNode {
    const first = this.unit();
    if (!this.peekIs("|")) return first;
    const values = [...this.literals(first)];
    while (this.eat("|")) values.push(...this.literals(this.unit()));
    return { k: "enum", values };
  }

  literals(n: TypeNode): Literal[] {
    if (n.k !== "enum") throw this.err("only unions of literals are supported");
    return n.values;
  }

  // unit := (name | literal | "{" fields "}" | "(" type ")") ("[" range? "]")*
  unit(): TypeNode {
    let node: TypeNode;
    let grouped = false;
    const t = this.toks[this.i];
    const lit = this.tryLiteral();
    if (lit !== undefined) node = { k: "enum", values: [lit] };
    else if (t?.kind === "id") {
      this.i++;
      node = isPrim(t.text) ? { k: "prim", name: t.text } : { k: "named", name: t.text };
    } else if (this.eat("{")) node = { k: "object", fields: this.fields() };
    else if (this.eat("(")) {
      node = this.type();
      this.expect(")");
      grouped = true;
    } else throw this.err("expected a type");
    while (this.eat("[")) {
      node = this.suffix(node, grouped);
      grouped = false;
    }
    return node;
  }

  // A bounded suffix on a plain string-like type limits its length. Every other suffix makes an
  // array, so a bounded array of strings is written `(string)[1..5]`.
  suffix(node: TypeNode, grouped: boolean): TypeNode {
    let lo: number | undefined;
    let hi: number | undefined;
    if (!this.peekIs("]")) {
      const a = this.toks[this.i];
      if (a?.kind === "num") {
        this.i++;
        lo = this.count(a);
      }
      this.expect("..");
      const b = this.toks[this.i];
      if (b?.kind === "num") {
        this.i++;
        hi = this.count(b);
      }
    }
    this.expect("]");
    if (lo !== undefined && hi !== undefined && lo > hi) throw this.err("range start is above range end");
    const bounded = lo !== undefined || hi !== undefined;
    if (bounded && !grouped && node.k === "prim" && STRING_LIKE.includes(node.name) && node.minLength === undefined && node.maxLength === undefined) {
      return { ...node, ...(lo !== undefined && { minLength: lo }), ...(hi !== undefined && { maxLength: hi }) };
    }
    return { k: "array", item: node, ...(lo !== undefined && { minItems: lo }), ...(hi !== undefined && { maxItems: hi }) };
  }

  count(t: Tok): number {
    const n = Number(t.text);
    if (!Number.isInteger(n) || n < 0) throw this.err("range bounds must be non-negative integers");
    return n;
  }

  fields(): Field[] {
    const out: Field[] = [];
    if (!this.eat("}")) {
      do out.push(this.field(false));
      while (this.eat(",") && !this.peekIs("}"));
      this.expect("}");
    }
    return unique(out, this);
  }

  // field := name "?"? (":" type)? ("=" literal)?   parameters may omit the type when a default gives it
  field(isParam: boolean): Field {
    const name = this.ident();
    const optional = this.eat("?");
    let type: TypeNode | undefined;
    if (this.eat(":")) type = this.type();
    let def: Literal | undefined;
    if (isParam && this.eat("=")) {
      def = this.tryLiteral();
      if (def === undefined) throw this.err("expected a literal default");
    }
    if (type === undefined) {
      if (def === undefined) throw this.err(isParam ? `parameter "${name}" needs a type or a default` : 'expected ":"');
      type = inferred(def);
    } else if (def !== undefined && !fits(type, def)) {
      throw this.err(`default for "${name}" does not fit its type`);
    }
    return { name, optional, type, ...(def !== undefined && { default: def }) };
  }
}

function unique(fields: Field[], p: Parser): Field[] {
  if (new Set(fields.map((f) => f.name)).size !== fields.length) throw p.err("duplicate name");
  return fields;
}

function inferred(def: Literal): TypeNode {
  if (typeof def === "string") return { k: "prim", name: "string" };
  if (typeof def === "boolean") return { k: "prim", name: "bool" };
  return { k: "prim", name: Number.isInteger(def) ? "int" : "number" };
}

// Named types are not resolved here, so a default on one is accepted unchecked.
function fits(type: TypeNode, def: Literal): boolean {
  if (type.k === "enum") return type.values.includes(def);
  if (type.k === "named") return true;
  if (type.k !== "prim") return false;
  if (type.name === "bool") return typeof def === "boolean";
  if (type.name === "int") return Number.isInteger(def);
  if (type.name === "number") return typeof def === "number";
  return typeof def === "string";
}

/** Parse one signature line: `name(params): Return`. */
export function parseSignature(src: string): Signature {
  const p = new Parser(src);
  const name = p.ident();
  p.expect("(");
  const params: Field[] = [];
  if (!p.eat(")")) {
    do params.push(p.field(true));
    while (p.eat(",") && !p.peekIs(")"));
    p.expect(")");
  }
  unique(params, p);
  p.expect(":");
  const returns = p.type();
  p.end();
  return { name, params, returns };
}

/** Parse one named type definition, such as `{ invoiceId: id, lines: Line[] }`. */
export function parseType(src: string): TypeNode {
  const p = new Parser(src);
  const t = p.type();
  p.end();
  return t;
}

// Expansion to JSON Schema 2020-12 -------------------------------------------------------------

const PRIM_SCHEMA: Record<Prim, JsonSchema> = {
  id: { type: "string", minLength: 1 },
  string: { type: "string" },
  email: { type: "string", format: "email" },
  date: { type: "string", format: "date" },
  datetime: { type: "string", format: "date-time" },
  int: { type: "integer" },
  number: { type: "number" },
  bool: { type: "boolean" },
};

function schemaOf(n: TypeNode, used: Set<string>): JsonSchema {
  switch (n.k) {
    case "prim":
      return {
        ...PRIM_SCHEMA[n.name],
        ...(n.minLength !== undefined && { minLength: n.minLength }),
        ...(n.maxLength !== undefined && { maxLength: n.maxLength }),
      };
    case "named":
      used.add(n.name);
      return { $ref: `#/$defs/${n.name}` };
    case "enum":
      return n.values.length === 1 ? { const: n.values[0] as Literal } : { enum: n.values };
    case "array":
      return {
        type: "array",
        items: schemaOf(n.item, used),
        ...(n.minItems !== undefined && { minItems: n.minItems }),
        ...(n.maxItems !== undefined && { maxItems: n.maxItems }),
      };
    case "object":
      return objectSchema(n.fields, used);
  }
}

// BSig objects are closed, so the schema says so; that is what keeps the expansion lossless.
function objectSchema(fields: Field[], used: Set<string>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const f of fields) {
    properties[f.name] = { ...schemaOf(f.type, used), ...(f.default !== undefined && { default: f.default }) };
    if (!f.optional && f.default === undefined) required.push(f.name);
  }
  return { type: "object", properties, ...(required.length > 0 && { required }), additionalProperties: false };
}

function withDefs(schema: JsonSchema, used: Set<string>, types: Record<string, string>): JsonSchema {
  if (used.size === 0) return schema;
  const defs: Record<string, JsonSchema> = {};
  const pending = [...used];
  while (pending.length > 0) {
    const name = pending.pop() as string;
    if (Object.hasOwn(defs, name)) continue;
    const src = Object.hasOwn(types, name) ? types[name] : undefined;
    if (src === undefined) throw new BsigError(`unknown type "${name}"`);
    const inner = new Set<string>();
    defs[name] = schemaOf(parseType(src), inner);
    pending.push(...inner);
  }
  return { ...schema, $defs: defs };
}

/** Expand a signature to JSON Schema 2020-12. Each schema carries the `$defs` it references. */
export function expand(sig: Signature, types: Record<string, string> = {}): { input: JsonSchema; output: JsonSchema } {
  const inUsed = new Set<string>();
  const outUsed = new Set<string>();
  const input = objectSchema(sig.params, inUsed);
  const output = schemaOf(sig.returns, outUsed);
  return { input: withDefs(input, inUsed, types), output: withDefs(output, outUsed, types) };
}
