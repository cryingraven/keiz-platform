import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ACCOUNT_TYPES, AccountType, NormalBalance } from '@keiz/shared';

export type AccountDocument = HydratedDocument<Account>;

@Schema({ timestamps: true, collection: 'accounts' })
export class Account {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true })
  code: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, enum: ACCOUNT_TYPES })
  type: AccountType;

  @Prop({ required: true, enum: ['debit', 'credit'] })
  normalBalance: NormalBalance;

  /** Seeded accounts are the default chart; users cannot delete them. */
  @Prop({ default: true })
  system: boolean;

  @Prop({ default: false })
  archived: boolean;
}

export const AccountSchema = SchemaFactory.createForClass(Account);
AccountSchema.index({ orgId: 1, code: 1 }, { unique: true });
