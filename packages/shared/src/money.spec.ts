import { describe, expect, it } from 'vitest';
import { applyBps, formatUnits, parseUnits, usdToUnits } from './money';

describe('money', () => {
  it('parses decimal strings without floating point', () => {
    expect(parseUnits('1.5', 6)).toBe(1_500_000n);
    expect(parseUnits('0.000001', 6)).toBe(1n);
    expect(parseUnits('4200', 2)).toBe(420_000n);
    expect(parseUnits('-2.25', 2)).toBe(-225n);
  });

  it('rejects excess precision and junk', () => {
    expect(() => parseUnits('1.1234567', 6)).toThrow();
    expect(() => parseUnits('1e6', 6)).toThrow();
    expect(() => parseUnits('', 6)).toThrow();
  });

  it('formats back to a human amount', () => {
    expect(formatUnits(1_500_000n, 6)).toBe('1.5');
    expect(formatUnits('420000', 2)).toBe('4200');
    expect(formatUnits(1n, 6)).toBe('0.000001');
    expect(formatUnits(0n, 2)).toBe('0');
  });

  it('keeps precision above Number.MAX_SAFE_INTEGER', () => {
    const huge = '9007199254740993';
    expect(parseUnits(huge, 0).toString()).toBe(huge);
    expect(formatUnits(parseUnits(huge, 0), 0)).toBe(huge);
  });

  it('applies basis points with integer math', () => {
    expect(applyBps(10_000n, 250)).toBe(250n);
    expect(applyBps(420_000n, 1100)).toBe(46_200n);
  });

  it('converts USD to token units using a decimal price', () => {
    expect(usdToUnits('100', '1.00', 6)).toBe(100_000_000n);
    expect(usdToUnits('100', '3.20', 6)).toBe(31_250_000n);
  });
});
