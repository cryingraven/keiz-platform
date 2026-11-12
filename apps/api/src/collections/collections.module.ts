import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsModule } from '../payments/payments.module';
import { Organization, OrganizationSchema } from '../users/organization.schema';
import { UsersModule } from '../users/users.module';
import {
  CollectionDeployment,
  CollectionDeploymentSchema,
} from './collection-deployment.schema';
import { CollectionDeployService } from './collect-deploy.service';
import { CollectionsController } from './collections.controller';

@Module({
  imports: [
    UsersModule,
    PaymentsModule,
    MongooseModule.forFeature([
      { name: CollectionDeployment.name, schema: CollectionDeploymentSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [CollectionsController],
  providers: [CollectionDeployService],
  exports: [CollectionDeployService],
})
export class CollectionsModule {}
