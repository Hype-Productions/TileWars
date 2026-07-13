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

export type {
  VersusGuessRequest,
  VersusInviteResponse,
  VersusInviteSummary,
  VersusLobbyResponse,
  VersusMarkRequest,
  VersusMatchSummary,
  VersusModeRequest,
  VersusPendingItem,
  VersusPatternRequest,
  VersusRematchResponse,
  VersusRematchSummary,
  VersusRules,
  VersusSessionResponse,
} from './versus';

export type {
  PlayerProgress,
  PlayerProgressSummary,
  ProgressResponse,
  ProgressAcknowledgeRequest,
  ProgressReward,
  RivalryHistoryEntry,
  RivalryHistoryResponse,
  RivalryMatchScore,
  RivalryOpponentSummary,
  RivalryOpponentsResponse,
  RivalryOutcome,
  RivalrySummary,
  VersusRecord,
} from './progression';
