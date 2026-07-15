import { redis } from '@devvit/web/server';
import {
  activeDailyStreak,
  createInitialProgress,
  dailyXpForStreak,
  nextDailyStreak,
  summarizeProgress,
  versusXpForResult,
  type PlayerProgress,
  type PlayerProgressSummary,
  type ProgressResponse,
  type ProgressReward,
  type RivalryHistoryEntry,
  type RivalryHistoryResponse,
  type RivalryMatchScore,
  type RivalryOpponentSummary,
  type RivalryOpponentsResponse,
  type RivalryOutcome,
  type RivalrySummary,
} from '../../shared/progression';

const TRANSACTION_RETRIES = 4;
const PENDING_REWARD_LIMIT = 20;

type ProgressAwardResult = {
  progress: PlayerProgressSummary;
  reward: ProgressReward | null;
};

type RivalryRecord = {
  userA: string;
  userB: string;
  displayNameA: string;
  displayNameB: string;
  winsA: number;
  winsB: number;
  draws: number;
  lastPlayedAt: number;
};

type RivalryResultInput = {
  matchId: string;
  firstUserId: string;
  firstDisplayName: string;
  firstScore: RivalryMatchScore | null;
  secondUserId: string;
  secondDisplayName: string;
  secondScore: RivalryMatchScore | null;
  firstOutcome: RivalryOutcome | 'no-contest';
  completedAt: number;
};

type StoredRivalryHistoryEntry = {
  matchId: string;
  completedAt: number;
  winnerUserId: string | null;
  draw: boolean;
  scoreA: RivalryMatchScore | null;
  scoreB: RivalryMatchScore | null;
};

export const progressStorageKeys = {
  profile: (userId: string): string => `progress:user:${userId}:profile`,
  award: (userId: string, awardId: string): string =>
    `progress:user:${userId}:award:${awardId}`,
  rewards: (userId: string): string => `progress:user:${userId}:rewards`,
  pendingRewards: (userId: string): string =>
    `progress:user:${userId}:pending-rewards`,
  rivalry: (firstUserId: string, secondUserId: string): string =>
    `progress:rivalry:${pairId(firstUserId, secondUserId)}`,
  rivalryAward: (matchId: string): string =>
    `progress:rivalry-award:${matchId}`,
  rivalryHistoryAward: (matchId: string): string =>
    `progress:rivalry-history-award:${matchId}`,
  rivalryHistory: (firstUserId: string, secondUserId: string): string =>
    `progress:rivalry-history:${pairId(firstUserId, secondUserId)}`,
  opponents: (userId: string): string => `progress:user:${userId}:opponents`,
};

export const loadProgressResponse = async (
  userId: string,
  today: string
): Promise<ProgressResponse> => {
  return {
    type: 'progress',
    progress: await loadProgressSummary(userId, today),
    pendingRewards: await loadPendingRewards(userId),
  };
};

export const loadProgressSummary = async (
  userId: string,
  today: string
): Promise<PlayerProgressSummary> => {
  const stored = await loadProgress(userId);
  return summarizeProgress({
    ...stored,
    dailyStreak: activeDailyStreak(stored, today),
  });
};

export const awardDailyProgress = async (
  userId: string,
  date: string,
  now: number = Date.now()
): Promise<ProgressAwardResult> => {
  const awardId = `daily:${date}`;
  return mutateProgressWithAward(userId, awardId, now, (current) => {
    const streak = nextDailyStreak(
      current.lastDailyDate,
      current.dailyStreak,
      date
    );
    const amount = dailyXpForStreak(streak);
    return {
      progress: {
        ...current,
        totalXp: current.totalXp + amount,
        dailyStreak: streak,
        lastDailyDate: date,
      },
      amount,
      source: 'daily',
      label: `Daily streak ${streak}`,
    };
  });
};

export const awardVersusProgress = async (
  userId: string,
  matchId: string,
  outcome: 'win' | 'loss' | 'draw' | 'no-contest',
  completed: boolean,
  opponentDisplayName: string,
  now: number = Date.now()
): Promise<ProgressAwardResult> => {
  const awardId = `versus:${matchId}`;
  return mutateProgressWithAward(userId, awardId, now, (current) => {
    const amount = versusXpForResult(outcome, completed);
    const versus = { ...current.versus };
    if (outcome === 'win') {
      versus.wins += 1;
    } else if (outcome === 'loss') {
      versus.losses += 1;
    } else if (outcome === 'draw') {
      versus.draws += 1;
    }

    return {
      progress: {
        ...current,
        totalXp: current.totalXp + amount,
        versus,
      },
      amount,
      source: 'versus',
      label:
        outcome === 'win'
          ? `Win vs ${opponentDisplayName}`
          : outcome === 'draw'
            ? `Draw vs ${opponentDisplayName}`
            : `Loss vs ${opponentDisplayName}`,
    };
  });
};

export const recordRivalryResult = async (
  input: RivalryResultInput
): Promise<void> => {
  if (input.firstOutcome === 'no-contest') {
    return;
  }

  const [userA, userB] = orderedPair(input.firstUserId, input.secondUserId);
  const rivalryKey = progressStorageKeys.rivalry(userA, userB);
  const awardKey = progressStorageKeys.rivalryAward(input.matchId);
  const historyAwardKey = progressStorageKeys.rivalryHistoryAward(input.matchId);
  const historyKey = progressStorageKeys.rivalryHistory(userA, userB);

  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await redis.watch(rivalryKey, awardKey, historyAwardKey);
    const alreadyCounted = Boolean(await redis.get(awardKey));
    const historyStored = Boolean(await redis.get(historyAwardKey));
    if (alreadyCounted && historyStored) {
      await transaction.unwatch();
      return;
    }

    const current = parseRivalry(await redis.get(rivalryKey), userA, userB);
    const firstIsA = input.firstUserId === userA;
    const next: RivalryRecord = {
      ...current,
      displayNameA: firstIsA ? input.firstDisplayName : input.secondDisplayName,
      displayNameB: firstIsA ? input.secondDisplayName : input.firstDisplayName,
      lastPlayedAt: Math.max(current.lastPlayedAt, input.completedAt),
    };
    if (!alreadyCounted) {
      if (input.firstOutcome === 'draw') {
        next.draws += 1;
      } else if (
        (input.firstOutcome === 'win' && firstIsA) ||
        (input.firstOutcome === 'loss' && !firstIsA)
      ) {
        next.winsA += 1;
      } else {
        next.winsB += 1;
      }
    }
    const historyEntry = storedHistoryEntry(input, firstIsA);

    try {
      await transaction.multi();
      await transaction.set(rivalryKey, JSON.stringify(next));
      if (!alreadyCounted) {
        await transaction.set(awardKey, '1');
      }
      if (!historyStored) {
        await transaction.zAdd(historyKey, {
          member: JSON.stringify(historyEntry),
          score: input.completedAt,
        });
        await transaction.set(historyAwardKey, '1');
      }
      await transaction.zAdd(progressStorageKeys.opponents(userA), {
        member: userB,
        score: next.lastPlayedAt,
      });
      await transaction.zAdd(progressStorageKeys.opponents(userB), {
        member: userA,
        score: next.lastPlayedAt,
      });
      const result: unknown = await transaction.exec();
      if (result !== null) {
        return;
      }
    } catch {
      continue;
    }
  }

  throw new Error('Could not update rivalry record.');
};

export const loadRivalryOpponents = async (
  userId: string,
  query = '',
  limit?: number
): Promise<RivalryOpponentsResponse> => {
  const members = await redis.zRange(
    progressStorageKeys.opponents(userId),
    0,
    -1,
    { by: 'rank', reverse: true }
  );
  const normalizedQuery = query.trim().toLowerCase();
  const opponents: RivalryOpponentSummary[] = [];
  for (const member of members) {
    const summary = await loadRivalryOpponentSummary(userId, member.member);
    if (
      summary &&
      (!normalizedQuery ||
        summary.opponentDisplayName.toLowerCase().includes(normalizedQuery))
    ) {
      opponents.push(summary);
      if (limit !== undefined && opponents.length >= limit) {
        break;
      }
    }
  }
  return { type: 'versus-opponents', opponents };
};

export const loadRivalryHistory = async (
  userId: string,
  opponentUserId: string
): Promise<RivalryHistoryResponse> => {
  const opponent = await loadRivalryOpponentSummary(userId, opponentUserId);
  if (!opponent) {
    throw new Error('Rivalry history not found.');
  }
  const [userA, userB] = orderedPair(userId, opponentUserId);
  const members = await redis.zRange(
    progressStorageKeys.rivalryHistory(userA, userB),
    0,
    -1,
    { by: 'rank', reverse: true }
  );
  const history: RivalryHistoryEntry[] = [];
  for (const member of members) {
    const stored = parseStoredHistory(member.member);
    if (stored) {
      history.push(historyEntryForUser(stored, userId, userA));
    }
  }
  return { type: 'versus-rivalry-history', opponent, history };
};

export const loadRivalrySummary = async (
  userId: string,
  opponentUserId: string
): Promise<RivalrySummary> => {
  const [userA, userB] = orderedPair(userId, opponentUserId);
  const record = parseRivalry(
    await redis.get(progressStorageKeys.rivalry(userA, userB)),
    userA,
    userB
  );
  const currentIsA = userId === userA;
  return {
    wins: currentIsA ? record.winsA : record.winsB,
    losses: currentIsA ? record.winsB : record.winsA,
    draws: record.draws,
  };
};

const loadRivalryOpponentSummary = async (
  userId: string,
  opponentUserId: string
): Promise<RivalryOpponentSummary | null> => {
  const [userA, userB] = orderedPair(userId, opponentUserId);
  const record = parseRivalry(
    await redis.get(progressStorageKeys.rivalry(userA, userB)),
    userA,
    userB
  );
  if (record.lastPlayedAt === 0) {
    return null;
  }
  const currentIsA = userId === userA;
  const recentMembers = await redis.zRange(
    progressStorageKeys.rivalryHistory(userA, userB),
    0,
    4,
    { by: 'rank', reverse: true }
  );
  const recentHistory = recentMembers.flatMap((member) => {
    const stored = parseStoredHistory(member.member);
    return stored ? [stored] : [];
  });
  const latestMatch = recentHistory[0];
  if (!latestMatch) {
    return null;
  }
  const recentOutcomes: RivalryOutcome[] = [];
  for (const stored of [...recentHistory].reverse()) {
    recentOutcomes.push(outcomeForUser(stored, userId));
  }
  return {
    opponentUserId,
    opponentDisplayName: currentIsA
      ? record.displayNameB
      : record.displayNameA,
    latestMatchId: latestMatch.matchId,
    wins: currentIsA ? record.winsA : record.winsB,
    losses: currentIsA ? record.winsB : record.winsA,
    draws: record.draws,
    lastPlayedAt: record.lastPlayedAt,
    recentOutcomes,
  };
};

const storedHistoryEntry = (
  input: RivalryResultInput,
  firstIsA: boolean
): StoredRivalryHistoryEntry => ({
  matchId: input.matchId,
  completedAt: input.completedAt,
  winnerUserId:
    input.firstOutcome === 'draw'
      ? null
      : input.firstOutcome === 'win'
        ? input.firstUserId
        : input.secondUserId,
  draw: input.firstOutcome === 'draw',
  scoreA: firstIsA ? input.firstScore : input.secondScore,
  scoreB: firstIsA ? input.secondScore : input.firstScore,
});

const historyEntryForUser = (
  stored: StoredRivalryHistoryEntry,
  userId: string,
  userA: string
): RivalryHistoryEntry => ({
  matchId: stored.matchId,
  completedAt: stored.completedAt,
  outcome: outcomeForUser(stored, userId),
  myScore: userId === userA ? stored.scoreA : stored.scoreB,
  opponentScore: userId === userA ? stored.scoreB : stored.scoreA,
});

const outcomeForUser = (
  stored: StoredRivalryHistoryEntry,
  userId: string
): RivalryOutcome =>
  stored.draw ? 'draw' : stored.winnerUserId === userId ? 'win' : 'loss';

const parseStoredHistory = (
  value: string
): StoredRivalryHistoryEntry | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      isRecord(parsed) &&
      typeof parsed.matchId === 'string' &&
      typeof parsed.completedAt === 'number' &&
      (typeof parsed.winnerUserId === 'string' || parsed.winnerUserId === null) &&
      typeof parsed.draw === 'boolean' &&
      isNullableScore(parsed.scoreA) &&
      isNullableScore(parsed.scoreB)
    ) {
      return {
        matchId: parsed.matchId,
        completedAt: parsed.completedAt,
        winnerUserId: parsed.winnerUserId,
        draw: parsed.draw,
        scoreA: parsed.scoreA,
        scoreB: parsed.scoreB,
      };
    }
  } catch {
    return null;
  }
  return null;
};

const isNullableScore = (value: unknown): value is RivalryMatchScore | null =>
  value === null ||
  (isRecord(value) &&
    typeof value.guesses === 'number' &&
    typeof value.durationMs === 'number');

export const acknowledgeProgressRewards = async (
  userId: string,
  rewardIds: string[]
): Promise<void> => {
  if (rewardIds.length > 0) {
    await redis.zRem(progressStorageKeys.pendingRewards(userId), rewardIds);
  }
};

const mutateProgressWithAward = async (
  userId: string,
  awardId: string,
  now: number,
  create: (current: PlayerProgress) => {
    progress: PlayerProgress;
    amount: number;
    source: 'daily' | 'versus';
    label: string;
  }
): Promise<ProgressAwardResult> => {
  const profileKey = progressStorageKeys.profile(userId);
  const awardKey = progressStorageKeys.award(userId, awardId);

  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await redis.watch(profileKey, awardKey);
    if (await redis.get(awardKey)) {
      await transaction.unwatch();
      return {
        progress: summarizeProgress(await loadProgress(userId)),
        reward: null,
      };
    }

    const current = await loadProgress(userId);
    const next = create(current);
    const reward: ProgressReward | null =
      next.amount > 0
        ? {
            rewardId: awardId,
            source: next.source,
            amount: next.amount,
            label: next.label,
            previousTotalXp: current.totalXp,
            newTotalXp: next.progress.totalXp,
            createdAt: now,
          }
        : null;

    try {
      await transaction.multi();
      await transaction.set(profileKey, JSON.stringify(next.progress));
      await transaction.set(awardKey, '1');
      if (reward) {
        await transaction.hSet(progressStorageKeys.rewards(userId), {
          [reward.rewardId]: JSON.stringify(reward),
        });
        await transaction.zAdd(progressStorageKeys.pendingRewards(userId), {
          member: reward.rewardId,
          score: now,
        });
      }
      const result: unknown = await transaction.exec();
      if (result !== null) {
        return {
          progress: summarizeProgress(next.progress),
          reward,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error('Could not update player progression.');
};

const loadProgress = async (userId: string): Promise<PlayerProgress> => {
  return parseProgress(await redis.get(progressStorageKeys.profile(userId)));
};

const loadPendingRewards = async (
  userId: string
): Promise<ProgressReward[]> => {
  const members = await redis.zRange(
    progressStorageKeys.pendingRewards(userId),
    0,
    PENDING_REWARD_LIMIT - 1,
    { by: 'rank' }
  );
  if (members.length === 0) {
    return [];
  }
  const values = await redis.hMGet(
    progressStorageKeys.rewards(userId),
    members.map((member) => member.member)
  );
  const rewards: ProgressReward[] = [];
  values.forEach((value) => {
    const reward = parseReward(value);
    if (reward) {
      rewards.push(reward);
    }
  });
  return rewards;
};

const parseProgress = (value: string | undefined): PlayerProgress => {
  if (!value) {
    return createInitialProgress();
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      isRecord(parsed) &&
      typeof parsed.totalXp === 'number' &&
      typeof parsed.dailyStreak === 'number' &&
      (parsed.lastDailyDate === null || typeof parsed.lastDailyDate === 'string') &&
      isRecord(parsed.versus) &&
      typeof parsed.versus.wins === 'number' &&
      typeof parsed.versus.losses === 'number' &&
      typeof parsed.versus.draws === 'number'
    ) {
      return {
        totalXp: parsed.totalXp,
        dailyStreak: parsed.dailyStreak,
        lastDailyDate: parsed.lastDailyDate,
        versus: {
          wins: parsed.versus.wins,
          losses: parsed.versus.losses,
          draws: parsed.versus.draws,
        },
      };
    }
  } catch {
    return createInitialProgress();
  }
  return createInitialProgress();
};

const parseReward = (
  value: string | null | undefined
): ProgressReward | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      isRecord(parsed) &&
      typeof parsed.rewardId === 'string' &&
      (parsed.source === 'daily' || parsed.source === 'versus') &&
      typeof parsed.amount === 'number' &&
      typeof parsed.label === 'string' &&
      typeof parsed.previousTotalXp === 'number' &&
      typeof parsed.newTotalXp === 'number' &&
      typeof parsed.createdAt === 'number'
    ) {
      return {
        rewardId: parsed.rewardId,
        source: parsed.source,
        amount: parsed.amount,
        label: parsed.label,
        previousTotalXp: parsed.previousTotalXp,
        newTotalXp: parsed.newTotalXp,
        createdAt: parsed.createdAt,
      };
    }
  } catch {
    return null;
  }
  return null;
};

const parseRivalry = (
  value: string | undefined,
  userA: string,
  userB: string
): RivalryRecord => {
  if (value) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        isRecord(parsed) &&
        parsed.userA === userA &&
        parsed.userB === userB &&
        typeof parsed.winsA === 'number' &&
        typeof parsed.winsB === 'number' &&
        typeof parsed.draws === 'number'
      ) {
        return {
          userA,
          userB,
          displayNameA:
            typeof parsed.displayNameA === 'string' ? parsed.displayNameA : userA,
          displayNameB:
            typeof parsed.displayNameB === 'string' ? parsed.displayNameB : userB,
          winsA: parsed.winsA,
          winsB: parsed.winsB,
          draws: parsed.draws,
          lastPlayedAt:
            typeof parsed.lastPlayedAt === 'number' ? parsed.lastPlayedAt : 0,
        };
      }
    } catch {
      // Fall through to a clean rivalry record.
    }
  }
  return {
    userA,
    userB,
    displayNameA: userA,
    displayNameB: userB,
    winsA: 0,
    winsB: 0,
    draws: 0,
    lastPlayedAt: 0,
  };
};

const pairId = (firstUserId: string, secondUserId: string): string => {
  return orderedPair(firstUserId, secondUserId).join(':');
};

const orderedPair = (first: string, second: string): [string, string] => {
  return first.localeCompare(second) <= 0 ? [first, second] : [second, first];
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
