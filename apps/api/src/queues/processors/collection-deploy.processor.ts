import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CollectionDeployService } from '../../collections/collect-deploy.service';
import { COLLECTIONS_QUEUE, COLLECT_DEPLOY_JOB } from '../queue.constants';

@Processor(COLLECTIONS_QUEUE)
export class CollectionDeployProcessor extends WorkerHost {
  constructor(private readonly deploy: CollectionDeployService) {
    super();
  }

  async process(job: Job<{ deploymentId: string }>): Promise<unknown> {
    if (job.name !== COLLECT_DEPLOY_JOB) return { skipped: true };
    await this.deploy.run(job.data.deploymentId);
    return { deploymentId: job.data.deploymentId };
  }
}
