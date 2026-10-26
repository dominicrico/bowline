# Benchmark protocol: idle context cost (v0.2 gate)

Status: pre-registered on 2026-10-26, before any benchmark or Bowline code exists. Changes after the first results must be logged in the changelog at the end, with a reason.

## Question

Does Bowline's three-tier disclosure cut the context a model pays for before the first user message, compared with MCP, without moving that cost into later turns or hurting tool choice?

## Definitions

- **Idle cost.** Input tokens a client adds to every request just by connecting to a server. Measured as `count_tokens(request with the integration) - count_tokens(same request without it)`. The request holds one fixed user message, `"Hello"`, and no system prompt beyond what the integration adds.
- **Task cost.** Idle cost plus every disclosure an agent must load to finish one scripted task (tier 2 descriptors for Bowline, search results for deferred MCP). Tool call arguments and results are excluded, because they are the same for both protocols.
- **Selection accuracy.** Share of prompts where the model's first real call targets the correct capability.

## Tokenizer and model

- Counts come from `POST /v1/messages/count_tokens` with model `claude-opus-5-5`. No offline tokenizer (tiktoken undercounts Claude tokens).
- The model ID, the API date and the SDK version are recorded with every result file.
- Opus 5.5 is the only model in the gate. Other models may be reported, but they don't decide the gate.

## Arms

| Arm | What the model receives |
| --- | --- |
| **B1 Bowline** | Tier 1 manifest rendered as text in the system prompt, plus two tools: `bowline_describe(group)` and `bowline_call(capability, args)`. Both tool definitions count toward idle cost. |
| **M1 MCP eager** | Every tool from `tools/list` as a Claude tool definition (`name`, `description`, `input_schema`). This is the common client behaviour. |
| **M2 MCP deferred** | The same tools with `defer_loading: true`, plus the `tool_search_tool_bm25_20251119` tool. This is the best case an MCP client can reach today without changing the protocol. |
| **M3 MCP scoped** | GitHub catalog only: the server's own `default` toolsets, as shipped. |

`outputSchema` is not sent in any arm, because Claude tool definitions have no field for it. Bowline output types appear only in tier 2, so the comparison stays like for like.

## Catalogs

### C1 Billing (controlled)

One source file defines every capability once: id, summary, BSig input, output type, effect, idempotency and scopes. Generators emit the Bowline manifest and descriptors and the MCP tool list from that same file. Neither side gets hand-tuned text.

- MCP `description` equals the Bowline `summary`. Effect class and idempotency are added to the MCP description as one short sentence, because Bowline shows them in tier 1 and the model needs the same information in both arms.
- MCP `input_schema` is the JSON Schema expanded from BSig by the reference expander.
- Scale points: **5** capabilities (invoices subset), **25** (the full billing service: customers, invoices, payments, subscriptions, reports; 5 per group) and **100** (billing plus 15 more groups built from the same templates).
- Known limitation: the 100-point groups are synthetic, so their names and summaries are more regular than real APIs. C3 exists to check that. G2 stays on C1, so the scaling comparison uses one consistent catalog.

### C3 Stripe billing subset (real world, 100 scale)

- Source: Stripe's public OpenAPI spec (`stripe/openapi`, MIT licence), API version `2026-09-30.endive`. The spec file is pinned by commit SHA when it is captured.
- Subset rule, fixed in advance: every GET, POST and DELETE operation under `/v1/customers`, `/v1/invoices`, `/v1/invoiceitems`, `/v1/subscriptions`, `/v1/subscription_items`, `/v1/credit_notes`, `/v1/refunds` and `/v1/prices`. That gives **103** operations as of 2026-10-26.
- Both arms come from the OpenAPI-to-Bowline generator: resources become groups, and the HTTP method sets the effect class as `SPEC.md` describes. The spec is OpenAPI 3.0, so the generator must accept 3.0 or convert it to 3.1 first.
- Descriptions: both arms use the same summary, the first sentence of the operation description with HTML stripped and a 120-character cap. This favours MCP, because a real OpenAPI-to-MCP generator would usually ship the full description (median 132 characters, longest 3,089). A second, reported-only run gives M1 the full descriptions.
- Reported, not gated. A C3 ratio below the C1 ratio at 100 means the synthetic catalog flatters Bowline, which triggers a review.

### C2 GitHub (real world)

- Source: `github/github-mcp-server` **v2.0.3** (released 2026-10-21), run locally. `tools/list` is captured once and committed as JSON, so reruns don't depend on the network.
- Captured twice: the `default` toolsets and `all`.
- The Bowline arm comes from the MCP-to-Bowline bridge. Toolsets become groups and toolset descriptions become group summaries. Every capability is `effect: external` until annotated, as `SPEC.md` requires.
- No hand-written Bowline summaries. If the bridge output is poor, that is a result, not something to fix before measuring.

## Tasks (task cost)

Ten scripted billing tasks, fixed before measuring. Each one lists the capabilities it needs. Examples:

1. Look up a customer by email. (1 group)
2. Create an invoice for a customer and send it. (2 groups)
3. Void an invoice and refund the payment. (2 groups)
4. Generate an aging report. (1 group, async)
5. Change a subscription plan and issue a prorated invoice. (3 groups)

The full list is written as data with the benchmark code, before the first run. Task cost is computed without a model, from the disclosures each arm needs. For M2, the search results returned for the task's capability names stand in for the search step.

## Selection accuracy

- 60 prompts against C1 at 25 capabilities, each with exactly one correct capability, written before the first run. The count was raised from 30 on 2026-10-26, because with 30 prompts a 5-point margin is within noise.
- Run all three arms (B1, M1, M2) once per prompt, with `tool_choice: auto` and default effort.
- B1 counts as correct when the model describes the right group and then calls the right capability. M2 counts as correct when the search finds the tool and the model calls it.
- Approximate cost: 180 requests at a few thousand input tokens each, under USD 10 at Opus 5.5 list price. Each run needs the owner's approval first.

## Gate (v0.2)

Bowline passes v0.2 when all four hold:

| # | Criterion | Threshold |
| --- | --- | --- |
| G1 | Idle cost ratio M1 / B1 on C1 at 25 capabilities | at least **3.0x** |
| G2 | The ratio grows from 25 to 100 capabilities | strictly higher at 100 |
| G3 | Task cost: B1 is no worse than M1 for every task touching 2 or fewer groups | B1 <= M1 |
| G4 | Selection accuracy: B1 vs M1 | B1 >= M1 minus 5 points |

If G1 or G2 fails, the progressive disclosure design needs rework. If G3 or G4 fails, Bowline's savings are moving cost around or hiding needed information, and the gate fails even if G1 passes.

## Reported, not gated

- **B1 vs M2 (deferred MCP).** This feeds the standalone-vs-MCP decision. If B1 doesn't beat M2 idle cost by at least 1.5x, the context saving is achievable as a client feature, which strengthens the case for proposing Bowline's other ideas to MCP.
- **C2 GitHub ratios** for `default` and `all`. If a ratio is under 2x, the result triggers a review of the bridge and the tier 1 format.
- Absolute token numbers for every arm, catalog and scale point.

## Reproducibility

- One command reruns everything and writes raw counts as JSON under `bench/results/`.
- Results files are committed. Summary tables are generated from them, never typed by hand.
- The benchmark code lives in the monorepo and uses the same generators as the SDK, so the arms can't drift apart.

## To verify before the first run

- **Resolved 2026-10-26: `count_tokens` counts deferred tools, at a much lower rate.** Model `claude-opus-5-5`, 20 identical small tools, BM25 search tool: no tools 11 tokens; search tool alone 561; search tool plus 20 deferred 654 (+93, about 4.7 per tool); 20 eager tools without search 2,617 (about 103 per tool). By the rule below, M2 is therefore measured from `usage.input_tokens` on a real request, with `max_tokens` 1 and the same fixed "Hello" message, and the `count_tokens` figure is reported next to it. Two facts this adds: the search tool itself costs about 550 tokens, which is a floor for M2 idle cost, and deferred tools still cost a few tokens each, so M2 grows slowly with catalog size instead of staying flat. The test used short synthetic tools. Real catalogs will give different absolute numbers.
- Original question, kept for the record. The tool search docs say that, at first, only the search tool and non-deferred tools are in context, and that deferred tools are kept out of the system-prompt prefix. The docs say nothing about `count_tokens` specifically. To confirm, compare `count_tokens` for (a) the search tool alone, (b) the search tool plus N deferred tools and (c) N eager tools. If (b) equals (a), `count_tokens` excludes deferred tools and is valid for M2. Otherwise M2 is measured from `usage.input_tokens` on a real request that ends before any search.
- Whether GitHub MCP server v2.0.3 speaks MCP 2026-07-28. Capture `tools/list` with whatever protocol version it supports, and record that version.

## Changelog

- 2026-10-26: initial protocol.
- 2026-10-26: added C3 (Stripe subset, 103 operations) as a real-world check at the 100 scale; recorded what the docs say about deferred tools. Both changes were made before any results existed.
- 2026-10-26: ran the `count_tokens` deferred-tools check (see "To verify"). It is a measurement of the API, not a Bowline result. M2 now uses `usage.input_tokens` from a real request. The gate and thresholds are unchanged.
- 2026-10-26: owner review of the thresholds. G1 stays at 3.0x, the deferred-MCP check stays reported at 1.5x, and the margin in G4 stays at 5 points. The selection test grows from 30 to 60 prompts. No results existed when this was decided.
