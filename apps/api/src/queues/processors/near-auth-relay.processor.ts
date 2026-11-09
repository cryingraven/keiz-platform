import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NearAuthService } from '../../auth/near-auth.service';
import { NEAR_AUTH_QUEUE, NEAR_AUTH_RELAY_JOB } from '../queue.constants';

@Processor(NEAR_AUTH_QUEUE, { concurrency: 1 })
export class NearAuthRelayProcessor extends WorkerHost {
  constructor(private readonly nearAuth: NearAuthService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== NEAR_AUTH_RELAY_JOB) return { skipped: true };
    return this.nearAuth.relayNow(job.data);
  }
}
