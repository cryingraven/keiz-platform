import { describe, expect, it, vi } from 'vitest';

// Vitest transpiles without `design:type`; keep Mongoose decorators out of the
// module graph.
vi.mock('./organization.schema', () => ({
  Organization: class {},
  OrganizationSchema: {},
}));

import { OrgPaymentsService } from './org-payments.service';

function orgDoc(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    collection: undefined,
    paymentSettings: undefined,
    ...overrides,
  };
  doc.set = vi.fn((key: string, value: unknown) => {
    doc[key] = value;
  });
  doc.save = vi.fn().mockResolvedValue(doc);
  return doc;
}

function serviceFor(doc: Record<string, unknown>) {
  const orgs = {
    findById: vi.fn(() => ({
      lean: vi.fn().mockResolvedValue(doc),
      then: (resolve: (value: unknown) => unknown) => resolve(doc),
    })),
  };
  return { service: new OrgPaymentsService(orgs as never), orgs };
}

describe('OrgPaymentsService', () => {
  it('defaults to TREASURY even when an inactive collection survives', async () => {
    const doc = orgDoc({ collection: { status: 'PAUSED', contractId: 'c.near' } });
    const { service } = serviceFor(doc);
    const settings = await service.resolve('org1');
    expect(settings.arMode).toBe('TREASURY');
    expect(settings.configured).toBe(false);
  });

  it('uses an explicit CONTRACT mode even with an active collection', async () => {
    const doc = orgDoc({
      collection: { status: 'ACTIVE', contractId: 'c.near' },
      paymentSettings: { arMode: 'CONTRACT' },
    });
    const { service } = serviceFor(doc);
    const settings = await service.resolve('org1');
    expect(settings.arMode).toBe('CONTRACT');
    expect(settings.configured).toBe(true);
  });

  it('uses an explicit OFF mode', async () => {
    const doc = orgDoc({ paymentSettings: { arMode: 'OFF' } });
    const { service } = serviceFor(doc);
    const settings = await service.resolve('org1');
    expect(settings.arMode).toBe('OFF');
    expect(settings.configured).toBe(true);
  });

  it('derives TREASURY from a treasury account', async () => {
    const doc = orgDoc({ paymentSettings: { treasuryAccountId: 'treasury.near' } });
    const { service } = serviceFor(doc);
    const settings = await service.resolve('org1');
    expect(settings.arMode).toBe('TREASURY');
    expect(settings.treasuryAccountId).toBe('treasury.near');
  });

  it('defaults to TREASURY when nothing is configured', async () => {
    const { service } = serviceFor(orgDoc());
    const settings = await service.resolve('org1');
    expect(settings.arMode).toBe('TREASURY');
    expect(settings.configured).toBe(false);
  });

  it('requires a treasury before enabling treasury mode', async () => {
    const doc = orgDoc();
    const { service } = serviceFor(doc);
    await expect(service.update('org1', { arMode: 'TREASURY' })).rejects.toThrow(
      'Set a treasury account',
    );
  });

  it('rejects a non-NEP-141 settlement asset', async () => {
    const doc = orgDoc();
    const { service } = serviceFor(doc);
    await expect(
      service.update('org1', {
        arMode: 'TREASURY',
        treasuryAccountId: 'treasury.near',
        arAssetId: 'usdc.near',
      }),
    ).rejects.toThrow('NEP-141');
  });

  it('stores an explicit mode and treasury', async () => {
    const doc = orgDoc();
    const { service } = serviceFor(doc);
    const settings = await service.update('org1', {
      arMode: 'TREASURY',
      treasuryAccountId: 'treasury.near',
      arAssetId: 'nep141:usdc.near',
    });
    expect(settings.arMode).toBe('TREASURY');
    expect(settings.configured).toBe(true);
    expect(doc.paymentSettings).toMatchObject({
      arMode: 'TREASURY',
      treasuryAccountId: 'treasury.near',
      arAssetId: 'nep141:usdc.near',
    });
  });
});
