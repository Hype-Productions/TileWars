import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  DailyCommentResultResponse,
  DailyGuessRequest,
  DailyLeaderboardResponse,
  DailyMarkRequest,
  DailyModeRequest,
  DailyResponse,
  DailySessionResponse,
} from '../../shared/api';
import {
  applyGuessToSession,
  createDailyPuzzleId,
  createInitialSession,
  createShareText,
  dailyPatternForPuzzle,
  setClueModeInSession,
  toggleMarkerInSession,
} from '../../shared/game';
import { todayUtcDate } from '../../shared/pattern';
import {
  clearDailyPlayerData,
  loadDailyLeaderboard,
  loadDailySession,
  saveBestDailyResult,
  saveDailySession,
} from '../core/dailyStorage';
import {
  awardDailyProgress,
  loadProgressSummary,
} from '../core/progressStorage';
import { ensureDailyResultsThread } from '../core/post';
import { versusApi } from './versus';
import { progressApi } from './progress';

export const api = new Hono();

api.route('/versus', versusApi);
api.route('/progress', progressApi);

api.get('/daily', (c) => {
  return c.json<DailyResponse>({
    type: 'daily',
    date: todayUtcDate(),
    seed: 'pattern',
  });
});

api.get('/daily/session', async (c) => {
  const user = currentUser();
  const puzzleId = createDailyPuzzleId(todayUtcDate());
  const existing = await loadDailySession(puzzleId.date, user.userId);
  const session =
    existing ??
    createInitialSession(puzzleId, dailyPatternForPuzzle(puzzleId).length);

  if (!existing) {
    await saveDailySession(session, user.userId);
  }

  const leaderboard = await loadDailyLeaderboard(puzzleId.date, user.userId);
  const progress = await loadProgressSummary(user.userId, puzzleId.date);

  return c.json<DailySessionResponse>({
    type: 'daily-session',
    session,
    leaderboard: leaderboard.leaderboard,
    playerRank: leaderboard.playerRank,
    lastPlayer: leaderboard.lastPlayer,
    progress,
  });
});

api.post('/daily/guess', async (c) => {
  const request = await c.req.json<DailyGuessRequest>();
  if (!isValidCoord(request.coord)) {
    return c.json({ status: 'error', message: 'Invalid coordinate.' }, 400);
  }

  const user = currentUser();
  const session = await getOrCreateTodaySession(user.userId);
  const pattern = dailyPatternForPuzzle(session.puzzleId);
  const nextSession = applyGuessToSession(session, pattern, request.coord);
  await saveDailySession(nextSession, user.userId);

  if (nextSession.solved && nextSession.solvedAt !== null) {
    await saveBestDailyResult({
      userId: user.userId,
      displayName: user.displayName,
      date: nextSession.puzzleId.date,
      puzzleNumber: nextSession.puzzleId.puzzleNumber,
      guesses: nextSession.guesses.length,
      solvedAt: nextSession.solvedAt,
      durationMs: Math.max(0, nextSession.solvedAt - nextSession.startedAt),
    });

    const leaderboard = await loadDailyLeaderboard(
      nextSession.puzzleId.date,
      user.userId
    );
    const progressAward = await awardDailyProgress(
      user.userId,
      nextSession.puzzleId.date
    );

    return c.json<DailySessionResponse>({
      type: 'daily-session',
      session: nextSession,
      leaderboard: leaderboard.leaderboard,
      playerRank: leaderboard.playerRank,
      lastPlayer: leaderboard.lastPlayer,
      progress: progressAward.progress,
      ...(progressAward.reward ? { reward: progressAward.reward } : {}),
    });
  }

  return c.json<DailySessionResponse>({
    type: 'daily-session',
    session: nextSession,
  });
});

api.post('/daily/mark', async (c) => {
  const request = await c.req.json<DailyMarkRequest>();
  if (!isValidCoord(request.coord)) {
    return c.json({ status: 'error', message: 'Invalid coordinate.' }, 400);
  }

  const user = currentUser();
  const session = await getOrCreateTodaySession(user.userId);
  const nextSession = toggleMarkerInSession(session, request.coord);
  await saveDailySession(nextSession, user.userId);

  const leaderboard = await loadDailyLeaderboard(
    nextSession.puzzleId.date,
    user.userId
  );
  const progress = await loadProgressSummary(
    user.userId,
    nextSession.puzzleId.date
  );

  return c.json<DailySessionResponse>({
    type: 'daily-session',
    session: nextSession,
    leaderboard: leaderboard.leaderboard,
    playerRank: leaderboard.playerRank,
    lastPlayer: leaderboard.lastPlayer,
    progress,
  });
});

api.post('/daily/mode', async (c) => {
  const request = await c.req.json<DailyModeRequest>();
  const clueMode = request.clueMode === 'proximity' ? 'proximity' : 'balanced';
  const user = currentUser();
  const session = await getOrCreateTodaySession(user.userId);
  const nextSession = setClueModeInSession(session, clueMode);
  await saveDailySession(nextSession, user.userId);

  const leaderboard = await loadDailyLeaderboard(
    nextSession.puzzleId.date,
    user.userId
  );
  const progress = await loadProgressSummary(
    user.userId,
    nextSession.puzzleId.date
  );

  return c.json<DailySessionResponse>({
    type: 'daily-session',
    session: nextSession,
    leaderboard: leaderboard.leaderboard,
    playerRank: leaderboard.playerRank,
    lastPlayer: leaderboard.lastPlayer,
    progress,
  });
});

api.get('/daily/leaderboard', async (c) => {
  const user = currentUser();
  const puzzleId = createDailyPuzzleId(todayUtcDate());
  const leaderboard = await loadDailyLeaderboard(puzzleId.date, user.userId);

  return c.json<DailyLeaderboardResponse>({
    type: 'daily-leaderboard',
    leaderboard: leaderboard.leaderboard,
    playerRank: leaderboard.playerRank,
    lastPlayer: leaderboard.lastPlayer,
  });
});

api.post('/daily/comment-result', async (c) => {
  const postId = context.postId;
  if (!postId) {
    return c.json(
      { status: 'error', message: 'No Reddit post is available here.' },
      400
    );
  }

  const user = currentUser();
  const session = await getOrCreateTodaySession(user.userId);
  if (!session.solved) {
    return c.json(
      { status: 'error', message: 'Solve the daily before commenting.' },
      400
    );
  }

  let dailyStreak: number | undefined;
  try {
    dailyStreak = (
      await loadProgressSummary(user.userId, session.puzzleId.date)
    ).dailyStreak;
  } catch (error) {
    console.warn('Could not load daily streak for result comment:', error);
  }

  try {
    const resultsThreadId = await ensureDailyResultsThread(postId);
    const comment = await reddit.submitComment({
      id: resultsThreadId,
      text: createShareText(session, dailyStreak),
      runAs: 'USER',
    });

    return c.json<DailyCommentResultResponse>({
      type: 'daily-comment-result',
      status: 'posted',
      commentId: comment.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not post result.';
    console.error('Daily result comment failed:', {
      message,
      postId,
      userId: user.userId,
    });
    return c.json({ status: 'error', message }, 500);
  }
});

api.post('/daily/dev-reset', async (c) => {
  const user = currentUser();
  const puzzleId = createDailyPuzzleId(todayUtcDate());
  await clearDailyPlayerData(puzzleId.date, user.userId);

  const session = createInitialSession(
    puzzleId,
    dailyPatternForPuzzle(puzzleId).length
  );
  await saveDailySession(session, user.userId);

  const leaderboard = await loadDailyLeaderboard(puzzleId.date, user.userId);
  const progress = await loadProgressSummary(user.userId, puzzleId.date);

  return c.json<DailySessionResponse>({
    type: 'daily-session',
    session,
    leaderboard: leaderboard.leaderboard,
    playerRank: leaderboard.playerRank,
    lastPlayer: leaderboard.lastPlayer,
    progress,
  });
});

const getOrCreateTodaySession = async (userId: string) => {
  const puzzleId = createDailyPuzzleId(todayUtcDate());
  const existing = await loadDailySession(puzzleId.date, userId);
  if (existing) {
    return existing;
  }

  const session = createInitialSession(
    puzzleId,
    dailyPatternForPuzzle(puzzleId).length
  );
  await saveDailySession(session, userId);
  return session;
};

const currentUser = (): { userId: string; displayName: string } => {
  const userId = context.userId ?? context.loid ?? 'local-preview';
  const displayName = context.username ?? 'anonymous';

  return {
    userId,
    displayName,
  };
};

const isValidCoord = (
  coord: unknown
): coord is { row: number; col: number } => {
  if (typeof coord !== 'object' || coord === null) {
    return false;
  }

  if (!('row' in coord) || !('col' in coord)) {
    return false;
  }

  const row = coord.row;
  const col = coord.col;

  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    typeof row === 'number' &&
    typeof col === 'number' &&
    row >= 0 &&
    row < 5 &&
    col >= 0 &&
    col < 5
  );
};
