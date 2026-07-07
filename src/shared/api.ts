export type DailyResponse = {
  type: 'daily';
  date: string;
  seed: string;
};

export type {
  DailyGuessRequest,
  DailyLeaderboardResponse,
  DailyMarkRequest,
  DailyModeRequest,
  DailySessionResponse,
  GameMode,
  GuessRecord,
  LeaderboardEntry,
  PlayerSession,
  PuzzleId,
} from './game';
