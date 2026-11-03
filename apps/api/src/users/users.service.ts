import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { Organization, OrganizationDocument } from './organization.schema';
import { Membership, MembershipDocument } from './membership.schema';
import { User, UserDocument } from './user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
  ) {}

  /** First login creates the user, their workspace and an OWNER membership atomically-ish. */
  async bootstrap(accountId: string) {
    const existing = await this.users.findOne({ accountId });
    if (existing) {
      const membership = await this.memberships.findOne({ userId: existing.id });
      if (membership) {
        const org = await this.orgs.findById(membership.orgId);
        if (org) {
          existing.lastLoginAt = new Date();
          await existing.save();
          return { user: existing, org, membership };
        }
      }
    }

    const user = existing ?? (await this.users.create({ accountId }));
    let membership = await this.memberships.findOne({ userId: user.id });
    let org: OrganizationDocument | null = null;

    if (membership) {
      org = await this.orgs.findById(membership.orgId);
    }
    if (!membership || !org) {
      org = await this.orgs.create({
        name: `${accountId.split('.')[0]} workspace`,
        slug: `${accountId.replace(/[^a-z0-9]+/g, '-')}-${randomBytes(3).toString('hex')}`,
      });
      membership = await this.memberships.create({
        orgId: org.id,
        userId: user.id,
        role: 'OWNER',
      });
    }

    user.lastLoginAt = new Date();
    await user.save();
    return { user, org, membership };
  }

  /** Fresh role + token version for every authenticated request. */
  async sessionContext(userId: string, orgId: string) {
    const [user, membership] = await Promise.all([
      this.users.findById(userId),
      this.memberships.findOne({ userId, orgId }),
    ]);
    return { user, membership };
  }

  /** Add or update a membership. Used by tests and future invite flows. */
  async addMember(orgId: string, accountId: string, role: 'OWNER' | 'ADMIN' | 'APPROVER' | 'MEMBER') {
    const { user } = await this.bootstrap(accountId);
    await this.memberships.updateOne(
      { orgId, userId: user.id },
      { $set: { role } },
      { upsert: true },
    );
    return user;
  }

  /** Used for separation-of-duties checks on invoice approval. */
  async countOtherApprovers(orgId: string, userId: string): Promise<number> {
    return this.memberships.countDocuments({
      orgId,
      userId: { $ne: userId },
      role: { $in: ['APPROVER', 'ADMIN', 'OWNER'] },
    });
  }

  /** Includes the otherwise-hidden refresh jti. */
  async authState(userId: string) {
    return this.users.findById(userId).select('+refreshJti');
  }

  async setRefreshJti(userId: string, jti: string) {
    await this.users.updateOne({ _id: userId }, { $set: { refreshJti: jti } });
  }

  /** Atomic compare-and-swap so two tabs cannot both rotate the same token. */
  async rotateRefresh(userId: string, expectedJti: string, nextJti: string) {
    const result = await this.users.updateOne(
      { _id: userId, refreshJti: expectedJti },
      { $set: { refreshJti: nextJti } },
    );
    return result.modifiedCount === 1;
  }

  async revokeAllSessions(userId: string) {
    await this.users.updateOne(
      { _id: userId },
      { $inc: { tokenVersion: 1 }, $unset: { refreshJti: 1 } },
    );
  }

  async clearRefreshJti(userId: string) {
    await this.users.updateOne({ _id: userId }, { $unset: { refreshJti: 1 } });
  }

  async profile(userId: string) {
    const user = await this.users.findById(userId);
    const membership = await this.memberships.findOne({ userId });
    const org = membership ? await this.orgs.findById(membership.orgId) : null;
    return { user, org, membership };
  }
}
