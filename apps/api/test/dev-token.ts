import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { JwtService } from '@nestjs/jwt';

/** Load the repo-root .env so this helper targets the same database as the API. */
function loadRootEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const file = path.join(dir, '.env');
    if (fs.existsSync(file) && fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const key = match[1];
        let value = match[2];
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    dir = path.dirname(dir);
  }
}

loadRootEnv();

/**
 * Dev helper: prints an access token for an existing seeded account so the
 * dashboard can be inspected without a browser wallet. Never expose this.
 */
async function main() {
  const accountId = process.argv[2] ?? 'demo.near';
  const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/keiz';
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const user = await db.collection('users').findOne({ accountId });
  if (!user) throw new Error(`No user ${accountId}. Run: pnpm --filter @keiz/api seed ${accountId}`);
  const membership = await db.collection('memberships').findOne({ userId: user._id.toString() });
  if (!membership) throw new Error('No membership');
  const token = new JwtService({}).sign(
    {
      sub: user._id.toString(),
      accountId,
      orgId: membership.orgId,
      role: membership.role,
      type: 'access',
    },
    { secret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me-0123456789abcdef', expiresIn: '1d' },
  );
  console.log(token);
  await mongoose.disconnect();
}

void main();
