import type {
  ProgressResponse,
  RivalryHistoryResponse,
  RivalryOpponentsResponse,
  VersusInviteResponse,
  VersusLobbyResponse,
  VersusRematchResponse,
  VersusSessionResponse,
} from '../shared/api';

export class VersusClientError extends Error {}

export const getVersusLobby = async (): Promise<VersusLobbyResponse> => {
  return versusRequest('/api/versus/lobby', 'GET', 'versus-lobby');
};

export const getVersusOpponents = async (): Promise<RivalryOpponentsResponse> => {
  return versusRequest('/api/versus/opponents', 'GET', 'versus-opponents');
};

export const getVersusRivalryHistory = async (
  opponentUserId: string
): Promise<RivalryHistoryResponse> => {
  return versusRequest(
    `/api/versus/opponents/${encodeURIComponent(opponentUserId)}/history`,
    'GET',
    'versus-rivalry-history'
  );
};

export const postVersusLobby = async (
  path: string,
  body: Record<string, unknown> = {}
): Promise<VersusLobbyResponse> => {
  return versusRequest(path, 'POST', 'versus-lobby', body);
};

export const getVersusSession = async (
  matchId: string
): Promise<VersusSessionResponse> => {
  return versusRequest(
    `/api/versus/matches/${encodeURIComponent(matchId)}/session`,
    'GET',
    'versus-session'
  );
};

export const postVersusSession = async (
  matchId: string,
  action: 'guess' | 'mark' | 'mode',
  body: Record<string, unknown>
): Promise<VersusSessionResponse> => {
  return versusRequest(
    `/api/versus/matches/${encodeURIComponent(matchId)}/${action}`,
    'POST',
    'versus-session',
    body
  );
};

export const getProgress = async (): Promise<ProgressResponse> => {
  return versusRequest('/api/progress', 'GET', 'progress');
};

export const acknowledgeRewards = async (
  rewardIds: string[]
): Promise<void> => {
  const response = await fetch('/api/progress/rewards/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rewardIds }),
  });
  if (!response.ok) {
    throw new VersusClientError('Could not acknowledge rewards.');
  }
};

export const createVersusInvite = async (
  pattern: { row: number; col: number }[]
): Promise<VersusInviteResponse> => {
  return versusRequest('/api/versus/invites', 'POST', 'versus-invite', {
    pattern,
  });
};

export const getVersusInvite = async (
  inviteId: string
): Promise<VersusInviteResponse> => {
  return versusRequest(
    `/api/versus/invites/${encodeURIComponent(inviteId)}`,
    'GET',
    'versus-invite'
  );
};

export const getVersusInviteByCode = async (
  inviteCode: string
): Promise<VersusInviteResponse> => {
  return versusRequest(
    `/api/versus/invite-codes/${encodeURIComponent(inviteCode)}`,
    'GET',
    'versus-invite'
  );
};

export const acceptVersusInvite = async (
  inviteId: string
): Promise<VersusInviteResponse> => {
  return versusRequest(
    `/api/versus/invites/${encodeURIComponent(inviteId)}/accept`,
    'POST',
    'versus-invite',
    {}
  );
};

export const submitVersusInvitePattern = async (
  inviteId: string,
  pattern: { row: number; col: number }[]
): Promise<VersusInviteResponse> => {
  return versusRequest(
    `/api/versus/invites/${encodeURIComponent(inviteId)}/pattern`,
    'POST',
    'versus-invite',
    { pattern }
  );
};

export const releaseVersusInvite = async (
  inviteId: string
): Promise<VersusInviteResponse> => {
  return versusRequest(
    `/api/versus/invites/${encodeURIComponent(inviteId)}/release`,
    'POST',
    'versus-invite',
    {}
  );
};

export const cancelVersusInvite = async (
  inviteId: string
): Promise<VersusInviteResponse> => {
  return versusRequest(
    `/api/versus/invites/${encodeURIComponent(inviteId)}/cancel`,
    'POST',
    'versus-invite',
    {}
  );
};

export const createRematchRequest = async (
  matchId: string,
  pattern: { row: number; col: number }[]
): Promise<VersusRematchResponse> => {
  return versusRequest(
    `/api/versus/matches/${encodeURIComponent(matchId)}/rematches`,
    'POST',
    'versus-rematch',
    { pattern }
  );
};

export const updateRematchRequest = async (
  matchId: string,
  requestId: string,
  action: 'accept' | 'decline' | 'cancel',
): Promise<VersusRematchResponse> => {
  return versusRequest(
    `/api/versus/matches/${encodeURIComponent(matchId)}/rematches/${encodeURIComponent(requestId)}/${action}`,
    'POST',
    'versus-rematch',
    {}
  );
};

export const submitRematchPattern = async (
  matchId: string,
  requestId: string,
  pattern: { row: number; col: number }[]
): Promise<VersusRematchResponse> => {
  return versusRequest(
    `/api/versus/matches/${encodeURIComponent(matchId)}/rematches/${encodeURIComponent(requestId)}/pattern`,
    'POST',
    'versus-rematch',
    { pattern }
  );
};

const versusRequest = async <
  Response extends
    | VersusLobbyResponse
    | VersusSessionResponse
    | VersusInviteResponse
    | VersusRematchResponse
    | RivalryOpponentsResponse
    | RivalryHistoryResponse
    | ProgressResponse,
>(
  path: string,
  method: 'GET' | 'POST',
  expectedType: Response['type'],
  body?: Record<string, unknown>
): Promise<Response> => {
  const response = await fetch(path, {
    method,
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value: unknown = await response.json();

  if (!response.ok) {
    throw new VersusClientError(errorMessage(value));
  }
  if (!isRecord(value) || value.type !== expectedType) {
    throw new VersusClientError('The Versus response was invalid.');
  }

  return value as Response;
};

const errorMessage = (value: unknown): string => {
  return isRecord(value) && typeof value.message === 'string'
    ? value.message
    : 'Versus is temporarily unavailable.';
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
