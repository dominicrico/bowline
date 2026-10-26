// shortcut: Node only (node:crypto); switch to WebCrypto when the client SDK has to run in browsers
import { createHash } from "node:crypto";

/**
 * RFC 8785 (JCS) canonical JSON. JSON.stringify already emits the number and string forms JCS
 * requires, so only key order and undefined handling need code. Keys sort by UTF-16 code unit,
 * which is the default string order in JavaScript.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("cannot canonicalize a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const members = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${members.join(",")}}`;
  }
  throw new TypeError(`cannot canonicalize a ${typeof value}`);
}

/** The digest form used in URLs and ETags: `sha256-<64 hex>`. */
export function sha256(text: string): string {
  return `sha256-${createHash("sha256").update(text).digest("hex")}`;
}
