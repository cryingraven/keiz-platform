import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountingService } from '../accounting/accounting.service';
import { AgentService } from '../agent/agent.service';
import { InvoicesService } from '../invoices/invoices.service';
import { Invoice, InvoiceDocument } from '../invoices/invoice.schema';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { ReceivablesService } from '../receivables/receivables.service';
import { Vendor, VendorDocument } from '../vendors/vendor.schema';
import { isDemoSeedAllowed } from './demo-seed-policy';

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

@Injectable()
export class DemoService {
  constructor(
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(Invoice.name) private readonly invoices: Model<InvoiceDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    private readonly invoicesService: InvoicesService,
    private readonly agent: AgentService,
    private readonly receivables: ReceivablesService,
    private readonly accounting: AccountingService,
  ) {}

  async seed(orgId: string, userId: string, accountId: string) {
    if (!isDemoSeedAllowed()) {
      throw new NotFoundException('Not available');
    }
    const invoiceCount = await this.invoices.countDocuments({ orgId });
    if (invoiceCount > 0) {
      return { seeded: false, reason: 'Workspace already has bills' };
    }

    const vendorSpecs = [
      {
        name: 'Nusantara Cloud',
        email: 'billing@nusantara.cloud',
        nearAccountId: 'nusantara.near',
        payoutChain: 'near',
        payoutAddress: 'nusantara.near',
      },
      {
        name: 'Straits Logistics',
        email: 'ar@straitslogistics.sg',
        payoutChain: 'eth',
        payoutAddress: '0x9f8a1b7c4d2e6f0a3b5c8d1e4f7a0b2c5d8e1f4a',
      },
      {
        name: 'Solana Studio',
        email: 'hello@solanastudio.io',
        payoutChain: 'sol',
        payoutAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      },
      {
        name: 'Batavia Design',
        email: 'invoice@bataviadesign.id',
        nearAccountId: 'batavia.near',
        payoutChain: 'near',
        payoutAddress: 'batavia.near',
      },
    ];

    // Upsert by name so an interrupted seed can be re-run without duplicating
    // vendors. Bills are the completion marker, checked above.
    const vendors: VendorDocument[] = [];
    for (const spec of vendorSpecs) {
      const vendor = await this.vendors.findOneAndUpdate(
        { orgId, name: spec.name },
        { $setOnInsert: { ...spec, orgId } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      if (vendor) vendors.push(vendor);
    }
    if (vendors.length !== vendorSpecs.length) {
      throw new Error('Could not create the demo vendors');
    }

    const specs = [
      { vendor: 0, number: 'INV-1001', status: 'APPROVED', amount: '4200', desc: 'Cloud infrastructure - March', due: 12 },
      { vendor: 1, number: 'INV-1002', status: 'SUBMITTED', amount: '12750', desc: 'Freight forwarding Q1', due: 5 },
      { vendor: 2, number: 'INV-1003', status: 'PAID', amount: '890', desc: 'Product design sprint', due: -3 },
      { vendor: 0, number: 'INV-1004', status: 'DRAFT', amount: '1150', desc: 'Managed database add-on', due: 21 },
      { vendor: 3, number: 'INV-1005', status: 'APPROVED', amount: '2400', desc: 'Brand refresh phase 2', due: 9 },
      { vendor: 1, number: 'INV-1006', status: 'SUBMITTED', amount: '6300', desc: 'Warehouse handling fees', due: 4 },
      { vendor: 0, number: 'INV-1007', status: 'PAID', amount: '3100', desc: 'Cloud infrastructure - February', due: -30 },
      { vendor: 2, number: 'INV-1008', status: 'APPROVED', amount: '780', desc: 'Landing page illustration', due: 16 },
    ] as const;

    for (const spec of specs) {
      const invoice = await this.invoicesService.create(orgId, userId, {
        vendorId: vendors[spec.vendor]._id.toString(),
        issueDate: daysFromNow(-14),
        dueDate: daysFromNow(spec.due),
        currency: 'USD',
        taxBps: 0,
        notes: `Demo seed: ${spec.desc}`,
        lineItems: [
          {
            description: spec.desc,
            quantity: '1',
            unitPrice: spec.amount,
          },
        ],
      });

      if (spec.status === 'SUBMITTED') {
        await this.invoices.updateOne({ _id: invoice._id }, { $set: { status: 'SUBMITTED' } });
      }
      if (spec.status === 'APPROVED' || spec.status === 'PAID') {
        await this.invoices.updateOne(
          { _id: invoice._id },
          {
            $set: {
              status: 'APPROVED',
              approvals: [
                {
                  userId,
                  accountId,
                  decision: 'APPROVE',
                  comment: 'Approved in the demo workspace',
                  at: new Date(Date.now() - 3 * 86_400_000),
                },
              ],
            },
          },
        );
      }
      if (spec.status === 'PAID') {
        const payment = await this.payments.create({
          orgId,
          invoiceId: invoice._id.toString(),
          provider: 'mock',
          payer: 'USER',
          status: 'SUCCEEDED',
          rawStatus: 'SUCCESS',
          originAsset: 'nep141:usdc.near',
          destinationAsset: 'nep141:usdc.near',
          swapType: 'EXACT_OUTPUT',
          amountIn: String(Number(spec.amount) * 1_000_000),
          amountOut: String(Number(spec.amount) * 1_000_000),
          amountInFormatted: spec.amount,
          amountOutFormatted: spec.amount,
          correlationId: `demo-${spec.number}`,
          depositAddress: `mock-demo-${spec.number.toLowerCase()}`,
          txHash: `demo-tx-${spec.number.toLowerCase()}`,
          createdByUserId: userId,
          payerAccountId: accountId,
          destinationTxHashes: [
            { hash: `demo-dest-${spec.number.toLowerCase()}`, explorerUrl: 'https://nearblocks.io' },
          ],
        });
        await this.invoices.updateOne(
          { _id: invoice._id },
          {
            $set: {
              status: 'PAID',
              paidAt: new Date(Date.now() - 2 * 86_400_000),
              paymentId: payment.id,
            },
          },
        );
      }
    }

    // --- AR subledger: customers, customer invoices, receipts ---
    const customers = await Promise.all([
      this.receivables.createCustomer(orgId, {
        name: 'Helios Labs',
        email: 'finance@helioslabs.io',
      }),
      this.receivables.createCustomer(orgId, {
        name: 'Meridian Retail',
        email: 'ap@meridianretail.sg',
      }),
      this.receivables.createCustomer(orgId, {
        name: 'Orbit Media',
        email: 'billing@orbitmedia.id',
      }),
    ]);

    const arSpecs = [
      {
        customer: 0,
        number: 'AR-2001',
        amount: '6800',
        desc: 'Platform subscription - Q2',
        due: 10,
        status: 'ISSUED',
      },
      {
        customer: 1,
        number: 'AR-2002',
        amount: '12000',
        desc: 'Implementation retainer',
        due: 20,
        status: 'PARTIAL',
        paid: '5000',
      },
      {
        customer: 2,
        number: 'AR-2003',
        amount: '3400',
        desc: 'Campaign retainer',
        due: -5,
        status: 'PAID',
      },
      {
        customer: 0,
        number: 'AR-2004',
        amount: '9200',
        desc: 'Data migration milestone',
        due: -12,
        status: 'ISSUED',
      },
    ] as const;

    for (const spec of arSpecs) {
      const receivable = await this.receivables.create(orgId, userId, {
        customerId: customers[spec.customer].id,
        issueDate: daysFromNow(-20),
        dueDate: daysFromNow(spec.due),
        currency: 'USD',
        taxBps: 0,
        notes: `Demo seed: ${spec.desc}`,
        lineItems: [{ description: spec.desc, quantity: '1', unitPrice: spec.amount }],
      });
      await this.receivables.issue(orgId, String(receivable._id));

      if (spec.status === 'PARTIAL' || spec.status === 'PAID') {
        const receiptAmount = 'paid' in spec ? spec.paid : spec.amount;
        await this.receivables.recordReceipt(orgId, userId, String(receivable._id), {
          amount: receiptAmount,
          method: 'BANK_TRANSFER',
          reference: `Demo receipt for ${spec.number}`,
        });
      }
    }

    // Opening cash so the demo does not start with a negative cash balance.
    await this.accounting.postOpeningBalance(orgId, 'USD', 25_000_000n);

    // Direct cash entries outside the AP/AR subledgers. They exercise the
    // EXP-YY/MM/XXXXX and REV-YY/MM/XXXX numbering and the Expenses/Revenue pages.
    const directExpenses = [
      {
        amount: '185.00',
        accountCode: '5200',
        memo: 'Demo direct expense: Payment rails fee',
      },
      {
        amount: '1250.00',
        accountCode: '5100',
        memo: 'Demo direct expense: Team offsite',
      },
    ];
    for (const entry of directExpenses) {
      await this.accounting.postDirectEntry(orgId, userId, 'EXPENSE', {
        date: daysFromNow(-3),
        amount: entry.amount,
        currency: 'USD',
        accountCode: entry.accountCode,
        cashAccountCode: '1010',
        memo: entry.memo,
      });
    }

    const directRevenues = [
      { amount: '3200.00', memo: 'Demo direct revenue: Advisory retainer' },
      { amount: '450.00', memo: 'Demo direct revenue: Template sales' },
    ];
    for (const entry of directRevenues) {
      await this.accounting.postDirectEntry(orgId, userId, 'REVENUE', {
        date: daysFromNow(-2),
        amount: entry.amount,
        currency: 'USD',
        accountCode: '4000',
        cashAccountCode: '1010',
        memo: entry.memo,
      });
    }

    await this.accounting.rebuild(orgId);

    await this.agent.getOrCreateWallet(orgId);

    return {
      seeded: true,
      vendors: vendors.length,
      invoices: specs.length,
      directExpenses: directExpenses.length,
      directRevenues: directRevenues.length,
      customers: customers.length,
      receivables: arSpecs.length,
    };
  }
}
