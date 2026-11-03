import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ROLES, Role } from '@keiz/shared';

export type MembershipDocument = HydratedDocument<Membership>;

@Schema({ timestamps: true, collection: 'memberships' })
export class Membership {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, enum: ROLES, default: 'MEMBER' })
  role: Role;
}

export const MembershipSchema = SchemaFactory.createForClass(Membership);
MembershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });
