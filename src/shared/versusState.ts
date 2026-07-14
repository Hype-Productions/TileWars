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
): 'create' | 'idempotent' | 'join' => {
  if (
    !current ||
    (current.status !== 'pending' &&
      current.status !== 'accepted-awaiting-pattern' &&
      current.status !== 'matched')
  ) {
    return 'create';
  }
  if (current.status === 'matched') {
    return 'idempotent';
  }
  return current.requesterUserId === actorUserId
    ? 'idempotent'
    : 'join';
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

export const resolvedResultAccessDecision = (
  isParticipant: boolean,
  status: 'active' | 'complete' | 'expired'
): 'allow' | 'not-participant' | 'still-active' => {
  if (!isParticipant) {
    return 'not-participant';
  }
  return status === 'active' ? 'still-active' : 'allow';
};
