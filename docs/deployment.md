# Deployment (GHCR + Coolify)

The deployment runs four containers in Coolify:

| Service | Image | Purpose |
|---|---|---|
| `web` | `ghcr.io/keizio/keiz-web` | Next.js UI; proxies `/api/*` to the API |
| `api` | `ghcr.io/keizio/keiz-api` | NestJS API (`node dist/main.js`) |
| `worker` | `ghcr.io/keizio/keiz-api` | BullMQ worker (`node dist/worker.js`) |
| `redis` | `redis:7-alpine` | Queues, payments and indexer |

MongoDB is **not** deployed. `MONGODB_URI` points at the existing Atlas cluster.

## Images and CI

`.github/workflows/publish.yml` builds and pushes both images on every push to
`main`, on `v*` tags, and on manual dispatch:

- `ghcr.io/keizio/keiz-api`
- `ghcr.io/keizio/keiz-web`

Tags: `latest` on the default branch, `sha-<short>`, and the git tag.

The web image bakes public configuration at build time:

- `API_URL=http://api:3001`
- `CHAIN_NETWORK`
- `NEXT_PUBLIC_CHAIN_NETWORK`
- `NEXT_PUBLIC_NEAR_NETWORK`

Changing the network or proxy target requires rebuilding the web image. Set the
values as repository variables (`CHAIN_NETWORK`, `NEXT_PUBLIC_CHAIN_NETWORK`,
`NEXT_PUBLIC_NEAR_NETWORK`) before publishing.

### GHCR namespace and credentials

The workflow publishes to `ghcr.io/keizio` by default. `GITHUB_TOKEN` can only
push to the namespace that owns the repository. If the repository is not under
the `keizio` org, add:

- `GHCR_USERNAME` — a user with package write access to `keizio`
- `GHCR_TOKEN` — a PAT with `write:packages` (and `read:packages`)

Otherwise set the `GHCR_NAMESPACE` repository variable to the repo owner.

If the GHCR packages are private, add registry credentials in Coolify so it can
pull the images.

## Coolify setup

1. Create a **Docker Compose** resource from this repository.
2. Point it at `docker-compose.coolify.yml`.
3. Add the variables from `.env.coolify.example` to the Coolify environment.
4. Set `MONGODB_URI` to the Atlas connection string and allow the Coolify host
   in Atlas → Network Access.
5. Assign the public domain to the `web` service on container port `3000`.
   Do not publish `api:3001`; the Next rewrite keeps `/api/*` on the compose
   network.
6. Deploy. The API healthcheck is `GET /api/health`; the web healthcheck is `GET /`.

### Required production values

`NODE_ENV=production` makes the API fail closed on unsafe configuration:

- `APP_DOMAIN` must be a real public domain, not `localhost`.
- `WEB_ORIGIN` must be the public HTTPS origin.
- `WEBAUTHN_RP_ID` must be the public registrable domain.
- `WEBAUTHN_ORIGINS` must be the matching HTTPS origin (or subdomain).
- `JWT_SECRET` and `AGENT_WALLET_MASTER_KEY` must be real secrets.
- `CHAIN_NETWORK` and `NEXT_PUBLIC_CHAIN_NETWORK` must match.

Also set `PAYMENTS_MODE=intents` for real 1Click payments; the compose default is
`mock`. OutLayer is optional and configured with `OUTLAYER_*`.

## Worker

The worker is the same API image with:

```text
command: ["node", "dist/worker.js"]
```

It shares the API environment, needs Redis and Atlas, exposes no port, and
handles `SIGTERM`/`SIGINT` with a 30 second stop grace period. Keep one replica
by default; BullMQ supports scaling later.

If you use managed Redis, remove the `redis` service and both `depends_on`
blocks, then set `REDIS_URL` to the managed URL.

## Database indexes

Mongoose `autoIndex` is disabled when `NODE_ENV=production`. Reusing the current
Atlas database preserves its existing indexes. For a fresh database, create the
schema indexes once before production traffic (run the API with
`NODE_ENV=development` against that database, or use a controlled migration).

## On-chain collection wasm

`COLLECT_WASM_PATH` is only needed when `COLLECT_DEPLOY_ENABLED=true`. The image
does not include the Rust build output by default; mount or copy the pinned wasm
and point `COLLECT_WASM_PATH` at it. Keep `KEIZ_COLLECT_CODE_HASH` pinned.

## Local image checks

```bash
docker build -f Dockerfile.api -t keiz-api:test .
docker build -f Dockerfile.web -t keiz-web:test \
  --build-arg API_URL=http://api:3001 \
  --build-arg CHAIN_NETWORK=testnet \
  --build-arg NEXT_PUBLIC_CHAIN_NETWORK=testnet \
  .

cp .env.coolify.example .env.coolify
docker compose --env-file .env.coolify -f docker-compose.coolify.yml config

docker run --rm -p 3001:3001 --env-file .env.coolify keiz-api:test
docker run --rm -p 3000:3000 keiz-web:test
```

For a real end-to-end check, use an Atlas URI (or a local `mongo` container that
is not part of the Coolify compose) and a running Redis.
