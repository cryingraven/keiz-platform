import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DocumentCounter, DocumentCounterSchema } from './document-counter.schema';
import { NumberingService } from './numbering.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DocumentCounter.name, schema: DocumentCounterSchema },
    ]),
  ],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
