import { describe, expect, it } from 'vitest';
import { isDemoSeedAllowed } from './demo-seed-policy';

describe('demo seed policy', () => {
  it('allows seeding outside production', () => {
    expect(isDemoSeedAllowed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isDemoSeedAllowed({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('hides seeding in production by default', () => {
    expect(isDemoSeedAllowed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('allows an explicit production opt-in', () => {
    expect(
      isDemoSeedAllowed({
        NODE_ENV: 'production',
        DEMO_SEED_ENABLED: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
