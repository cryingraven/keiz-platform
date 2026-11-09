import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type IndexerCursorDocument = HydratedDocument<IndexerCursor>;

/** Durable high-water mark per external source (e.g. collect:<contract>). */
@Schema({ timestamps: true, collection: 'indexer_cursors' })
export class IndexerCursor {
  @Prop({ required: true, unique: true, index: true })
  key: string;

  @Prop({ required: true, default: -1 })
  value: number;
}

export const IndexerCursorSchema = SchemaFactory.createForClass(IndexerCursor);
