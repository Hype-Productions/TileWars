import { describe, expect, it } from 'vitest';
import {
  applyGuessToSession,
  createCustomPuzzleId,
  createDailyPuzzleId,
  createInitialSession,
  createShareText,
  formatElapsedTime,
  leaderboardScore,
  leaderboardRankColor,
  selectLeaderboardDisplayRows,
  setClueModeInSession,
  toggleMarkerInSession,
} from '../src/shared/game';
import { coordKey, parsePatternInput, todayUtcDate } from '../src/shared/pattern';

describe('Daily puzzle numbering', () => {
  it('numbers launch day and following UTC days sequentially', () => {
    expect(createDailyPuzzleId('2026-07-07').puzzleNumber).toBe(1);
    expect(createDailyPuzzleId('2026-07-08').puzzleNumber).toBe(2);
    expect(createDailyPuzzleId('2026-07-31').puzzleNumber).toBe(25);
  });

  it('uses UTC date boundaries', () => {
    expect(todayUtcDate(new Date('2026-07-07T23:59:59.999Z'))).toBe('2026-07-07');
    expect(todayUtcDate(new Date('2026-07-08T00:00:00.000Z'))).toBe('2026-07-08');
    expect(createDailyPuzzleId(todayUtcDate(new Date('2026-07-08T00:00:00.000Z'))).puzzleNumber).toBe(2);
  });

});

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
  it('formats result time in one shared display format', () => {
    expect(formatElapsedTime(123000)).toBe('2m 03s');
    expect(formatElapsedTime(-1)).toBe('0s');
  });

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

  it('creates the daily result comment from the shared result time', () => {
    const session = {
      ...createInitialSession(createDailyPuzzleId('2026-07-08'), 4, 1000),
      solved: true,
      solvedAt: 124000,
    };

    expect(createShareText(session, 4)).toBe(
      [
        '🟥 TILEWARS Daily #2',
        '',
        '✅ Pattern complete in 0 guesses',
        `⏱️ Solved in ${formatElapsedTime(123000)}`,
        '🔥 4-day streak',
        '',
        'Can you beat my score?',
      ].join('\n')
    );
  });

  it('shows the top three, the player, and the final-ranked player', () => {
    const leaders = [
      { rank: 1, displayName: 'one', guesses: 4, solvedAt: 1 },
      { rank: 2, displayName: 'two', guesses: 5, solvedAt: 2 },
      { rank: 3, displayName: 'three', guesses: 6, solvedAt: 3 },
    ];
    expect(selectLeaderboardDisplayRows(leaders, leaders[1] ?? null)).toHaveLength(3);

    const fourth = { rank: 4, displayName: 'four', guesses: 7, solvedAt: 4 };
    const last = { rank: 12, displayName: 'last', guesses: 12, solvedAt: 12 };
    expect(selectLeaderboardDisplayRows(leaders, fourth, last).slice(-3)).toEqual([
      { kind: 'entry', entry: fourth, isPlayer: true },
      { kind: 'ellipsis' },
      { kind: 'entry', entry: last, isPlayer: false },
    ]);

    expect(selectLeaderboardDisplayRows(leaders, leaders[0] ?? null, fourth)).toEqual([
      { kind: 'entry', entry: leaders[0], isPlayer: true },
      { kind: 'entry', entry: leaders[1], isPlayer: false },
      { kind: 'entry', entry: leaders[2], isPlayer: false },
      { kind: 'entry', entry: fourth, isPlayer: false },
    ]);

    const player = { rank: 12, displayName: 'me', guesses: 9, solvedAt: 12 };
    expect(selectLeaderboardDisplayRows(leaders, player, last).slice(-2)).toEqual([
      { kind: 'ellipsis' },
      { kind: 'entry', entry: player, isPlayer: true },
    ]);
  });

  it('handles empty and short leaderboard displays without duplication', () => {
    expect(selectLeaderboardDisplayRows([], null)).toEqual([]);
    const entries = [
      { rank: 1, displayName: 'one', guesses: 4, solvedAt: 1 },
      { rank: 2, displayName: 'two', guesses: 5, solvedAt: 2 },
    ];
    expect(selectLeaderboardDisplayRows(entries, entries[0] ?? null)).toEqual([
      { kind: 'entry', entry: entries[0], isPlayer: true },
      { kind: 'entry', entry: entries[1], isPlayer: false },
    ]);
  });

  it('cycles canonical leaderboard rank colors', () => {
    expect([1, 2, 3, 4, 5].map(leaderboardRankColor)).toEqual([
      'green',
      'red',
      'blue',
      'orange',
      'green',
    ]);
  });
});
