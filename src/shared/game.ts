import {
  type ClueMode,
  type ClueResult,
  type Coord,
  coordKey,
  generatePattern,
  getClue,
  getRemainingCount,
  todayUtcDate,
} from './pattern';
import type {
  PlayerProgressSummary,
  ProgressReward,
} from './progression';

export type GameMode =
  | 'daily'
  | 'custom-seed'
  | 'custom-pattern'
  | 'challenge'
  | 'versus';

export type PuzzleId = {
  mode: GameMode;
  date: string;
  seed: string;
  puzzleNumber: number;
};

export type GuessRecord = {
  coord: Coord;
  clue: ClueResult;
  timestamp: number;
  wasGreen: boolean;
};

export type PlayerSession = {
  puzzleId: PuzzleId;
  guesses: GuessRecord[];
  foundKeys: string[];
  markerKeys: string[];
  clueMode: ClueMode;
  totalTiles: number;
  solved: boolean;
  startedAt: number;
  solvedAt: number | null;
};

export type DailyResult = {
  userId: string;
  displayName: string;
  date: string;
  puzzleNumber: number;
  guesses: number;
  solvedAt: number;
  durationMs?: number;
};

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  guesses: number;
  solvedAt: number;
  durationMs?: number;
};

export type LeaderboardDisplayRow =
  | { kind: 'entry'; entry: LeaderboardEntry; isPlayer: boolean }
  | { kind: 'ellipsis' };

export type LeaderboardRankColor = 'green' | 'red' | 'blue' | 'orange';

export const leaderboardRankColor = (rank: number): LeaderboardRankColor => {
  const colors: LeaderboardRankColor[] = ['green', 'red', 'blue', 'orange'];
  return colors[(Math.max(1, rank) - 1) % colors.length] ?? 'green';
};

export type DailySessionResponse = {
  type: 'daily-session';
  session: PlayerSession;
  leaderboard?: LeaderboardEntry[];
  playerRank?: LeaderboardEntry | null;
  lastPlayer?: LeaderboardEntry | null;
  progress?: PlayerProgressSummary;
  reward?: ProgressReward;
};

export type DailyGuessRequest = {
  coord: Coord;
};

export type DailyMarkRequest = {
  coord: Coord;
};

export type DailyModeRequest = {
  clueMode: ClueMode;
};

export type DailyLeaderboardResponse = {
  type: 'daily-leaderboard';
  leaderboard: LeaderboardEntry[];
  playerRank: LeaderboardEntry | null;
  lastPlayer?: LeaderboardEntry | null;
};

export const DAILY_SEED = 'pattern';
export const DAILY_LAUNCH_DATE = '2026-07-07';

export const createDailyPuzzleId = (
  date: string = todayUtcDate()
): PuzzleId => {
  return {
    mode: 'daily',
    date,
    seed: DAILY_SEED,
    puzzleNumber: puzzleNumberForDate(date),
  };
};

export const createCustomPuzzleId = (
  mode: 'custom-seed' | 'custom-pattern',
  seed: string
): PuzzleId => {
  return {
    mode,
    date: 'custom',
    seed,
    puzzleNumber: 0,
  };
};

export const createInitialSession = (
  puzzleId: PuzzleId,
  totalTiles = 0,
  now: number = Date.now()
): PlayerSession => {
  return {
    puzzleId,
    guesses: [],
    foundKeys: [],
    markerKeys: [],
    clueMode: 'balanced',
    totalTiles,
    solved: false,
    startedAt: now,
    solvedAt: null,
  };
};

export const dailyPatternForPuzzle = (puzzleId: PuzzleId): Coord[] => {
  return generatePattern(puzzleId.seed, puzzleId.date);
};

export const applyGuessToSession = (
  session: PlayerSession,
  pattern: Coord[],
  coord: Coord,
  now: number = Date.now()
): PlayerSession => {
  if (session.solved || hasGuessed(session, coord)) {
    return session;
  }

  const clue = getClue(coord, pattern);
  const key = coordKey(coord);
  const foundKeys = clue.green
    ? uniqueStrings([...session.foundKeys, key])
    : session.foundKeys;
  const markerKeys = session.markerKeys.filter(
    (markerKey) => markerKey !== key
  );
  const guesses = [
    ...session.guesses,
    {
      coord,
      clue,
      timestamp: now,
      wasGreen: clue.green,
    },
  ];
  const solved = getRemainingCount(pattern, foundKeys) === 0;

  return {
    ...session,
    totalTiles: session.totalTiles || pattern.length,
    guesses,
    foundKeys,
    markerKeys,
    solved,
    solvedAt: solved ? now : session.solvedAt,
  };
};

export const toggleMarkerInSession = (
  session: PlayerSession,
  coord: Coord
): PlayerSession => {
  if (session.solved || hasGuessed(session, coord)) {
    return session;
  }

  const key = coordKey(coord);
  const markerKeys = session.markerKeys.includes(key)
    ? session.markerKeys.filter((markerKey) => markerKey !== key)
    : [...session.markerKeys, key];

  return {
    ...session,
    markerKeys,
  };
};

export const setClueModeInSession = (
  session: PlayerSession,
  clueMode: ClueMode
): PlayerSession => {
  return {
    ...session,
    clueMode,
  };
};

export const createShareText = (session: PlayerSession): string => {
  const title =
    session.puzzleId.mode === 'daily' ? 'TILEWARS Daily' : 'TILEWARS';
  const result = session.solved
    ? `Solved in ${session.guesses.length} guesses`
    : `${session.foundKeys.length} found in ${session.guesses.length} guesses`;

  return `${title}\n${result}\n${session.puzzleId.date}`;
};

export const leaderboardScore = (guesses: number, solvedAt: number): number => {
  return guesses * 10_000_000_000_000 + solvedAt;
};

export const selectLeaderboardDisplayRows = (
  leaderboard: LeaderboardEntry[],
  playerRank: LeaderboardEntry | null,
  lastPlayer: LeaderboardEntry | null = null
): LeaderboardDisplayRow[] => {
  const leaders = leaderboard.slice(0, 3);
  const rows: LeaderboardDisplayRow[] = leaders.map((entry) => ({
    kind: 'entry',
    entry,
    isPlayer: playerRank?.rank === entry.rank,
  }));

  const appendEntry = (entry: LeaderboardEntry, isPlayer: boolean): void => {
    if (!rows.some((row) => row.kind === 'entry' && row.entry.rank === entry.rank)) {
      rows.push({ kind: 'entry', entry, isPlayer });
    }
  };

  if (playerRank && playerRank.rank > 3) {
    if (playerRank.rank >= 5) {
      rows.push({ kind: 'ellipsis' });
    }
    appendEntry(playerRank, true);
    if (lastPlayer && lastPlayer.rank > playerRank.rank) {
      rows.push({ kind: 'ellipsis' });
      appendEntry(lastPlayer, false);
    }
  } else if (lastPlayer && lastPlayer.rank > 3) {
    rows.push({ kind: 'ellipsis' });
    appendEntry(lastPlayer, false);
  }

  return rows;
};

export const puzzleNumberForDate = (date: string): number => {
  const launch = Date.parse(`${DAILY_LAUNCH_DATE}T00:00:00.000Z`);
  const target = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(target) || target < launch) {
    return 1;
  }

  return Math.floor((target - launch) / 86_400_000) + 1;
};

const hasGuessed = (session: PlayerSession, coord: Coord): boolean => {
  const key = coordKey(coord);
  return session.guesses.some((guess) => coordKey(guess.coord) === key);
};

const uniqueStrings = (values: string[]): string[] => {
  return Array.from(new Set(values));
};
