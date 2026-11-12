import { describe, expect, it, vi } from 'vitest';
import { RequestContext } from '@mastra/core/request-context';
import { computeInvoiceTotals } from '@keiz/shared';
import type { ChatToolDeps } from './tools';
import { createChatTools } from './tools';

const vendor = {
  _id: 'ven-1',
  name: 'Acme',
  email: 'billing@acme.test',
  payoutChain: 'near',
  payoutAddress: 'acme.near',
  status: 'ACTIVE',
};

const customer = {
  _id: 'cus-1',
  name: 'Globex',
  email: 'ap@globex.test',
  status: 'ACTIVE',
};

function makeDeps(overrides: Partial<Record<keyof ChatToolDeps, unknown>> = {}) {
  const deps = {
    vendors: {
      list: vi.fn(async () => [vendor]),
      create: vi.fn(async (_orgId: string, input: Record<string, unknown>) => ({
        ...vendor,
        ...input,
        _id: 'ven-new',
      })),
    },
    invoices: {
      list: vi.fn(async () => []),
      create: vi.fn(async (_orgId: string, _userId: string, input: Record<string, unknown>) => {
        const totals = computeInvoiceTotals(
          input.lineItems as Array<{ description: string; quantity: string; unitPrice: string }>,
          2,
          Number(input.taxBps ?? 0),
        );
        return {
          _id: 'inv-new',
          ...input,
          decimals: 2,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          total: totals.total,
          lineItems: totals.lines,
          status: 'DRAFT',
          approvals: [],
        };
      }),
      submit: vi.fn(async (_orgId: string, id: string) => ({
        _id: id,
        number: 'INV-1001',
        vendorId: 'ven-1',
        status: 'SUBMITTED',
        issueDate: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        currency: 'USD',
        decimals: 2,
        subtotal: '10000',
        taxAmount: '0',
        total: '10000',
        lineItems: [],
      })),
    },
    receivables: {
      listCustomers: vi.fn(async () => [customer]),
      createCustomer: vi.fn(async (_orgId: string, input: Record<string, unknown>) => ({
        ...customer,
        ...input,
        _id: 'cus-new',
      })),
      list: vi.fn(async () => []),
      create: vi.fn(async (_orgId: string, _userId: string, input: Record<string, unknown>) => {
        const totals = computeInvoiceTotals(
          input.lineItems as Array<{ description: string; quantity: string; unitPrice: string }>,
          2,
          Number(input.taxBps ?? 0),
        );
        return {
          _id: 'ar-new',
          ...input,
          decimals: 2,
          total: totals.total,
          paidAmount: '0',
          lineItems: totals.lines,
          status: 'DRAFT',
          receipts: [],
        };
      }),
      issue: vi.fn(async (_orgId: string, id: string) => ({
        _id: id,
        number: 'AR-1001',
        customerId: 'cus-1',
        status: 'ISSUED',
        issueDate: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        currency: 'USD',
        decimals: 2,
        total: '10000',
        paidAmount: '0',
        receipts: [],
      })),
    },
    ...overrides,
  } as unknown as ChatToolDeps;
  return deps;
}

function ctx(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    orgId: 'org-1',
    userId: 'user-1',
    accountId: 'acct.near',
    role: 'ADMIN',
    planApproved: true,
    ...overrides,
  };
  const requestContext = new RequestContext<Record<string, unknown>>();
  for (const [key, value] of Object.entries(values)) requestContext.set(key, value);
  return { requestContext };
}

function execute(tool: unknown, input: unknown, context: unknown): Promise<Record<string, unknown>> {
  return (tool as { execute: (i: unknown, c: unknown) => Promise<Record<string, unknown>> })
    .execute(input, context);
}

const lines = [{ description: 'Design', quantity: '1', unitPrice: '100.00' }];

describe('creation tools', () => {
  it('creates a vendor for an admin and scopes the write to the org', async () => {
    const deps = makeDeps();
    const tools = createChatTools(deps);
    const result = await execute(
      tools.createVendor,
      {
        name: 'New Co',
        email: 'pay@newco.test',
        payoutChain: 'near',
        payoutAddress: 'newco.near',
      },
      ctx(),
    );

    expect(result.kind).toBe('vendor');
    expect(result.title).toBe('Created New Co');
    expect(deps.vendors.create).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ name: 'New Co', payoutAddress: 'newco.near' }),
    );
  });

  it('rejects vendor creation for a member and invalid payout addresses', async () => {
    const tools = createChatTools(makeDeps());
    const denied = await execute(
      tools.createVendor,
      {
        name: 'New Co',
        email: 'pay@newco.test',
        payoutChain: 'near',
        payoutAddress: 'newco.near',
      },
      ctx({ role: 'MEMBER' }),
    );
    expect(denied.error).toMatch(/ADMIN or OWNER/);

    const invalid = await execute(
      tools.createVendor,
      {
        name: 'New Co',
        email: 'pay@newco.test',
        payoutChain: 'near',
        payoutAddress: 'not a near account!',
      },
      ctx(),
    );
    expect(invalid.error).toMatch(/Invalid NEAR account id/);
  });

  it('does not create a duplicate vendor email', async () => {
    const tools = createChatTools(makeDeps());
    const result = await execute(
      tools.createVendor,
      {
        name: 'Acme again',
        email: 'billing@acme.test',
        payoutChain: 'near',
        payoutAddress: 'acme2.near',
      },
      ctx(),
    );
    expect(result.error).toMatch(/already exists/);
  });

  it('creates a bill, resolves the vendor and submits when asked', async () => {
    const deps = makeDeps();
    const tools = createChatTools(deps);
    const result = await execute(
      tools.createBill,
      {
        vendor: 'Acme',
        dueInDays: 30,
        currency: 'USD',
        taxBps: 0,
        lineItems: lines,
        submit: true,
      },
      ctx(),
    );

    expect(result.kind).toBe('invoice');
    expect(result.title).toBe('Created INV-1001');
    expect(result.subtitle).toContain('SUBMITTED');
    expect(deps.invoices.create).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      expect.objectContaining({
        vendorId: 'ven-1',
        currency: 'USD',
        lineItems: lines,
      }),
    );
    expect(deps.invoices.submit).toHaveBeenCalledWith('org-1', 'inv-new');
  });

  it('rejects ambiguous vendors and unknown customers', async () => {
    const ambiguous = makeDeps({
      vendors: {
        list: vi.fn(async () => [vendor, { ...vendor, _id: 'ven-2', email: 'two@acme.test' }]),
        create: vi.fn(),
      },
    });
    const tools = createChatTools(ambiguous);
    const vendorResult = await execute(
      tools.createBill,
      {
        vendor: 'Acme',
        dueInDays: 14,
        currency: 'USD',
        taxBps: 0,
        lineItems: lines,
      },
      ctx(),
    );
    expect(vendorResult.error).toMatch(/ambiguous/);

    const customerResult = await execute(
      tools.createReceivable,
      {
        customer: 'Missing Co',
        dueInDays: 14,
        currency: 'USD',
        taxBps: 0,
        lineItems: lines,
      },
      ctx(),
    );
    expect(customerResult.error).toMatch(/not found/);
  });

  it('creates and issues an AR invoice for an existing customer', async () => {
    const deps = makeDeps();
    const tools = createChatTools(deps);
    const result = await execute(
      tools.createReceivable,
      {
        customer: 'ap@globex.test',
        dueInDays: 30,
        currency: 'USD',
        taxBps: 0,
        lineItems: lines,
        issue: true,
      },
      ctx(),
    );

    expect(result.kind).toBe('receivable');
    expect(result.title).toBe('Created AR-1001');
    expect(result.subtitle).toContain('ISSUED');
    expect(deps.receivables.create).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      expect.objectContaining({ customerId: 'cus-1' }),
    );
    expect(deps.receivables.issue).toHaveBeenCalledWith('org-1', 'ar-new');
  });

  it('creates a customer without requiring an admin role', async () => {
    const deps = makeDeps();
    const tools = createChatTools(deps);
    const result = await execute(
      tools.createCustomer,
      { name: 'Initech', email: 'ap@initech.test' },
      ctx({ role: 'MEMBER' }),
    );
    expect(result.kind).toBe('customer');
    expect(result.title).toBe('Created Initech');
  });
});
