# Draft SEP: Digest-addressed, signed and pinned tool definitions

Status: strawman, not submitted. Written 2026-10-26. Type: Standards Track (possibly Extensions Track). Author: Rico.

This is a draft in MCP's SEP format. MCP's process requires prior discussion in a working or interest group, a linked thread in the pull request, a sponsor, and a prototype before acceptance. None of that has happened yet. Names and field shapes below are placeholders for that discussion. Checked against the draft Tools page on 2026-10-26.

## Abstract

A client approves a set of tool definitions once, then lets a model use them for a long time. Today nothing ties the approval to the bytes that were approved. A server, or anything between server and client, can change a description or an annotation after approval, and the model sees the change. `notifications/tools/list_changed` signals that the list changed. It carries no diff and asks for no consent. This proposal adds a digest per tool definition, an optional publisher signature over the list, and a client requirement to bind approval to digests and to re-ask when they change.

## Motivation

The Tools page already warns that clients must treat annotations as untrusted unless they come from trusted servers. It gives clients no way to establish trust, and no way to notice that a definition changed.

We ran a four-attack scenario against the official TypeScript SDK 1.32.1 (`scripts/scenario-tamper.ts`, result `bench/results/tamper-2026-10-26T11-19-57.361Z.json`). After approval, the description of an email-sending tool gained an injected instruction, and a destructive tool was downgraded to read-only. In all four attacks the changed definition reached the model:

1. The server changes definitions and sends `list_changed`.
2. The server changes definitions with no notification.
3. An intermediary rewrites the `tools/list` response.
4. An intermediary rewrites the whole exchange.

The SDK has no hook that would have stopped any of them. The effect is worst for annotations such as `destructiveHint`, because a downgrade removes the signal that would make a client ask for confirmation.

## Specification (strawman)

1. **Tool digest.** A server SHOULD include `digest` on each tool: `sha256-<hex>` over the RFC 8785 canonical JSON of the tool object without its `digest` field.
2. **Verification.** A client that receives a `digest` MUST recompute it and MUST discard the tool if it does not match.
3. **Signed list (optional).** A server MAY include a detached JWS over the sorted list of tool digests, with a `kid` that resolves to a publisher key (for example `did:web`). A client that holds a trusted key for the server MUST reject a list whose signature does not verify.
4. **Pinning.** A client that records user approval of tools MUST record it against tool digests. When a digest for an approved tool changes, or a tool is added, the client MUST NOT expose the changed tool to the model until the user approves it again. The prompt SHOULD show a field-level diff and SHOULD flag any change that lowers an effect declaration, such as `destructiveHint` true to false.
5. **Trust for annotations.** Annotations from a list whose signature verifies against a key the user trusts MAY be treated as trusted. Otherwise the current rule applies unchanged.

Not in this proposal: a mandatory effect class, delegation identity, and request-bound step-up approval. They depend on this one and are better as separate proposals.

## Rationale

- **Why a digest and not a version number.** A version is a claim by the server. A digest is checkable by the client and by any cache in between.
- **Why optional signing.** Digests alone catch tampering by an intermediary who does not control the server. They do not catch a malicious or compromised publisher, who can ship a new valid digest. Signing lets a user trust a publisher key and see when it changes. Publisher key discovery is the hard part and is left open here.
- **Why pinning must be normative.** The mechanism does nothing if each client may ignore it. The scenario shows that without a requirement, the default outcome is silent acceptance.
- **Alternative: client-only pinning.** A client can hash approved tool lists today without any protocol change, and it would have stopped all four attacks. We recommend it. A protocol requirement still helps because it makes the behaviour testable in a conformance suite and gives users the same guarantee in every client.

## Backward compatibility

Fields are additive. Servers without digests keep working, and clients then fall back to hashing the received definition themselves, which gives pinning but not integrity against an intermediary. The pinning requirement changes client behaviour only for clients that already persist approvals.

## Reference implementation

`packages/mcp-pinning` is a prototype against the unmodified TypeScript SDK 1.32.1. It has no SDK dependency and works on the tool objects and `tools/list` results the SDK produces.

- **Server side:** `signedToolsResult()` adds a digest to each tool and a detached EdDSA JWS over the sorted `name@digest` list.
- **Client side:** `guardTools()` checks the list signature (when the user trusts a publisher key), then each tool's digest, then the user's pins (`ToolPins`). Only pinned tools are exposed. Changed tools come back with a field-level diff and an effect-downgrade flag.
- **Evidence:** `scripts/scenario-tamper.ts` runs the four attacks over the real SDK with the prototype on. All four are stopped, and an honest publisher is never withheld (25 of 25 tools exposed). Result: `bench/results/tamper-*.json`, column `mcpPrototype`.

Two findings from building it:
1. The SDK's `ToolSchema` drops unknown top-level fields on the client. The prototype therefore carries the digest in the tool's `_meta` and the signature in the result's `_meta`. A final SEP must either use `_meta` or extend the schema.
2. Rows 1 and 2 use the publisher's own key, so the signature is valid. Only pinning stops a publisher who ships a bad update. The signature adds protection against intermediaries and lets a user trust a publisher by key.

Still to do before acceptance: a conformance scenario, publisher key discovery, and a pass over how this interacts with `ttlMs` and `cacheScope`. Bowline's own group-document version of the same checks stays in `packages/client/src/discovery.ts`.

## Security implications

- Pinning detects change. It does not decide whether a change is safe. A user who approves a malicious diff is still compromised, so diffs must be readable and downgrades must be flagged.
- Digest verification needs canonical JSON that every implementation reproduces byte for byte.
- Without publisher signatures, a compromised publisher is not caught by digests.
- A trust-on-first-use model has the usual first-contact weakness.

## Open questions for the working group

- Does this fit the core protocol or an extension?
- How should publisher keys be discovered and rotated?
- Should the digest cover `outputSchema` and annotations (this draft says yes, as part of the whole tool object)?
- How does this interact with `ttlMs` and `cacheScope` caching?
