import type { IncomingMessage, ServerResponse } from "node:http";
import {
  EFFECTS,
  canonicalize,
  parseSignature,
  sha256,
  type Capability,
  type Effect,
  type GroupDocument,
  type Manifest,
} from "@bowline/spec-types";

export type CapabilityDef = Omit<Capability, "http">;

export interface GroupDef {
  name: string;
  summary: string;
  types?: Record<string, string>;
  capabilities: CapabilityDef[];
}

export interface DiscoveryDef {
  server: Manifest["server"];
  auth: Manifest["auth"];
  groups: GroupDef[];
}

export interface Discovery {
  manifest: Manifest;
  /** Group documents by group name, as served at the manifest's `descriptors` URLs. */
  documents: Map<string, GroupDocument>;
  handle(req: IncomingMessage, res: ServerResponse): boolean;
}

const MANIFEST_MAX_AGE = 60;
const IMMUTABLE = "public, max-age=31536000, immutable";
const CONTENT_TYPE = "application/bowline+json";

/** Builds the tier 1 manifest and tier 2 group documents, and an HTTP handler that serves them. */
export function createDiscovery(def: DiscoveryDef): Discovery {
  const basePath = new URL(def.server.base).pathname.replace(/\/$/, "");
  const documents = new Map<string, GroupDocument>();
  const byPath = new Map<string, { body: string; digest: string }>();
  const groups: Manifest["groups"] = [];
  const seen = new Set<string>();

  for (const g of def.groups) {
    if (documents.has(g.name)) throw new Error(`duplicate group ${g.name}`);
    const effects = new Set<Effect>();
    const capabilities = g.capabilities.map((c): Capability => {
      if (seen.has(c.id)) throw new Error(`duplicate capability ${c.id}`);
      seen.add(c.id);
      if (c.summary.length > 120) throw new Error(`${c.id}: summary is over 120 characters`);
      if (!c.id.startsWith(`${g.name}.`)) throw new Error(`${c.id}: id must start with "${g.name}."`);
      parseSignature(c.sig);
      effects.add(c.effect);
      return { ...c, http: { method: "POST", path: `${basePath}/call/${c.id}` } };
    });
    const doc: GroupDocument = { group: g.name, types: g.types ?? {}, capabilities };
    const body = canonicalize(doc);
    const digest = sha256(body);
    const descriptors = `${basePath}/d/${g.name}@${digest}`;
    documents.set(g.name, doc);
    byPath.set(descriptors, { body, digest });
    groups.push({
      name: g.name,
      summary: g.summary,
      effects: EFFECTS.filter((e) => effects.has(e)),
      descriptors,
    });
  }

  const manifest: Manifest = { bowline: "0.1", server: def.server, auth: def.auth, groups };
  const manifestBody = canonicalize(manifest);
  const manifestDigest = sha256(manifestBody);

  function send(req: IncomingMessage, res: ServerResponse, entry: { body: string; digest: string }, cache: string) {
    const etag = `"${entry.digest}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", cache);
    if (req.headers["if-none-match"]?.split(",").some((t) => t.trim() === etag)) {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", CONTENT_TYPE);
    res.end(entry.body);
  }

  return {
    manifest,
    documents,
    handle(req, res) {
      if (req.method !== "GET" && req.method !== "HEAD") return false;
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/.well-known/bowline") {
        send(req, res, { body: manifestBody, digest: manifestDigest }, `public, max-age=${MANIFEST_MAX_AGE}`);
        return true;
      }
      const entry = byPath.get(path);
      if (!entry) return false;
      send(req, res, entry, IMMUTABLE);
      return true;
    },
  };
}
