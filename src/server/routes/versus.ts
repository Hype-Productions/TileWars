import { context, reddit } from '@devvit/web/server';
import { Hono, type Context } from 'hono';
import type {
  VersusGuessRequest,
  VersusMarkRequest,
  VersusModeRequest,
  VersusPatternRequest,
} from '../../shared/api';
import type { Coord } from '../../shared/pattern';
import { buildVersusInviteShareUrl } from '../../shared/versus';
import {
  closeVersusRound,
  acceptRematchRequest,
  acceptVersusInvite,
  cancelRematchRequest,
  cancelVersusInvite,
  createVersusInvite,
  createRematchRequest,
  declineRematchRequest,
  createVersusRound,
  guessVersusTile,
  loadVersusLobby,
  loadVersusResult,
  loadVersusInvite,
  loadVersusInviteByCode,
  markVersusTile,
  matchmakeVersusRound,
  openVersusSession,
  setVersusClueMode,
  releaseVersusInvite,
  submitRematchResponsePattern,
  submitVersusInvitePattern,
  VersusStorageError,
} from '../core/versusStorage';
import {
  loadRivalryHistory,
  loadRivalryOpponents,
} from '../core/progressStorage';

export const versusApi = new Hono();

versusApi.get('/lobby', async (c) => {
  return c.json(await loadVersusLobby(currentUser()));
});

versusApi.get('/opponents', async (c) => {
  return c.json(
    await loadRivalryOpponents(currentUser().userId, c.req.query('q') ?? '')
  );
});

versusApi.get('/opponents/:opponentUserId/history', async (c) => {
  try {
    return c.json(
      await loadRivalryHistory(
        currentUser().userId,
        c.req.param('opponentUserId')
      )
    );
  } catch {
    return c.json({ status: 'error', message: 'Rivalry history not found.' }, 404);
  }
});

versusApi.post('/round', async (c) => {
  try {
    const request: unknown = await c.req.json<VersusPatternRequest>();
    const pattern = patternFromRequest(request);
    const user = currentUser();
    const matchedMatchId = await createVersusRound(user, pattern);
    return c.json(await loadVersusLobby(user, matchedMatchId ?? undefined));
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/matchmake', async (c) => {
  try {
    const user = currentUser();
    const matchedMatchId = await matchmakeVersusRound(user.userId);
    return c.json(await loadVersusLobby(user, matchedMatchId ?? undefined));
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/round/close', async (c) => {
  try {
    const user = currentUser();
    await closeVersusRound(user.userId);
    return c.json(await loadVersusLobby(user));
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/invites', async (c) => {
  try {
    const request: unknown = await c.req.json<VersusPatternRequest>();
    const postId = context.postId;
    return c.json(
      await createVersusInvite(
        currentUser(),
        patternFromRequest(request),
        postId
          ? async (inviteId) => {
              const canonicalUrl = buildVersusInviteShareUrl(postId, inviteId);
              try {
                return await reddit.createShareUrl(canonicalUrl);
              } catch {
                return canonicalUrl;
              }
            }
          : undefined
      )
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.get('/invites/:inviteId', async (c) => {
  try {
    return c.json(
      await loadVersusInvite(
        c.req.param('inviteId'),
        currentUser().userId
      )
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.get('/invite-codes/:inviteCode', async (c) => {
  try {
    return c.json(
      await loadVersusInviteByCode(
        c.req.param('inviteCode'),
        currentUser().userId
      )
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/invites/:inviteId/accept', async (c) => {
  try {
    return c.json(
      await acceptVersusInvite(
        c.req.param('inviteId'),
        currentUser()
      )
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/invites/:inviteId/pattern', async (c) => {
  try {
    const request: unknown = await c.req.json<VersusPatternRequest>();
    return c.json(
      await submitVersusInvitePattern(
        c.req.param('inviteId'),
        currentUser(),
        patternFromRequest(request)
      )
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/invites/:inviteId/release', async (c) => {
  try {
    return c.json(
      await releaseVersusInvite(c.req.param('inviteId'), currentUser().userId)
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/invites/:inviteId/cancel', async (c) => {
  try {
    return c.json(
      await cancelVersusInvite(
        c.req.param('inviteId'),
        currentUser().userId
      )
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.get('/matches/:matchId/session', async (c) => {
  try {
    return c.json(
      await openVersusSession(c.req.param('matchId'), currentUser().userId)
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.get('/matches/:matchId/result', async (c) => {
  try {
    return c.json(
      await loadVersusResult(c.req.param('matchId'), currentUser().userId)
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/matches/:matchId/guess', async (c) => {
  try {
    const request: unknown = await c.req.json<VersusGuessRequest>();
    const coord = coordFromRequest(request);
    return c.json(
      await guessVersusTile(
        c.req.param('matchId'),
        currentUser().userId,
        coord
      )
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/matches/:matchId/mark', async (c) => {
  try {
    const request: unknown = await c.req.json<VersusMarkRequest>();
    const coord = coordFromRequest(request);
    return c.json(
      await markVersusTile(c.req.param('matchId'), currentUser().userId, coord)
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/matches/:matchId/mode', async (c) => {
  try {
    const request: unknown = await c.req.json<VersusModeRequest>();
    const clueMode =
      isRecord(request) && request.clueMode === 'proximity'
        ? 'proximity'
        : 'balanced';
    return c.json(
      await setVersusClueMode(
        c.req.param('matchId'),
        currentUser().userId,
        clueMode
      )
    );
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/matches/:matchId/rematches', async (c) => {
  try {
    const request: unknown = await c.req.json<VersusPatternRequest>();
    return c.json(await createRematchRequest(
      c.req.param('matchId'),
      currentUser(),
      patternFromRequest(request)
    ));
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/matches/:matchId/rematches/:requestId/accept', async (c) => {
  try {
    return c.json(await acceptRematchRequest(
      c.req.param('matchId'),
      c.req.param('requestId'),
      currentUser().userId
    ));
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/matches/:matchId/rematches/:requestId/pattern', async (c) => {
  try {
    const request: unknown = await c.req.json<VersusPatternRequest>();
    return c.json(await submitRematchResponsePattern(
      c.req.param('matchId'),
      c.req.param('requestId'),
      currentUser(),
      patternFromRequest(request)
    ));
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/matches/:matchId/rematches/:requestId/decline', async (c) => {
  try {
    return c.json(await declineRematchRequest(
      c.req.param('matchId'),
      c.req.param('requestId'),
      currentUser().userId
    ));
  } catch (error) {
    return versusError(c, error);
  }
});

versusApi.post('/matches/:matchId/rematches/:requestId/cancel', async (c) => {
  try {
    return c.json(await cancelRematchRequest(
      c.req.param('matchId'),
      c.req.param('requestId'),
      currentUser().userId
    ));
  } catch (error) {
    return versusError(c, error);
  }
});

const currentUser = (): { userId: string; displayName: string } => {
  return {
    userId: context.userId ?? context.loid ?? 'local-versus-preview',
    displayName: context.username ?? 'local-player',
  };
};

const patternFromRequest = (request: unknown): Coord[] => {
  if (!isRecord(request) || !Array.isArray(request.pattern)) {
    throw new VersusStorageError('A pattern is required.', 400);
  }

  const pattern: Coord[] = [];
  for (const value of request.pattern) {
    if (!isCoord(value)) {
      throw new VersusStorageError('Pattern contains an invalid tile.', 400);
    }
    pattern.push(value);
  }
  return pattern;
};

const coordFromRequest = (request: unknown): Coord => {
  if (!isRecord(request) || !isCoord(request.coord)) {
    throw new VersusStorageError('Invalid coordinate.', 400);
  }
  return request.coord;
};

const isCoord = (value: unknown): value is Coord => {
  return (
    isRecord(value) &&
    typeof value.row === 'number' &&
    typeof value.col === 'number' &&
    Number.isInteger(value.row) &&
    Number.isInteger(value.col) &&
    value.row >= 0 &&
    value.row < 5 &&
    value.col >= 0 &&
    value.col < 5
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const versusError = (
  c: Context,
  error: unknown
) => {
  if (error instanceof VersusStorageError) {
    return c.json({ status: 'error', message: error.message }, error.status);
  }
  console.error('Versus request failed:', error);
  return c.json(
    { status: 'error', message: 'Versus is temporarily unavailable.' },
    500
  );
};
