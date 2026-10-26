<!-- DRAFT. Not posted. Owner review required before posting to MCP Discord, GitHub Discussions or a working group. -->

**Title:** Pinning and signing tool definitions: a SEP draft and an SDK prototype

Hi all. I'd like to discuss a gap in how clients handle `tools/list` after the user has approved tools, and I have a draft SEP and a prototype to show.

**The gap.** A client approves a set of tools once. After that, nothing ties the approval to the bytes that were approved. A server can change a description or annotation, or something between server and client can rewrite the response, and the model sees the change. `notifications/tools/list_changed` says the list changed. It carries no diff and asks for no consent.

**What I tested.** I ran four attacks against the unmodified TypeScript SDK (1.32.1, protocol 2025-11-25). After approval, an email tool's description gained an injected instruction, and a destructive tool's annotations were downgraded to read-only. The changed definitions reached the model in all four cases. The attacks were: a publisher change with a notification, a silent publisher change, an intermediary that rewrote `tools/list` and kept the old digests, and an intermediary that rewrote and re-digested. Scripts and results are in the repo: https://github.com/dominicrico/bowline (`scripts/scenario-tamper.ts`, `bench/results/`).

**What the draft proposes.**
- A digest per tool, over the RFC 8785 canonical JSON of the tool object without its own digest.
- An optional detached signature over the sorted list of `name@digest`, with a `kid` that a client can match to a trusted publisher key.
- Normative pinning: a client that records approval must bind it to digests. A changed or new tool is not exposed to the model until the user approves it again. The prompt should show a field-level diff and flag any change that lowers a safety annotation.

**What the prototype shows.** `@bowline/mcp-pinning` runs against the unmodified SDK. With it on, all four attacks are stopped. An honest publisher loses no tools, which I checked with a control run. The prototype has no SDK dependency and works on the objects `listTools()` returns.

**Things we found while building it.**
1. The SDK's `ToolSchema` drops unknown top-level fields on the client. The prototype carries the digest in `_meta` and the signature in the result's `_meta`. A real SEP would need to use `_meta` or extend the schema. I'd like the group's view on which.
2. Signing does not stop a publisher who ships a bad update with its own key. Only pinning does. Signing protects against intermediaries and lets users trust a publisher key. I think the proposal should say this plainly.

**Open questions for the group.**
- Core protocol change or extension? The draft is labelled Standards Track, possibly Extensions Track.
- How are publisher keys discovered and rotated? I have no proposal for this yet, and I'd value input (did:web, a well-known URL, or something else).
- Should the digest cover `outputSchema` and annotations? The draft says yes.
- How does this interact with `ttlMs` and `cacheScope`? A cached list could skip the check.
- Should pinning be a MUST for every client, or only for clients that persist approvals? The draft says the latter.

**What we are not claiming.** Pinning detects change. It does not decide whether a change is safe. A user who approves a malicious diff is still exposed. I have not tested this against other MCP SDKs or any real server, and the prototype is in-memory only.

**Asks.** Is this the right venue? If so, which working or interest group should sponsor it? Is there an existing discussion of tool-definition integrity I should read first? If the group thinks the idea belongs elsewhere, a pointer would help.

Draft SEP: https://github.com/dominicrico/bowline/blob/main/docs/mcp-sep-signed-pinned-tools.md. Prototype: https://github.com/dominicrico/bowline/tree/main/packages/mcp-pinning. Thanks for reading.

— Rico
