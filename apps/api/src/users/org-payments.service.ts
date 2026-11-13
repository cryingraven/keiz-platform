import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NEAR_ACCOUNT_RE, OrgPaymentsInput } from '@keiz/shared';
import { Organization, OrganizationDocument } from './organization.schema';

export type EffectiveArMode = 'CONTRACT' | 'TREASURY' | 'OFF';

export interface ResolvedArSettings {
  /** Effective mode after falling back to the contract/treasury that exist. */
  arMode: EffectiveArMode;
  /** True when arMode was chosen explicitly in Settings. */
  configured: boolean;
  treasuryAccountId?: string;
  arAssetId?: string;
  collection: Organization['collection'] | null;
}

/**
 * Workspace payment rail settings. AR works with either a keiz-collect
 * contract or a plain treasury account; both are optional.
 */
@Injectable()
export class OrgPaymentsService {
  constructor(
    @InjectModel(Organization.name)
    private readonly orgs: Model<OrganizationDocument>,
  ) {}

  async resolve(orgId: string): Promise<ResolvedArSettings> {
    const org = await this.orgs.findById(orgId).lean();
    if (!org) throw new NotFoundException('Workspace not found');
    return this.fromOrg(org);
  }

  async update(orgId: string, input: OrgPaymentsInput): Promise<ResolvedArSettings> {
    const org = await this.orgs.findById(orgId);
    if (!org) throw new NotFoundException('Workspace not found');

    const treasury =
      (input.treasuryAccountId ?? org.paymentSettings?.treasuryAccountId ?? '').trim() ||
      undefined;
    if (input.arMode === 'TREASURY') {
      if (!treasury) {
        throw new BadRequestException(
          'Set a treasury account before switching AR collection to treasury mode.',
        );
      }
      if (!NEAR_ACCOUNT_RE.test(treasury)) {
        throw new BadRequestException('Invalid treasury account id.');
      }
    }
    if (input.arAssetId && !input.arAssetId.startsWith('nep141:')) {
      throw new BadRequestException('The AR asset must be a NEP-141 1Click asset id.');
    }

    org.set('paymentSettings', {
      arMode: input.arMode,
      treasuryAccountId: treasury,
      arAssetId: input.arAssetId ?? org.paymentSettings?.arAssetId,
    });
    await org.save();
    return this.fromOrg(org);
  }

  private fromOrg(org: {
    collection?: Organization['collection'] | null;
    paymentSettings?: Organization['paymentSettings'];
  }): ResolvedArSettings {
    const settings = org.paymentSettings;
    const collection = org.collection ?? null;
    // TREASURY is the workspace default. A stored mode always wins; an ACTIVE
    // collect contract no longer overrides an unconfigured workspace.
    const arMode: EffectiveArMode = settings?.arMode ?? 'TREASURY';
    return {
      arMode,
      configured: Boolean(settings?.arMode),
      treasuryAccountId: settings?.treasuryAccountId,
      arAssetId: settings?.arAssetId,
      collection,
    };
  }
}
