import { describe, expect, it } from 'vitest';
import { mapOutlayerStatus, isTerminalOutlayerStatus } from './outlayer.mapper';

describe('OutLayer status mapping', () => {
  it('maps success and failure states', () => {
    expect(mapOutlayerStatus('success')).toBe('SUCCEEDED');
    expect(mapOutlayerStatus('failed')).toBe('FAILED');
    expect(mapOutlayerStatus('rejected')).toBe('FAILED');
    expect(mapOutlayerStatus('refunded')).toBe('REFUNDED');
    expect(mapOutlayerStatus('needs_review')).toBe('NEEDS_REVIEW');
  });

  it('keeps in-flight and approval states processing', () => {
    for (const status of ['pending_deposit', 'processing', 'pending_approval', 'approved', 'unknown']) {
      expect(mapOutlayerStatus(status)).toBe('PROCESSING');
    }
  });

  it('marks terminal custody states', () => {
    expect(isTerminalOutlayerStatus('success')).toBe(true);
    expect(isTerminalOutlayerStatus('needs_review')).toBe(true);
    expect(isTerminalOutlayerStatus('processing')).toBe(false);
  });
});
