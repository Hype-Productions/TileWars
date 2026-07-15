import { randomUUID } from 'node:crypto';
import { redis } from '@devvit/web/server';
import {
  applyGuessToSession,
  createInitialSession,
  setClueModeInSession,
  toggleMarkerInSession,
  type PlayerSession,
  type PuzzleId,
} from '../../shared/game';
import type { ClueMode, Coord } from '../../shared/pattern';
import { todayUtcDate } from '../../shared/pattern';
import {
  replayForSession,
  resolveVersusScores,
  VERSUS_MATCH_DURATION_MS,
  VERSUS_MATCHMAKING_DURATION_MS,
  VERSUS_MAX_OPPONENTS,
  type VersusAttemptStatus,
  type VersusLobbyResponse,
  type VersusInviteResponse,
  type VersusInviteSummary,
  type VersusMatchSummary,
  type VersusOutcome,
  type VersusPendingItem,
  type VersusRematchResponse,
  type VersusRematchSummary,
  type VersusResultResponse,
  type VersusRoundSummary,
  type VersusSessionResponse,
  validateVersusPattern,
  versusRules,
  versusScoreForSession,
} from '../../shared/versus';
import {
  awardVersusProgress,
  loadProgressResponse,
  loadRivalryOpponents,
  loadRivalrySummary,
  recordRivalryResult,
} from './progressStorage';
import { versusXpForResult } from '../../shared/progression';
import {
  inviteAcceptanceDecision,
  rematchCreationDecision,
  resolvedResultAccessDecision,
  responsePatternDecision,
} from '../../shared/versusState';

const HISTORY_LIMIT = 20;
const CANDIDATE_LIMIT = 50;
const ARCHIVE_SECONDS = 30 * 24 * 60 * 60;
const MATCHMAKING_SCORE_BUCKET = 10_000_000_000_000;
const TRANSACTION_RETRIES = 4;

type VersusUser = {
  userId: string;
  displayName: string;
};

type VersusRoundRecord = {
  roundId: string;
  userId: string;
  displayName: string;
  pattern: Coord[];
  status: 'matching' | 'closed' | 'complete';
  createdAt: number;
  matchingClosesAt: number;
  matchIds: string[];
  opponentIds: string[];
};

type VersusParticipant = {
  userId: string;
  displayName: string;
  pattern: Coord[];
};

type VersusMatchRecord = {
  matchId: string;
  source: 'public' | 'rematch' | 'invite';
  createdAt: number;
  expiresAt: number;
  status: 'active' | 'complete' | 'expired';
  participantA: VersusParticipant;
  participantB: VersusParticipant;
  sessionA: PlayerSession | null;
  sessionB: PlayerSession | null;
  winnerUserId: string | null;
  noContest: boolean;
  progressEligible: boolean;
  progressFinalized: boolean;
};

type VersusInviteRecord = {
  inviteId: string;
  inviteCode: string;
  shareUrl: string | null;
  creator: VersusUser;
  pattern: Coord[];
  status:
    | 'open'
    | 'accepted-awaiting-pattern'
    | 'matched'
    | 'cancelled'
    | 'expired';
  createdAt: number;
  expiresAt: number;
  acceptedBy: VersusUser | null;
  matchId: string | null;
};

type RematchRecord = {
  requestId: string;
  sourceMatchId: string;
  requester: VersusUser;
  responder: VersusUser;
  requesterPattern: Coord[];
  status:
    | 'pending'
    | 'accepted-awaiting-pattern'
    | 'matched'
    | 'declined'
    | 'cancelled'
    | 'expired';
  createdAt: number;
  expiresAt: number;
  createdMatchId: string | null;
  legacyUpgraded?: boolean;
};

export const versusStorageKeys = {
  queue: 'versus:queue',
  round: (roundId: string): string => `versus:round:${roundId}`,
  activeRound: (userId: string): string => `versus:user:${userId}:active-round`,
  match: (matchId: string): string => `versus:match:${matchId}`,
  userMatches: (userId: string): string => `versus:user:${userId}:matches`,
  rematch: (sourceMatchId: string): string =>
    `versus:rematch:${sourceMatchId}`,
  invite: (inviteId: string): string => `versus:invite:${inviteId}`,
  inviteCode: (inviteCode: string): string =>
    `versus:invite-code:${inviteCode.toUpperCase()}`,
  userInvites: (userId: string): string => `versus:user:${userId}:invites`,
};

export const loadVersusLobby = async (
  user: VersusUser,
  matchedMatchId?: string
): Promise<VersusLobbyResponse> => {
  const now = Date.now();
  const round = await loadActiveRound(user.userId);
  const normalizedRound = round ? await normalizeRound(round, now) : null;
  const matches = await loadUserMatchRecords(user.userId);
  const settledMatches: VersusMatchRecord[] = [];
  for (const match of matches) {
    const settled = await settleSaveAndFinalizeMatch(match, now);
    settledMatches.push(settled);
  }
  const summaries: VersusMatchSummary[] = [];
  for (const match of settledMatches) {
    summaries.push(await summarizeMatch(match, user.userId));
  }

  await completeRoundIfReady(normalizedRound, matches, now);
  const progress = await loadProgressResponse(user.userId, todayUtcDate());
  const pendingItems = await loadPendingItems(user.userId, settledMatches, now);
  const recentOpponents = (
    await loadRivalryOpponents(user.userId, '', 3)
  ).opponents;

  return {
    type: 'versus-lobby',
    serverNow: now,
    rules: versusRules(),
    round: normalizedRound ? summarizeRound(normalizedRound) : null,
    matches: summaries,
    pendingItems,
    recentOpponents,
    progress: progress.progress,
    pendingRewards: progress.pendingRewards,
    ...(matchedMatchId ? { matchedMatchId } : {}),
  };
};

export const createVersusRound = async (
  user: VersusUser,
  pattern: Coord[]
): Promise<string | null> => {
  const validation = validateVersusPattern(pattern);
  if (!validation.valid) {
    throw new VersusStorageError(validation.message, 400);
  }

  const existing = await loadActiveRound(user.userId);
  if (existing) {
    const normalized = await normalizeRound(existing, Date.now());
    if (normalized.status !== 'complete') {
      throw new VersusStorageError('Finish or close your active round first.', 409);
    }
    await redis.del(versusStorageKeys.activeRound(user.userId));
  }

  const now = Date.now();
  const round: VersusRoundRecord = {
    roundId: randomUUID(),
    userId: user.userId,
    displayName: user.displayName,
    pattern,
    status: 'matching',
    createdAt: now,
    matchingClosesAt: now + VERSUS_MATCHMAKING_DURATION_MS,
    matchIds: [],
    opponentIds: [],
  };
  const activeKey = versusStorageKeys.activeRound(user.userId);
  const claimed = await redis.set(activeKey, round.roundId, {
    nx: true,
    expiration: new Date(now + VERSUS_MATCHMAKING_DURATION_MS + ARCHIVE_SECONDS * 1000),
  });

  if (!claimed) {
    throw new VersusStorageError('An active Versus round already exists.', 409);
  }

  try {
    await redis.set(versusStorageKeys.round(round.roundId), JSON.stringify(round), {
      expiration: new Date(now + ARCHIVE_SECONDS * 1000),
    });
    await redis.zAdd(versusStorageKeys.queue, {
      member: round.roundId,
      score: queueScore(round),
    });
  } catch (error) {
    await redis.del(activeKey);
    throw error;
  }

  return matchmakeVersusRound(user.userId);
};

export const matchmakeVersusRound = async (
  userId: string
): Promise<string | null> => {
  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const current = await loadActiveRound(userId);
    if (!current) {
      return null;
    }

    const now = Date.now();
    const normalized = await normalizeRound(current, now);
    if (normalized.status !== 'matching') {
      return null;
    }

    const candidateMembers = await redis.zRange(
      versusStorageKeys.queue,
      0,
      CANDIDATE_LIMIT - 1,
      { by: 'rank' }
    );
    let candidate: VersusRoundRecord | null = null;

    for (const member of candidateMembers) {
      if (member.member === normalized.roundId) {
        continue;
      }

      const loaded = await loadRound(member.member);
      if (!loaded) {
        await redis.zRem(versusStorageKeys.queue, [member.member]);
        continue;
      }

      const ready = await normalizeRound(loaded, now);
      if (
        ready.status === 'matching' &&
        ready.userId !== userId &&
        !normalized.opponentIds.includes(ready.userId) &&
        !ready.opponentIds.includes(userId)
      ) {
        candidate = ready;
        break;
      }
    }

    if (!candidate) {
      return null;
    }

    const currentKey = versusStorageKeys.round(normalized.roundId);
    const candidateKey = versusStorageKeys.round(candidate.roundId);
    const transaction = await redis.watch(
      versusStorageKeys.queue,
      currentKey,
      candidateKey
    );
    const freshCurrent = await loadRound(normalized.roundId);
    const freshCandidate = await loadRound(candidate.roundId);

    if (
      !freshCurrent ||
      !freshCandidate ||
      freshCurrent.status !== 'matching' ||
      freshCandidate.status !== 'matching' ||
      freshCurrent.opponentIds.includes(freshCandidate.userId) ||
      freshCurrent.matchIds.length >= VERSUS_MAX_OPPONENTS ||
      freshCandidate.matchIds.length >= VERSUS_MAX_OPPONENTS
    ) {
      await transaction.unwatch();
      continue;
    }

    const match = createMatchRecord(
      {
        userId: freshCurrent.userId,
        displayName: freshCurrent.displayName,
        pattern: freshCurrent.pattern,
      },
      {
        userId: freshCandidate.userId,
        displayName: freshCandidate.displayName,
        pattern: freshCandidate.pattern,
      },
      'public',
      now
    );
    const nextCurrent = addMatchToRound(
      freshCurrent,
      match.matchId,
      freshCandidate.userId
    );
    const nextCandidate = addMatchToRound(
      freshCandidate,
      match.matchId,
      freshCurrent.userId
    );

    try {
      await transaction.multi();
      await transaction.set(currentKey, JSON.stringify(nextCurrent));
      await transaction.set(candidateKey, JSON.stringify(nextCandidate));
      await transaction.set(
        versusStorageKeys.match(match.matchId),
        JSON.stringify(match)
      );
      await transaction.expire(versusStorageKeys.match(match.matchId), ARCHIVE_SECONDS);
      await transaction.zAdd(versusStorageKeys.userMatches(freshCurrent.userId), {
        member: match.matchId,
        score: now,
      });
      await transaction.zAdd(versusStorageKeys.userMatches(freshCandidate.userId), {
        member: match.matchId,
        score: now,
      });
      await transaction.zRemRangeByRank(
        versusStorageKeys.userMatches(freshCurrent.userId),
        0,
        -(HISTORY_LIMIT + 1)
      );
      await transaction.zRemRangeByRank(
        versusStorageKeys.userMatches(freshCandidate.userId),
        0,
        -(HISTORY_LIMIT + 1)
      );
      await updateQueueInTransaction(transaction, nextCurrent);
      await updateQueueInTransaction(transaction, nextCandidate);
      const result: unknown = await transaction.exec();
      if (result === null) {
        continue;
      }
      return match.matchId;
    } catch {
      continue;
    }
  }

  return null;
};

export const closeVersusRound = async (userId: string): Promise<void> => {
  const round = await loadActiveRound(userId);
  if (!round) {
    return;
  }

  const status = round.matchIds.length === 0 ? 'complete' : 'closed';
  const next: VersusRoundRecord = { ...round, status };
  await redis.set(versusStorageKeys.round(round.roundId), JSON.stringify(next));
  await redis.zRem(versusStorageKeys.queue, [round.roundId]);
  if (status === 'complete') {
    await redis.del(versusStorageKeys.activeRound(userId));
  }
};

export const openVersusSession = async (
  matchId: string,
  userId: string
): Promise<VersusSessionResponse> => {
  const match = await mutateMatch(matchId, (record, now) => {
    assertParticipant(record, userId);
    const settled = settleMatch(record, now);
    if (settled.status === 'expired') {
      throw new VersusStorageError('This match has expired.', 410);
    }

    return ensureSession(settled, userId, now);
  });
  const session = sessionForUser(match, userId);
  if (!session) {
    throw new VersusStorageError('This match cannot be opened.', 410);
  }

  const now = Date.now();
  return {
    type: 'versus-session',
    serverNow: now,
    session,
    match: await summarizeMatch(match, userId),
  };
};

export const loadVersusResult = async (
  matchId: string,
  userId: string
): Promise<VersusResultResponse> => {
  const stored = await loadMatch(matchId);
  if (!stored) {
    throw new VersusStorageError('Detailed replay is no longer available.', 404);
  }
  const isParticipant =
    stored.participantA.userId === userId || stored.participantB.userId === userId;
  if (resolvedResultAccessDecision(isParticipant, stored.status) === 'not-participant') {
    throw new VersusStorageError('You are not part of this match.', 404);
  }
  const match = await settleSaveAndFinalizeMatch(stored, Date.now());
  const access = resolvedResultAccessDecision(
    isParticipant,
    match.status
  );
  if (access === 'still-active') {
    throw new VersusStorageError('This match is still active.', 409);
  }
  return {
    type: 'versus-result',
    match: await summarizeMatch(match, userId),
  };
};

export const guessVersusTile = async (
  matchId: string,
  userId: string,
  coord: Coord
): Promise<VersusSessionResponse> => {
  const match = await mutateMatch(matchId, (record, now) => {
    assertPlayable(record, userId, now);
    const withSession = ensureSession(record, userId, now);
    const session = sessionForUser(withSession, userId);
    if (!session) {
      throw new VersusStorageError('Could not start this attempt.', 409);
    }

    const pattern = opponentForUser(withSession, userId).pattern;
    const nextSession = applyGuessToSession(session, pattern, coord, now);
    return settleMatch(setSessionForUser(withSession, userId, nextSession), now);
  });
  return sessionResponse(await finalizeMatchProgress(match), userId);
};

export const markVersusTile = async (
  matchId: string,
  userId: string,
  coord: Coord
): Promise<VersusSessionResponse> => {
  const match = await mutateMatch(matchId, (record, now) => {
    assertPlayable(record, userId, now);
    const withSession = ensureSession(record, userId, now);
    const session = sessionForUser(withSession, userId);
    if (!session) {
      throw new VersusStorageError('Could not start this attempt.', 409);
    }
    return setSessionForUser(
      withSession,
      userId,
      toggleMarkerInSession(session, coord)
    );
  });

  return sessionResponse(match, userId);
};

export const setVersusClueMode = async (
  matchId: string,
  userId: string,
  clueMode: ClueMode
): Promise<VersusSessionResponse> => {
  const match = await mutateMatch(matchId, (record, now) => {
    assertPlayable(record, userId, now);
    const withSession = ensureSession(record, userId, now);
    const session = sessionForUser(withSession, userId);
    if (!session) {
      throw new VersusStorageError('Could not start this attempt.', 409);
    }
    return setSessionForUser(
      withSession,
      userId,
      setClueModeInSession(session, clueMode)
    );
  });

  return sessionResponse(match, userId);
};

export const createRematchRequest = async (
  sourceMatchId: string,
  user: VersusUser,
  pattern: Coord[]
): Promise<VersusRematchResponse> => {
  const validation = validateVersusPattern(pattern);
  if (!validation.valid) {
    throw new VersusStorageError(validation.message, 400);
  }

  const source = await loadMatch(sourceMatchId);
  if (!source) {
    throw new VersusStorageError('Match not found.', 404);
  }
  assertParticipant(source, user.userId);
  const settled = await settleSaveAndFinalizeMatch(source, Date.now());
  if (settled.status === 'active') {
    throw new VersusStorageError('Finish this match before sending another invitation.', 409);
  }

  const rematchKey = versusStorageKeys.rematch(sourceMatchId);
  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await redis.watch(rematchKey);
    const now = Date.now();
    const loaded = await normalizeRematch(
      parseRematch(await redis.get(rematchKey)),
      now,
      rematchKey
    );
    const decision = rematchCreationDecision(
      loaded
        ? { status: loaded.status, requesterUserId: loaded.requester.userId }
        : null,
      user.userId
    );
    if (decision === 'idempotent') {
      await transaction.unwatch();
      if (!loaded) {
        continue;
      }
      return {
        type: 'versus-rematch',
        rematch: summarizeRematch(loaded, user.userId),
        ...(loaded.createdMatchId
          ? { matchedMatchId: loaded.createdMatchId }
          : {}),
      };
    }
    if (decision === 'join' && loaded) {
      const match = createMatchRecord(
        { ...loaded.requester, pattern: loaded.requesterPattern },
        { ...loaded.responder, pattern },
        'rematch',
        now
      );
      const joined: RematchRecord = {
        ...loaded,
        status: 'matched',
        createdMatchId: match.matchId,
      };
      try {
        await transaction.multi();
        await transaction.set(rematchKey, JSON.stringify(joined));
        await transaction.expire(rematchKey, ARCHIVE_SECONDS);
        await addMatchToTransaction(transaction, match, now);
        const result: unknown = await transaction.exec();
        if (result === null) {
          continue;
        }
        return {
          type: 'versus-rematch',
          rematch: summarizeRematch(joined, user.userId),
          matchedMatchId: match.matchId,
        };
      } catch {
        continue;
      }
    }
    const next = createRematchRecord(settled, user, pattern, now);

    try {
      await transaction.multi();
      await transaction.set(rematchKey, JSON.stringify(next));
      await transaction.expire(rematchKey, ARCHIVE_SECONDS);
      const result: unknown = await transaction.exec();
      if (result === null) {
        continue;
      }
      return {
        type: 'versus-rematch',
        rematch: summarizeRematch(next, user.userId),
      };
    } catch {
      continue;
    }
  }

  throw new VersusStorageError('Could not send the invitation. Try again.', 409);
};

export const acceptRematchRequest = async (
  sourceMatchId: string,
  requestId: string,
  userId: string
): Promise<VersusRematchResponse> => {
  return mutateRematch(sourceMatchId, requestId, userId, 'accept');
};

export const declineRematchRequest = async (
  sourceMatchId: string,
  requestId: string,
  userId: string
): Promise<VersusRematchResponse> => {
  return mutateRematch(sourceMatchId, requestId, userId, 'decline');
};

export const cancelRematchRequest = async (
  sourceMatchId: string,
  requestId: string,
  userId: string
): Promise<VersusRematchResponse> => {
  return mutateRematch(sourceMatchId, requestId, userId, 'cancel');
};

export const submitRematchResponsePattern = async (
  sourceMatchId: string,
  requestId: string,
  user: VersusUser,
  pattern: Coord[]
): Promise<VersusRematchResponse> => {
  const validation = validateVersusPattern(pattern);
  if (!validation.valid) {
    throw new VersusStorageError(validation.message, 400);
  }
  const key = versusStorageKeys.rematch(sourceMatchId);
  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await redis.watch(key);
    const rematch = parseRematch(await redis.get(key));
    if (!rematch || rematch.requestId !== requestId) {
      await transaction.unwatch();
      throw new VersusStorageError('Invitation not found.', 404);
    }
    if (rematch.responder.userId !== user.userId) {
      await transaction.unwatch();
      throw new VersusStorageError('Only the invited opponent can answer.', 409);
    }
    const decision = responsePatternDecision(
      rematch.status,
      rematch.createdMatchId
    );
    if (decision === 'idempotent' && rematch.createdMatchId) {
      await transaction.unwatch();
      return {
        type: 'versus-rematch',
        rematch: summarizeRematch(rematch, user.userId),
        matchedMatchId: rematch.createdMatchId,
      };
    }
    if (decision === 'invalid') {
      await transaction.unwatch();
      throw new VersusStorageError('Accept this invitation before choosing a pattern.', 409);
    }
    const now = Date.now();
    const match = createMatchRecord(
      { ...rematch.requester, pattern: rematch.requesterPattern },
      { ...rematch.responder, pattern },
      'rematch',
      now
    );
    const next: RematchRecord = {
      ...rematch,
      status: 'matched',
      createdMatchId: match.matchId,
    };
    try {
      await transaction.multi();
      await transaction.set(key, JSON.stringify(next));
      await addMatchToTransaction(transaction, match, now);
      const result: unknown = await transaction.exec();
      if (result !== null) {
        return {
          type: 'versus-rematch',
          rematch: summarizeRematch(next, user.userId),
          matchedMatchId: match.matchId,
        };
      }
    } catch {
      continue;
    }
  }
  throw new VersusStorageError('Could not start the invited match. Try again.', 409);
};

export const createVersusInvite = async (
  user: VersusUser,
  pattern: Coord[],
  createShareUrl?: (inviteId: string) => Promise<string>
): Promise<VersusInviteResponse> => {
  const validation = validateVersusPattern(pattern);
  if (!validation.valid) {
    throw new VersusStorageError(validation.message, 400);
  }
  const now = Date.now();
  const inviteId = randomUUID();
  const shareUrl = createShareUrl ? await createShareUrl(inviteId) : null;
  const inviteCode = await createInviteCode(inviteId, now + VERSUS_MATCH_DURATION_MS);
  const invite: VersusInviteRecord = {
    inviteId,
    inviteCode,
    shareUrl,
    creator: user,
    pattern,
    status: 'open',
    createdAt: now,
    expiresAt: now + VERSUS_MATCH_DURATION_MS,
    acceptedBy: null,
    matchId: null,
  };
  await redis.set(
    versusStorageKeys.invite(invite.inviteId),
    JSON.stringify(invite),
    { expiration: new Date(invite.expiresAt + ARCHIVE_SECONDS * 1000) }
  );
  await redis.zAdd(versusStorageKeys.userInvites(user.userId), {
    member: invite.inviteId,
    score: now,
  });
  return {
    type: 'versus-invite',
    invite: summarizeInvite(invite, user.userId),
  };
};

export const loadVersusInvite = async (
  inviteId: string,
  userId: string
): Promise<VersusInviteResponse> => {
  const invite = await normalizeInvite(await loadInvite(inviteId), Date.now());
  if (!invite) {
    throw new VersusStorageError('Invitation not found.', 404);
  }
  const canOpenMatch =
    invite.creator.userId === userId || invite.acceptedBy?.userId === userId;
  return {
    type: 'versus-invite',
    invite: summarizeInvite(invite, userId),
    ...(invite.matchId && canOpenMatch ? { matchedMatchId: invite.matchId } : {}),
  };
};

export const loadVersusInviteByCode = async (
  inviteCode: string,
  userId: string
): Promise<VersusInviteResponse> => {
  const normalizedCode = normalizeInviteCode(inviteCode);
  const inviteId = await redis.get(versusStorageKeys.inviteCode(normalizedCode));
  if (!inviteId) {
    throw new VersusStorageError('Invitation code not found.', 404);
  }
  return loadVersusInvite(inviteId, userId);
};

export const acceptVersusInvite = async (
  inviteId: string,
  user: VersusUser
): Promise<VersusInviteResponse> => {
  const key = versusStorageKeys.invite(inviteId);
  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await redis.watch(key);
    const invite = await normalizeInvite(parseInvite(await redis.get(key)), Date.now());
    if (!invite) {
      await transaction.unwatch();
      throw new VersusStorageError('Invitation not found.', 404);
    }
    if (invite.creator.userId === user.userId) {
      await transaction.unwatch();
      throw new VersusStorageError('You cannot accept your own invitation.', 409);
    }
    const decision = inviteAcceptanceDecision(
      invite.status,
      invite.acceptedBy?.userId ?? null,
      user.userId
    );
    if (decision === 'idempotent') {
      await transaction.unwatch();
      return { type: 'versus-invite', invite: summarizeInvite(invite, user.userId) };
    }
    if (decision === 'unavailable') {
      await transaction.unwatch();
      throw new VersusStorageError('This invitation is no longer available.', 409);
    }

    const accepted: VersusInviteRecord = {
      ...invite,
      status: 'accepted-awaiting-pattern',
      acceptedBy: user,
    };

    try {
      await transaction.multi();
      await transaction.set(key, JSON.stringify(accepted));
      await transaction.zAdd(versusStorageKeys.userInvites(user.userId), {
        member: invite.inviteId,
        score: Date.now(),
      });
      const result: unknown = await transaction.exec();
      if (result !== null) {
        return {
          type: 'versus-invite',
          invite: summarizeInvite(accepted, user.userId),
        };
      }
    } catch {
      continue;
    }
  }
  throw new VersusStorageError('Could not accept this invitation.', 409);
};

export const submitVersusInvitePattern = async (
  inviteId: string,
  user: VersusUser,
  pattern: Coord[]
): Promise<VersusInviteResponse> => {
  const validation = validateVersusPattern(pattern);
  if (!validation.valid) {
    throw new VersusStorageError(validation.message, 400);
  }
  const key = versusStorageKeys.invite(inviteId);
  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await redis.watch(key);
    const invite = parseInvite(await redis.get(key));
    if (!invite || invite.acceptedBy?.userId !== user.userId) {
      await transaction.unwatch();
      throw new VersusStorageError('Accepted invitation not found.', 404);
    }
    const decision = responsePatternDecision(invite.status, invite.matchId);
    if (decision === 'idempotent' && invite.matchId) {
      await transaction.unwatch();
      return {
        type: 'versus-invite',
        invite: summarizeInvite(invite, user.userId),
        matchedMatchId: invite.matchId,
      };
    }
    if (decision === 'invalid') {
      await transaction.unwatch();
      throw new VersusStorageError('Accept this invitation before choosing a pattern.', 409);
    }
    const now = Date.now();
    const match = createMatchRecord(
      { ...invite.creator, pattern: invite.pattern },
      { ...user, pattern },
      'invite',
      now
    );
    const matched: VersusInviteRecord = {
      ...invite,
      status: 'matched',
      matchId: match.matchId,
    };
    try {
      await transaction.multi();
      await transaction.set(key, JSON.stringify(matched));
      await addMatchToTransaction(transaction, match, now);
      const result: unknown = await transaction.exec();
      if (result !== null) {
        return {
          type: 'versus-invite',
          invite: summarizeInvite(matched, user.userId),
          matchedMatchId: match.matchId,
        };
      }
    } catch {
      continue;
    }
  }
  throw new VersusStorageError('Could not start this invitation match.', 409);
};

export const releaseVersusInvite = async (
  inviteId: string,
  userId: string
): Promise<VersusInviteResponse> => {
  const key = versusStorageKeys.invite(inviteId);
  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await redis.watch(key);
    const invite = parseInvite(await redis.get(key));
    if (
      !invite ||
      invite.status !== 'accepted-awaiting-pattern' ||
      invite.acceptedBy?.userId !== userId
    ) {
      await transaction.unwatch();
      throw new VersusStorageError('Accepted invitation not found.', 404);
    }
    const reopened: VersusInviteRecord = {
      ...invite,
      status: 'open',
      acceptedBy: null,
    };
    try {
      await transaction.multi();
      await transaction.set(key, JSON.stringify(reopened));
      await transaction.zRem(versusStorageKeys.userInvites(userId), [inviteId]);
      const result: unknown = await transaction.exec();
      if (result !== null) {
        return { type: 'versus-invite', invite: summarizeInvite(reopened, userId) };
      }
    } catch {
      continue;
    }
  }
  throw new VersusStorageError('Could not release this invitation.', 409);
};

export const cancelVersusInvite = async (
  inviteId: string,
  userId: string
): Promise<VersusInviteResponse> => {
  const key = versusStorageKeys.invite(inviteId);
  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await redis.watch(key);
    const invite = parseInvite(await redis.get(key));
    if (!invite || invite.creator.userId !== userId) {
      await transaction.unwatch();
      throw new VersusStorageError('Invitation not found.', 404);
    }
    if (invite.status !== 'open') {
      await transaction.unwatch();
      throw new VersusStorageError('This invitation cannot be cancelled.', 409);
    }
    const cancelled: VersusInviteRecord = { ...invite, status: 'cancelled' };
    try {
      await transaction.multi();
      await transaction.set(key, JSON.stringify(cancelled));
      const result: unknown = await transaction.exec();
      if (result !== null) {
        return {
          type: 'versus-invite',
          invite: summarizeInvite(cancelled, userId),
        };
      }
    } catch {
      continue;
    }
  }
  throw new VersusStorageError('Could not cancel this invitation.', 409);
};

export class VersusStorageError extends Error {
  readonly status: 400 | 404 | 409 | 410;

  constructor(message: string, status: 400 | 404 | 409 | 410) {
    super(message);
    this.status = status;
  }
}

const sessionResponse = async (
  match: VersusMatchRecord,
  userId: string
): Promise<VersusSessionResponse> => {
  const session = sessionForUser(match, userId);
  if (!session) {
    throw new VersusStorageError('Session not found.', 404);
  }
  const now = Date.now();
  return {
    type: 'versus-session',
    serverNow: now,
    session,
    match: await summarizeMatch(match, userId),
  };
};

const mutateMatch = async (
  matchId: string,
  mutate: (match: VersusMatchRecord, now: number) => VersusMatchRecord
): Promise<VersusMatchRecord> => {
  const key = versusStorageKeys.match(matchId);
  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await redis.watch(key);
    const match = parseMatch(await redis.get(key));
    if (!match) {
      await transaction.unwatch();
      throw new VersusStorageError('Match not found.', 404);
    }

    const next = mutate(match, Date.now());
    try {
      await transaction.multi();
      await transaction.set(key, JSON.stringify(next));
      await transaction.expire(key, ARCHIVE_SECONDS);
      const result: unknown = await transaction.exec();
      if (result === null) {
        continue;
      }
      return next;
    } catch {
      continue;
    }
  }

  throw new VersusStorageError('Match changed. Try again.', 409);
};

const addMatchToTransaction = async (
  transaction: Awaited<ReturnType<typeof redis.watch>>,
  match: VersusMatchRecord,
  now: number
): Promise<void> => {
  await transaction.set(
    versusStorageKeys.match(match.matchId),
    JSON.stringify(match)
  );
  await transaction.expire(versusStorageKeys.match(match.matchId), ARCHIVE_SECONDS);
  for (const participant of [match.participantA, match.participantB]) {
    await transaction.zAdd(versusStorageKeys.userMatches(participant.userId), {
      member: match.matchId,
      score: now,
    });
    await transaction.zRemRangeByRank(
      versusStorageKeys.userMatches(participant.userId),
      0,
      -(HISTORY_LIMIT + 1)
    );
  }
};

const mutateRematch = async (
  sourceMatchId: string,
  requestId: string,
  userId: string,
  action: 'accept' | 'decline' | 'cancel'
): Promise<VersusRematchResponse> => {
  const key = versusStorageKeys.rematch(sourceMatchId);
  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const transaction = await redis.watch(key);
    const rematch = parseRematch(await redis.get(key));
    if (!rematch || rematch.requestId !== requestId) {
      await transaction.unwatch();
      throw new VersusStorageError('Invitation not found.', 404);
    }
    const isRequester = rematch.requester.userId === userId;
    const isResponder = rematch.responder.userId === userId;
    if (
      (action === 'cancel' && !isRequester) ||
      (action !== 'cancel' && !isResponder)
    ) {
      await transaction.unwatch();
      throw new VersusStorageError('You cannot update this invitation.', 409);
    }
    const nextStatus =
      action === 'accept'
        ? 'accepted-awaiting-pattern'
        : action === 'decline'
          ? 'declined'
          : 'cancelled';
    if (rematch.status === nextStatus) {
      await transaction.unwatch();
      return {
        type: 'versus-rematch',
        rematch: summarizeRematch(rematch, userId),
      };
    }
    if (
      (action === 'accept' && rematch.status !== 'pending') ||
      (action === 'cancel' && rematch.status !== 'pending') ||
      (action === 'decline' &&
        rematch.status !== 'pending' &&
        rematch.status !== 'accepted-awaiting-pattern')
    ) {
      await transaction.unwatch();
      throw new VersusStorageError('This invitation is no longer available.', 409);
    }
    const next: RematchRecord = { ...rematch, status: nextStatus };
    try {
      await transaction.multi();
      await transaction.set(key, JSON.stringify(next));
      const result: unknown = await transaction.exec();
      if (result !== null) {
        return {
          type: 'versus-rematch',
          rematch: summarizeRematch(next, userId),
        };
      }
    } catch {
      continue;
    }
  }
  throw new VersusStorageError('Could not update the invitation.', 409);
};

const summarizeMatch = async (
  match: VersusMatchRecord,
  userId: string
): Promise<VersusMatchSummary> => {
  assertParticipant(match, userId);
  const mineIsA = match.participantA.userId === userId;
  const mySession = mineIsA ? match.sessionA : match.sessionB;
  const opponentSession = mineIsA ? match.sessionB : match.sessionA;
  const opponent = mineIsA ? match.participantB : match.participantA;
  const rivalry = await loadRivalrySummary(userId, opponent.userId);
  const outcome = outcomeForUser(match, userId);

  return {
    matchId: match.matchId,
    source: match.source,
    opponentDisplayName: opponent.displayName,
    status: match.status,
    outcome,
    createdAt: match.createdAt,
    expiresAt: match.expiresAt,
    myAttemptStatus: attemptStatus(mySession),
    opponentAttemptStatus: attemptStatus(opponentSession),
    myScore: versusScoreForSessionNullable(mySession),
    opponentScore: versusScoreForSessionNullable(opponentSession),
    myReplay: replayForSession(mySession),
    opponentReplay: replayForSession(opponentSession),
    rivalry,
    xpEarned:
      match.progressEligible && outcome !== 'pending'
        ? versusXpForResult(outcome, mySession?.solved === true)
        : 0,
  };
};

const summarizeRound = (round: VersusRoundRecord): VersusRoundSummary => ({
  roundId: round.roundId,
  status: round.status,
  createdAt: round.createdAt,
  matchingClosesAt: round.matchingClosesAt,
  matchCount: round.matchIds.length,
  maxMatches: VERSUS_MAX_OPPONENTS,
});

const createMatchRecord = (
  participantA: VersusParticipant,
  participantB: VersusParticipant,
  source: 'public' | 'rematch' | 'invite',
  now: number
): VersusMatchRecord => ({
  matchId: randomUUID(),
  source,
  createdAt: now,
  expiresAt: now + VERSUS_MATCH_DURATION_MS,
  status: 'active',
  participantA,
  participantB,
  sessionA: null,
  sessionB: null,
  winnerUserId: null,
  noContest: false,
  progressEligible: true,
  progressFinalized: false,
});

const createRematchRecord = (
  match: VersusMatchRecord,
  requester: VersusUser,
  requesterPattern: Coord[],
  now: number
): RematchRecord => {
  const opponent = opponentForUser(match, requester.userId);
  return {
    requestId: randomUUID(),
    sourceMatchId: match.matchId,
    requester,
    responder: {
      userId: opponent.userId,
      displayName: opponent.displayName,
    },
    requesterPattern,
    status: 'pending',
    createdAt: now,
    expiresAt: now + VERSUS_MATCH_DURATION_MS,
    createdMatchId: null,
  };
};

const ensureSession = (
  match: VersusMatchRecord,
  userId: string,
  now: number
): VersusMatchRecord => {
  if (sessionForUser(match, userId)) {
    return match;
  }

  const puzzleId: PuzzleId = {
    mode: 'versus',
    date: 'versus',
    seed: match.matchId,
    puzzleNumber: 0,
  };
  const session = createInitialSession(
    puzzleId,
    opponentForUser(match, userId).pattern.length,
    now
  );
  return setSessionForUser(match, userId, session);
};

const settleMatch = (
  match: VersusMatchRecord,
  now: number
): VersusMatchRecord => {
  if (match.status !== 'active') {
    return match;
  }

  const scoreA = versusScoreForSessionNullable(match.sessionA);
  const scoreB = versusScoreForSessionNullable(match.sessionB);
  const resolution = resolveVersusScores(scoreA, scoreB, now >= match.expiresAt);
  if (resolution.status === 'active') {
    return match;
  }

  return {
    ...match,
    status: resolution.status,
    winnerUserId:
      resolution.winner === 'first'
        ? match.participantA.userId
        : resolution.winner === 'second'
          ? match.participantB.userId
          : null,
    noContest: resolution.noContest,
  };
};

const settleSaveAndFinalizeMatch = async (
  match: VersusMatchRecord,
  now: number
): Promise<VersusMatchRecord> => {
  const settled = settleMatch(match, now);
  if (settled !== match) {
    await redis.set(
      versusStorageKeys.match(match.matchId),
      JSON.stringify(settled)
    );
  }
  return finalizeMatchProgress(settled);
};

const finalizeMatchProgress = async (
  match: VersusMatchRecord
): Promise<VersusMatchRecord> => {
  if (match.status === 'active') {
    return match;
  }
  if (match.progressFinalized) {
    await ensureRivalryRecorded(match);
    return match;
  }

  if (!match.progressEligible) {
    const legacyFinalized = { ...match, progressFinalized: true };
    await redis.set(
      versusStorageKeys.match(match.matchId),
      JSON.stringify(legacyFinalized)
    );
    return legacyFinalized;
  }

  const outcomeA = settledOutcomeForUser(match, match.participantA.userId);
  const outcomeB = settledOutcomeForUser(match, match.participantB.userId);
  await Promise.all([
    awardVersusProgress(
      match.participantA.userId,
      match.matchId,
      outcomeA,
      match.sessionA?.solved === true,
      match.participantB.displayName
    ),
    awardVersusProgress(
      match.participantB.userId,
      match.matchId,
      outcomeB,
      match.sessionB?.solved === true,
      match.participantA.displayName
    ),
  ]);
  await ensureRivalryRecorded(match);

  const finalized = { ...match, progressFinalized: true };
  await redis.set(
    versusStorageKeys.match(match.matchId),
    JSON.stringify(finalized)
  );
  return finalized;
};

const ensureRivalryRecorded = async (
  match: VersusMatchRecord
): Promise<void> => {
  if (match.status === 'active' || !match.progressEligible) {
    return;
  }
  const completedAt = Math.max(
    match.sessionA?.solvedAt ?? 0,
    match.sessionB?.solvedAt ?? 0,
    match.status === 'expired' ? match.expiresAt : match.createdAt
  );
  await recordRivalryResult({
    matchId: match.matchId,
    firstUserId: match.participantA.userId,
    firstDisplayName: match.participantA.displayName,
    firstScore: versusScoreForSessionNullable(match.sessionA),
    secondUserId: match.participantB.userId,
    secondDisplayName: match.participantB.displayName,
    secondScore: versusScoreForSessionNullable(match.sessionB),
    firstOutcome: settledOutcomeForUser(match, match.participantA.userId),
    completedAt,
  });
};

const normalizeRound = async (
  round: VersusRoundRecord,
  now: number
): Promise<VersusRoundRecord> => {
  const shouldClose =
    round.matchIds.length >= VERSUS_MAX_OPPONENTS ||
    now >= round.matchingClosesAt;
  if (round.status !== 'matching' || !shouldClose) {
    return round;
  }

  const next: VersusRoundRecord = {
    ...round,
    status: round.matchIds.length === 0 ? 'complete' : 'closed',
  };
  await redis.set(versusStorageKeys.round(round.roundId), JSON.stringify(next));
  await redis.zRem(versusStorageKeys.queue, [round.roundId]);
  if (next.status === 'complete') {
    await redis.del(versusStorageKeys.activeRound(round.userId));
  }
  return next;
};

const completeRoundIfReady = async (
  round: VersusRoundRecord | null,
  matches: VersusMatchRecord[],
  now: number
): Promise<void> => {
  if (!round || round.status === 'matching' || round.status === 'complete') {
    return;
  }

  const records = matches.filter((match) => round.matchIds.includes(match.matchId));
  if (
    records.length === round.matchIds.length &&
    records.every((match) => settleMatch(match, now).status !== 'active')
  ) {
    const next = { ...round, status: 'complete' as const };
    await redis.set(versusStorageKeys.round(round.roundId), JSON.stringify(next));
    await redis.del(versusStorageKeys.activeRound(round.userId));
  }
};

const addMatchToRound = (
  round: VersusRoundRecord,
  matchId: string,
  opponentId: string
): VersusRoundRecord => {
  const matchIds = [...round.matchIds, matchId];
  return {
    ...round,
    matchIds,
    opponentIds: [...round.opponentIds, opponentId],
    status: matchIds.length >= VERSUS_MAX_OPPONENTS ? 'closed' : 'matching',
  };
};

const updateQueueInTransaction = async (
  transaction: Awaited<ReturnType<typeof redis.watch>>,
  round: VersusRoundRecord
): Promise<void> => {
  if (round.status === 'matching') {
    await transaction.zAdd(versusStorageKeys.queue, {
      member: round.roundId,
      score: queueScore(round),
    });
  } else {
    await transaction.zRem(versusStorageKeys.queue, [round.roundId]);
  }
};

const queueScore = (round: VersusRoundRecord): number => {
  return round.matchIds.length * MATCHMAKING_SCORE_BUCKET + round.createdAt;
};

const assertPlayable = (
  match: VersusMatchRecord,
  userId: string,
  now: number
): void => {
  assertParticipant(match, userId);
  const settled = settleMatch(match, now);
  if (settled.status !== 'active') {
    throw new VersusStorageError('This match is no longer active.', 410);
  }
};

const assertParticipant = (match: VersusMatchRecord, userId: string): void => {
  if (
    match.participantA.userId !== userId &&
    match.participantB.userId !== userId
  ) {
    throw new VersusStorageError('You are not part of this match.', 404);
  }
};

const sessionForUser = (
  match: VersusMatchRecord,
  userId: string
): PlayerSession | null => {
  return match.participantA.userId === userId ? match.sessionA : match.sessionB;
};

const setSessionForUser = (
  match: VersusMatchRecord,
  userId: string,
  session: PlayerSession
): VersusMatchRecord => {
  return match.participantA.userId === userId
    ? { ...match, sessionA: session }
    : { ...match, sessionB: session };
};

const opponentForUser = (
  match: VersusMatchRecord,
  userId: string
): VersusParticipant => {
  return match.participantA.userId === userId
    ? match.participantB
    : match.participantA;
};

const attemptStatus = (session: PlayerSession | null): VersusAttemptStatus => {
  if (!session) {
    return 'not-started';
  }
  return session.solved ? 'solved' : 'playing';
};

const outcomeForUser = (
  match: VersusMatchRecord,
  userId: string
): VersusOutcome => {
  if (match.status === 'active') {
    return 'pending';
  }
  if (match.noContest) {
    return 'no-contest';
  }
  if (match.winnerUserId === null) {
    return 'draw';
  }
  return match.winnerUserId === userId ? 'win' : 'loss';
};

const settledOutcomeForUser = (
  match: VersusMatchRecord,
  userId: string
): 'win' | 'loss' | 'draw' | 'no-contest' => {
  const outcome = outcomeForUser(match, userId);
  return outcome === 'pending' ? 'no-contest' : outcome;
};

const versusScoreForSessionNullable = (session: PlayerSession | null) => {
  return session ? versusScoreForSession(session) : null;
};

const loadActiveRound = async (
  userId: string
): Promise<VersusRoundRecord | null> => {
  const roundId = await redis.get(versusStorageKeys.activeRound(userId));
  return roundId ? loadRound(roundId) : null;
};

const loadRound = async (roundId: string): Promise<VersusRoundRecord | null> => {
  return parseRound(await redis.get(versusStorageKeys.round(roundId)));
};

const loadMatch = async (matchId: string): Promise<VersusMatchRecord | null> => {
  return parseMatch(await redis.get(versusStorageKeys.match(matchId)));
};

const loadUserMatchRecords = async (
  userId: string
): Promise<VersusMatchRecord[]> => {
  const members = await redis.zRange(
    versusStorageKeys.userMatches(userId),
    0,
    HISTORY_LIMIT - 1,
    { by: 'rank', reverse: true }
  );
  const records: VersusMatchRecord[] = [];
  for (const member of members) {
    const match = await loadMatch(member.member);
    if (match) {
      records.push(match);
    } else {
      await redis.zRem(versusStorageKeys.userMatches(userId), [member.member]);
    }
  }
  return records;
};

const loadPendingItems = async (
  userId: string,
  matches: VersusMatchRecord[],
  now: number
): Promise<VersusPendingItem[]> => {
  const items: VersusPendingItem[] = [];
  for (const match of matches) {
    const key = versusStorageKeys.rematch(match.matchId);
    const rematch = await normalizeRematch(
      parseRematch(await redis.get(key)),
      now,
      key,
      match
    );
    if (
      rematch &&
      (rematch.status === 'pending' ||
        rematch.status === 'accepted-awaiting-pattern')
    ) {
      items.push({ kind: 'rematch', rematch: summarizeRematch(rematch, userId) });
    }
  }
  const members = await redis.zRange(
    versusStorageKeys.userInvites(userId),
    0,
    9,
    { by: 'rank', reverse: true }
  );
  for (const member of members) {
    const invite = await normalizeInvite(await loadInvite(member.member), now);
    if (!invite) {
      await redis.zRem(versusStorageKeys.userInvites(userId), [member.member]);
    } else if (
      (invite.status === 'open' && invite.creator.userId === userId) ||
      (invite.status === 'accepted-awaiting-pattern' &&
        (invite.creator.userId === userId || invite.acceptedBy?.userId === userId))
    ) {
      items.push({ kind: 'invite', invite: summarizeInvite(invite, userId) });
    }
  }
  return items;
};

const loadInvite = async (
  inviteId: string
): Promise<VersusInviteRecord | null> => {
  return parseInvite(await redis.get(versusStorageKeys.invite(inviteId)));
};

const normalizeRematch = async (
  rematch: RematchRecord | null,
  now: number,
  key: string,
  sourceMatch?: VersusMatchRecord
): Promise<RematchRecord | null> => {
  if (!rematch) {
    return null;
  }
  let normalized = rematch;
  if (normalized.legacyUpgraded) {
    const { legacyUpgraded: _legacyUpgraded, ...upgraded } = normalized;
    normalized = upgraded;
    await redis.set(key, JSON.stringify(normalized));
  }
  if (
    (normalized.status === 'pending' ||
      normalized.status === 'accepted-awaiting-pattern') &&
    now >= normalized.expiresAt
  ) {
    normalized = { ...normalized, status: 'expired' };
    await redis.set(key, JSON.stringify(normalized));
  }
  if (sourceMatch) {
    assertParticipant(sourceMatch, normalized.requester.userId);
    assertParticipant(sourceMatch, normalized.responder.userId);
  }
  return normalized;
};

const summarizeRematch = (
  rematch: RematchRecord,
  userId: string
): VersusRematchSummary => ({
  requestId: rematch.requestId,
  sourceMatchId: rematch.sourceMatchId,
  opponentDisplayName:
    rematch.requester.userId === userId
      ? rematch.responder.displayName
      : rematch.requester.displayName,
  status:
    rematch.status === 'accepted-awaiting-pattern'
      ? 'accepted-awaiting-pattern'
      : 'pending',
  role: rematch.requester.userId === userId ? 'requester' : 'responder',
  createdAt: rematch.createdAt,
  expiresAt: rematch.expiresAt,
});

const normalizeInviteCode = (inviteCode: string): string =>
  inviteCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

const createInviteCode = async (
  inviteId: string,
  expiresAt: number
): Promise<string> => {
  for (let attempt = 0; attempt < TRANSACTION_RETRIES; attempt += 1) {
    const code = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const claimed = await redis.set(versusStorageKeys.inviteCode(code), inviteId, {
      nx: true,
      expiration: new Date(expiresAt + ARCHIVE_SECONDS * 1000),
    });
    if (claimed) {
      return code;
    }
  }
  throw new VersusStorageError('Could not create an invitation code.', 409);
};

const normalizeInvite = async (
  invite: VersusInviteRecord | null,
  now: number
): Promise<VersusInviteRecord | null> => {
  if (!invite) {
    return invite;
  }
  let normalized = invite;
  if (!normalized.inviteCode) {
    const inviteCode = await createInviteCode(normalized.inviteId, normalized.expiresAt);
    normalized = { ...normalized, inviteCode };
    await redis.set(
      versusStorageKeys.invite(normalized.inviteId),
      JSON.stringify(normalized)
    );
  }
  if (
    (normalized.status !== 'open' &&
      normalized.status !== 'accepted-awaiting-pattern') ||
    now < normalized.expiresAt
  ) {
    return normalized;
  }
  const expired: VersusInviteRecord = { ...normalized, status: 'expired' };
  await redis.set(
    versusStorageKeys.invite(invite.inviteId),
    JSON.stringify(expired)
  );
  return expired;
};

const summarizeInvite = (
  invite: VersusInviteRecord,
  userId: string
): VersusInviteSummary => ({
  inviteId: invite.inviteId,
  inviteCode: invite.inviteCode,
  shareUrl: invite.shareUrl,
  creatorDisplayName: invite.creator.displayName,
  acceptedByDisplayName: invite.acceptedBy?.displayName ?? null,
  createdAt: invite.createdAt,
  status: invite.status,
  expiresAt: invite.expiresAt,
  role:
    invite.creator.userId === userId
      ? 'creator'
      : invite.acceptedBy?.userId === userId
        ? 'acceptor'
        : 'viewer',
  matchId: invite.matchId,
});

const parseRound = (value: string | undefined): VersusRoundRecord | null => {
  const parsed = parseJsonRecord(value);
  if (
    !parsed ||
    typeof parsed.roundId !== 'string' ||
    typeof parsed.userId !== 'string' ||
    typeof parsed.displayName !== 'string' ||
    !Array.isArray(parsed.pattern) ||
    !Array.isArray(parsed.matchIds) ||
    !Array.isArray(parsed.opponentIds) ||
    typeof parsed.status !== 'string' ||
    typeof parsed.createdAt !== 'number' ||
    typeof parsed.matchingClosesAt !== 'number'
  ) {
    return null;
  }
  return parsed as VersusRoundRecord;
};

const parseMatch = (value: string | undefined): VersusMatchRecord | null => {
  const parsed = parseJsonRecord(value);
  if (
    !parsed ||
    typeof parsed.matchId !== 'string' ||
    typeof parsed.createdAt !== 'number' ||
    typeof parsed.expiresAt !== 'number' ||
    !isParticipant(parsed.participantA) ||
    !isParticipant(parsed.participantB)
  ) {
    return null;
  }
  const match = parsed as VersusMatchRecord;
  return {
    ...match,
    progressEligible:
      typeof parsed.progressEligible === 'boolean'
        ? parsed.progressEligible
        : match.status === 'active',
    progressFinalized:
      typeof parsed.progressFinalized === 'boolean'
        ? parsed.progressFinalized
        : match.status !== 'active',
  };
};

const parseRematch = (value: string | undefined): RematchRecord | null => {
  const parsed = parseJsonRecord(value);
  if (
    !parsed ||
    typeof parsed.sourceMatchId !== 'string' ||
    typeof parsed.createdAt !== 'number' ||
    typeof parsed.expiresAt !== 'number'
  ) {
    return null;
  }
  if (
    typeof parsed.requestId === 'string' &&
    isUser(parsed.requester) &&
    isUser(parsed.responder) &&
    Array.isArray(parsed.requesterPattern) &&
    typeof parsed.status === 'string'
  ) {
    return parsed as RematchRecord;
  }
  if (
    isUser(parsed.userA) &&
    isUser(parsed.userB) &&
    'patternA' in parsed &&
    'patternB' in parsed
  ) {
    const patternA = Array.isArray(parsed.patternA) ? parsed.patternA : null;
    const patternB = Array.isArray(parsed.patternB) ? parsed.patternB : null;
    if ((patternA === null) === (patternB === null)) {
      return null;
    }
    return {
      requestId: randomUUID(),
      sourceMatchId: parsed.sourceMatchId,
      requester: patternA ? parsed.userA : parsed.userB,
      responder: patternA ? parsed.userB : parsed.userA,
      requesterPattern: (patternA ?? patternB) as Coord[],
      status: 'pending',
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
      createdMatchId: null,
      legacyUpgraded: true,
    };
  }
  return null;
};

const parseInvite = (value: string | undefined): VersusInviteRecord | null => {
  const parsed = parseJsonRecord(value);
  if (
    !parsed ||
    typeof parsed.inviteId !== 'string' ||
    !isUser(parsed.creator) ||
    !Array.isArray(parsed.pattern) ||
    typeof parsed.status !== 'string' ||
    typeof parsed.createdAt !== 'number' ||
    typeof parsed.expiresAt !== 'number'
  ) {
    return null;
  }
  const invite = parsed as VersusInviteRecord;
  return {
    ...invite,
    inviteCode: typeof parsed.inviteCode === 'string' ? parsed.inviteCode : '',
    shareUrl: typeof parsed.shareUrl === 'string' ? parsed.shareUrl : null,
    status:
      parsed.status === 'accepted' && parsed.matchId
        ? 'matched'
        : invite.status,
  };
};

const parseJsonRecord = (
  value: string | undefined
): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const isParticipant = (value: unknown): value is VersusParticipant => {
  return (
    isRecord(value) &&
    typeof value.userId === 'string' &&
    typeof value.displayName === 'string' &&
    Array.isArray(value.pattern)
  );
};

const isUser = (value: unknown): value is VersusUser => {
  return (
    isRecord(value) &&
    typeof value.userId === 'string' &&
    typeof value.displayName === 'string'
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
