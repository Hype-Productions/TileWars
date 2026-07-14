import { describe, expect, it } from 'vitest';
import {
  applyGuessToSession,
  createInitialSession,
  type PuzzleId,
} from '../src/shared/game';
import { parsePatternInput } from '../src/shared/pattern';
import {
  compareVersusScores,
  organizeVersusLobby,
  parseVersusShareData,
  parseVersusShareUrl,
  replayForSession,
  resolveVersusScores,
  validateVersusPattern,
  versusRules,
  versusScoreForSession,
} from '../src/shared/versus';
import {
  inviteAcceptanceDecision,
  rematchCreationDecision,
  resolvedResultAccessDecision,
  responsePatternDecision,
} from '../src/shared/versusState';

const puzzleId: PuzzleId = {
  mode: 'versus',
  date: 'versus',
  seed: 'match-1',
  puzzleNumber: 0,
};

describe('versus rules', () => {
  it('creates one opponent per public search', () => {
    expect(versusRules().maxOpponents).toBe(1);
  });

  it('requires exactly six connected tiles', () => {
    expect(validateVersusPattern(parsePatternInput('A1,B1,C1,D1,E1,E2')).valid).toBe(
      true
    );
    expect(validateVersusPattern(parsePatternInput('A1,B1,C1,D1,E1')).valid).toBe(
      false
    );
    expect(
      validateVersusPattern(parsePatternInput('A1,B1,C1,D1,E1,E5')).valid
    ).toBe(false);
  });

  it('orders by guesses and then elapsed duration', () => {
    expect(
      compareVersusScores(
        { guesses: 7, durationMs: 60_000 },
        { guesses: 8, durationMs: 1_000 }
      )
    ).toBe(-1);
    expect(
      compareVersusScores(
        { guesses: 7, durationMs: 20_000 },
        { guesses: 7, durationMs: 25_000 }
      )
    ).toBe(-1);
    expect(
      compareVersusScores(
        { guesses: 7, durationMs: 20_000 },
        { guesses: 7, durationMs: 20_000 }
      )
    ).toBe(0);
  });

  it('resolves completed, forfeited, and abandoned matches', () => {
    const fast = { guesses: 7, durationMs: 20_000 };
    const slow = { guesses: 8, durationMs: 10_000 };

    expect(resolveVersusScores(fast, slow, false)).toEqual({
      status: 'complete',
      winner: 'first',
      noContest: false,
    });
    expect(resolveVersusScores(fast, null, true)).toEqual({
      status: 'expired',
      winner: 'first',
      noContest: false,
    });
    expect(resolveVersusScores(null, null, true)).toEqual({
      status: 'expired',
      winner: null,
      noContest: true,
    });
  });

  it('creates a server-timed score and ordered replay after solving', () => {
    const pattern = parsePatternInput('A1,B1,C1,D1,E1,E2');
    let session = createInitialSession(puzzleId, pattern.length, 1_000);

    for (const [index, coord] of pattern.entries()) {
      session = applyGuessToSession(session, pattern, coord, 2_000 + index * 100);
    }

    expect(versusScoreForSession(session)).toEqual({
      guesses: 6,
      durationMs: 1_500,
    });
    expect(replayForSession(session).map((guess) => guess.order)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it('joins a crossed rematch invitation and keeps retries idempotent', () => {
    const pending = { status: 'pending' as const, requesterUserId: 'user-a' };
    expect(rematchCreationDecision(pending, 'user-a')).toBe('idempotent');
    expect(rematchCreationDecision(pending, 'user-b')).toBe('join');
    expect(
      rematchCreationDecision(
        { status: 'matched', requesterUserId: 'user-a' },
        'user-b'
      )
    ).toBe('idempotent');
    expect(rematchCreationDecision(null, 'user-b')).toBe('create');
  });

  it('creates a match only after acceptance and makes retries idempotent', () => {
    expect(responsePatternDecision('pending', null)).toBe('invalid');
    expect(responsePatternDecision('accepted-awaiting-pattern', null)).toBe('create');
    expect(responsePatternDecision('matched', 'match-2')).toBe('idempotent');
    expect(inviteAcceptanceDecision('open', null, 'user-b')).toBe('accept');
    expect(
      inviteAcceptanceDecision('accepted-awaiting-pattern', 'user-b', 'user-b')
    ).toBe('idempotent');
    expect(
      inviteAcceptanceDecision('accepted-awaiting-pattern', 'user-b', 'user-c')
    ).toBe('unavailable');
  });

  it('parses only valid Versus invitation share data', () => {
    expect(
      parseVersusShareData(
        JSON.stringify({ type: 'pattern-invite', inviteId: 'invite-1' })
      )
    ).toEqual({ type: 'pattern-invite', inviteId: 'invite-1' });
    expect(parseVersusShareData('{bad json')).toBeNull();
    expect(parseVersusShareData(JSON.stringify({ type: 'other' }))).toBeNull();
  });

  it('parses both full and iOS-minimal Devvit invitation URLs', () => {
    const fullUrl =
      'https://www.reddit.com/r/TileFinder/comments/1uq3v9z/daily_pattern_tiles/?devvitshare=%7B%22hash%22%3A%22%22%2C%22params%22%3A%7B%7D%2C%22path%22%3A%22%22%2C%22userData%22%3A%22%7B%5C%22type%5C%22%3A%5C%22pattern-invite%5C%22%2C%5C%22inviteId%5C%22%3A%5C%22a963c58e-5de4-4112-87dc-7af97a8d92b7%5C%22%7D%22%7D';
    const iosUrl =
      'https://www.reddit.com/r/TileFinder/comments/1uq3v9z/daily_pattern_tiles/?devvitshare=%7B%22userData%22%3A%22%7B%5C%22type%5C%22%3A%5C%22pattern-invite%5C%22%2C%5C%22inviteId%5C%22%3A%5C%22900c39cd-6d82-4c92-86e6-790d628c0ea0%5C%22%7D%22%7D&share_id=ObqrTQx8FaZ6RTEN1t8wk';
    expect(parseVersusShareUrl(fullUrl)?.inviteId).toBe(
      'a963c58e-5de4-4112-87dc-7af97a8d92b7'
    );
    expect(parseVersusShareUrl(iosUrl)?.inviteId).toBe(
      '900c39cd-6d82-4c92-86e6-790d628c0ea0'
    );
  });

  it('keeps an invitation and its permanent result in their requested groups', () => {
    const resultMatch = {
      matchId: 'match-1',
      source: 'public' as const,
      opponentDisplayName: 'opponent',
      status: 'complete' as const,
      outcome: 'win' as const,
      createdAt: 1,
      expiresAt: 2,
      myAttemptStatus: 'solved' as const,
      opponentAttemptStatus: 'solved' as const,
      myScore: { guesses: 6, durationMs: 1000 },
      opponentScore: { guesses: 7, durationMs: 1200 },
      myReplay: [],
      opponentReplay: [],
      rivalry: { wins: 2, losses: 1, draws: 0 },
      xpEarned: 100,
    };
    const pendingItem = {
      kind: 'rematch' as const,
      rematch: {
        requestId: 'request-1',
        sourceMatchId: resultMatch.matchId,
        opponentDisplayName: 'opponent',
        status: 'pending' as const,
        role: 'responder' as const,
        createdAt: 3,
        expiresAt: 4,
      },
    };
    const sections = organizeVersusLobby({
      matches: [resultMatch],
      pendingItems: [pendingItem],
    });
    expect(sections.invitations).toEqual([pendingItem]);
    expect(sections.resultMatches).toEqual([resultMatch]);
  });

  it('orders active matches as continue, play, then waiting', () => {
    const match = (id: string, attempt: 'playing' | 'not-started' | 'solved', createdAt: number) => ({
      matchId: id,
      source: 'public' as const,
      opponentDisplayName: id,
      status: 'active' as const,
      outcome: 'pending' as const,
      createdAt,
      expiresAt: createdAt + 100,
      myAttemptStatus: attempt,
      opponentAttemptStatus: 'not-started' as const,
      myScore: null,
      opponentScore: null,
      myReplay: [],
      opponentReplay: [],
      rivalry: { wins: 0, losses: 0, draws: 0 },
      xpEarned: 0,
    });
    const sections = organizeVersusLobby({
      matches: [match('waiting', 'solved', 4), match('play', 'not-started', 3), match('continue', 'playing', 2)],
      pendingItems: [],
    });
    expect(sections.activeMatches.map((entry) => entry.matchId)).toEqual([
      'continue',
      'play',
      'waiting',
    ]);
  });

  it('orders actionable invitations before sent invitations', () => {
    const incoming = {
      kind: 'rematch' as const,
      rematch: {
        requestId: 'incoming', sourceMatchId: 'one', opponentDisplayName: 'A',
        status: 'pending' as const, role: 'responder' as const, createdAt: 1, expiresAt: 10,
      },
    };
    const outgoing = {
      kind: 'rematch' as const,
      rematch: {
        requestId: 'outgoing', sourceMatchId: 'two', opponentDisplayName: 'B',
        status: 'pending' as const, role: 'requester' as const, createdAt: 2, expiresAt: 10,
      },
    };
    const sections = organizeVersusLobby({ matches: [], pendingItems: [outgoing, incoming] });
    expect(sections.invitations).toEqual([incoming, outgoing]);
  });

  it('allows only participants to open resolved analytical results', () => {
    expect(resolvedResultAccessDecision(true, 'complete')).toBe('allow');
    expect(resolvedResultAccessDecision(true, 'expired')).toBe('allow');
    expect(resolvedResultAccessDecision(true, 'active')).toBe('still-active');
    expect(resolvedResultAccessDecision(false, 'complete')).toBe('not-participant');
  });
});
