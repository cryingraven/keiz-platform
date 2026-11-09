import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import type { Role } from '@keiz/shared';
import { NearNetwork, walletNetwork } from '../common/network';
import { Organization, OrganizationDocument } from './organization.schema';
import { Membership, MembershipDocument } from './membership.schema';
import { User, UserDocument } from './user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    private readonly config: ConfigService,
  ) {}

  /** The workspace the user last selected, falling back to their first membership. */
  private async currentMembership(user: UserDocument): Promise<MembershipDocument | null> {
    if (user.activeOrgId) {
      const active = await this.memberships.findOne({
        userId: user.id,
        orgId: user.activeOrgId,
      });
      if (active) return active;
    }
    return this.memberships.findOne({ userId: user.id });
  }

  /** First login creates the user, their workspace and an OWNER membership atomically-ish. */
  async bootstrap(accountId: string, network: NearNetwork = walletNetwork(this.config)) {
    const existing = await this.users.findOne({ accountId });
    if (existing?.network && existing.network !== network) {
      throw new BadRequestException(
        `This account belongs to NEAR ${existing.network}, not ${network}.`,
      );
    }
    if (existing) {
      const membership = await this.currentMembership(existing);
      if (membership) {
        const org = await this.orgs.findById(membership.orgId);
        if (org) {
          if (org.network && org.network !== network) {
            throw new BadRequestException(
              `This workspace belongs to NEAR ${org.network}, not ${network}.`,
            );
          }
          if (!existing.network) existing.network = network;
          if (!org.network) {
            org.network = network;
            await org.save();
          }
          if (existing.activeOrgId !== org.id) {
            existing.activeOrgId = org.id;
          }
          existing.lastLoginAt = new Date();
          await existing.save();
          return { user: existing, org, membership };
        }
      }
    }

    const user =
      existing ?? (await this.users.create({ accountId, network }));
    if (!user.network) {
      user.network = network;
    }
    let membership = await this.currentMembership(user);
    let org: OrganizationDocument | null = null;

    if (membership) {
      org = await this.orgs.findById(membership.orgId);
      if (org?.network && org.network !== network) {
        throw new BadRequestException(
          `This workspace belongs to NEAR ${org.network}, not ${network}.`,
        );
      }
    }
    if (!membership || !org) {
      const implicit = /^[0-9a-f]{64}$/i.test(accountId);
      const label = implicit ? `Passkey ${accountId.slice(0, 6)}` : accountId.split('.')[0];
      org = await this.orgs.create({
        name: `${label} workspace`,
        slug: `${(implicit ? `passkey-${accountId.slice(0, 12)}` : accountId).replace(/[^a-z0-9]+/g, '-')}-${randomBytes(3).toString('hex')}`,
        network,
      });
      membership = await this.memberships.create({
        orgId: org.id,
        userId: user.id,
        role: 'OWNER',
      });
    }

    user.activeOrgId = org.id;
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

  /** Find or create a user without creating a workspace for them. */
  async ensureUser(accountId: string, network: NearNetwork = walletNetwork(this.config)) {
    const existing = await this.users.findOne({ accountId });
    if (existing) {
      if (existing.network && existing.network !== network) {
        throw new BadRequestException(
          `This account belongs to NEAR ${existing.network}, not ${network}.`,
        );
      }
      if (!existing.network) {
        existing.network = network;
        await existing.save();
      }
      return existing;
    }
    try {
      return await this.users.create({ accountId, network });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const raced = await this.users.findOne({ accountId });
        if (raced) return raced;
      }
      throw error;
    }
  }

  async listMembers(orgId: string) {
    const memberships = await this.memberships.find({ orgId }).sort({ createdAt: 1 }).lean();
    const users = await this.users
      .find({ _id: { $in: memberships.map((membership) => membership.userId) } })
      .lean();
    const byId = new Map(users.map((user) => [String(user._id), user]));
    return memberships.map((membership) => {
      const user = byId.get(membership.userId);
      return {
        userId: membership.userId,
        accountId: user?.accountId ?? 'unknown',
        displayName: user?.displayName ?? null,
        role: membership.role,
        joinedAt: (membership as { createdAt?: Date }).createdAt?.toISOString() ?? null,
      };
    });
  }

  /** Add or update a membership. The caller decides whether the role is allowed. */
  async addMember(orgId: string, accountId: string, role: Role) {
    const org = await this.orgs.findById(orgId);
    if (!org) throw new NotFoundException('Workspace not found');
    const network = org.network ?? walletNetwork(this.config);
    if (!org.network) {
      org.network = network;
      await org.save();
    }
    const user = await this.ensureUser(accountId, network);
    if (user.network && user.network !== network) {
      throw new BadRequestException(
        `This account belongs to NEAR ${user.network}, not ${network}.`,
      );
    }
    const existing = await this.memberships.findOne({ orgId, userId: user.id });
    if (existing) {
      if (existing.role === 'OWNER' && role !== 'OWNER') {
        await this.assertNotLastOwner(orgId, user.id);
      }
      existing.role = role;
      await existing.save();
    } else {
      await this.memberships.create({ orgId, userId: user.id, role });
    }
    return user;
  }

  async updateMemberRole(orgId: string, userId: string, role: Role) {
    const membership = await this.memberships.findOne({ orgId, userId });
    if (!membership) throw new NotFoundException('Member not found');
    if (membership.role === 'OWNER' && role !== 'OWNER') {
      await this.assertNotLastOwner(orgId, userId);
    }
    membership.role = role;
    await membership.save();
    return membership.toObject();
  }

  async removeMember(orgId: string, userId: string) {
    const membership = await this.memberships.findOne({ orgId, userId });
    if (!membership) throw new NotFoundException('Member not found');
    if (membership.role === 'OWNER') {
      await this.assertNotLastOwner(orgId, userId);
    }
    await this.memberships.deleteOne({ _id: membership._id, orgId });
    return { ok: true };
  }

  private async assertNotLastOwner(orgId: string, userId: string) {
    const owners = await this.memberships.countDocuments({ orgId, role: 'OWNER' });
    if (owners <= 1) {
      throw new BadRequestException('A workspace must keep at least one owner');
    }
    // Keep the parameter meaningful for future audit/logging hooks.
    void userId;
  }

  /** Used for separation-of-duties checks on invoice approval. */
  async countOtherApprovers(orgId: string, userId: string): Promise<number> {
    return this.memberships.countDocuments({
      orgId,
      userId: { $ne: userId },
      role: { $in: ['APPROVER', 'ADMIN', 'OWNER'] },
    });
  }

  /** Includes the otherwise-hidden refresh jti and its grace window. */
  async authState(userId: string) {
    return this.users
      .findById(userId)
      .select('+refreshJti +previousRefreshJti +refreshGraceUntil');
  }

  async setRefreshJti(userId: string, jti: string) {
    await this.users.updateOne(
      { _id: userId },
      {
        $set: { refreshJti: jti },
        $unset: { previousRefreshJti: 1, refreshGraceUntil: 1 },
      },
    );
  }

  /** Atomic compare-and-swap so two tabs cannot both rotate the same token. */
  async rotateRefresh(userId: string, expectedJti: string, nextJti: string) {
    // Keep the old jti valid for a moment. Parallel requests that raced us will
    // present it; accepting it briefly avoids logging the whole workspace out.
    const graceMs = 30_000;
    const result = await this.users.updateOne(
      { _id: userId, refreshJti: expectedJti },
      {
        $set: {
          refreshJti: nextJti,
          previousRefreshJti: expectedJti,
          refreshGraceUntil: new Date(Date.now() + graceMs),
        },
      },
    );
    return result.modifiedCount === 1;
  }

  async revokeAllSessions(userId: string) {
    await this.users.updateOne(
      { _id: userId },
      {
        $inc: { tokenVersion: 1 },
        $unset: { refreshJti: 1, previousRefreshJti: 1, refreshGraceUntil: 1 },
      },
    );
  }

  async clearRefreshJti(userId: string) {
    await this.users.updateOne(
      { _id: userId },
      { $unset: { refreshJti: 1, previousRefreshJti: 1, refreshGraceUntil: 1 } },
    );
  }

  async profile(userId: string) {
    const user = await this.users.findById(userId);
    const membership = user ? await this.currentMembership(user) : null;
    const org = membership ? await this.orgs.findById(membership.orgId) : null;
    return { user, org, membership };
  }

  async listOrgs(userId: string) {
    const memberships = await this.memberships.find({ userId }).lean();
    const orgs = await this.orgs
      .find({ _id: { $in: memberships.map((membership) => membership.orgId) } })
      .lean();
    const byId = new Map(orgs.map((org) => [String(org._id), org]));
    return memberships.flatMap((membership) => {
      const org = byId.get(membership.orgId);
      if (!org) return [];
      return [
        {
          id: String(org._id),
          name: org.name,
          slug: org.slug,
          role: membership.role,
          network: org.network ?? null,
        },
      ];
    });
  }

  async switchOrg(userId: string, orgId: string) {
    const membership = await this.memberships.findOne({ userId, orgId });
    if (!membership) throw new NotFoundException('Workspace not found');
    const [org, user] = await Promise.all([
      this.orgs.findById(orgId),
      this.users.findById(userId),
    ]);
    if (!org || !user) throw new NotFoundException('Workspace not found');
    if (user.network && org.network && user.network !== org.network) {
      throw new BadRequestException('This workspace belongs to a different NEAR network.');
    }
    await this.users.updateOne({ _id: userId }, { $set: { activeOrgId: orgId } });
    return { org, membership };
  }
}
