import { GameObjects, Scene, Time } from 'phaser';
import type { PlayerSession } from '../../shared/game';
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
  drawRaisedPanel,
  drawTileHeading,
  drawTileWarsBackdrop,
} from './tileWarsTheme';

type VersusGameData = { matchId: string };
type ColorName = 'red' | 'blue' | 'orange';
type Modal = 'none' | 'clues' | 'finished';
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
  private modal: Modal = 'none';
  private status = 'Loading opponent pattern...';
  private boardSize = 360;
  private boardX = 0;
  private boardY = 0;
  private tileSize = 72;
  private serverNowAtSync = 0;
  private clientNowAtSync = 0;
  private clockEvent: Time.TimerEvent | null = null;

  constructor() {
    super('VersusGame');
  }

  init(data: VersusGameData): void {
    this.matchId = data.matchId;
    this.session = null;
    this.match = null;
    this.markerMode = false;
    this.pendingTileKey = null;
    this.modal = 'none';
    this.status = 'Loading opponent pattern...';
  }

  create(): void {
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
      this.status = this.session?.solved
        ? 'Your answer is complete.'
        : 'Find your opponent’s hidden pattern.';
      if (this.session?.solved) {
        this.modal = 'finished';
      }
    } catch (error) {
      this.status = clientErrorMessage(error);
    }
    this.render();
  }

  private render(): void {
    this.tweens.killAll();
    this.children.removeAll(true);
    this.input.resetCursor();
    this.tileViews = [];
    const width = this.scale.width;
    const height = this.scale.height;
    const mobile = width < 760;
    drawTileWarsBackdrop(this, width, height);
    drawTileHeading(this, 'Versus', width / 2, 34, mobile);

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
      .text(width / 2, 76, `vs ${this.match.opponentDisplayName}`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: mobile ? '19px' : '23px',
        color: '#18212b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);
    this.add
      .text(width - 16, 34, '', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: mobile ? '13px' : '15px',
        color: '#ffffff',
        backgroundColor: '#ffb12d',
        padding: { left: 8, right: 8, top: 6, bottom: 6 },
        resolution: TEXT_RESOLUTION,
      })
      .setName('versus-clock')
      .setOrigin(1, 0.5);
    this.add
      .text(width / 2, 120, this.statsText(), {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: mobile ? '12px' : '14px',
        color: '#25313b',
        backgroundColor: '#fff6dd',
        padding: { left: 12, right: 12, top: 6, bottom: 6 },
      })
      .setOrigin(0.5);
    this.add
      .text(
        width / 2,
        98,
        `You ${this.match.rivalry.wins} - ${this.match.rivalry.losses} ${this.match.opponentDisplayName}`,
        {
          fontFamily: 'Arial, sans-serif',
          fontSize: mobile ? '12px' : '14px',
          color: '#25313b',
        }
      )
      .setOrigin(0.5);

    this.layoutBoard(mobile);
    this.createTiles();
    if (mobile) {
      this.createButton(width - 48, 92, 'Clues', () => {
        this.modal = 'clues';
        this.render();
      }, 'blue');
    } else {
      this.drawRulesPanel();
    }

    const buttonY = mobile ? height - 30 : height - 42;
    this.createButton(
      width / 2 - 124,
      buttonY,
      mobile ? this.shortModeLabel() : this.modeLabel(),
      () => void this.changeMode(),
      'blue'
    );
    this.createButton(
      width / 2,
      buttonY,
      this.markerMode ? 'X on' : 'X off',
      () => {
        this.markerMode = !this.markerMode;
        this.render();
      },
      this.markerMode ? 'green' : 'dark'
    );
    this.createButton(
      width / 2 + 124,
      buttonY,
      'Lobby',
      () => this.scene.start('VersusLobby'),
      'orange'
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
    if (this.modal === 'clues') {
      this.drawModal('Clues', [
        'Green: tile is in the pattern',
        'Red: same vertical column',
        'Blue: same horizontal row',
        'Orange: diagonal from a pattern tile',
        'X mode: private no-guess notes',
      ]);
    } else if (this.modal === 'finished') {
      this.drawFinishedModal();
    }
  }

  private layoutBoard(mobile: boolean): void {
    const width = this.scale.width;
    const height = this.scale.height;
    if (mobile) {
      this.boardSize = snapBoardSize(
        Math.max(225, Math.min(width - 26, height - 286, 360))
      );
      this.boardX = Math.round((width - this.boardSize) / 2);
      this.boardY = Math.round(
        Math.max(148, (height - this.boardSize) / 2 + 18)
      );
    } else {
      const rulesWidth = 270;
      this.boardSize = snapBoardSize(
        Math.max(320, Math.min(width - rulesWidth - 90, height - 185, 460))
      );
      this.boardX = Math.round(
        Math.max(28, (width - rulesWidth - this.boardSize) / 2)
      );
      this.boardY = Math.round(
        Math.max(132, (height - this.boardSize) / 2 + 6)
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
    if (!this.session || this.updateInFlight || this.session.solved) {
      return;
    }
    const key = coordKey(coord);
    if (this.markerMode) {
      void this.postUpdate('mark', { coord });
      return;
    }
    if (this.session.guesses.some((guess) => coordKey(guess.coord) === key)) {
      return;
    }
    this.pendingTileKey = key;
    this.status = 'Checking tile...';
    this.redrawTiles();
    void this.postUpdate('guess', { coord });
  }

  private async changeMode(): Promise<void> {
    if (!this.session || this.updateInFlight) {
      return;
    }
    const clueMode =
      this.session.clueMode === 'balanced' ? 'proximity' : 'balanced';
    await this.postUpdate('mode', { clueMode });
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
      this.status = this.session?.solved
        ? 'Finished. Your opponent can now see your score.'
        : action === 'guess'
          ? this.session?.guesses.at(-1)?.wasGreen
            ? 'Pattern tile found.'
            : 'Clue added.'
          : 'Saved.';
      if (this.session?.solved) {
        this.modal = 'finished';
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

  private statsText(): string {
    if (!this.session) {
      return '';
    }
    const remaining = Math.max(
      0,
      this.session.totalTiles - this.session.foundKeys.length
    );
    return `Remaining: ${remaining}   Guesses: ${this.session.guesses.length}`;
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

  private drawRulesPanel(): void {
    const x = this.boardX + this.boardSize + 154;
    const y = this.boardY + 24;
    drawRaisedPanel(this, x - 138, y - 16, 276, 190, COLORS.blue);
    this.add
      .text(x, y, 'Clues', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '18px',
        color: '#18212b',
      })
      .setOrigin(0.5);
    const rows: { label: string; color: number }[] = [
      { label: 'Part of pattern', color: COLORS.green },
      { label: 'Same column', color: COLORS.red },
      { label: 'Same row', color: COLORS.blue },
      { label: 'Diagonal', color: COLORS.orange },
      { label: 'X mode is a private note', color: COLORS.line },
    ];
    rows.forEach((row, index) => {
      const rowY = y + 32 + index * 28;
      const left = x - 122;
      const graphics = this.add.graphics();
      graphics.fillStyle(row.color, 1);
      graphics.fillRoundedRect(left, rowY - 8, 16, 16, 4);
      this.add
        .text(left + 26, rowY, row.label, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '15px',
          color: '#33404c',
        })
        .setOrigin(0, 0.5);
    });
  }

  private drawFinishedModal(): void {
    if (!this.match || !this.session) {
      return;
    }
    const score = this.match.myScore;
    const lines = [
      score
        ? `${score.guesses} guesses in ${formatDuration(score.durationMs)}`
        : `${this.session.guesses.length} guesses`,
      this.match.status === 'active'
        ? 'Waiting for your opponent to answer.'
        : `Result: ${this.match.outcome.replace('-', ' ')}`,
    ];
    this.drawModal('Answer submitted', lines, true);
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
      this.createButton(width / 2, y + modalHeight - 34, 'Versus lobby', () => {
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

  private modeLabel(): string {
    return this.session?.clueMode === 'proximity'
      ? 'Proximity clues'
      : 'Balanced clues';
  }

  private shortModeLabel(): string {
    return this.session?.clueMode === 'proximity' ? 'Proximity' : 'Balanced';
  }

  private createButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    variant: ButtonVariant = 'dark'
  ): GameObjects.Text {
    const base = this.buttonColor(variant);
    const hover = this.buttonHoverColor(variant);
    const button = this.add
      .text(x, y, label, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
        backgroundColor: base,
        padding: { left: 11, right: 11, top: 7, bottom: 7 },
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    button.on('pointerover', () => {
      button.setStyle({ backgroundColor: hover });
      this.tweens.add({ targets: button, y: y - 2, duration: 90 });
    });
    button.on('pointerout', () => {
      button.setStyle({ backgroundColor: base });
      this.tweens.add({ targets: button, y, duration: 90 });
    });
    button.on('pointerdown', () => {
      this.tweens.add({
        targets: button,
        scaleX: 0.94,
        scaleY: 0.94,
        yoyo: true,
        duration: 80,
      });
      onClick();
    });
    return button;
  }

  private buttonColor(variant: ButtonVariant): string {
    return {
      dark: '#25313b',
      blue: '#2577ff',
      green: '#16a66a',
      orange: '#f28d13',
      red: '#df4758',
    }[variant];
  }

  private buttonHoverColor(variant: ButtonVariant): string {
    return {
      dark: '#354555',
      blue: '#339dff',
      green: '#27bf7d',
      orange: '#ffad2d',
      red: '#ff5365',
    }[variant];
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
