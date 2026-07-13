import type { GuessRecord, PlayerSession } from './game';
import type {
  PlayerProgressSummary,
  ProgressReward,
  RivalryOpponentSummary,
  RivalrySummary,
} from './progression';
import {
  type Coord,
  validatePattern,
  type ValidationResult,
} from './pattern';

export const VERSUS_PATTERN_SIZE = 6;
export const VERSUS_MAX_OPPONENTS = 1;
export const VERSUS_MATCH_DURATION_MS = 72 * 60 * 60 * 1000;
export const VERSUS_MATCHMAKING_DURATION_MS = 72 * 60 * 60 * 1000;

export type VersusRules = {
  patternSize: number;
  maxOpponents: number;
  matchDurationMs: number;
};

export type VersusAttemptStatus = 'not-started' | 'playing' | 'solved';
export type VersusMatchStatus = 'active' | 'complete' | 'expired';
export type VersusOutcome =
  | 'pending'
  | 'win'
  | 'loss'
  | 'draw'
  | 'no-contest';
export type VersusRoundStatus = 'matching' | 'closed' | 'complete';
export type VersusRematchStatus =
  | 'none'
  | 'waiting-for-opponent'
  | 'pattern-needed';
export type VersusPendingStatus = 'pending' | 'accepted-awaiting-pattern';

export type VersusScore = {
  guesses: number;
  durationMs: number;
};

export type VersusResolution = {
  status: VersusMatchStatus;
  winner: 'first' | 'second' | null;
  noContest: boolean;
};

export type VersusReplayGuess = GuessRecord & {
  order: number;
};

export type VersusRoundSummary = {
  roundId: string;
  status: VersusRoundStatus;
  createdAt: number;
  matchingClosesAt: number;
  matchCount: number;
  maxMatches: number;
};

export type VersusMatchSummary = {
  matchId: string;
  source: 'public' | 'rematch' | 'invite';
  opponentDisplayName: string;
  status: VersusMatchStatus;
  outcome: VersusOutcome;
  createdAt: number;
  expiresAt: number;
  myAttemptStatus: VersusAttemptStatus;
  opponentAttemptStatus: VersusAttemptStatus;
  myScore: VersusScore | null;
  opponentScore: VersusScore | null;
  myReplay: VersusReplayGuess[];
  opponentReplay: VersusReplayGuess[];
  rivalry: RivalrySummary;
  xpEarned: number;
};

export type VersusInviteSummary = {
  inviteId: string;
  inviteCode: string;
  creatorDisplayName: string;
  acceptedByDisplayName: string | null;
  status:
    | 'open'
    | 'accepted-awaiting-pattern'
    | 'matched'
    | 'cancelled'
    | 'expired';
  expiresAt: number;
  role: 'creator' | 'acceptor' | 'viewer';
  matchId: string | null;
};

export type VersusRematchSummary = {
  requestId: string;
  sourceMatchId: string;
  opponentDisplayName: string;
  status: VersusPendingStatus;
  role: 'requester' | 'responder';
  createdAt: number;
  expiresAt: number;
};

export type VersusPendingItem =
  | { kind: 'invite'; invite: VersusInviteSummary }
  | { kind: 'rematch'; rematch: VersusRematchSummary };

export type VersusLobbyResponse = {
  type: 'versus-lobby';
  serverNow: number;
  rules: VersusRules;
  round: VersusRoundSummary | null;
  matches: VersusMatchSummary[];
  pendingItems: VersusPendingItem[];
  recentOpponents: RivalryOpponentSummary[];
  progress: PlayerProgressSummary;
  pendingRewards: ProgressReward[];
  matchedMatchId?: string;
};

export type VersusSessionResponse = {
  type: 'versus-session';
  serverNow: number;
  session: PlayerSession;
  match: VersusMatchSummary;
};

export type VersusPatternRequest = {
  pattern: Coord[];
};

export type VersusInviteResponse = {
  type: 'versus-invite';
  invite: VersusInviteSummary;
  matchedMatchId?: string;
};

export type VersusRematchResponse = {
  type: 'versus-rematch';
  rematch: VersusRematchSummary;
  matchedMatchId?: string;
};

export type VersusShareData = {
  type: 'pattern-invite';
  inviteId: string;
};

export type VersusLobbySections = {
  actionItems: VersusPendingItem[];
  playableMatches: VersusMatchSummary[];
  waitingItems: VersusPendingItem[];
  waitingMatches: VersusMatchSummary[];
  resultMatches: VersusMatchSummary[];
};

export type VersusGuessRequest = {
  coord: Coord;
};

export type VersusMarkRequest = {
  coord: Coord;
};

export type VersusModeRequest = {
  clueMode: PlayerSession['clueMode'];
};

export const versusRules = (): VersusRules => ({
  patternSize: VERSUS_PATTERN_SIZE,
  maxOpponents: VERSUS_MAX_OPPONENTS,
  matchDurationMs: VERSUS_MATCH_DURATION_MS,
});

export const validateVersusPattern = (pattern: Coord[]): ValidationResult => {
  return validatePattern(pattern, {
    minTiles: VERSUS_PATTERN_SIZE,
    maxTiles: VERSUS_PATTERN_SIZE,
  });
};

export const versusScoreForSession = (
  session: PlayerSession
): VersusScore | null => {
  if (!session.solved || session.solvedAt === null) {
    return null;
  }

  return {
    guesses: session.guesses.length,
    durationMs: Math.max(0, session.solvedAt - session.startedAt),
  };
};

export const compareVersusScores = (
  first: VersusScore,
  second: VersusScore
): -1 | 0 | 1 => {
  if (first.guesses !== second.guesses) {
    return first.guesses < second.guesses ? -1 : 1;
  }

  if (first.durationMs === second.durationMs) {
    return 0;
  }

  return first.durationMs < second.durationMs ? -1 : 1;
};

export const resolveVersusScores = (
  first: VersusScore | null,
  second: VersusScore | null,
  expired: boolean
): VersusResolution => {
  if (first && second) {
    const comparison = compareVersusScores(first, second);
    return {
      status: 'complete',
      winner:
        comparison === 0 ? null : comparison < 0 ? 'first' : 'second',
      noContest: false,
    };
  }

  if (!expired) {
    return { status: 'active', winner: null, noContest: false };
  }

  return {
    status: 'expired',
    winner: first ? 'first' : second ? 'second' : null,
    noContest: !first && !second,
  };
};

export const replayForSession = (
  session: PlayerSession | null
): VersusReplayGuess[] => {
  if (!session?.solved) {
    return [];
  }

  return session.guesses.map((guess, index) => ({
    ...guess,
    order: index + 1,
  }));
};

export const parseVersusShareData = (
  raw: string | null | undefined
): VersusShareData | null => {
  if (!raw) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('type' in value) ||
      !('inviteId' in value) ||
      value.type !== 'pattern-invite' ||
      typeof value.inviteId !== 'string'
    ) {
      return null;
    }
    return { type: 'pattern-invite', inviteId: value.inviteId };
  } catch {
    return null;
  }
};

export const parseVersusShareUrl = (
  value: string | null | undefined
): VersusShareData | null => {
  if (!value) {
    return null;
  }
  try {
    const envelopeValue = new URL(value).searchParams.get('devvitshare');
    if (!envelopeValue) {
      return null;
    }
    const envelope: unknown = JSON.parse(envelopeValue);
    if (
      typeof envelope !== 'object' ||
      envelope === null ||
      !('userData' in envelope) ||
      typeof envelope.userData !== 'string'
    ) {
      return null;
    }
    return parseVersusShareData(envelope.userData);
  } catch {
    return null;
  }
};

export const organizeVersusLobby = (
  lobby: Pick<VersusLobbyResponse, 'matches' | 'pendingItems'>
): VersusLobbySections => {
  const actionItems = lobby.pendingItems.filter((item) =>
    item.kind === 'invite'
      ? item.invite.role === 'acceptor'
      : item.rematch.role === 'responder'
  );
  const waitingItems = lobby.pendingItems.filter(
    (item) => !actionItems.includes(item)
  );
  const pendingSourceIds = new Set(
    lobby.pendingItems.flatMap((item) =>
      item.kind === 'rematch' ? [item.rematch.sourceMatchId] : []
    )
  );
  return {
    actionItems,
    playableMatches: lobby.matches.filter(
      (match) => match.status === 'active' && match.myAttemptStatus !== 'solved'
    ),
    waitingItems,
    waitingMatches: lobby.matches.filter(
      (match) => match.status === 'active' && match.myAttemptStatus === 'solved'
    ),
    resultMatches: lobby.matches.filter(
      (match) => match.status !== 'active' && !pendingSourceIds.has(match.matchId)
    ),
  };
};
