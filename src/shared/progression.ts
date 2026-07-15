export const DAILY_BASE_XP = 150;
export const DAILY_STREAK_XP_STEP = 10;
export const DAILY_MAX_STREAK_XP = 500;
export const DAILY_MAX_XP = DAILY_BASE_XP + DAILY_MAX_STREAK_XP;
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

export type ProgressFlair = {
  title: string;
  text: string;
  backgroundColor: `#${string}`;
  textColor: 'dark';
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
  return Math.min(3000, 300 + Math.max(0, level - 1) * 50);
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

export const progressFlairFor = (
  progress: Pick<PlayerProgressSummary, 'level' | 'totalXp'>
): ProgressFlair => {
  if (progress.totalXp <= 0) {
    return {
      title: 'Unranked',
      text: 'Unranked',
      backgroundColor: '#FFF6DD',
      textColor: 'dark',
    };
  }

  const level = Math.max(1, Math.floor(progress.level));
  const tier =
    PROGRESS_FLAIR_TIERS.find((candidate) => level >= candidate.minimumLevel) ??
    TILE_STARTER_FLAIR_TIER;

  return {
    title: tier.title,
    text: `${tier.title} · Lv ${level}`,
    backgroundColor: tier.backgroundColor,
    textColor: 'dark',
  };
};

export const dailyXpForStreak = (streak: number): number => {
  const streakBonus = Math.min(
    DAILY_MAX_STREAK_XP,
    Math.max(0, streak - 1) * DAILY_STREAK_XP_STEP
  );
  return Math.min(
    DAILY_MAX_XP,
    DAILY_BASE_XP + streakBonus
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

type ProgressFlairTier = {
  minimumLevel: number;
  title: string;
  backgroundColor: `#${string}`;
};

const TILE_STARTER_FLAIR_TIER: ProgressFlairTier = {
  minimumLevel: 1,
  title: 'Tile Starter',
  backgroundColor: '#FFF6DD',
};

const PROGRESS_FLAIR_TIERS: ProgressFlairTier[] = [
  { minimumLevel: 500, title: 'Legend of the Grid', backgroundColor: '#FFB12D' },
  { minimumLevel: 450, title: 'Living Pattern', backgroundColor: '#35D07F' },
  { minimumLevel: 400, title: 'Tile Champion', backgroundColor: '#35D07F' },
  { minimumLevel: 350, title: 'Grid Vanguard', backgroundColor: '#339DFF' },
  { minimumLevel: 300, title: 'Pattern Sage', backgroundColor: '#339DFF' },
  { minimumLevel: 250, title: 'Mosaic Master', backgroundColor: '#FF5365' },
  { minimumLevel: 200, title: 'Board Tactician', backgroundColor: '#FF5365' },
  { minimumLevel: 150, title: 'Tile Architect', backgroundColor: '#FFB12D' },
  { minimumLevel: 100, title: 'Pattern Smith', backgroundColor: '#FFB12D' },
  { minimumLevel: 75, title: 'Clue Keeper', backgroundColor: '#35D07F' },
  { minimumLevel: 50, title: 'Grid Runner', backgroundColor: '#35D07F' },
  { minimumLevel: 25, title: 'Color Reader', backgroundColor: '#339DFF' },
  { minimumLevel: 10, title: 'Pattern Scout', backgroundColor: '#339DFF' },
  TILE_STARTER_FLAIR_TIER,
];
