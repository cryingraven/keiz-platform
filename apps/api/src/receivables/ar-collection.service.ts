import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CollectionQuoteInput, formatUnits, parseUnits } from '@keiz/shared';
import { PaymentProviderFactory } from '../payments/payment-provider.factory';
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
    private readonly config: ConfigService,
  ) {}

  async quote(orgId: string, receivableId: string, input: CollectionQuoteInput) {
    const receivable = await this.receivables.findOne({ _id: receivableId, orgId }).lean();
    if (!receivable) throw new NotFoundException('Receivable not found');
    if (!['ISSUED', 'PARTIALLY_PAID'].includes(receivable.status)) {
      throw new BadRequestException(`Cannot collect a ${receivable.status} receivable`);
    }

    const contractId = this.config.get<string>('KEIZ_COLLECT_CONTRACT_ID');
    const destinationAssetId = this.config.get<string>('KEIZ_COLLECT_ASSET_ID');
    if (!contractId || !destinationAssetId) {
      throw new BadRequestException(
        'On-chain AR collection is not configured (KEIZ_COLLECT_CONTRACT_ID / KEIZ_COLLECT_ASSET_ID)',
      );
    }

    const provider = this.providerFactory.get();
    const tokens = await provider.getTokens();
    const destination = tokens.find((token) => token.assetId === destinationAssetId);
    if (!destination) {
      throw new BadRequestException('KEIZ_COLLECT_ASSET_ID is not in the 1Click token list');
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
      customRecipientMsg: JSON.stringify({ receivableRef: receivable.number }),
    });

    return {
      receivableId,
      receivableNumber: receivable.number,
      collectContractId: contractId,
      destinationAssetId,
      ...quote,
    };
  }
}
