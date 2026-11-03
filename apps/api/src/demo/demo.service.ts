import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentService } from '../agent/agent.service';
import { InvoicesService } from '../invoices/invoices.service';
import { Invoice, InvoiceDocument } from '../invoices/invoice.schema';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { Vendor, VendorDocument } from '../vendors/vendor.schema';

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
  ) {}

  async seed(orgId: string, userId: string, accountId: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException('Not available');
    }
    const existing = await this.vendors.countDocuments({ orgId });
    if (existing > 0) {
      return { seeded: false, reason: 'Workspace already has vendors' };
    }

    const vendors = await this.vendors.insertMany([
      {
        orgId,
        name: 'Nusantara Cloud',
        email: 'billing@nusantara.cloud',
        nearAccountId: 'nusantara.near',
        payoutChain: 'near',
        payoutAddress: 'nusantara.near',
      },
      {
        orgId,
        name: 'Straits Logistics',
        email: 'ar@straitslogistics.sg',
        payoutChain: 'eth',
        payoutAddress: '0x9f8a1b7c4d2e6f0a3b5c8d1e4f7a0b2c5d8e1f4a',
      },
      {
        orgId,
        name: 'Solana Studio',
        email: 'hello@solanastudio.io',
        payoutChain: 'sol',
        payoutAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      },
      {
        orgId,
        name: 'Batavia Design',
        email: 'invoice@bataviadesign.id',
        nearAccountId: 'batavia.near',
        payoutChain: 'near',
        payoutAddress: 'batavia.near',
      },
    ]);

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
        number: spec.number,
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

    await this.agent.getOrCreateWallet(orgId);

    return {
      seeded: true,
      vendors: vendors.length,
      invoices: specs.length,
    };
  }
}
