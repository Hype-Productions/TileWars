import { describe, expect, it } from 'vitest';
import {
  applyGuessToSession,
  createCustomPuzzleId,
  createInitialSession,
  createShareText,
  leaderboardScore,
  setClueModeInSession,
  toggleMarkerInSession,
} from '../src/shared/game';
import { coordKey, parsePatternInput } from '../src/shared/pattern';

describe('player sessions', () => {
  const pattern = parsePatternInput('A1,B2,C3,D4');

  it('creates a reusable session shape', () => {
    const session = createInitialSession(
      createCustomPuzzleId('custom-pattern', 'picked'),
      pattern.length,
      100
    );

    expect(session.totalTiles).toBe(4);
    expect(session.guesses).toEqual([]);
    expect(session.foundKeys).toEqual([]);
    expect(session.solved).toBe(false);
    expect(session.startedAt).toBe(100);
  });

  it('applies guesses and detects solved state', () => {
    let session = createInitialSession(
      createCustomPuzzleId('custom-pattern', 'picked'),
      pattern.length,
      100
    );

    session = applyGuessToSession(session, pattern, { row: 0, col: 0 }, 101);
    session = applyGuessToSession(session, pattern, { row: 1, col: 1 }, 102);
    session = applyGuessToSession(session, pattern, { row: 2, col: 2 }, 103);
    session = applyGuessToSession(session, pattern, { row: 3, col: 3 }, 104);

    expect(session.solved).toBe(true);
    expect(session.solvedAt).toBe(104);
    expect(session.foundKeys).toEqual([
      coordKey({ row: 0, col: 0 }),
      coordKey({ row: 1, col: 1 }),
      coordKey({ row: 2, col: 2 }),
      coordKey({ row: 3, col: 3 }),
    ]);
  });

  it('toggles X markers and clue display mode', () => {
    let session = createInitialSession(
      createCustomPuzzleId('custom-seed', '123456'),
      pattern.length
    );

    session = toggleMarkerInSession(session, { row: 4, col: 4 });
    expect(session.markerKeys).toEqual([coordKey({ row: 4, col: 4 })]);

    session = toggleMarkerInSession(session, { row: 4, col: 4 });
    expect(session.markerKeys).toEqual([]);

    session = setClueModeInSession(session, 'proximity');
    expect(session.clueMode).toBe('proximity');
  });
});

describe('results', () => {
  it('orders leaderboard score by guesses before solve time', () => {
    expect(leaderboardScore(5, 999)).toBeLessThan(leaderboardScore(6, 1));
    expect(leaderboardScore(5, 100)).toBeLessThan(leaderboardScore(5, 200));
  });

  it('generates spoiler-free share text', () => {
    const session = {
      ...createInitialSession(createCustomPuzzleId('custom-pattern', 'picked'), 4),
      guesses: [{ coord: { row: 0, col: 0 }, clue: { green: true, red: 0, blue: 0, orange: 0 }, timestamp: 1, wasGreen: true }],
      foundKeys: [coordKey({ row: 0, col: 0 })],
    };

    expect(createShareText(session)).toContain('1 found in 1 guesses');
    expect(createShareText(session)).not.toContain('A1');
  });
});
