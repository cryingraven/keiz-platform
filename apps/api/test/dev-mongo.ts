import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Throwaway Mongo for local development when Docker is unavailable.
 * Data lives in memory and disappears when this process exits.
 * Prefer `docker compose up -d` for anything you want to keep.
 */
async function main() {
  const mongo = await MongoMemoryServer.create({
    instance: { port: 27017, dbName: 'keiz' },
  });
  console.log(`[keiz] in-memory MongoDB at ${mongo.getUri('keiz')}`);
  const shutdown = async () => {
    await mongo.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
