import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { DemoService } from './demo.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const accountId = process.argv[2] ?? 'demo.near';
    const users = app.get(UsersService);
    const demo = app.get(DemoService);
    const { user, org } = await users.bootstrap(accountId);
    const result = await demo.seed(org!.id, user.id, accountId);
    console.log(JSON.stringify({ accountId, orgId: org!.id, ...result }, null, 2));
  } finally {
    await app.close();
  }
}

void main();
