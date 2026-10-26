import type { CapabilityDef, DiscoveryDef, GroupDef } from "@bowline/server";

type Effect = CapabilityDef["effect"];

// [name, summary, sig, effect, idempotent, async]. The id is `<group>.<name>`; the scope follows from the effect.
type Row = [string, string, string, Effect, boolean, CapabilityDef["async"]?];

function group(name: string, summary: string, types: Record<string, string>, rows: Row[]): GroupDef {
  return {
    name,
    summary,
    types,
    capabilities: rows.map(([n, s, sig, effect, idempotent, async = "never"]) => ({
      id: `${name}.${n}`,
      version: "1.0.0",
      summary: s,
      sig,
      effect,
      idempotent,
      scopes: [`${name}:${effect === "read" || effect === "write" ? effect : n.toLowerCase()}`],
      async,
      ...(effect === "destructive" || effect === "external" ? { stepUp: "required" as const } : {}),
    })),
  };
}

const MONEY = "{ amount: string, currency: string }";

/** The fictional billing service from SPEC.md at the protocol's 25-capability scale point (5 groups of 5). */
export const catalog: DiscoveryDef = {
  server: { name: "Example Billing", publisher: "did:web:billing.example.com", base: "https://billing.example.com/bowline/v1" },
  auth: { issuer: "https://auth.example.com", metadata: "https://auth.example.com/.well-known/oauth-authorization-server", dpop: "required" },
  groups: [
    group("customers", "Look up and update customer records", { Money: MONEY, Customer: "{ customerId: id, name: string, billingEmail: email, openBalance: Money }" }, [
      ["get", "Fetch one customer by id", "get(customerId: id): Customer", "read", true],
      ["find", "Find customers by billing email or name", "find(email?: email, name?: string): Customer[]", "read", true],
      ["create", "Create a customer record", "create(name: string, billingEmail: email, currency = \"EUR\"): Customer", "write", false],
      ["update", "Change a customer's name or billing email", "update(customerId: id, name?: string, billingEmail?: email): Customer", "write", true],
      ["delete", "Permanently delete a customer with no open invoices", "delete(customerId: id): { customerId: id, deleted: bool }", "destructive", true],
    ]),
    group(
      "invoices",
      "Create, send, void and query invoices",
      {
        Money: MONEY,
        Line: "{ description: string[1..500], quantity: int, unitPrice: number }",
        Invoice: "{ invoiceId: id, customerId: id, status: \"draft\" | \"open\" | \"paid\" | \"void\", total: Money, lines: Line[] }",
        Receipt: "{ receiptId: id }",
        SendResult: "{ invoiceId: id, sentTo: email, sentAt: datetime, receipt: Receipt }",
      },
      [
        ["create", "Create a draft invoice for a customer", "create(customerId: id, lines: Line[1..100], dueDate?: date, currency = \"EUR\"): Invoice", "write", false],
        ["get", "Fetch one invoice by id", "get(invoiceId: id): Invoice", "read", true],
        ["list", "List invoices, optionally by customer or status", "list(customerId?: id, status?: \"draft\" | \"open\" | \"paid\" | \"void\", limit = 50): Invoice[]", "read", true],
        ["send", "Email a finalized invoice to the customer's billing contact", "send(invoiceId: id, message?: string[..500]): SendResult", "external", false],
        ["void", "Void an unpaid invoice", "void(invoiceId: id): Invoice", "destructive", true],
      ],
    ),
    group("payments", "Record, query and refund payments", { Money: MONEY, Payment: "{ paymentId: id, invoiceId: id, amount: Money, receivedAt: datetime }" }, [
      ["record", "Record a payment received against an invoice", "record(invoiceId: id, amount: number, receivedAt?: datetime): Payment", "write", false],
      ["get", "Fetch one payment by id", "get(paymentId: id): Payment", "read", true],
      ["list", "List payments, optionally by invoice", "list(invoiceId?: id, limit = 50): Payment[]", "read", true],
      ["refund", "Refund a payment to the customer's original payment method", "refund(paymentId: id, amount?: number): Payment", "external", false],
      ["reconcile", "Match a bank transaction to a recorded payment", "reconcile(paymentId: id, bankTransactionId: id): Payment", "write", true],
    ]),
    group("subscriptions", "Manage recurring plans and their billing", { Subscription: "{ subscriptionId: id, customerId: id, plan: string, status: \"active\" | \"paused\" | \"canceled\", renewsOn?: date }" }, [
      ["create", "Start a subscription on a plan", "create(customerId: id, plan: string, startsOn?: date): Subscription", "write", false],
      ["get", "Fetch one subscription by id", "get(subscriptionId: id): Subscription", "read", true],
      ["changePlan", "Switch a subscription to another plan, prorated", "changePlan(subscriptionId: id, plan: string): Subscription", "write", true],
      ["pause", "Pause billing until a resume date", "pause(subscriptionId: id, resumeOn?: date): Subscription", "write", true],
      ["cancel", "Cancel a subscription at the end of the period", "cancel(subscriptionId: id): Subscription", "destructive", true],
    ]),
    group("reports", "Generate revenue and aging reports (async)", { Report: "{ reportId: id, kind: string, status: \"running\" | \"ready\" | \"failed\", url?: string }" }, [
      ["revenue", "Generate a revenue report for a date range", "revenue(from: date, to: date): Report", "read", true, "always"],
      ["aging", "Generate an accounts receivable aging report", "aging(asOf?: date): Report", "read", true, "always"],
      ["taxSummary", "Generate a tax summary for a quarter", "taxSummary(year: int, quarter: int): Report", "read", true, "always"],
      ["get", "Fetch a generated report by id", "get(reportId: id): Report", "read", true],
      ["list", "List recently generated reports", "list(limit = 20): Report[]", "read", true],
    ]),
  ],
};

// [plural, singular, one-line purpose]. Synthetic: names and summaries come from one template, so they are
// more regular than a real API (protocol, C1 known limitation).
const NOUNS: [string, string, string][] = [
  ["orders", "order", "customer orders"],
  ["products", "product", "the product catalog"],
  ["shipments", "shipment", "outbound shipments"],
  ["vendors", "vendor", "supplier records"],
  ["expenses", "expense", "employee expenses"],
  ["budgets", "budget", "department budgets"],
  ["contracts", "contract", "customer contracts"],
  ["quotes", "quote", "sales quotes"],
  ["credits", "credit", "credit notes"],
  ["taxes", "tax", "tax rates and filings"],
  ["ledgers", "ledger", "general ledger entries"],
  ["payouts", "payout", "vendor payouts"],
  ["disputes", "dispute", "payment disputes"],
  ["coupons", "coupon", "discount coupons"],
  ["wallets", "wallet", "prepaid customer wallets"],
];

function templated([plural, one, purpose]: [string, string, string]): GroupDef {
  const T = one[0]!.toUpperCase() + one.slice(1);
  const id = `${one}Id`;
  return group(plural, `Create, query and update ${purpose}`, { [T]: `{ ${id}: id, name: string, status: "active" | "archived" }` }, [
    ["get", `Fetch one ${one} by id`, `get(${id}: id): ${T}`, "read", true],
    ["list", `List ${plural}, optionally by status`, `list(status?: "active" | "archived", limit = 50): ${T}[]`, "read", true],
    ["create", `Create a ${one}`, `create(name: string): ${T}`, "write", false],
    ["update", `Rename a ${one} or change its status`, `update(${id}: id, name?: string, status?: "active" | "archived"): ${T}`, "write", true],
    ["delete", `Permanently delete a ${one}`, `delete(${id}: id): { ${id}: id, deleted: bool }`, "destructive", true],
  ]);
}

/** The protocol's 100-capability scale point: the billing service plus 15 templated groups. */
export const catalog100: DiscoveryDef = { ...catalog, groups: [...catalog.groups, ...NOUNS.map(templated)] };
