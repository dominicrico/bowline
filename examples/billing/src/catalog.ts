import type { DiscoveryDef } from "@bowline/server";

const cap = (id: string, summary: string, sig: string, effect: "read" | "write" | "destructive" | "external", scope: string) => ({
  id, version: "1.0.0", summary, sig, effect, idempotent: effect === "read", scopes: [scope], async: "never" as const,
});

/** Fictional billing service from SPEC.md. Only the groups the v0.2 idle-cost check needs. */
export const catalog: DiscoveryDef = {
  server: { name: "Example Billing", publisher: "did:web:billing.example.com", base: "https://billing.example.com/bowline/v1" },
  auth: { issuer: "https://auth.example.com", metadata: "https://auth.example.com/.well-known/oauth-authorization-server", dpop: "required" },
  groups: [
    {
      name: "customers",
      summary: "Look up and update customer records",
      capabilities: [
        cap("customers.get", "Fetch one customer by id", "get(customerId: id): Customer", "read", "customers:read"),
        cap("customers.update", "Change a customer's name or billing email", "update(customerId: id, name?: string, billingEmail?: email): Customer", "write", "customers:write"),
      ],
    },
    {
      name: "invoices",
      summary: "Create, send, void and query invoices",
      capabilities: [
        cap("invoices.get", "Fetch one invoice by id", "get(invoiceId: id): Invoice", "read", "invoices:read"),
        cap("invoices.send", "Email a finalized invoice to the customer's billing contact", "send(invoiceId: id, message?: string[..500]): SendResult", "external", "invoices:send"),
        cap("invoices.void", "Void an unpaid invoice", "void(invoiceId: id): Invoice", "destructive", "invoices:void"),
      ],
    },
    {
      name: "reports",
      summary: "Generate revenue and aging reports (async)",
      capabilities: [cap("reports.revenue", "Generate a revenue report for a date range", "revenue(from: date, to: date): Report", "read", "reports:read")],
    },
  ],
};
