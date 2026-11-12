import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { IndexerService } from '../../indexer/indexer.service';
import { INDEXER_QUEUE, INDEXER_SYNC_JOB } from '../queue.constants';

@Processor(INDEXER_QUEUE)
export class IndexerSyncProcessor extends WorkerHost {
  constructor(private readonly indexer: IndexerService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== INDEXER_SYNC_JOB) return { skipped: true };
    return this.indexer.syncAll(25);
  }
}
