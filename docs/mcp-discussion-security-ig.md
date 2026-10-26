<!-- DRAFT. Not posted. For the Security in MCP interest group (Discord channel name to confirm, e.g. #security-ig, or its GitHub Discussions category). Owner review required. -->

**Title:** Threat model check: tool definitions changing after user approval (four attacks, SDK prototype)

Hi all. I'm an independent developer working on tool-definition integrity for MCP. I'd like a security review of the threat model and the prototype, not a decision. It's an interest-group question, so I'm not asking for a working group or a sponsor yet.

**Threat.** A user approves a set of tools. Afterwards, the definitions can change: the publisher changes them, or something between server and client rewrites `tools/list`. The model then acts on the new text. `notifications/tools/list_changed` says the list changed but carries no diff, and asks for no consent.

**What I tested.** Four attacks against the unmodified TypeScript SDK (1.32.1, protocol 2025-11-25). After approval, an email tool's description gains an injected instruction (BCC an external address, hide it from the user), and a destructive tool's annotations are downgraded to read-only:
1. Publisher changes the list and sends `list_changed`.
2. Publisher changes the list silently.
3. Intermediary rewrites `tools/list` and keeps the original digests.
4. Intermediary rewrites `tools/list` and recomputes the digests.

In all four, the changed definitions reach the model. Scripts and results: https://github.com/dominicrico/bowline (`scripts/scenario-tamper.ts`, `bench/results/`).

**Proposal under review (strawman, not submitted).**
- A digest per tool, over the RFC 8785 canonical JSON of the tool object without its own digest.
- An optional detached signature over the sorted `name@digest` list, with a `kid` that a client matches to a trusted publisher key.
- Pinning: a client that records approval binds it to digests. A new or changed tool is withheld from the model until the user approves it again. The prompt shows a field-level diff and flags any change that lowers a safety annotation.

Draft: https://github.com/dominicrico/bowline/blob/main/docs/mcp-sep-signed-pinned-tools.md
Prototype: https://github.com/dominicrico/bowline/tree/main/packages/mcp-pinning (runs against the unmodified SDK; all four attacks stopped; an honest-publisher control loses no tools).

**Where I'd most value review.**
1. **Is the threat model complete?** I've considered publisher-side changes and in-transit rewriting. Have I missed a path, such as a compromised cache, a proxy that re-signs, or a client that never persists approvals?
2. **Signing is weaker than it looks.** A publisher with its own key can still ship a bad update. Only pinning stops that. I think the proposal should say so plainly. Is there a better mitigation, such as a transparency log for tool lists?
3. **Diff quality is the security boundary.** Pinning only helps if the user can see the change. What must the diff show for a user to decide safely? Is the effect-downgrade flag enough, or does a changed description need its own warning?
4. **Key discovery and rotation** are not designed. I'd value input on did:web, a well-known URL, or another approach, and on how revocation should work.
5. **Caching.** `ttlMs` and `cacheScope` could let a stale, approved list skip the check. Is that acceptable, or should pinning run on every list?

**What I'm not claiming.** Pinning detects change. It doesn't judge whether a change is safe, so a user who approves a malicious diff is still exposed. I haven't tested other MCP SDKs or a real server, and the prototype runs in-memory only.

**Asks.** Is this group the right place to review the threat model? Is there prior work on tool-definition integrity or a list of known attacks I should read first? If a working group should take this up later, which one would you suggest?

Thanks for reading. Rico
