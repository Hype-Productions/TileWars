import { GameObjects, Scene } from 'phaser';
import {
  type Coord,
  coordKey,
  getRemainingCount,
  todayUtcDate,
} from '../../shared/pattern';
import {
  type DailySessionResponse,
  type LeaderboardEntry,
  type PlayerSession,
  applyGuessToSession,
  createDailyPuzzleId,
  createInitialSession,
  dailyPatternForPuzzle,
  toggleMarkerInSession,
} from '../../shared/game';
import type {
  PlayerProgressSummary,
  ProgressReward,
} from '../../shared/progression';

type StoredGuess = {
  coord: Coord;
  clue: PlayerSession['guesses'][number]['clue'];
};

type TileView = {
  coord: Coord;
  graphics: GameObjects.Graphics;
  label: GameObjects.Text;
  marker: GameObjects.Text;
  zone: GameObjects.Zone;
};

type ColorName = 'red' | 'blue' | 'orange';
type Screen = 'loading' | 'game';
type Modal = 'none' | 'clues' | 'result';
type ButtonVariant = 'dark' | 'blue' | 'green' | 'orange' | 'red';

const BOARD_DIMENSION = 5;
const TEXT_RESOLUTION =
  typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);

const COLORS: Record<
  | ColorName
  | 'green'
  | 'base'
  | 'line'
  | 'marked'
  | 'pending'
  | 'paper'
  | 'panel'
  | 'shadow',
  number
> = {
  base: 0xf8f1e8,
  line: 0x25313b,
  marked: 0xede0cf,
  pending: 0xfff0bf,
  paper: 0xfff6dd,
  panel: 0xfffbef,
  shadow: 0x142130,
  green: 0x35d07f,
  red: 0xff5365,
  blue: 0x339dff,
  orange: 0xffb12d,
};

export class PatternGame extends Scene {
  private screen: Screen = 'loading';
  private pattern: Coord[] = [];
  private session: PlayerSession | null = null;
  private leaderboard: LeaderboardEntry[] = [];
  private playerRank: LeaderboardEntry | null = null;
  private tileViews: TileView[] = [];
  private interactiveObjects: GameObjects.GameObject[] = [];
  private markerMode = false;
  private modal: Modal = 'none';
  private currentStatus = 'Loading daily puzzle...';
  private boardSize = 360;
  private boardX = 0;
  private boardY = 0;
  private tileSize = 72;
  private pendingTileKey: string | null = null;
  private lastGuessKey: string | null = null;
  private dailyUpdateInFlight = false;
  private progress: PlayerProgressSummary | null = null;
  private dailyReward: ProgressReward | null = null;
  private acknowledgedRewardIds = new Set<string>();
  private showingSolvedReveal = false;

  constructor() {
    super('PatternGame');
  }

  create(): void {
    const sharedInviteId: unknown = this.registry.get('sharedInviteId');
    if (typeof sharedInviteId === 'string') {
      this.scene.start('VersusLobby', { inviteId: sharedInviteId });
      return;
    }
    this.cameras.main.setBackgroundColor(0xf6f0e8);
    this.scale.on('resize', this.handleResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize, this);
    });
    this.startDailyGame();
  }

  private handleResize(): void {
    this.renderScreen();
  }

  private clearInteractiveObjects(): void {
    for (const object of this.interactiveObjects) {
      if (!object.active) {
        continue;
      }

      object.removeAllListeners();
      if (object.input) {
        this.input.disable(object);
        this.input.clear(object, true);
      }
      object.destroy();
    }

    this.interactiveObjects = [];
    this.input.resetCursor();
  }

  private trackInteractive<T extends GameObjects.GameObject>(object: T): T {
    this.interactiveObjects.push(object);
    return object;
  }

  private renderScreen(): void {
    this.tweens.killAll();
    this.clearInteractiveObjects();
    this.children.removeAll(true);
    this.tileViews = [];

    if (this.screen === 'loading') {
      this.drawLoading();
      return;
    }

    this.drawGame();
  }

  private startDailyGame(): void {
    this.screen = 'loading';
    this.currentStatus = 'Loading daily puzzle...';
    this.renderScreen();
    void this.loadDailySession();
  }

  private startGame(status: string, modal: Modal = 'none'): void {
    this.screen = 'game';
    this.markerMode = false;
    this.modal = modal;
    this.showingSolvedReveal = false;
    this.lastGuessKey = null;
    this.currentStatus = status;
    this.renderScreen();
    this.setGameStatus(status);
  }

  private async loadDailySession(): Promise<void> {
    try {
      const response = await fetch('/api/daily/session');
      if (!response.ok) {
        throw new Error(`Daily session failed: ${response.status}`);
      }

      const data = toDailySessionResponse(await response.json());
      if (!data) {
        throw new Error('Daily session response was invalid.');
      }
      this.applyDailyResponse(data);
      this.startGame(
        data.session.solved
          ? `Solved in ${data.session.guesses.length} guesses.`
          : 'Daily progress loaded.',
        data.session.solved ? 'result' : 'none'
      );
    } catch (error) {
      console.warn('Falling back to local daily session:', error);
      const puzzleId = createDailyPuzzleId(todayUtcDate());
      this.pattern = dailyPatternForPuzzle(puzzleId);
      this.session = createInitialSession(puzzleId, this.pattern.length);
      this.leaderboard = [];
      this.playerRank = null;
      this.startGame(
        'Local daily preview. Reddit persistence is unavailable here.'
      );
    }
  }

  private applyDailyResponse(data: DailySessionResponse): void {
    this.session = data.session;
    if (data.leaderboard) {
      this.leaderboard = data.leaderboard;
    }
    if (data.playerRank !== undefined) {
      this.playerRank = data.playerRank;
    }
    this.pattern = [];
    if (data.progress) {
      this.progress = data.progress;
    }
    this.dailyReward = data.reward ?? null;
  }

  private drawLoading(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.resize(width, height);
    this.drawGameBackdrop(width, height);
    this.drawTileTitle(width / 2, 46, width < 760);

    this.add
      .text(width / 2, Math.max(118, height * 0.3), this.currentStatus, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '18px',
        color: '#25313b',
        align: 'center',
        wordWrap: { width: Math.min(520, width - 32) },
      })
      .setOrigin(0.5);
  }

  private drawGame(): void {
    if (!this.session) {
      this.screen = 'loading';
      this.currentStatus = 'Loading daily puzzle...';
      this.renderScreen();
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const mobile = width < 760;
    this.cameras.resize(width, height);
    this.drawGameBackdrop(width, height);

    this.drawTileTitle(width / 2, mobile ? 38 : 36, mobile);

    this.layoutBoard(mobile);
    this.createTiles();

    this.drawStatsHud(mobile);
    this.drawGameToolbar(mobile);

    this.add
      .text(width / 2, mobile ? height - 116 : height - 42, '', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: mobile ? '13px' : '15px',
        color: '#25313b',
        align: 'center',
        wordWrap: { width: Math.min(560, width - 28) },
      })
      .setName('game-status')
      .setOrigin(0.5);

    this.redrawGame();
    this.setGameStatus(this.currentStatus);

    if (this.modal === 'clues') {
      this.drawClueModal();
    } else if (this.modal === 'result') {
      this.drawResultModal();
    }
  }

  private layoutBoard(mobile: boolean): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const headerReserve = mobile ? 138 : 144;
    const footerReserve = mobile ? 136 : 108;
    let rawBoardSize: number;

    if (mobile) {
      rawBoardSize = Math.max(
        245,
        Math.min(width - 28, height - headerReserve - footerReserve, 360)
      );
      this.boardSize = snapBoardSize(rawBoardSize);
      this.boardX = Math.round((width - this.boardSize) / 2);
      this.boardY = Math.round(
        Math.max(headerReserve, (height - this.boardSize) / 2 - 8)
      );
    } else {
      rawBoardSize = Math.max(
        340,
        Math.min(width - 170, height - headerReserve - footerReserve, 500)
      );
      this.boardSize = snapBoardSize(rawBoardSize);
      this.boardX = Math.round((width - this.boardSize) / 2);
      this.boardY = Math.round(
        Math.max(headerReserve, (height - this.boardSize) / 2 + 2)
      );
    }

    this.tileSize = this.boardSize / BOARD_DIMENSION;
  }

  private drawGameBackdrop(width: number, height: number): void {
    const graphics = this.add.graphics();
    graphics.fillGradientStyle(0xfff1b8, 0xc8f4ff, 0xd5ffc7, 0xffc7e7, 1);
    graphics.fillRect(0, 0, width, height);

    const tile = Math.max(34, Math.min(58, Math.floor(width / 15)));
    const gap = 8;
    const startX = -tile;
    const startY = -tile;
    const colors = [
      COLORS.paper,
      COLORS.paper,
      COLORS.paper,
      COLORS.blue,
      COLORS.orange,
      COLORS.red,
    ];

    for (let y = startY; y < height + tile; y += tile + gap) {
      for (let x = startX; x < width + tile; x += tile + gap) {
        const value =
          Math.abs(Math.floor(x / 13) + Math.floor(y / 17)) % colors.length;
        const color = colors[value] ?? COLORS.paper;
        const alpha = color === COLORS.paper ? 0.3 : 0.2;

        graphics.fillStyle(color, alpha);
        graphics.fillRoundedRect(x, y, tile, tile, 7);
        graphics.lineStyle(1, COLORS.line, 0.08);
        graphics.strokeRoundedRect(x, y, tile, tile, 7);
      }
    }
  }

  private drawTileTitle(x: number, y: number, mobile: boolean): void {
    const letters = ['T', 'I', 'L', 'E', 'W', 'A', 'R', 'S'];
    const colors = [
      COLORS.green,
      COLORS.red,
      COLORS.blue,
      COLORS.orange,
      COLORS.blue,
      COLORS.orange,
      COLORS.green,
      COLORS.red,
    ];
    const size = mobile ? 31 : 38;
    const gap = mobile ? 4 : 6;
    const totalWidth = letters.length * size + (letters.length - 1) * gap;
    const left = x - totalWidth / 2;
    const graphics = this.add.graphics();

    letters.forEach((letter, index) => {
      const tileX = left + index * (size + gap);
      const color = colors[index] ?? COLORS.green;
      graphics.fillStyle(COLORS.shadow, 0.2);
      graphics.fillRoundedRect(tileX + 3, y - size / 2 + 4, size, size, 6);
      graphics.fillStyle(color, 1);
      graphics.fillRoundedRect(tileX, y - size / 2, size, size, 6);
      graphics.lineStyle(2, COLORS.line, 0.72);
      graphics.strokeRoundedRect(tileX, y - size / 2, size, size, 6);

      this.add
        .text(tileX + size / 2, y, letter, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: `${Math.floor(size * 0.58)}px`,
          color: '#ffffff',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0.5);
    });
  }

  private drawStatsHud(mobile: boolean): void {
    if (!this.session) {
      return;
    }

    const remaining =
      this.session.totalTiles > 0
        ? Math.max(0, this.session.totalTiles - this.session.foundKeys.length)
        : getRemainingCount(this.pattern, this.session.foundKeys);
    const totalTiles =
      this.session.totalTiles || this.pattern.length || Math.max(remaining, 1);
    const foundTiles = Math.max(0, totalTiles - remaining);
    this.drawScoreStrip(
      this.boardX + this.boardSize / 2,
      mobile ? 86 : 88,
      totalTiles,
      foundTiles,
      this.session.guesses.length,
      mobile
    );
  }

  private drawScoreStrip(
    x: number,
    y: number,
    totalTiles: number,
    foundTiles: number,
    guesses: number,
    mobile: boolean
  ): void {
    const count = Math.max(1, Math.min(8, totalTiles));
    const tileSize = mobile ? 19 : 21;
    const gap = mobile ? 4 : 5;
    const guessSize = mobile ? 30 : 34;
    const stripWidth = Math.min(this.boardSize, mobile ? 340 : 400);
    const left = x - stripWidth / 2;
    const right = x + stripWidth / 2;
    const progressLeft = left + (mobile ? 2 : 4);
    const guessX = right - guessSize / 2 - (mobile ? 2 : 4);
    const tileY = y + 13;
    const graphics = this.add.graphics();

    this.add
      .text(progressLeft, y - 13, 'TILES FOUND', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: mobile ? '10px' : '11px',
        color: '#25313b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0, 0.5);

    this.add
      .text(guessX, y - 13, 'GUESSES', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: mobile ? '9px' : '10px',
        color: '#25313b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);

    for (let index = 0; index < count; index += 1) {
      const tileX = progressLeft + index * (tileSize + gap);
      const lit = index < foundTiles;

      graphics.fillStyle(COLORS.shadow, lit ? 0.22 : 0.1);
      graphics.fillRoundedRect(
        tileX + 2,
        tileY - tileSize / 2 + 3,
        tileSize,
        tileSize,
        5
      );
      graphics.fillStyle(lit ? COLORS.green : COLORS.paper, lit ? 1 : 0.8);
      graphics.fillRoundedRect(
        tileX,
        tileY - tileSize / 2,
        tileSize,
        tileSize,
        5
      );
      graphics.lineStyle(2, COLORS.line, lit ? 0.76 : 0.36);
      graphics.strokeRoundedRect(
        tileX,
        tileY - tileSize / 2,
        tileSize,
        tileSize,
        5
      );

    }

    const guessTileX = guessX - guessSize / 2;
    const guessTileY = tileY - guessSize / 2;

    graphics.fillStyle(COLORS.shadow, 0.24);
    graphics.fillRoundedRect(
      guessTileX + 4,
      guessTileY + 5,
      guessSize,
      guessSize,
      8
    );
    graphics.fillStyle(COLORS.blue, 1);
    graphics.fillRoundedRect(guessTileX, guessTileY, guessSize, guessSize, 8);
    graphics.lineStyle(3, COLORS.line, 0.84);
    graphics.strokeRoundedRect(guessTileX, guessTileY, guessSize, guessSize, 8);

    this.add
      .text(guessX, tileY + 1, guesses.toString(), {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: guesses > 99 ? '15px' : mobile ? '18px' : '20px',
        color: '#ffffff',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);
  }

  private drawGameToolbar(mobile: boolean): void {
    const width = this.scale.width;
    const height = this.scale.height;

    if (mobile) {
      const y = height - 58;
      this.createButton(
        width / 2 - 118,
        y,
        'Home',
        () => {
          this.openHomeScreen();
        },
        'orange'
      );
      this.createButton(
        width / 2,
        y,
        '? Clues',
        () => {
          this.modal = 'clues';
          this.renderScreen();
        },
        'blue'
      );
      this.createButton(
        width / 2 + 118,
        y,
        `X ${this.markerMode ? 'On' : 'Off'}`,
        () => {
          this.markerMode = !this.markerMode;
          this.currentStatus = this.markerMode
            ? 'Tap tiles to mark X notes.'
            : 'Tap tiles to guess.';
          this.renderScreen();
        },
        'dark'
      ).setName('marker-button');
      return;
    }

    const y = height - 82;
    this.createButton(
      width / 2 - 158,
      y,
      'Home',
      () => {
        this.openHomeScreen();
      },
      'orange'
    );
    this.createButton(
      width / 2,
      y,
      '? Clues',
      () => {
        this.modal = 'clues';
        this.renderScreen();
      },
      'blue'
    );
    this.createButton(
      width / 2 + 158,
      y,
      this.markerMode ? 'X on' : 'X off',
      () => {
        this.markerMode = !this.markerMode;
        this.currentStatus = this.markerMode
          ? 'Tap tiles to mark X notes.'
          : 'Tap tiles to guess.';
        this.renderScreen();
      },
      'dark'
    ).setName('marker-button');
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
            color: '#25313b',
            resolution: TEXT_RESOLUTION,
          })
          .setOrigin(0.5);
        const zone = this.add
          .zone(0, 0, 10, 10)
          .setOrigin(0)
          .setInteractive({ useHandCursor: true });

        zone.on('pointerdown', () => {
          this.handleTile(coord);
        });
        zone.on('pointerover', () => {
          this.input.setDefaultCursor('pointer');
          this.tweens.add({
            targets: [graphics, label, marker],
            alpha: 0.88,
            duration: 110,
            ease: 'Sine.easeOut',
          });
        });
        zone.on('pointerout', () => {
          this.input.setDefaultCursor('default');
          this.tweens.add({
            targets: [graphics, label, marker],
            alpha: 1,
            duration: 110,
            ease: 'Sine.easeOut',
          });
        });
        this.trackInteractive(zone);

        this.tileViews.push({ coord, graphics, label, marker, zone });
      }
    }
  }

  private drawResultModal(): void {
    if (!this.session) {
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const mobile = width < 760;
    const modalWidth = Math.min(width - 28, mobile ? 370 : 440);
    const modalHeight = Math.min(height - 42, mobile ? 426 : 398);
    const x = (width - modalWidth) / 2;
    const y = (height - modalHeight) / 2;
    const blocker = this.add
      .zone(0, 0, width, height)
      .setOrigin(0)
      .setInteractive({ useHandCursor: false });
    const overlay = this.add.graphics();
    const panel = this.add.graphics();
    const elapsed = formatElapsedTime(
      (this.session.solvedAt ?? Date.now()) - this.session.startedAt
    );
    const saveStatus =
      this.currentStatus === 'Result commented.' ||
      this.currentStatus === 'Could not comment result.'
        ? this.currentStatus
        : this.session.puzzleId.mode === 'daily'
          ? 'Daily result saved'
          : 'Practice result';
    const progressionStatus = this.dailyReward
      ? `${saveStatus} · +${this.dailyReward.amount} XP`
      : this.progress
        ? `Level ${this.progress.level} · ${this.progress.levelXp}/${this.progress.xpForNextLevel} XP`
        : saveStatus;

    blocker.on('pointerdown', () => undefined);
    this.trackInteractive(blocker);

    overlay.fillStyle(0x111820, 0.42);
    overlay.fillRect(0, 0, width, height);
    panel.fillStyle(COLORS.shadow, 0.24);
    panel.fillRoundedRect(x + 8, y + 10, modalWidth, modalHeight, 10);
    panel.fillStyle(COLORS.panel, 1);
    panel.fillRoundedRect(x, y, modalWidth, modalHeight, 10);
    panel.lineStyle(3, COLORS.line, 0.95);
    panel.strokeRoundedRect(x, y, modalWidth, modalHeight, 10);

    this.add
      .text(width / 2, y + 42, 'Pattern complete', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: mobile ? '24px' : '28px',
        color: '#18212b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        y + 72,
        `${this.session.puzzleId.date} · ${
          this.playerRank ? `Rank #${this.playerRank.rank}` : saveStatus
        }`,
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '12px',
          color: '#667380',
          resolution: TEXT_RESOLUTION,
        }
      )
      .setOrigin(0.5);

    const statY = y + 121;
    this.drawResultMetric(
      width / 2 - modalWidth * 0.2,
      statY,
      'Guesses',
      this.session.guesses.length.toString()
    );
    this.drawResultMetric(width / 2 + modalWidth * 0.2, statY, 'Time', elapsed);

    this.add
      .text(width / 2, y + 172, progressionStatus, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '13px',
        color: '#53606b',
        align: 'center',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);

    if (this.progress) {
      this.drawResultProgressBar(x + 24, y + 188, modalWidth - 48);
    }

    this.drawResultLeaderboard(
      x + 24,
      y + (this.progress ? 216 : 198),
      modalWidth - 48
    );

    this.createButton(
      width / 2 - 76,
      y + modalHeight - 34,
      'Close',
      () => {
        this.modal = 'none';
        this.renderScreen();
      },
      'dark'
    );
    this.createButton(
      width / 2 + 76,
      y + modalHeight - 34,
      'Comment',
      () => {
        void this.commentResult();
      },
      'green'
    );

    if (this.dailyReward) {
      void this.acknowledgeDailyReward(this.dailyReward.rewardId);
    }
  }

  private drawResultMetric(
    x: number,
    y: number,
    label: string,
    value: string
  ): void {
    this.add
      .text(x, y - 15, label, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '12px',
        color: '#667380',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);
    this.add
      .text(x, y + 10, value, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '24px',
        color: '#18212b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);
  }

  private drawResultLeaderboard(x: number, y: number, width: number): void {
    const graphics = this.add.graphics();
    const entries = this.leaderboard.slice(0, 3);

    this.add
      .text(x, y, 'Daily leaders', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '13px',
        color: '#25313b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0, 0.5);

    if (entries.length === 0) {
      this.add
        .text(x, y + 34, 'Leaderboard appears after Reddit playtest saves.', {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '12px',
          color: '#667380',
          wordWrap: { width },
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0, 0.5);
      return;
    }

    entries.forEach((entry, index) => {
      const rowY = y + 28 + index * 36;
      graphics.fillStyle(0xffffff, 0.62);
      graphics.fillRoundedRect(x, rowY - 15, width, 30, 7);
      graphics.lineStyle(1, COLORS.line, 0.14);
      graphics.strokeRoundedRect(x, rowY - 15, width, 30, 7);
      graphics.fillStyle(COLORS.green, 1);
      graphics.fillRoundedRect(x + 8, rowY - 11, 22, 22, 5);

      this.add
        .text(x + 19, rowY, entry.rank.toString(), {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '12px',
          color: '#ffffff',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0.5);
      this.add
        .text(x + 40, rowY, entry.displayName, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '12px',
          color: '#25313b',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0, 0.5);
      this.add
        .text(x + width - 10, rowY, `${entry.guesses} guesses`, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '11px',
          color: '#667380',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(1, 0.5);
    });
  }

  private drawClueModal(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const modalWidth = Math.min(width - 32, 390);
    const modalHeight = Math.min(height - 44, 350);
    const x = (width - modalWidth) / 2;
    const y = (height - modalHeight) / 2;
    const blocker = this.add
      .zone(0, 0, width, height)
      .setOrigin(0)
      .setInteractive({ useHandCursor: false });
    const overlay = this.add.graphics();
    const panel = this.add.graphics();

    blocker.on('pointerdown', () => undefined);
    this.trackInteractive(blocker);

    overlay.fillStyle(0x111820, 0.44);
    overlay.fillRect(0, 0, width, height);
    panel.fillStyle(COLORS.shadow, 0.24);
    panel.fillRoundedRect(x + 8, y + 10, modalWidth, modalHeight, 8);
    panel.fillStyle(COLORS.panel, 1);
    panel.fillRoundedRect(x, y, modalWidth, modalHeight, 8);
    panel.lineStyle(3, COLORS.line, 1);
    panel.strokeRoundedRect(x, y, modalWidth, modalHeight, 8);

    this.add
      .text(width / 2, y + 30, 'Clue Tiles', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '23px',
        color: '#18212b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);

    const rows = [
      {
        label: 'Green - Pattern tile',
        clue: { green: true, red: 0, blue: 0, orange: 0 },
        marker: false,
      },
      {
        label: 'Red vertical · Same column',
        clue: { green: false, red: 1, blue: 0, orange: 0 },
        marker: false,
      },
      {
        label: 'Blue horizontal · Same row',
        clue: { green: false, red: 0, blue: 1, orange: 0 },
        marker: false,
      },
      {
        label: 'Orange X · Diagonal',
        clue: { green: false, red: 0, blue: 0, orange: 1 },
        marker: false,
      },
      {
        label: 'Mark as no-guess',
        clue: { green: false, red: 0, blue: 0, orange: 0 },
        marker: true,
      },
    ] satisfies {
      label: string;
      clue: StoredGuess['clue'];
      marker: boolean;
    }[];

    rows.forEach((row, index) => {
      const rowY = y + 76 + index * 42;
      this.drawClueSample(x + 42, rowY, 28, row.clue, row.marker);
      this.add
        .text(x + 80, rowY, row.label, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '16px',
          color: '#25313b',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0, 0.5);
    });

    this.createButton(width / 2, y + modalHeight - 34, 'Close', () => {
      this.modal = 'none';
      this.renderScreen();
    });
  }

  private drawResultProgressBar(x: number, y: number, width: number): void {
    if (!this.progress) {
      return;
    }
    const ratio = Math.min(
      1,
      this.progress.levelXp / this.progress.xpForNextLevel
    );
    const background = this.add.graphics();
    background.fillStyle(0xd8d0c5, 1);
    background.fillRoundedRect(x, y, width, 12, 6);
    const fill = this.add
      .rectangle(x, y + 6, width * ratio, 10, 0x43c978)
      .setOrigin(0, 0.5)
      .setScale(0, 1);
    this.tweens.add({
      targets: fill,
      scaleX: 1,
      duration: 650,
      ease: 'Sine.easeOut',
    });
  }

  private async acknowledgeDailyReward(rewardId: string): Promise<void> {
    if (this.acknowledgedRewardIds.has(rewardId)) {
      return;
    }
    this.acknowledgedRewardIds.add(rewardId);
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    try {
      const response = await fetch('/api/progress/rewards/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardIds: [rewardId] }),
      });
      if (!response.ok) {
        this.acknowledgedRewardIds.delete(rewardId);
      }
    } catch {
      this.acknowledgedRewardIds.delete(rewardId);
    }
  }

  private drawClueSample(
    x: number,
    y: number,
    size: number,
    clue: StoredGuess['clue'],
    marker: boolean
  ): void {
    const graphics = this.add.graphics();
    const radius = 6;

    graphics.fillStyle(clue.green ? COLORS.green : COLORS.paper, 1);
    graphics.fillRoundedRect(x - size / 2, y - size / 2, size, size, radius);
    this.drawCluePattern(
      graphics,
      x - size / 2,
      y - size / 2,
      size,
      radius,
      clue
    );
    graphics.lineStyle(2, COLORS.line, 0.85);
    graphics.strokeRoundedRect(x - size / 2, y - size / 2, size, size, radius);
    if (marker) {
      this.add
        .text(x, y, 'X', {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '21px',
          color: '#25313b',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0.5)
        .setAngle(0);
    }
  }

  private showSolvedPatternReveal(): void {
    this.modal = 'none';
    this.showingSolvedReveal = true;
    this.currentStatus = 'Pattern complete!';
    this.renderScreen();

    this.time.delayedCall(1550, () => {
      if (!this.session?.solved || !this.showingSolvedReveal) {
        return;
      }

      this.showingSolvedReveal = false;
      this.modal = 'result';
      this.renderScreen();
    });
  }

  private createButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    variant: ButtonVariant = 'dark'
  ): GameObjects.Text {
    const backgroundColor = this.buttonColor(variant);
    const hoverColor = this.buttonHoverColor(variant);
    const button = this.add
      .text(x, y, label, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '15px',
        color: '#ffffff',
        backgroundColor,
        padding: { left: 13, right: 13, top: 9, bottom: 9 },
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    button.on('pointerover', () => {
      button.setStyle({ backgroundColor: hoverColor });
      this.tweens.add({
        targets: button,
        y: y - 2,
        duration: 90,
        ease: 'Sine.easeOut',
      });
    });
    button.on('pointerout', () => {
      button.setStyle({ backgroundColor });
      this.tweens.add({
        targets: button,
        y,
        duration: 90,
        ease: 'Sine.easeOut',
      });
    });
    button.on('pointerdown', () => {
      this.tweens.add({
        targets: button,
        scaleX: 0.94,
        scaleY: 0.94,
        yoyo: true,
        duration: 80,
        ease: 'Sine.easeInOut',
      });
      onClick();
    });
    this.trackInteractive(button);
    return button;
  }

  private buttonColor(variant: ButtonVariant): string {
    const colors: Record<ButtonVariant, string> = {
      dark: '#25313b',
      blue: '#2577ff',
      green: '#16a66a',
      orange: '#f28d13',
      red: '#df4758',
    };

    return colors[variant];
  }

  private buttonHoverColor(variant: ButtonVariant): string {
    const colors: Record<ButtonVariant, string> = {
      dark: '#354555',
      blue: '#339dff',
      green: '#27bf7d',
      orange: '#ffad2d',
      red: '#ff5365',
    };

    return colors[variant];
  }

  private openHomeScreen(): void {
    try {
      window.open('splash.html', '_self');
    } catch {
      // Static previews and embedded contexts may block same-frame navigation.
    }
  }

  private async commentResult(): Promise<void> {
    if (!this.session) {
      return;
    }

    try {
      const response = await fetch('/api/daily/comment-result', {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`Comment failed: ${response.status}`);
      }
      this.currentStatus = 'Result commented.';
    } catch {
      this.currentStatus = 'Could not comment result.';
    }
    this.renderScreen();
  }

  private handleTile(coord: Coord): void {
    if (!this.session || this.dailyUpdateInFlight) {
      return;
    }

    const key = coordKey(coord);

    if (this.markerMode) {
      void this.toggleActiveMarker(coord);
      return;
    }

    if (this.session.guesses.some((guess) => coordKey(guess.coord) === key)) {
      return;
    }

    void this.submitActiveGuess(coord);
  }

  private async submitActiveGuess(coord: Coord): Promise<void> {
    if (!this.session) {
      return;
    }

    if (this.session.puzzleId.mode === 'daily' && this.pattern.length === 0) {
      const key = coordKey(coord);
      this.pendingTileKey = key;
      this.lastGuessKey = key;
      this.currentStatus = 'Checking tile...';
      this.redrawGame();
      this.setGameStatus(this.currentStatus);
      await this.postDailyUpdate('/api/daily/guess', { coord });
      return;
    }

    this.session = applyGuessToSession(this.session, this.pattern, coord);
    this.lastGuessKey = coordKey(coord);
    this.currentStatus = this.session.solved
      ? `Solved in ${this.session.guesses.length} guesses.`
      : this.session.guesses.at(-1)?.wasGreen
        ? 'Pattern tile found.'
        : 'Clue added.';
    if (this.session.solved) {
      this.showSolvedPatternReveal();
      return;
    }
    this.renderScreen();
  }

  private async toggleActiveMarker(coord: Coord): Promise<void> {
    if (!this.session || this.dailyUpdateInFlight) {
      return;
    }

    if (this.session.puzzleId.mode === 'daily' && this.pattern.length === 0) {
      await this.postDailyUpdate('/api/daily/mark', { coord });
      return;
    }

    this.session = toggleMarkerInSession(this.session, coord);
    this.currentStatus = 'X mark updated.';
    this.lastGuessKey = coordKey(coord);
    this.renderScreen();
  }

  private async postDailyUpdate(
    url: string,
    body: Record<string, unknown>
  ): Promise<void> {
    this.dailyUpdateInFlight = true;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`Daily update failed: ${response.status}`);
      }

      const data = toDailySessionResponse(await response.json());
      if (!data) {
        throw new Error('Daily update response was invalid.');
      }
      this.applyDailyResponse(data);
      if (url.endsWith('/guess')) {
        const lastGuess = data.session.guesses.at(-1);
        this.lastGuessKey = lastGuess ? coordKey(lastGuess.coord) : null;
      }
      this.currentStatus = data.session.solved
        ? `Solved in ${data.session.guesses.length} guesses.`
        : 'Daily progress saved.';
      if (data.session.solved) {
        this.pendingTileKey = null;
        this.showSolvedPatternReveal();
        return;
      }
      this.pendingTileKey = null;
      this.renderScreen();
    } catch (error) {
      console.error('Daily update failed:', error);
      this.currentStatus = 'Could not save daily progress. Try again.';
      this.pendingTileKey = null;
      this.renderScreen();
    } finally {
      this.dailyUpdateInFlight = false;
    }
  }

  private redrawGame(): void {
    if (!this.session) {
      return;
    }

    const guesses = this.guessMap();
    for (const view of this.tileViews) {
      this.drawTile(view, guesses);
    }
    this.lastGuessKey = null;
  }

  private guessMap(): Map<string, StoredGuess> {
    const guesses = new Map<string, StoredGuess>();
    if (!this.session) {
      return guesses;
    }

    for (const guess of this.session.guesses) {
      guesses.set(coordKey(guess.coord), {
        coord: guess.coord,
        clue: guess.clue,
      });
    }

    return guesses;
  }

  private drawTile(view: TileView, guesses: Map<string, StoredGuess>): void {
    if (!this.session) {
      return;
    }

    const key = coordKey(view.coord);
    const x = this.boardX + view.coord.col * this.tileSize;
    const y = this.boardY + view.coord.row * this.tileSize;
    const gap = Math.max(5, this.tileSize * 0.06);
    const size = this.tileSize - gap;
    const radius = Math.max(5, this.tileSize * 0.08);
    const guess = guesses.get(key);
    const pending = key === this.pendingTileKey;
    const recentlyChanged = key === this.lastGuessKey;
    const graphics = view.graphics;
    const tileX = x + gap / 2;
    const tileY = y + gap / 2;
    const isMarked = this.session.markerKeys.includes(key);
    const isFound = this.session.foundKeys.includes(key);

    graphics.setPosition(0, 0);
    graphics.clear();
    graphics.fillStyle(COLORS.shadow, 0.14);
    graphics.fillRoundedRect(tileX + 3, tileY + 4, size, size, radius);

    if (this.showingSolvedReveal) {
      graphics.fillStyle(isFound ? COLORS.green : COLORS.paper, 1);
      graphics.fillRoundedRect(tileX, tileY, size, size, radius);
      graphics.lineStyle(2, COLORS.line, 0.85);
      graphics.strokeRoundedRect(tileX, tileY, size, size, radius);
    } else if (pending && !guess) {
      graphics.fillStyle(COLORS.pending, 1);
      graphics.fillRoundedRect(tileX, tileY, size, size, radius);
      graphics.lineStyle(3, COLORS.orange, 0.85);
      graphics.strokeRoundedRect(tileX, tileY, size, size, radius);
    } else if (guess?.clue.green) {
      graphics.fillStyle(COLORS.green, 1);
      graphics.fillRoundedRect(tileX, tileY, size, size, radius);
    } else if (guess) {
      graphics.fillStyle(COLORS.paper, 1);
      graphics.fillRoundedRect(tileX, tileY, size, size, radius);
      this.drawCluePattern(
        graphics,
        tileX,
        tileY,
        size,
        radius,
        guess.clue
      );
    } else {
      graphics.fillStyle(COLORS.paper, 1);
      graphics.fillRoundedRect(tileX, tileY, size, size, radius);
    }

    if ((!pending || guess) && !this.showingSolvedReveal) {
      graphics.lineStyle(2, COLORS.line, 1);
      graphics.strokeRoundedRect(tileX, tileY, size, size, radius);
    }

    view.label.setPosition(x + this.tileSize / 2, y + this.tileSize / 2);
    view.label.setFontSize(Math.max(12, Math.floor(this.tileSize * 0.19)));
    view.label.setColor(guess?.clue.green ? '#0b2818' : '#18212b');
    view.label.setVisible(false);

    view.marker.setPosition(x + this.tileSize / 2, y + this.tileSize / 2);
    view.marker.setFontSize(Math.max(24, Math.floor(this.tileSize * 0.5)));
    view.marker.setVisible(!this.showingSolvedReveal && isMarked);
    view.marker.setAngle(0);
    view.marker.setScale(1);
    view.marker.setAlpha(1);

    view.zone.setPosition(x + gap / 2, y + gap / 2);
    view.zone.setSize(size, size);

    if (pending && !guess) {
      this.animatePendingTile(view);
    } else if (recentlyChanged && guess) {
      this.animateTileReveal(view, Boolean(guess?.clue.green));
    }

    if (recentlyChanged && isMarked) {
      this.animateXMark(view);
    }

    if (this.showingSolvedReveal && isFound) {
      this.animateSolvedTile(view);
    }
  }

  private animatePendingTile(view: TileView): void {
    const targets = [view.graphics, view.label, view.marker];
    this.tweens.add({
      targets,
      x: '+=4',
      y: '-=2',
      yoyo: true,
      repeat: 3,
      duration: 85,
      ease: 'Sine.easeInOut',
    });
  }

  private animateTileReveal(view: TileView, found: boolean): void {
    this.tweens.add({
      targets: view.graphics,
      y: { from: found ? 6 : 3, to: 0 },
      alpha: { from: 0.7, to: 1 },
      duration: found ? 300 : 190,
      ease: found ? 'Back.easeOut' : 'Sine.easeOut',
    });

    if (found) {
      this.tweens.add({
        targets: view.graphics,
        alpha: { from: 0.82, to: 1 },
        yoyo: true,
        repeat: 1,
        delay: 140,
        duration: 190,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private animateSolvedTile(view: TileView): void {
    const delay = (view.coord.row + view.coord.col) * 60;
    this.tweens.add({
      targets: view.graphics,
      y: { from: 5, to: 0 },
      alpha: { from: 0.62, to: 1 },
      delay,
      duration: 300,
      ease: 'Back.easeOut',
    });
  }

  private drawCluePattern(
    graphics: GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    radius: number,
    clue: StoredGuess['clue']
  ): void {
    if (clue.green) {
      graphics.fillStyle(COLORS.green, 1);
      graphics.fillRoundedRect(x, y, size, size, radius);
      return;
    }

    const hasRed = clue.red > 0;
    const hasBlue = clue.blue > 0;
    const hasOrange = clue.orange > 0;
    const clueCount = Number(hasRed) + Number(hasBlue) + Number(hasOrange);

    if (clueCount === 0) {
      graphics.fillStyle(COLORS.paper, 1);
      graphics.fillRoundedRect(x, y, size, size, radius);
      return;
    }

    const colorNames = this.clueColorNames(clue);
    const clueColors = colorNames.map((color) => COLORS[color]);

    graphics.fillStyle(clueColors[0] ?? COLORS.paper, 1);
    graphics.fillRoundedRect(x, y, size, size, radius);

    const segmentSize = size / clueColors.length;
    for (let index = 1; index < clueColors.length; index += 1) {
      const isLastSegment = index === clueColors.length - 1;
      graphics.fillStyle(clueColors[index] ?? COLORS.paper, 1);

      const segmentX = x + segmentSize * index;
      if (isLastSegment) {
        const remainingWidth = size - segmentSize * index;
        graphics.fillRoundedRect(
          segmentX,
          y,
          remainingWidth,
          size,
          radius
        );
        graphics.fillRect(
          segmentX,
          y,
          Math.min(radius, remainingWidth),
          size
        );
      } else {
        graphics.fillRect(segmentX, y, segmentSize, size);
      }
    }
  }

  private animateXMark(view: TileView): void {
    view.marker.setScale(0.2);
    view.marker.setAlpha(0);
    view.marker.setAngle(0);
    this.tweens.add({
      targets: view.marker,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 260,
      ease: 'Back.easeOut',
    });
  }

  private clueColorNames(clue: StoredGuess['clue']): ColorName[] {
    const colors: ColorName[] = [];
    if (clue.red > 0) {
      colors.push('red');
    }
    if (clue.blue > 0) {
      colors.push('blue');
    }
    if (clue.orange > 0) {
      colors.push('orange');
    }
    return colors;
  }

  private setGameStatus(message: string): void {
    const status = this.children.getByName('game-status');
    if (status instanceof GameObjects.Text) {
      status.setText(message);
    }
  }
}

const toDailySessionResponse = (
  value: unknown
): DailySessionResponse | null => {
  if (!isRecord(value) || value.type !== 'daily-session') {
    return null;
  }

  if (!isPlayerSession(value.session)) {
    return null;
  }

  if (
    value.playerRank !== null &&
    value.playerRank !== undefined &&
    !isLeaderboardEntry(value.playerRank)
  ) {
    return null;
  }

  const leaderboard: LeaderboardEntry[] = [];
  if (Array.isArray(value.leaderboard)) {
    for (const entry of value.leaderboard) {
      if (!isLeaderboardEntry(entry)) {
        return null;
      }
      leaderboard.push(entry);
    }
  }

  const response: DailySessionResponse = {
    type: 'daily-session',
    session: value.session,
  };

  if (Array.isArray(value.leaderboard)) {
    response.leaderboard = leaderboard;
  }
  if (value.playerRank !== undefined) {
    response.playerRank = value.playerRank;
  }
  if (isProgressSummary(value.progress)) {
    response.progress = value.progress;
  }
  if (isProgressReward(value.reward)) {
    response.reward = value.reward;
  }

  return response;
};

const isProgressSummary = (
  value: unknown
): value is PlayerProgressSummary => {
  return (
    isRecord(value) &&
    typeof value.totalXp === 'number' &&
    typeof value.dailyStreak === 'number' &&
    typeof value.level === 'number' &&
    typeof value.levelXp === 'number' &&
    typeof value.xpForNextLevel === 'number' &&
    isRecord(value.versus) &&
    typeof value.versus.wins === 'number' &&
    typeof value.versus.losses === 'number' &&
    typeof value.versus.draws === 'number'
  );
};

const isProgressReward = (value: unknown): value is ProgressReward => {
  return (
    isRecord(value) &&
    typeof value.rewardId === 'string' &&
    (value.source === 'daily' || value.source === 'versus') &&
    typeof value.amount === 'number' &&
    typeof value.label === 'string' &&
    typeof value.previousTotalXp === 'number' &&
    typeof value.newTotalXp === 'number' &&
    typeof value.createdAt === 'number'
  );
};

const isPlayerSession = (value: unknown): value is PlayerSession => {
  return (
    isRecord(value) &&
    isRecord(value.puzzleId) &&
    Array.isArray(value.guesses) &&
    Array.isArray(value.foundKeys) &&
    Array.isArray(value.markerKeys) &&
    typeof value.clueMode === 'string' &&
    typeof value.totalTiles === 'number' &&
    typeof value.solved === 'boolean' &&
    typeof value.startedAt === 'number'
  );
};

const isLeaderboardEntry = (value: unknown): value is LeaderboardEntry => {
  return (
    isRecord(value) &&
    typeof value.rank === 'number' &&
    typeof value.displayName === 'string' &&
    typeof value.guesses === 'number' &&
    typeof value.solvedAt === 'number'
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const snapBoardSize = (size: number): number => {
  return Math.floor(size / BOARD_DIMENSION) * BOARD_DIMENSION;
};

const formatElapsedTime = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
