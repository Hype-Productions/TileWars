export const DAILY_BASE_XP = 150;
export const DAILY_STREAK_XP_STEP = 15;
export const DAILY_MAX_XP = 300;
export const VERSUS_WIN_XP = 100;
export const VERSUS_DRAW_XP = 70;
export const VERSUS_LOSS_XP = 40;

export type VersusRecord = {
  wins: number;
  losses: number;
  draws: number;
};

export type PlayerProgress = {
  totalXp: number;
  dailyStreak: number;
  lastDailyDate: string | null;
  versus: VersusRecord;
};

export type PlayerProgressSummary = PlayerProgress & {
  level: number;
  levelXp: number;
  xpForNextLevel: number;
};

export type ProgressReward = {
  rewardId: string;
  source: 'daily' | 'versus';
  amount: number;
  label: string;
  previousTotalXp: number;
  newTotalXp: number;
  createdAt: number;
};

export type XpAnimationSegment = {
  level: number;
  fromXp: number;
  toXp: number;
  xpForNextLevel: number;
  completesLevel: boolean;
};

export type RivalrySummary = {
  wins: number;
  losses: number;
  draws: number;
};

export type RivalryOutcome = 'win' | 'loss' | 'draw';
export type RivalryOutcomeSlot = RivalryOutcome | null;
export type RivalryOutcomeColor = 'green' | 'red' | 'orange' | 'cream';

export type RivalryMatchScore = {
  guesses: number;
  durationMs: number;
};

export type RivalryHistoryEntry = {
  matchId: string;
  completedAt: number;
  outcome: RivalryOutcome;
  myScore: RivalryMatchScore | null;
  opponentScore: RivalryMatchScore | null;
};

export type RivalryOpponentSummary = RivalrySummary & {
  opponentUserId: string;
  opponentDisplayName: string;
  latestMatchId: string;
  lastPlayedAt: number;
  recentOutcomes: RivalryOutcome[];
};

export type RivalryOpponentsResponse = {
  type: 'versus-opponents';
  opponents: RivalryOpponentSummary[];
};

export type RivalryHistoryResponse = {
  type: 'versus-rivalry-history';
  opponent: RivalryOpponentSummary;
  history: RivalryHistoryEntry[];
};

export type ProgressResponse = {
  type: 'progress';
  progress: PlayerProgressSummary;
  pendingRewards: ProgressReward[];
};

export type ProgressAcknowledgeRequest = {
  rewardIds: string[];
};

export const createInitialProgress = (): PlayerProgress => ({
  totalXp: 0,
  dailyStreak: 0,
  lastDailyDate: null,
  versus: { wins: 0, losses: 0, draws: 0 },
});

export const xpRequiredForLevel = (level: number): number => {
  return Math.min(1000, 300 + Math.max(0, level - 1) * 50);
};

export const summarizeProgress = (
  progress: PlayerProgress
): PlayerProgressSummary => {
  let level = 1;
  let levelXp = Math.max(0, progress.totalXp);
  while (levelXp >= xpRequiredForLevel(level)) {
    levelXp -= xpRequiredForLevel(level);
    level += 1;
  }

  return {
    ...progress,
    level,
    levelXp,
    xpForNextLevel: xpRequiredForLevel(level),
  };
};

export const dailyXpForStreak = (streak: number): number => {
  return Math.min(
    DAILY_MAX_XP,
    DAILY_BASE_XP + Math.max(0, streak - 1) * DAILY_STREAK_XP_STEP
  );
};

export const nextDailyStreak = (
  lastDailyDate: string | null,
  currentStreak: number,
  solvedDate: string
): number => {
  if (lastDailyDate === solvedDate) {
    return currentStreak;
  }
  if (lastDailyDate && daysBetween(lastDailyDate, solvedDate) === 1) {
    return Math.max(1, currentStreak + 1);
  }
  return 1;
};

export const activeDailyStreak = (
  progress: PlayerProgress,
  today: string
): number => {
  if (!progress.lastDailyDate) {
    return 0;
  }
  const difference = daysBetween(progress.lastDailyDate, today);
  return difference === 0 || difference === 1 ? progress.dailyStreak : 0;
};

export const versusXpForResult = (
  outcome: 'win' | 'loss' | 'draw' | 'no-contest',
  completed: boolean
): number => {
  if (outcome === 'win') {
    return completed ? VERSUS_WIN_XP : 0;
  }
  if (outcome === 'draw') {
    return completed ? VERSUS_DRAW_XP : 0;
  }
  if (outcome === 'loss') {
    return completed ? VERSUS_LOSS_XP : 0;
  }
  return 0;
};

export const buildXpAnimationSegments = (
  previousTotalXp: number,
  newTotalXp: number
): XpAnimationSegment[] => {
  let currentTotalXp = Math.max(0, Math.floor(previousTotalXp));
  const targetTotalXp = Math.max(currentTotalXp, Math.floor(newTotalXp));
  const segments: XpAnimationSegment[] = [];

  while (currentTotalXp < targetTotalXp) {
    const summary = summarizeProgress({
      ...createInitialProgress(),
      totalXp: currentTotalXp,
    });
    const available = summary.xpForNextLevel - summary.levelXp;
    const amount = Math.min(available, targetTotalXp - currentTotalXp);
    const toXp = summary.levelXp + amount;
    segments.push({
      level: summary.level,
      fromXp: summary.levelXp,
      toXp,
      xpForNextLevel: summary.xpForNextLevel,
      completesLevel: toXp === summary.xpForNextLevel,
    });
    currentTotalXp += amount;
  }

  return segments;
};

export const rivalryOutcomeSlots = (
  outcomes: RivalryOutcome[]
): RivalryOutcomeSlot[] => {
  const recent = outcomes.slice(-5);
  return [...recent, ...Array<RivalryOutcomeSlot>(5 - recent.length).fill(null)];
};

export const rivalryOutcomeColor = (
  outcome: RivalryOutcomeSlot
): RivalryOutcomeColor => {
  return outcome === 'win'
    ? 'green'
    : outcome === 'loss'
      ? 'red'
      : outcome === 'draw'
        ? 'orange'
        : 'cream';
};

const daysBetween = (first: string, second: string): number => {
  const firstTime = Date.parse(`${first}T00:00:00.000Z`);
  const secondTime = Date.parse(`${second}T00:00:00.000Z`);
  return Math.round((secondTime - firstTime) / 86_400_000);
};
