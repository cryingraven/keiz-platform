import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CollectionQuoteInput, formatUnits, parseUnits } from '@keiz/shared';
import { PaymentProviderFactory } from '../payments/payment-provider.factory';
import { OrgCollectionService } from '../users/org-collection.service';
import { Receivable, ReceivableDocument } from './receivable.schema';

/**
 * Builds the 1Click quote a customer uses to pay a receivable from another
 * chain. The destination is the workspace `keiz-collect` contract and
 * `customRecipientMsg` carries the receivable reference to ft_on_transfer.
 */
@Injectable()
export class ArCollectionService {
  constructor(
    @InjectModel(Receivable.name) private readonly receivables: Model<ReceivableDocument>,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly collections: OrgCollectionService,
  ) {}

  async quote(orgId: string, receivableId: string, input: CollectionQuoteInput) {
    const receivable = await this.receivables.findOne({ _id: receivableId, orgId }).lean();
    if (!receivable) throw new NotFoundException('Receivable not found');
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(receivable.status)) {
      throw new BadRequestException(`Cannot collect a ${receivable.status} receivable`);
    }

    const collection = await this.collections.get(orgId);
    if (!collection || collection.status !== 'ACTIVE') {
      throw new BadRequestException(
        'On-chain AR collection is not configured for this workspace (set it in Settings)',
      );
    }
    const contractId = collection.contractId;
    const destinationAssetId = collection.assetId;

    const provider = this.providerFactory.get();
    const tokens = await provider.getTokens();
    const destination = tokens.find((token) => token.assetId === destinationAssetId);
    if (!destination) {
      throw new BadRequestException('The workspace collection asset is not in the 1Click token list');
    }
    if (destination.blockchain.toLowerCase() !== 'near') {
      throw new BadRequestException('The collection asset must be a NEAR NEP-141 token');
    }

    const outstanding = BigInt(receivable.total) - BigInt(receivable.paidAmount);
    if (outstanding <= 0n) throw new BadRequestException('Receivable is fully paid');

    const quote = await provider.quote({
      dry: false,
      swapType: 'EXACT_OUTPUT',
      originAsset: input.originAsset,
      destinationAsset: destinationAssetId,
      amount: parseUnits(
        formatUnits(outstanding.toString(), receivable.decimals),
        destination.decimals,
      ).toString(),
      recipient: contractId,
      refundTo: input.refundTo,
      customRecipientMsg: JSON.stringify({
        orgId,
        receivableRef: receivable.number,
      }),
    });

    return {
      receivableId,
      receivableNumber: receivable.number,
      collectContractId: contractId,
      destinationAssetId,
      collection,
      ...quote,
    };
  }
}
