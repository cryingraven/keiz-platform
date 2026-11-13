/**
 * Demo seeding is hidden in production unless explicitly enabled. The route
 * stays OWNER-only; this flag only controls whether it exists at runtime.
 */
export function isDemoSeedAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV !== 'production' || env.DEMO_SEED_ENABLED === 'true';
}
