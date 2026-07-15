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
export const VERSUS_MAX_UNFINISHED_MATCHES = 5;
export const VERSUS_MATCH_DURATION_MS = 24 * 60 * 60 * 1000;
export const VERSUS_INVITATION_DURATION_MS = 72 * 60 * 60 * 1000;
export const VERSUS_MATCHMAKING_DURATION_MS = 72 * 60 * 60 * 1000;

export type VersusRules = {
  patternSize: number;
  maxOpponents: number;
  maxUnfinishedMatches: number;
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
  shareUrl: string | null;
  creatorDisplayName: string;
  acceptedByDisplayName: string | null;
  createdAt: number;
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

export type VersusResultResponse = {
  type: 'versus-result';
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

export const buildVersusInviteShareUrl = (
  postId: string,
  inviteId: string
): string => {
  const postWithoutPrefix = postId.replace(/^t3_/, '');
  const userData: VersusShareData = { type: 'pattern-invite', inviteId };
  const envelope = {
    hash: '',
    params: {},
    path: '',
    userData: JSON.stringify(userData),
  };
  const url = new URL(
    `https://reddit.com/r/_/comments/${encodeURIComponent(postWithoutPrefix)}`
  );
  url.searchParams.set('devvitshare', JSON.stringify(envelope));
  return url.toString();
};

export type VersusLobbySections = {
  activeMatches: VersusMatchSummary[];
  invitations: VersusPendingItem[];
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
  maxUnfinishedMatches: VERSUS_MAX_UNFINISHED_MATCHES,
  matchDurationMs: VERSUS_MATCH_DURATION_MS,
});

export const unfinishedVersusMatchCount = (
  matches: readonly Pick<VersusMatchSummary, 'status' | 'myAttemptStatus'>[]
): number =>
  matches.filter(
    (match) => match.status === 'active' && match.myAttemptStatus !== 'solved'
  ).length;

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
  for (const candidate of decodedShareCandidates(raw)) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (
        typeof value !== 'object' ||
        value === null ||
        !('type' in value) ||
        !('inviteId' in value) ||
        value.type !== 'pattern-invite' ||
        typeof value.inviteId !== 'string'
      ) {
        continue;
      }
      const inviteId = value.inviteId.trim();
      if (inviteId.length === 0 || inviteId.length > 200) {
        continue;
      }
      return { type: 'pattern-invite', inviteId };
    } catch {
      continue;
    }
  }
  return null;
};

export const parseVersusShareUrl = (
  value: string | null | undefined
): VersusShareData | null => {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value, 'https://reddit.invalid');
    const envelopeValues = [...url.searchParams.getAll('devvitshare')];
    const hash = url.hash.slice(1);
    for (const hashCandidate of decodedShareCandidates(hash)) {
      const queryStart = hashCandidate.indexOf('?');
      const params = new URLSearchParams(
        queryStart >= 0 ? hashCandidate.slice(queryStart + 1) : hashCandidate
      );
      envelopeValues.push(...params.getAll('devvitshare'));
    }

    for (const envelopeValue of envelopeValues) {
      for (const candidate of decodedShareCandidates(envelopeValue)) {
        try {
          const envelope: unknown = JSON.parse(candidate);
          if (
            typeof envelope !== 'object' ||
            envelope === null ||
            !('userData' in envelope) ||
            typeof envelope.userData !== 'string'
          ) {
            continue;
          }
          const share = parseVersusShareData(envelope.userData);
          if (share) {
            return share;
          }
        } catch {
          continue;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
};

const decodedShareCandidates = (value: string): string[] => {
  const candidates = [value];
  let current = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current || candidates.includes(decoded)) {
        break;
      }
      candidates.push(decoded);
      current = decoded;
    } catch {
      break;
    }
  }
  return candidates;
};

export const organizeVersusLobby = (
  lobby: Pick<VersusLobbyResponse, 'matches' | 'pendingItems'>
): VersusLobbySections => {
  const matchPriority = (match: VersusMatchSummary): number =>
    match.myAttemptStatus === 'playing'
      ? 0
      : match.myAttemptStatus === 'not-started'
        ? 1
        : 2;
  const invitationNeedsAction = (item: VersusPendingItem): boolean =>
    item.kind === 'invite'
      ? item.invite.role === 'acceptor'
      : item.rematch.role === 'responder';
  const invitationCreatedAt = (item: VersusPendingItem): number =>
    item.kind === 'invite' ? item.invite.createdAt : item.rematch.createdAt;
  return {
    activeMatches: lobby.matches
      .filter((match) => match.status === 'active')
      .sort(
        (first, second) =>
          matchPriority(first) - matchPriority(second) ||
          second.createdAt - first.createdAt
      ),
    invitations: [...lobby.pendingItems].sort(
      (first, second) =>
        Number(invitationNeedsAction(second)) - Number(invitationNeedsAction(first)) ||
        invitationCreatedAt(second) - invitationCreatedAt(first)
    ),
    resultMatches: lobby.matches.filter(
      (match) => match.status !== 'active'
    ).sort((first, second) => second.createdAt - first.createdAt),
  };
};
