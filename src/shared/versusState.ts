export type PendingRequestState =
  | 'pending'
  | 'accepted-awaiting-pattern'
  | 'matched'
  | 'declined'
  | 'cancelled'
  | 'expired';

export const rematchCreationDecision = (
  current: { status: PendingRequestState; requesterUserId: string } | null,
  actorUserId: string
): 'create' | 'idempotent' | 'opponent-pending' => {
  if (
    !current ||
    (current.status !== 'pending' &&
      current.status !== 'accepted-awaiting-pattern')
  ) {
    return 'create';
  }
  return current.requesterUserId === actorUserId
    ? 'idempotent'
    : 'opponent-pending';
};

export const responsePatternDecision = (
  status: PendingRequestState | 'open',
  createdMatchId: string | null
): 'create' | 'idempotent' | 'invalid' => {
  if (status === 'matched' && createdMatchId) {
    return 'idempotent';
  }
  return status === 'accepted-awaiting-pattern' ? 'create' : 'invalid';
};

export const inviteAcceptanceDecision = (
  status: 'open' | PendingRequestState,
  acceptedByUserId: string | null,
  actorUserId: string
): 'accept' | 'idempotent' | 'unavailable' => {
  if (status === 'open') {
    return 'accept';
  }
  if (
    status === 'accepted-awaiting-pattern' &&
    acceptedByUserId === actorUserId
  ) {
    return 'idempotent';
  }
  return 'unavailable';
};
