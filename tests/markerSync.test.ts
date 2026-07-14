import { describe, expect, it } from 'vitest';
import {
  createCustomPuzzleId,
  createInitialSession,
  toggleMarkerInSession,
} from '../src/shared/game';
import {
  SerializedMarkerQueue,
  replayPendingMarkerOperations,
} from '../src/shared/markerSync';
import { coordKey } from '../src/shared/pattern';

const first = { row: 0, col: 0 };
const second = { row: 1, col: 1 };
const createSession = () =>
  createInitialSession(createCustomPuzzleId('custom-pattern', 'markers'), 6);

describe('optimistic marker synchronization', () => {
  it('replays a pending marker immediately over confirmed state', () => {
    const visible = replayPendingMarkerOperations(createSession(), [first]);
    expect(visible.markerKeys).toEqual([coordKey(first)]);
  });

  it('preserves rapid double-toggle intent', () => {
    const visible = replayPendingMarkerOperations(createSession(), [first, first]);
    expect(visible.markerKeys).toEqual([]);
  });

  it('serializes marker writes in tap order', () => {
    const queue = new SerializedMarkerQueue();
    queue.enqueueMarker(first);
    queue.enqueueMarker(second);
    expect(queue.beginNextWrite()).toEqual(first);
    expect(queue.beginNextWrite()).toBeNull();
    queue.settleCurrentWrite();
    expect(queue.beginNextWrite()).toEqual(second);
  });

  it('reconciles a confirmed response before replaying later taps', () => {
    const queue = new SerializedMarkerQueue();
    queue.enqueueMarker(first);
    queue.enqueueMarker(first);
    expect(queue.beginNextWrite()).toEqual(first);
    const confirmed = toggleMarkerInSession(createSession(), first);
    queue.settleCurrentWrite();
    const visible = replayPendingMarkerOperations(
      confirmed,
      queue.pendingOperations
    );
    expect(visible.markerKeys).toEqual([]);
  });

  it('rolls a failed write back to confirmed state', () => {
    const queue = new SerializedMarkerQueue();
    const confirmed = createSession();
    queue.enqueueMarker(first);
    expect(
      replayPendingMarkerOperations(confirmed, queue.pendingOperations).markerKeys
    ).toEqual([coordKey(first)]);
    expect(queue.beginNextWrite()).toEqual(first);
    queue.settleCurrentWrite();
    expect(
      replayPendingMarkerOperations(confirmed, queue.pendingOperations).markerKeys
    ).toEqual([]);
  });

  it('holds a guess until outstanding marker writes settle', () => {
    const queue = new SerializedMarkerQueue();
    queue.enqueueMarker(first);
    queue.queueGuess(second);
    expect(queue.takeQueuedGuess()).toBeNull();
    expect(queue.beginNextWrite()).toEqual(first);
    queue.settleCurrentWrite();
    expect(queue.takeQueuedGuess()).toEqual(second);
    expect(queue.takeQueuedGuess()).toBeNull();
  });
});
