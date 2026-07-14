import type { PlayerSession } from './game';
import { toggleMarkerInSession } from './game';
import type { Coord } from './pattern';

export class SerializedMarkerQueue {
  private operations: Coord[] = [];
  private writeInFlight = false;
  private queuedGuess: Coord | null = null;

  reset(): void {
    this.operations = [];
    this.writeInFlight = false;
    this.queuedGuess = null;
  }

  enqueueMarker(coord: Coord): void {
    this.operations.push(coord);
  }

  beginNextWrite(): Coord | null {
    if (this.writeInFlight) {
      return null;
    }
    const operation = this.operations[0];
    if (!operation) {
      return null;
    }
    this.writeInFlight = true;
    return operation;
  }

  settleCurrentWrite(): void {
    if (!this.writeInFlight) {
      return;
    }
    this.operations.shift();
    this.writeInFlight = false;
  }

  queueGuess(coord: Coord): void {
    this.queuedGuess = coord;
  }

  takeQueuedGuess(): Coord | null {
    if (this.hasPendingWrites) {
      return null;
    }
    const guess = this.queuedGuess;
    this.queuedGuess = null;
    return guess;
  }

  get pendingOperations(): readonly Coord[] {
    return this.operations;
  }

  get hasPendingWrites(): boolean {
    return this.writeInFlight || this.operations.length > 0;
  }
}

export const replayPendingMarkerOperations = (
  confirmedSession: PlayerSession,
  operations: readonly Coord[]
): PlayerSession => {
  return operations.reduce(
    (session, coord) => toggleMarkerInSession(session, coord),
    confirmedSession
  );
};
