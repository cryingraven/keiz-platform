import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentService } from '../agent/agent.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { VendorsService } from '../vendors/vendors.service';
import { formatUnits } from '@keiz/shared';

const requestContextSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  accountId: z.string().min(1),
});

type ToolContext = {
  requestContext?: { get: (key: string) => unknown };
};

function requireOrg(context: ToolContext | undefined): string {
  const orgId = context?.requestContext?.get('orgId');
  if (typeof orgId !== 'string' || !orgId) {
    throw new Error('Missing orgId in request context - refusing to query tenant data');
  }
  return orgId;
}

export interface ChatToolDeps {
  invoices: InvoicesService;
  vendors: VendorsService;
  payments: PaymentsService;
  agent: AgentService;
}

/**
 * Tools are created once, but every query is scoped by the orgId that Nest puts
 * into the per-request Mastra RequestContext. The model never sees or chooses it.
 */
export function createChatTools(deps: ChatToolDeps) {
  const listInvoices = createTool({
    id: 'list-invoices',
    description:
      'List invoices for the current organization, optionally filtered by status. Use before stating any invoice fact.',
    inputSchema: z.object({
      status: z
        .enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAYMENT_PENDING', 'PAID', 'VOID'])
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    requestContextSchema,
    execute: async ({ status, limit }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = await deps.invoices.list(orgId, status);
      return rows.slice(0, limit ?? 20).map((invoice) => ({
        number: invoice.number,
        status: invoice.status,
        currency: invoice.currency,
        total: formatUnits(invoice.total, invoice.decimals),
        dueDate: invoice.dueDate,
      }));
    },
  });

  const getInvoice = createTool({
    id: 'get-invoice',
    description: 'Get one invoice by its invoice number, for example INV-1042.',
    inputSchema: z.object({ number: z.string().min(1) }),
    requestContextSchema,
    execute: async ({ number }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = await deps.invoices.list(orgId);
      const invoice = rows.find(
        (row) => row.number.toLowerCase() === number.toLowerCase(),
      );
      if (!invoice) return { error: `Invoice ${number} not found` };
      return {
        number: invoice.number,
        status: invoice.status,
        currency: invoice.currency,
        total: formatUnits(invoice.total, invoice.decimals),
        subtotal: formatUnits(invoice.subtotal, invoice.decimals),
        tax: formatUnits(invoice.taxAmount, invoice.decimals),
        dueDate: invoice.dueDate,
        lineItems: invoice.lineItems.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      };
    },
  });

  const spendSummary = createTool({
    id: 'spend-summary',
    description:
      'Totals grouped by invoice status plus the vendor count. Use for spend, burn or pipeline questions.',
    inputSchema: z.object({}),
    requestContextSchema,
    execute: async (_input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const [byStatus, vendorRows] = await Promise.all([
        deps.invoices.summary(orgId),
        deps.vendors.list(orgId),
      ]);
      return {
        byStatus: byStatus.map((row) => ({
          status: row._id,
          count: row.count,
          // aggregate returns minor units as a double
          total: (row.total / 100).toFixed(2),
        })),
        vendorCount: vendorRows.length,
      };
    },
  });

  const listVendors = createTool({
    id: 'list-vendors',
    description: 'List active vendors with their payout chain and address.',
    inputSchema: z.object({}),
    requestContextSchema,
    execute: async (_input, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = await deps.vendors.list(orgId);
      return rows.map((vendor) => ({
        name: vendor.name,
        email: vendor.email,
        payoutChain: vendor.payoutChain,
        payoutAddress: vendor.payoutAddress,
      }));
    },
  });

  const proposePayment = createTool({
    id: 'propose-payment',
    description:
      'Create an agent payment proposal for an APPROVED invoice. This never moves funds; it only queues an action for a human to approve or execute.',
    inputSchema: z.object({
      invoiceNumber: z.string().min(1),
      reason: z.string().max(1000).optional(),
    }),
    requestContextSchema,
    execute: async ({ invoiceNumber, reason }, context) => {
      const orgId = requireOrg(context as ToolContext);
      const rows = await deps.invoices.list(orgId);
      const invoice = rows.find(
        (row) => row.number.toLowerCase() === invoiceNumber.toLowerCase(),
      );
      if (!invoice) return { error: `Invoice ${invoiceNumber} not found` };
      if (invoice.status !== 'APPROVED') {
        return { error: `Invoice is ${invoice.status}; only APPROVED invoices can be proposed` };
      }
      const tokens = await deps.payments.tokens();
      const asset = tokens.find(
        (token) => token.symbol === 'USDC' && token.blockchain === 'near',
      );
      if (!asset) return { error: 'USDC on NEAR is unavailable in the token list' };

      const action = await deps.agent.propose(orgId, {
        invoiceId: String(invoice._id),
        asset: asset.assetId,
        reason: reason ?? 'Proposed from chat',
      });
      return {
        actionId: String(action._id),
        status: action.status,
        amountUsd: action.amountUsd,
        reason: action.reason,
      };
    },
  });

  return { listInvoices, getInvoice, spendSummary, listVendors, proposePayment };
}

export type ChatTools = ReturnType<typeof createChatTools>;
