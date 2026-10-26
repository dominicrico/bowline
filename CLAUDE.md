# Bowline: project context

Bowline is a draft protocol for connecting AI agents to remote capabilities, designed as a better-engineered alternative to MCP for agent-to-tool access. The full draft lives in `SPEC.md`. Read it before designing or changing anything protocol-related; treat this repo's `SPEC.md` as the single source of truth from now on.

Status: v0.1 strawman with a TypeScript reference implementation (discovery server, client with pinning, MCP bridge) and benchmarks under `bench/`. "Bowline" replaced the earlier working name "Keel" on 2026-10-26 after collision checks (npm, PyPI, GitHub, web: no AI-protocol conflicts found). Trademark and domain checks are still open. Use `@bowline/*` for npm and `bowline-protocol` for the GitHub org.

## How this started

The idea came from a critical review of the article "MCP Is Dead" (Lucas McGregor, Medium, 2026), written after Perplexity announced in March 2026 that it stopped using MCP internally in favour of plain APIs and CLIs. Our assessment of the article:

- Valid and kept: enterprise API discipline (auth, rate limits, versioning, audit) is the solution, not bureaucracy; tool schema context overhead is a real cost; unauthenticated internet-exposed servers are a real-world problem.
- Overstated or outdated, so we did not design against them: "MCP has no auth" (it has an optional OAuth 2.1 profile), "MCP needs two connections and cannot scale" (that described the old HTTP+SSE transport), "MCP has no contracts" (non-determinism comes from the model, not the protocol), "MCP cannot be fixed".
- Our stance: the real gaps are idle context cost, optional contracts and side-effect declarations, optional remote security, missing delegation identity, and descriptor tampering or prompt injection. Bowline targets exactly those.

## Core design decisions (do not change without discussing)

1. Build on existing standards (HTTP, OpenAPI 3.1, OAuth 2.1, RFC 9457, W3C Trace Context). No new transport, auth scheme or schema language beyond the thin BSig signature syntax.
2. Progressive disclosure in three tiers (manifest, descriptor, docs), content-addressed by SHA-256 and cached immutably.
3. Mandatory per capability: output schema, effect class (`read` / `write` / `destructive` / `external`), idempotency flag, scopes.
4. Stateless request/response; long work is a task resource (`202` + task URL, poll, signed webhook, resumable SSE).
5. No unauthenticated remote profile. OAuth 2.1 + PKCE + DPoP; RFC 8693 token exchange so every token names user (`sub`), agent (`act`) and client.
6. Step-up approval for `destructive` and `external` effects, bound to a digest of the request body, via CIBA.
7. Signed manifests, digest pinning, re-consent when descriptors change; all tool output labelled untrusted.
8. Scope: agent-to-capability only. Agent-to-agent stays with A2A.
9. Adoption first: bridges (Bowline to MCP, MCP to Bowline, OpenAPI to Bowline) are core, not optional.

## Decision (2026-10-26): upstream to MCP, not standalone

Gate results: G1, G2 and G3 passed, G4 failed (see `docs/benchmark-protocol.md` changelog). Deferred MCP tool search removes most of the context-cost advantage, and the tampering scenario shows client-side pinning closes most of the security gap. Next steps: discuss the first proposal (`docs/mcp-sep-signed-pinned-tools.md`) in an MCP working group before any pull request, build a TypeScript SDK prototype, and test publisher-signed manifests. Core design decision 8 and the adoption goal in decision 9 stand. Decisions 1 to 7 are now the content of proposals, not of a standalone spec. Do not submit anything to MCP without the owner's approval.

## Earlier focus: roadmap step v0.2 (done)

Build the TypeScript reference implementation first:

- Server SDK: manifest and descriptor serving with digests and caching headers, call endpoint, task resource, RFC 9457 errors, idempotency store.
- Client SDK: discovery and caching, BSig to JSON Schema expansion, call and task handling, rendering the tier 1 manifest as compact model-facing text.
- A demo server modelled on the fictional billing service in `SPEC.md`.
- Measure idle context cost against an equivalent MCP server; that number is the gate for v0.2.

Auth (DPoP, token exchange, CIBA) can start as a pluggable interface with a dev-mode stub, but the stub must never be usable for remote serving.

## Open questions

See the checklist at the end of `SPEC.md`. The biggest one: ship as a standalone protocol or propose the core ideas to MCP as enhancement proposals. Do not resolve these silently in code; flag them.

## Working preferences

- Stack: TypeScript on Node.js, monorepo with separate packages for spec types, server, client and bridges. Docker for local demos.
- Spec changes and code changes go in separate commits; update `SPEC.md` when an implementation decision changes the protocol.
- The comparison table was verified on 2026-10-26 against MCP 2026-07-28 and A2A v1.0.0. Re-check it whenever either spec ships a new revision. MCP is now stateless and caches `tools/list`, so do not argue against sessions or connection scaling.
- Prose in docs: clear, short sentences, no em-dashes.
