// The ten scripted billing tasks of the v0.2 gate (docs/benchmark-protocol.md, "Tasks").
// Fixed before the first task-cost run. `needs` lists the capabilities a finished task calls.
export interface Task {
  id: number;
  prompt: string;
  needs: string[];
}

export const tasks: Task[] = [
  { id: 1, prompt: "Look up the customer with billing email accounts@atelier-nord.example.", needs: ["customers.find"] },
  { id: 2, prompt: "Create an invoice for customer cus_4821 with one line, 3 hours of consulting at 120 EUR, and send it.", needs: ["customers.get", "invoices.create", "invoices.send"] },
  { id: 3, prompt: "Void invoice inv_204 and refund its payment pay_77.", needs: ["invoices.get", "invoices.void", "payments.list", "payments.refund"] },
  { id: 4, prompt: "Generate an accounts receivable aging report as of today and give me the link.", needs: ["reports.aging", "reports.get"] },
  { id: 5, prompt: "Move subscription sub_19 to the Pro plan and invoice the prorated difference to the customer.", needs: ["customers.get", "subscriptions.changePlan", "invoices.create"] },
  { id: 6, prompt: "Change the billing email of customer cus_4821 to ap@atelier-nord.example.", needs: ["customers.get", "customers.update"] },
  { id: 7, prompt: "Record a payment of 360 EUR received yesterday against invoice inv_204.", needs: ["invoices.get", "payments.record"] },
  { id: 8, prompt: "Cancel subscription sub_19 and then delete customer cus_4821.", needs: ["subscriptions.cancel", "customers.delete"] },
  { id: 9, prompt: "Generate the revenue report for Q3 2026 and the tax summary for the same quarter.", needs: ["reports.revenue", "reports.taxSummary", "reports.get"] },
  { id: 10, prompt: "Onboard Nordlicht GmbH: create the customer, start a Pro subscription, invoice the first month and send the invoice.", needs: ["customers.create", "subscriptions.create", "invoices.create", "invoices.send"] },
];
