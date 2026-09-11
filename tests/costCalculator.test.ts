import { describe, it, expect } from 'vitest';
import { calculatePrintCost, parsePageRange, DEFAULT_PRICING } from '../shared/costCalculator.js';

describe('Cost Calculator', () => {
  it('calculates single-sided black & white print correctly', () => {
    const result = calculatePrintCost({
      totalPages: 5,
      colorMode: 'bw',
      sides: 'single',
      copies: 1,
    });

    expect(result.effectivePages).toBe(5);
    expect(result.sheets).toBe(5);
    expect(result.perCopyCost).toBe(10); // 5 * 2
    expect(result.totalCost).toBe(10);
  });

  it('calculates duplex (front & back) black & white print correctly with sheet savings', () => {
    // 5 pages on duplex = 3 sheets (ceil(5/2))
    const result = calculatePrintCost({
      totalPages: 5,
      colorMode: 'bw',
      sides: 'duplex',
      copies: 1,
    });

    expect(result.effectivePages).toBe(5);
    expect(result.sheets).toBe(3);
    // 3 sheets * ₹3/sheet = ₹9
    expect(result.perCopyCost).toBe(9);
    expect(result.totalCost).toBe(9);
  });

  it('calculates color single-sided print correctly', () => {
    const result = calculatePrintCost({
      totalPages: 4,
      colorMode: 'color',
      sides: 'single',
      copies: 2,
    });

    expect(result.effectivePages).toBe(4);
    expect(result.sheets).toBe(4);
    expect(result.perCopyCost).toBe(40); // 4 * 10
    expect(result.totalCost).toBe(80); // 40 * 2 copies
  });

  it('calculates duplex color print correctly', () => {
    // 4 pages duplex = 2 sheets * 18 = 36 * 3 copies = 108
    const result = calculatePrintCost({
      totalPages: 4,
      colorMode: 'color',
      sides: 'duplex',
      copies: 3,
    });

    expect(result.effectivePages).toBe(4);
    expect(result.sheets).toBe(2);
    expect(result.perCopyCost).toBe(36);
    expect(result.totalCost).toBe(108);
  });

  it('parses page ranges correctly', () => {
    expect(parsePageRange('all', 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(parsePageRange('', 3)).toEqual([1, 2, 3]);
    expect(parsePageRange('1-3', 10)).toEqual([1, 2, 3]);
    expect(parsePageRange('1, 3, 5', 10)).toEqual([1, 3, 5]);
    expect(parsePageRange('2-4, 6', 10)).toEqual([2, 3, 4, 6]);
    expect(parsePageRange('8-15', 10)).toEqual([8, 9, 10]); // clamped to max
  });

  it('computes cost with specific page range', () => {
    const result = calculatePrintCost({
      totalPages: 10,
      pageRange: '1-3, 5', // 4 effective pages
      colorMode: 'bw',
      sides: 'single',
      copies: 2,
    });

    expect(result.effectivePages).toBe(4);
    expect(result.sheets).toBe(4);
    expect(result.totalCost).toBe(16); // 4 * 2 * 2
  });

  it('handles edge cases safely (invalid copies, empty range, out of range)', () => {
    // 0 or negative copies defaults to at least 1 copy
    const zeroCopies = calculatePrintCost({
      totalPages: 3,
      colorMode: 'bw',
      sides: 'single',
      copies: 0,
    });
    expect(zeroCopies.copies).toBe(1);
    expect(zeroCopies.totalCost).toBe(6);

    const negativeCopies = calculatePrintCost({
      totalPages: 2,
      colorMode: 'bw',
      sides: 'single',
      copies: -5,
    });
    expect(negativeCopies.copies).toBe(1);
    expect(negativeCopies.totalCost).toBe(4);

    // Out of bounds page range on 3-page doc
    const outOfBounds = parsePageRange('50-60', 3);
    expect(outOfBounds).toEqual([1, 2, 3]); // falls back safely to all pages

    // Gibberish input falls back safely
    const gibberish = parsePageRange('abc, xyz', 4);
    expect(gibberish).toEqual([1, 2, 3, 4]);
  });
});
