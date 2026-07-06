import { describe, expect, it } from 'vitest';
import {
  coordKey,
  generatePattern,
  getClue,
  getRemainingCount,
  isConnected,
  parsePatternInput,
  validatePattern,
} from '../src/shared/pattern';

describe('pattern generation', () => {
  it('generates the same connected pattern for the same seed and date', () => {
    const first = generatePattern('daily', '2026-07-06');
    const second = generatePattern('daily', '2026-07-06');

    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThanOrEqual(4);
    expect(first.length).toBeLessThanOrEqual(7);
    expect(isConnected(first)).toBe(true);
  });

  it('usually changes when the date changes', () => {
    const first = generatePattern('daily', '2026-07-06');
    const second = generatePattern('daily', '2026-07-07');

    expect(second.map(coordKey).join('|')).not.toBe(
      first.map(coordKey).join('|')
    );
  });
});

describe('pattern input validation', () => {
  it('parses exact coordinate input', () => {
    expect(parsePatternInput('A1, B2 C3,D4')).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 2 },
      { col: 3, row: 3 },
    ]);
  });

  it('rejects duplicate and disconnected patterns', () => {
    expect(
      validatePattern(parsePatternInput('A1,A1,B1,C1')).valid
    ).toBe(false);
    expect(
      validatePattern(parsePatternInput('A1,B1,E5,E4')).valid
    ).toBe(false);
  });

  it('accepts diagonal touching as connected', () => {
    const result = validatePattern(parsePatternInput('A1,B2,C3,D4'));

    expect(result.valid).toBe(true);
  });
});

describe('clues', () => {
  const pattern = parsePatternInput('B2,C2,C3,D3');

  it('reports multiple clue colors for one guess', () => {
    const clue = getClue({ row: 1, col: 2 }, pattern);

    expect(clue.green).toBe(true);
    expect(clue.blue).toBeGreaterThan(0);
    expect(clue.red).toBeGreaterThan(0);
    expect(clue.orange).toBeGreaterThan(0);
  });

  it('still lets found tiles act as clue sources', () => {
    const found = new Set([coordKey({ row: 1, col: 1 })]);
    const clue = getClue({ row: 0, col: 0 }, pattern);

    expect(getRemainingCount(pattern, found)).toBe(3);
    expect(clue.orange).toBeGreaterThan(0);
  });
});
