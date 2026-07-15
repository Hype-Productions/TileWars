import { GameObjects, Scene, Time } from 'phaser';
import { toggleMarkerInSession, type PlayerSession } from '../../shared/game';
import {
  SerializedMarkerQueue,
  replayPendingMarkerOperations,
} from '../../shared/markerSync';
import {
  type Coord,
  coordKey,
} from '../../shared/pattern';
import type { VersusMatchSummary } from '../../shared/versus';
import {
  getVersusSession,
  postVersusSession,
  VersusClientError,
} from '../versusClient';
import {
  TILE_WARS_COLORS,
  clearSceneContent,
  drawGameplayStatsHud,
  drawPlainRivalryRecord,
  drawHowToPlayModal,
  drawRaisedPanel,
  drawTileButton,
  ensureTileWarsSceneShell,
  type TileWarsSceneShell,
} from './tileWarsTheme';

type VersusGameData = { matchId: string };
type ColorName = 'red' | 'blue' | 'orange';
type Modal = 'none' | 'help' | 'finished';
type ButtonVariant = 'dark' | 'blue' | 'green' | 'orange' | 'red';
type TileView = {
  coord: Coord;
  graphics: GameObjects.Graphics;
  label: GameObjects.Text;
  marker: GameObjects.Text;
  zone: GameObjects.Zone;
};

const TEXT_RESOLUTION =
  typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
const COLORS = TILE_WARS_COLORS;

export class VersusGame extends Scene {
  private matchId = '';
  private session: PlayerSession | null = null;
  private match: VersusMatchSummary | null = null;
  private tileViews: TileView[] = [];
  private markerMode = false;
  private pendingTileKey: string | null = null;
  private updateInFlight = false;
  private confirmedSession: PlayerSession | null = null;
  private markerQueue = new SerializedMarkerQueue();
  private modal: Modal = 'none';
  private status = 'Loading opponent pattern...';
  private boardSize = 360;
  private boardX = 0;
  private boardY = 0;
  private tileSize = 72;
  private serverNowAtSync = 0;
  private clientNowAtSync = 0;
  private clockEvent: Time.TimerEvent | null = null;
  private sceneShell: TileWarsSceneShell | null = null;

  constructor() {
    super('VersusGame');
  }

  init(data: VersusGameData): void {
    this.matchId = data.matchId;
    this.session = null;
    this.match = null;
    this.markerMode = false;
    this.pendingTileKey = null;
    this.confirmedSession = null;
    this.markerQueue.reset();
    this.modal = 'none';
    this.status = 'Loading opponent pattern...';
  }

  create(): void {
    this.sceneShell = null;
    this.cameras.main.setBackgroundColor(0xf6f0e8);
    this.scale.on('resize', this.handleResize, this);
    this.events.once('shutdown', this.handleShutdown, this);
    this.clockEvent = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.updateClockText(),
    });
    this.render();
    void this.loadSession();
  }

  private handleResize(): void {
    this.render();
  }

  private handleShutdown(): void {
    this.scale.off('resize', this.handleResize, this);
    this.clockEvent?.destroy();
    this.clockEvent = null;
  }

  private async loadSession(): Promise<void> {
    try {
      this.applyResponse(await getVersusSession(this.matchId));
      this.confirmedSession = this.session;
      this.status = this.session?.solved
        ? 'Your answer is complete.'
        : 'Tap a tile to make your guess.';
      if (this.session?.solved) {
        if (this.match?.status === 'active') {
          this.modal = 'finished';
        } else {
          await this.openResolvedResult();
          return;
        }
      }
    } catch (error) {
      this.status = clientErrorMessage(error);
    }
    this.render();
  }

  private render(): void {
    clearSceneContent(this, this.sceneShell);
    this.tileViews = [];
    const width = this.scale.width;
    const height = this.scale.height;
    const mobile = width < 760;
    const shortLandscape = width >= 600 && height < 500;
    this.sceneShell = ensureTileWarsSceneShell(this, this.sceneShell, {
      width,
      height,
      headingY: shortLandscape ? 24 : 34,
      mobile: mobile || shortLandscape,
    });

    if (!this.session || !this.match) {
      this.add
        .text(width / 2, height / 2, this.status, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '18px',
          color: '#33404c',
          align: 'center',
          wordWrap: { width: width - 36 },
        })
        .setOrigin(0.5);
      this.createButton(
        52,
        34,
        'Lobby',
        () => this.scene.start('VersusLobby'),
        'orange'
      );
      return;
    }

    this.add
      .text(width / 2, shortLandscape ? 54 : 74, `vs ${this.match.opponentDisplayName}`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: mobile ? '19px' : '23px',
        color: '#18212b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);
    const statY = shortLandscape ? 82 : 103;
    drawPlainRivalryRecord(
      this,
      width / 2,
      statY,
      this.match.rivalry,
      shortLandscape || mobile ? 12 : 14
    );

    this.layoutBoard(mobile, shortLandscape);
    this.createTiles();
    this.drawStatsHud(mobile, shortLandscape);
    this.add
      .text(
        width / 2,
        this.boardY + this.boardSize + (shortLandscape ? 11 : 15),
        '',
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: mobile ? '13px' : '15px',
          color: '#ffffff',
          backgroundColor: '#ffb12d',
          padding: { left: 8, right: 8, top: 5, bottom: 5 },
          resolution: TEXT_RESOLUTION,
        }
      )
      .setName('versus-clock')
      .setOrigin(0.5);

    const buttonY = shortLandscape ? height - 24 : mobile ? height - 30 : height - 42;
    this.createButton(
      width / 2 - 124,
      buttonY,
      'Lobby',
      () => this.scene.start('VersusLobby'),
      'orange'
    );
    this.createButton(
      width / 2,
      buttonY,
      'Help',
      () => {
        this.modal = 'help';
        this.render();
      },
      'blue'
    );
    this.createButton(
      width / 2 + 124,
      buttonY,
      this.markerMode ? 'X ON' : 'X OFF',
      () => {
        this.markerMode = !this.markerMode;
        this.render();
      },
      'dark'
    );

    this.add
      .text(width / 2, buttonY - 40, this.status, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#33404c',
        align: 'center',
        wordWrap: { width: width - 26 },
      })
      .setOrigin(0.5);

    this.redrawTiles();
    this.updateClockText();
    if (this.modal === 'help') {
      this.drawHelpModal();
    } else if (this.modal === 'finished') {
      this.drawFinishedModal();
    }
  }

  private layoutBoard(mobile: boolean, shortLandscape: boolean): void {
    const width = this.scale.width;
    const height = this.scale.height;
    if (shortLandscape) {
      this.boardSize = snapBoardSize(
        Math.max(150, Math.min(width - 30, height - 250, 260))
      );
      this.boardX = Math.round((width - this.boardSize) / 2);
      this.boardY = 145;
    } else if (mobile) {
      this.boardSize = snapBoardSize(
        Math.max(225, Math.min(width - 26, height - 316, 360))
      );
      this.boardX = Math.round((width - this.boardSize) / 2);
      this.boardY = Math.round(
        Math.max(174, (height - this.boardSize) / 2 + 24)
      );
    } else {
      this.boardSize = snapBoardSize(
        Math.max(320, Math.min(width - 80, height - 300, 460))
      );
      this.boardX = Math.round((width - this.boardSize) / 2);
      this.boardY = Math.round(
        Math.max(174, (height - this.boardSize) / 2 + 12)
      );
    }
    this.tileSize = this.boardSize / 5;
  }

  private createTiles(): void {
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const coord = { row, col };
        const graphics = this.add.graphics();
        const label = this.add
          .text(0, 0, '', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '16px',
            color: '#18212b',
            resolution: TEXT_RESOLUTION,
          })
          .setOrigin(0.5);
        const marker = this.add
          .text(0, 0, 'X', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '34px',
            color: '#1f2933',
            resolution: TEXT_RESOLUTION,
          })
          .setOrigin(0.5);
        const zone = this.add
          .zone(0, 0, 10, 10)
          .setOrigin(0)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => this.handleTile(coord));
        this.tileViews.push({ coord, graphics, label, marker, zone });
      }
    }
  }

  private redrawTiles(): void {
    if (!this.session) {
      return;
    }
    const guesses = new Map(
      this.session.guesses.map((guess) => [coordKey(guess.coord), guess])
    );
    for (const view of this.tileViews) {
      const key = coordKey(view.coord);
      const guess = guesses.get(key);
      const x = this.boardX + view.coord.col * this.tileSize;
      const y = this.boardY + view.coord.row * this.tileSize;
      const gap = Math.max(5, this.tileSize * 0.06);
      const size = this.tileSize - gap;
      const radius = Math.max(5, this.tileSize * 0.08);
      const pending = key === this.pendingTileKey;
      const graphics = view.graphics;
      const tileX = x + gap / 2;
      const tileY = y + gap / 2;
      graphics.clear();
      graphics.fillStyle(COLORS.shadow, 0.14);
      graphics.fillRoundedRect(tileX + 3, tileY + 4, size, size, radius);

      if (pending && !guess) {
        graphics.fillStyle(COLORS.pending, 1);
        graphics.fillRoundedRect(tileX, tileY, size, size, radius);
        graphics.lineStyle(3, COLORS.orange, 0.85);
        graphics.strokeRoundedRect(tileX, tileY, size, size, radius);
      } else if (guess?.clue.green) {
        graphics.fillStyle(COLORS.green, 1);
        graphics.fillRoundedRect(tileX, tileY, size, size, radius);
      } else if (guess) {
        this.drawCluePattern(graphics, tileX, tileY, size, radius, guess.clue);
      } else {
        graphics.fillStyle(
          this.session.markerKeys.includes(key) ? COLORS.marked : COLORS.paper,
          1
        );
        graphics.fillRoundedRect(tileX, tileY, size, size, radius);
      }

      if (!pending || guess) {
        graphics.lineStyle(2, COLORS.line, 1);
        graphics.strokeRoundedRect(tileX, tileY, size, size, radius);
      }
      view.label.setPosition(x + this.tileSize / 2, y + this.tileSize / 2);
      view.label.setFontSize(Math.max(12, Math.floor(this.tileSize * 0.19)));
      view.label.setVisible(false);
      view.marker.setPosition(x + this.tileSize / 2, y + this.tileSize / 2);
      view.marker.setFontSize(Math.max(24, Math.floor(this.tileSize * 0.5)));
      view.marker.setVisible(this.session.markerKeys.includes(key));
      view.zone.setPosition(x + gap / 2, y + gap / 2).setSize(size, size);

      if (pending && !guess) {
        this.tweens.add({
          targets: [view.graphics, view.label, view.marker],
          x: '+=4',
          y: '-=2',
          yoyo: true,
          repeat: 3,
          duration: 85,
          ease: 'Sine.easeInOut',
        });
      }
    }
  }

  private handleTile(coord: Coord): void {
    if (!this.session || this.session.solved) {
      return;
    }
    const key = coordKey(coord);
    if (this.markerMode) {
      if (this.updateInFlight) {
        return;
      }
      this.session = toggleMarkerInSession(this.session, coord);
      this.markerQueue.enqueueMarker(coord);
      this.status = 'X note updated.';
      this.render();
      void this.processMarkerQueue();
      return;
    }
    if (this.updateInFlight) {
      return;
    }
    if (this.session.guesses.some((guess) => coordKey(guess.coord) === key)) {
      return;
    }
    if (this.markerQueue.hasPendingWrites) {
      this.markerQueue.queueGuess(coord);
      this.pendingTileKey = key;
      this.status = 'Checking tile...';
      this.redrawTiles();
      return;
    }
    this.pendingTileKey = key;
    this.status = 'Checking tile...';
    this.redrawTiles();
    void this.postUpdate('guess', { coord });
  }

  private async processMarkerQueue(): Promise<void> {
    const coord = this.markerQueue.beginNextWrite();
    if (!coord) {
      return;
    }
    try {
      const response = await postVersusSession(this.matchId, 'mark', { coord });
      this.markerQueue.settleCurrentWrite();
      this.applyResponse(response);
      this.confirmedSession = response.session;
      this.reapplyPendingMarkers();
    } catch (error) {
      this.markerQueue.settleCurrentWrite();
      this.session = this.confirmedSession;
      this.reapplyPendingMarkers();
      this.status = 'Couldn’t save that X—try again.';
    } finally {
      if (this.scene.isActive()) {
        this.render();
      }
      if (this.markerQueue.hasPendingWrites) {
        void this.processMarkerQueue();
      } else {
        const guess = this.markerQueue.takeQueuedGuess();
        if (guess) {
          this.pendingTileKey = null;
          this.handleTile(guess);
        }
      }
    }
  }

  private reapplyPendingMarkers(): void {
    if (!this.confirmedSession) {
      return;
    }
    this.session = replayPendingMarkerOperations(
      this.confirmedSession,
      this.markerQueue.pendingOperations
    );
  }

  private async postUpdate(
    action: 'guess' | 'mark' | 'mode',
    body: Record<string, unknown>
  ): Promise<void> {
    if (this.updateInFlight) {
      return;
    }
    this.updateInFlight = true;
    try {
      this.applyResponse(await postVersusSession(this.matchId, action, body));
      this.confirmedSession = this.session;
      this.status = this.session?.solved
        ? 'Pattern found!'
        : action === 'guess'
          ? this.session?.guesses.at(-1)?.wasGreen
            ? 'Pattern tile found.'
            : 'Clue added.'
          : 'Saved.';
      if (this.session?.solved) {
        if (this.match?.status === 'active') {
          this.modal = 'finished';
        } else {
          await this.openResolvedResult();
          return;
        }
      }
    } catch (error) {
      this.status = clientErrorMessage(error);
    } finally {
      this.pendingTileKey = null;
      this.updateInFlight = false;
      this.render();
    }
  }

  private applyResponse(response: {
    session: PlayerSession;
    match: VersusMatchSummary;
    serverNow: number;
  }): void {
    this.session = response.session;
    this.match = response.match;
    this.serverNowAtSync = response.serverNow;
    this.clientNowAtSync = Date.now();
  }

  private async openResolvedResult(): Promise<void> {
    if (!this.match) {
      return;
    }
    this.scene.start('VersusResult', {
      match: this.match,
    });
  }

  private drawStatsHud(mobile: boolean, shortLandscape: boolean): void {
    if (!this.session) {
      return;
    }
    const tileSize = shortLandscape ? 22 : mobile ? 26 : 30;
    drawGameplayStatsHud(this, {
      centerX: this.scale.width / 2,
      labelY: shortLandscape ? 105 : 132,
      tileY: shortLandscape ? 128 : 157,
      totalTiles: this.session.totalTiles,
      foundTiles: this.session.foundKeys.length,
      guesses: this.session.guesses.length,
      tileSize,
      gap: shortLandscape ? 3 : 4,
      groupGap: shortLandscape ? 18 : mobile ? 22 : 30,
    });
  }

  private updateClockText(): void {
    const clock = this.children.getByName('versus-clock');
    if (!(clock instanceof GameObjects.Text) || !this.session) {
      return;
    }
    const end =
      this.session.solvedAt ??
      this.serverNowAtSync + Math.max(0, Date.now() - this.clientNowAtSync);
    clock.setText(formatDuration(Math.max(0, end - this.session.startedAt)));
  }

  private drawHelpModal(): void {
    drawHowToPlayModal(this, () => {
      this.modal = 'none';
      this.render();
    });
  }

  private drawFinishedModal(): void {
    if (!this.match || !this.session) {
      return;
    }
    const score = this.match.myScore;
    const guesses = score?.guesses ?? this.session.guesses.length;
    const timing = score ? ` (${formatDuration(score.durationMs)})` : '';
    this.drawModal(
      'Pattern Found!',
      [
        `You found ${this.match.opponentDisplayName}'s pattern in ${guesses} guesses${timing}.`,
        `Your score is locked in; waiting for ${this.match.opponentDisplayName}.`,
      ],
      true
    );
  }

  private drawModal(title: string, lines: string[], finished = false): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const modalWidth = Math.min(width - 30, 420);
    const modalHeight = 220;
    const x = (width - modalWidth) / 2;
    const y = (height - modalHeight) / 2;
    this.add.zone(0, 0, width, height).setOrigin(0).setInteractive();
    const overlay = this.add.graphics();
    overlay.fillStyle(0x111820, 0.44);
    overlay.fillRect(0, 0, width, height);
    drawRaisedPanel(
      this,
      x,
      y,
      modalWidth,
      modalHeight,
      COLORS.line,
      COLORS.panel
    );
    this.add
      .text(width / 2, y + 34, title, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '22px',
        color: '#18212b',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, y + 78, lines.join('\n'), {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#33404c',
        align: 'center',
        lineSpacing: 7,
      })
      .setOrigin(0.5, 0);
    if (finished) {
      this.createButton(width / 2, y + modalHeight - 34, 'Lobby', () => {
        this.scene.start('VersusLobby');
      }, 'green');
    } else {
      this.createButton(width / 2, y + modalHeight - 34, 'Close', () => {
        this.modal = 'none';
        this.render();
      }, 'red');
    }
  }

  private drawCluePattern(
    graphics: GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    radius: number,
    clue: PlayerSession['guesses'][number]['clue']
  ): void {
    const colors: ColorName[] = [];
    if (clue.red > 0) colors.push('red');
    if (clue.blue > 0) colors.push('blue');
    if (clue.orange > 0) colors.push('orange');

    if (colors.length === 0) {
      graphics.fillStyle(COLORS.paper, 1);
      graphics.fillRoundedRect(x, y, size, size, radius);
      return;
    }

    graphics.fillStyle(COLORS[colors[0] ?? 'red'], 1);
    graphics.fillRoundedRect(x, y, size, size, radius);
    const segmentSize = size / colors.length;
    for (let index = 1; index < colors.length; index += 1) {
      const segmentX = x + segmentSize * index;
      const remainingWidth = size - segmentSize * index;
      graphics.fillStyle(COLORS[colors[index] ?? 'red'], 1);
      if (index === colors.length - 1) {
        graphics.fillRoundedRect(segmentX, y, remainingWidth, size, radius);
        graphics.fillRect(segmentX, y, Math.min(radius, remainingWidth), size);
      } else {
        graphics.fillRect(segmentX, y, segmentSize, size);
      }
    }
  }

  private createButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    variant: ButtonVariant = 'dark'
  ): GameObjects.Container {
    return drawTileButton(this, {
      x,
      y,
      label,
      variant,
      onClick: () => onClick(),
    });
  }
}

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const snapBoardSize = (value: number): number => {
  return Math.max(5, Math.floor(value / 5) * 5);
};

const clientErrorMessage = (error: unknown): string => {
  return error instanceof VersusClientError
    ? error.message
    : 'Could not update this match. Try again.';
};
