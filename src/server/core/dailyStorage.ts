import { redis } from '@devvit/web/server';
import {
  type DailyResult,
  type LeaderboardEntry,
  type PlayerSession,
  leaderboardScore,
} from '../../shared/game';

const TOP_LEADERBOARD_COUNT = 10;

export const storageKeys = {
  dailySession: (date: string, userId: string): string =>
    `daily:${date}:session:${userId}`,
  dailyResults: (date: string): string => `daily:${date}:results`,
  dailyLeaderboard: (date: string): string => `daily:${date}:leaderboard`,
  userHistory: (userId: string): string => `user:${userId}:history`,
  challenge: (challengeId: string): string => `challenge:${challengeId}`,
  versusMatch: (matchId: string): string => `versus:${matchId}`,
};

export const loadDailySession = async (
  date: string,
  userId: string
): Promise<PlayerSession | null> => {
  const value = await redis.get(storageKeys.dailySession(date, userId));
  if (!value) {
    return null;
  }

  return parseSession(value);
};

export const saveDailySession = async (
  session: PlayerSession,
  userId: string
): Promise<void> => {
  await redis.set(
    storageKeys.dailySession(session.puzzleId.date, userId),
    JSON.stringify(session)
  );
};

export const saveBestDailyResult = async (
  result: DailyResult
): Promise<void> => {
  const resultKey = storageKeys.dailyResults(result.date);
  const leaderboardKey = storageKeys.dailyLeaderboard(result.date);
  const existing = parseResult(await redis.hGet(resultKey, result.userId));
  const nextScore = leaderboardScore(result.guesses, result.solvedAt);
  const existingScore = existing
    ? leaderboardScore(existing.guesses, existing.solvedAt)
    : null;

  if (existingScore !== null && existingScore <= nextScore) {
    return;
  }

  await redis.hSet(resultKey, {
    [result.userId]: JSON.stringify(result),
  });
  await redis.zAdd(leaderboardKey, {
    member: result.userId,
    score: nextScore,
  });
};

export const clearDailyPlayerData = async (
  date: string,
  userId: string
): Promise<void> => {
  await Promise.all([
    redis.del(storageKeys.dailySession(date, userId)),
    redis.hDel(storageKeys.dailyResults(date), [userId]),
    redis.zRem(storageKeys.dailyLeaderboard(date), [userId]),
  ]);
};

export const loadDailyLeaderboard = async (
  date: string,
  userId: string
): Promise<{
  leaderboard: LeaderboardEntry[];
  playerRank: LeaderboardEntry | null;
}> => {
  const leaderboardKey = storageKeys.dailyLeaderboard(date);
  const resultKey = storageKeys.dailyResults(date);
  const rankedMembers = await redis.zRange(
    leaderboardKey,
    0,
    TOP_LEADERBOARD_COUNT - 1,
    { by: 'rank' }
  );
  const leaderboard = await entriesForMembers(
    resultKey,
    rankedMembers.map((member) => member.member),
    1
  );
  const playerRankIndex = await redis.zRank(leaderboardKey, userId);

  if (playerRankIndex === undefined) {
    return {
      leaderboard,
      playerRank: null,
    };
  }

  const playerEntries = await entriesForMembers(
    resultKey,
    [userId],
    playerRankIndex + 1
  );

  return {
    leaderboard,
    playerRank: playerEntries.at(0) ?? null,
  };
};

const entriesForMembers = async (
  resultKey: string,
  userIds: string[],
  firstRank: number
): Promise<LeaderboardEntry[]> => {
  if (userIds.length === 0) {
    return [];
  }

  const values = await redis.hMGet(resultKey, userIds);
  const entries: LeaderboardEntry[] = [];

  values.forEach((value, index) => {
    if (!value) {
      return;
    }

    const result = parseResult(value);
    if (!result) {
      return;
    }

    entries.push({
      rank: firstRank + index,
      displayName: result.displayName,
      guesses: result.guesses,
      solvedAt: result.solvedAt,
    });
  });

  return entries;
};

const parseSession = (value: string): PlayerSession | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isSession(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const parseResult = (value: string | undefined): DailyResult | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isDailyResult(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const isSession = (value: unknown): value is PlayerSession => {
  return (
    isRecord(value) &&
    isRecord(value.puzzleId) &&
    Array.isArray(value.guesses) &&
    Array.isArray(value.foundKeys) &&
    Array.isArray(value.markerKeys) &&
    typeof value.clueMode === 'string' &&
    typeof value.solved === 'boolean' &&
    typeof value.startedAt === 'number'
  );
};

const isDailyResult = (value: unknown): value is DailyResult => {
  return (
    isRecord(value) &&
    typeof value.userId === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.date === 'string' &&
    typeof value.puzzleNumber === 'number' &&
    typeof value.guesses === 'number' &&
    typeof value.solvedAt === 'number'
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
