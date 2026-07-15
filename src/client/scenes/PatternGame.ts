import { GameObjects, Input, Scene } from 'phaser';
import { exitExpandedMode } from '@devvit/web/client';
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
  leaderboardRankColor,
  toggleMarkerInSession,
  selectLeaderboardDisplayRows,
} from '../../shared/game';
import {
  SerializedMarkerQueue,
  replayPendingMarkerOperations,
} from '../../shared/markerSync';
import type {
  PlayerProgressSummary,
  ProgressReward,
} from '../../shared/progression';
import {
  DAILY_BASE_XP,
  buildXpAnimationSegments,
  dailyXpForStreak,
  summarizeProgress,
} from '../../shared/progression';
import { formatDuration, formatOptionalDuration } from '../../shared/time';
import {
  TILE_WARS_COLORS,
  clearSceneContent,
  drawTileWarsLoadingMessage,
  ensureTileWarsSceneShell,
  type TileWarsSceneShell,
  type TileButtonVariant,
  drawGameplayStatsHud,
  drawHeaderChip,
  drawHowToPlayModal,
  drawTileButton,
} from './tileWarsTheme';

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
type ButtonVariant = TileButtonVariant;

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
  private lastPlayer: LeaderboardEntry | null = null;
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
  private confirmedSession: PlayerSession | null = null;
  private markerQueue = new SerializedMarkerQueue();
  private progress: PlayerProgressSummary | null = null;
  private dailyReward: ProgressReward | null = null;
  private acknowledgedRewardIds = new Set<string>();
  private showingSolvedReveal = false;
  private sceneShell: TileWarsSceneShell | null = null;

  constructor() {
    super('PatternGame');
  }

  create(): void {
    this.sceneShell = null;
    this.markerQueue.reset();
    const sharedInviteId: unknown = this.registry.get('sharedInviteId');
    if (typeof sharedInviteId === 'string') {
      const acceptInvite = this.registry.get('acceptSharedInvite') === true;
      this.registry.remove('acceptSharedInvite');
      this.scene.start('VersusLobby', {
        inviteId: sharedInviteId,
        acceptInvite,
      });
      return;
    }
    const startMode: unknown = this.registry.get('startMode');
    this.registry.remove('startMode');
    if (startMode === 'versus') {
      this.scene.start('VersusLobby');
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
    this.clearInteractiveObjects();
    clearSceneContent(this, this.sceneShell);
    this.tileViews = [];

    const width = this.scale.width;
    const height = this.scale.height;
    const mobile = width < 760;
    const shortLandscape = width >= 600 && height < 500;
    const headingY =
      this.screen === 'loading' ? 46 : shortLandscape ? 24 : mobile ? 38 : 36;
    this.sceneShell = ensureTileWarsSceneShell(this, this.sceneShell, {
      width,
      height,
      headingY,
      mobile: mobile || shortLandscape,
      maxHeadingSize: mobile ? 31 : 38,
    });

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
      this.confirmedSession = data.session;
      if (data.session.solved && !data.reward) {
        await this.loadPendingDailyReward(data.session.puzzleId.date);
      }
      this.startGame(
        data.session.solved
          ? `Solved in ${data.session.guesses.length} guesses.`
          : 'Tap a tile to make your guess.',
        'none'
      );
    } catch (error) {
      console.warn('Falling back to local daily session:', error);
      const puzzleId = createDailyPuzzleId(todayUtcDate());
      this.pattern = dailyPatternForPuzzle(puzzleId);
      this.session = createInitialSession(puzzleId, this.pattern.length);
      this.confirmedSession = this.session;
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
    if (data.lastPlayer !== undefined) {
      this.lastPlayer = data.lastPlayer;
    }
    this.pattern = [];
    if (data.progress) {
      this.progress = data.progress;
    }
    this.dailyReward = data.reward ?? null;
  }

  private async loadPendingDailyReward(date: string): Promise<void> {
    try {
      const response = await fetch('/api/progress');
      if (!response.ok) {
        return;
      }
      const value: unknown = await response.json();
      if (!isRecord(value)) {
        return;
      }
      if (isProgressSummary(value.progress)) {
        this.progress = value.progress;
      }
      if (Array.isArray(value.pendingRewards)) {
        this.dailyReward =
          value.pendingRewards.find(
            (reward): reward is ProgressReward =>
              isProgressReward(reward) &&
              reward.rewardId === `daily:${date}`
          ) ?? null;
      }
    } catch {
      // The static preview and transient Reddit errors keep the final progress snapshot.
    }
  }

  private drawLoading(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.resize(width, height);
    drawTileWarsLoadingMessage(this, this.currentStatus);
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
    const shortLandscape = width >= 600 && height < 500;
    this.cameras.resize(width, height);
    this.drawDailyHeader(shortLandscape);

    this.layoutBoard(mobile, shortLandscape);
    this.createTiles();

    this.drawStatsHud(mobile, shortLandscape);
    this.drawGameToolbar(mobile, shortLandscape);

    this.add
      .text(
        width / 2,
        shortLandscape ? height - 65 : mobile ? height - 116 : height - 42,
        '',
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: mobile ? '13px' : '15px',
          color: '#25313b',
          align: 'center',
          wordWrap: { width: Math.min(560, width - 28) },
        }
      )
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

  private layoutBoard(mobile: boolean, shortLandscape: boolean): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const headerReserve = shortLandscape ? 178 : 224;
    const footerReserve = mobile ? 136 : 94;
    let rawBoardSize: number;

    if (shortLandscape) {
      rawBoardSize = Math.max(150, Math.min(width - 30, height - 210, 260));
      this.boardSize = snapBoardSize(rawBoardSize);
      this.boardX = Math.round((width - this.boardSize) / 2);
      this.boardY = 178;
    } else if (mobile) {
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

  private drawDailyHeader(shortLandscape: boolean): void {
    if (!this.session) {
      return;
    }
    const y = shortLandscape ? 56 : 72;
    drawHeaderChip(
      this,
      this.scale.width / 2,
      y,
      `Daily #${this.session.puzzleId.puzzleNumber}`,
      TILE_WARS_COLORS.blue,
      94,
      24
    );
  }

  private drawStatsHud(mobile: boolean, shortLandscape: boolean): void {
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
    const tileSize = shortLandscape ? 22 : mobile ? 28 : 32;
    const tileY =
      this.boardY - tileSize / 2 - (shortLandscape ? 10 : mobile ? 28 : 30);
    drawGameplayStatsHud(this, {
      centerX: this.boardX + this.boardSize / 2,
      labelY: tileY - tileSize / 2 - (shortLandscape ? 8 : 10),
      tileY,
      totalTiles,
      foundTiles,
      guesses: this.session.guesses.length,
      tileSize,
      gap: shortLandscape ? 3 : mobile ? 4 : 5,
      groupGap: shortLandscape ? 18 : mobile ? 24 : 34,
      stacked: true,
    });
  }

  private drawGameToolbar(mobile: boolean, shortLandscape: boolean): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const completedDaily = this.isCompletedDaily();

    if (mobile || shortLandscape) {
      const y = shortLandscape ? height - 24 : height - 58;
      this.createButton(
        width / 2 - (completedDaily ? 48 : 118),
        y,
        'Home',
        (pointer) => {
          this.openHomeScreen(pointer);
        },
        'orange'
      );
      this.createButton(
        width / 2 + (completedDaily ? 48 : 0),
        y,
        'Help',
        () => {
          this.modal = 'clues';
          this.renderScreen();
        },
        'blue'
      );
      if (completedDaily) {
        return;
      }
      this.createButton(
        width / 2 + 118,
        y,
        `X ${this.markerMode ? 'ON' : 'OFF'}`,
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
      width / 2 - (completedDaily ? 48 : 158),
      y,
      'Home',
      (pointer) => {
        this.openHomeScreen(pointer);
      },
      'orange'
    );
    this.createButton(
      width / 2 + (completedDaily ? 48 : 0),
      y,
      'Help',
      () => {
        this.modal = 'clues';
        this.renderScreen();
      },
      'blue'
    );
    if (completedDaily) {
      return;
    }
    this.createButton(
      width / 2 + 158,
      y,
      this.markerMode ? 'X ON' : 'X OFF',
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
    const shortLandscape = width >= 600 && height < 500;
    const modalWidth = Math.min(
      width - 24,
      shortLandscape ? 760 : mobile ? 380 : 460
    );
    const modalHeight = Math.min(
      height - 24,
      shortLandscape ? 520 : mobile ? 690 : 620
    );
    const x = (width - modalWidth) / 2;
    const y = (height - modalHeight) / 2;
    const blocker = this.add
      .zone(0, 0, width, height)
      .setOrigin(0)
      .setInteractive({ useHandCursor: false });
    const overlay = this.add.graphics();
    const panel = this.add.graphics();
    const elapsed = formatDuration(
      (this.session.solvedAt ?? Date.now()) - this.session.startedAt
    );
    const earnedXp =
      this.progress && this.dailyReward
        ? Math.max(0, this.progress.totalXp - this.dailyReward.previousTotalXp)
        : (this.dailyReward?.amount ??
          (this.progress ? dailyXpForStreak(this.progress.dailyStreak) : 0));
    const baseDailyXp = Math.min(DAILY_BASE_XP, earnedXp);
    const streakBonusXp = Math.max(0, earnedXp - baseDailyXp);
    const pendingReward =
      this.dailyReward &&
      !this.acknowledgedRewardIds.has(this.dailyReward.rewardId)
        ? this.dailyReward
        : null;
    const displayedProgress =
      this.progress && pendingReward
        ? summarizeProgress({
            ...this.progress,
            totalXp: pendingReward.previousTotalXp,
          })
        : this.progress;

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
      .text(width / 2, y + 32, 'Pattern Complete', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: mobile ? '24px' : '28px',
        color: '#18212b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        y + 59,
        `Daily #${this.session.puzzleId.puzzleNumber} · ${formatDailyDate(
          this.session.puzzleId.date
        )} · ${this.playerRank ? `Rank #${this.playerRank.rank}` : 'Rank —'}`,
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '12px',
          color: '#667380',
          resolution: TEXT_RESOLUTION,
        }
      )
      .setOrigin(0.5);

    const summaryCenter = shortLandscape ? x + modalWidth * 0.25 : width / 2;
    const summaryWidth = shortLandscape ? modalWidth * 0.46 : modalWidth;
    const statY = y + 111;
    this.drawResultMetric(
      summaryCenter - summaryWidth * 0.2,
      statY,
      'Guesses',
      this.session.guesses.length.toString()
    );
    this.drawResultMetric(
      summaryCenter + summaryWidth * 0.2,
      statY,
      'Time',
      elapsed
    );

    this.add
      .text(
        summaryCenter,
        y + 146,
        `🔥 ${this.progress?.dailyStreak ?? 0} day streak`,
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: mobile ? '13px' : '14px',
          color: '#d88416',
          resolution: TEXT_RESOLUTION,
        }
      )
      .setName('result-streak-label')
      .setOrigin(0.5);

    if (displayedProgress) {
      this.add
        .text(summaryCenter, y + 177, `Level ${displayedProgress.level}`, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '15px',
          color: '#25313b',
        })
        .setName('result-level-label')
        .setOrigin(0.5);
      this.add
        .text(
          summaryCenter,
          y + 199,
          `${displayedProgress.levelXp}/${displayedProgress.xpForNextLevel} XP + ${baseDailyXp} XP`,
          {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: mobile ? '10px' : '11px',
            color: '#53606b',
          }
        )
        .setName('result-xp-label')
        .setOrigin(1, 0.5);
      this.add
        .text(summaryCenter, y + 199, `+ ${streakBonusXp} XP`, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: mobile ? '10px' : '11px',
          color: '#d88416',
        })
        .setName('result-streak-xp-label')
        .setOrigin(0, 0.5);
      this.centerResultXpLabels(summaryCenter);
      this.drawResultProgressBar(
        x + 24,
        y + 213,
        shortLandscape ? modalWidth * 0.46 - 48 : modalWidth - 48,
        summaryCenter
      );
    }

    this.drawResultLeaderboard(
      shortLandscape ? x + modalWidth * 0.52 : x + 24,
      shortLandscape ? y + 92 : y + 253,
      shortLandscape ? modalWidth * 0.45 : modalWidth - 48
    );

    this.add
      .text(
        summaryCenter,
        y + modalHeight - 72,
        'Comment your result to the subreddit game post!',
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: mobile ? '10px' : '11px',
          color: '#FF4500',
          align: 'center',
          wordWrap: { width: summaryWidth - 20 },
          resolution: TEXT_RESOLUTION,
        }
      )
      .setOrigin(0.5);

    const resultButtonGap = 12;
    const resultButtonWidth = Math.min(
      144,
      (summaryWidth - resultButtonGap) / 2
    );
    const resultButtonOffset = resultButtonWidth / 2 + resultButtonGap / 2;
    this.createButton(
      summaryCenter - resultButtonOffset,
      y + modalHeight - 34,
      'Back',
      () => {
        this.modal = 'none';
        this.renderScreen();
      },
      'orange',
      resultButtonWidth
    );
    this.createButton(
      summaryCenter + resultButtonOffset,
      y + modalHeight - 34,
      'Post Result',
      () => {
        void this.commentResult();
      },
      'reddit',
      resultButtonWidth
    );
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

  private centerResultXpLabels(centerX: number): void {
    const xpLabel = this.children.getByName('result-xp-label');
    const streakXpLabel = this.children.getByName('result-streak-xp-label');
    if (
      !(xpLabel instanceof GameObjects.Text) ||
      !(streakXpLabel instanceof GameObjects.Text)
    ) {
      return;
    }

    const gap = 4;
    const totalWidth = xpLabel.width + gap + streakXpLabel.width;
    const left = centerX - totalWidth / 2;
    xpLabel.setX(left + xpLabel.width);
    streakXpLabel.setX(left + xpLabel.width + gap);
  }

  private drawResultLeaderboard(x: number, y: number, width: number): void {
    const graphics = this.add.graphics();
    const rows = selectLeaderboardDisplayRows(
      this.leaderboard,
      this.playerRank,
      this.lastPlayer
    );

    this.add
      .text(x, y, 'Daily Leaderboard', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '13px',
        color: '#25313b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0, 0.5);

    if (rows.length === 0) {
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

    let rowY = y + 38;
    rows.forEach((row) => {
      if (row.kind === 'ellipsis') {
        this.add
          .text(x + width / 2, rowY, '…', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '16px',
            color: '#667380',
          })
          .setOrigin(0.5);
        rowY += 40;
        return;
      }
      const entry = row.entry;
      graphics.fillStyle(
        row.isPlayer ? 0xd5ffc7 : 0xffffff,
        row.isPlayer ? 0.88 : 0.62
      );
      graphics.fillRoundedRect(x, rowY - 18, width, 36, 6);
      graphics.lineStyle(
        2,
        row.isPlayer ? COLORS.green : COLORS.line,
        row.isPlayer ? 0.9 : 0.14
      );
      graphics.strokeRoundedRect(x, rowY - 18, width, 36, 6);
      const rankColors = {
        green: COLORS.green,
        red: COLORS.red,
        blue: COLORS.blue,
        orange: COLORS.orange,
      };
      graphics.fillStyle(rankColors[leaderboardRankColor(entry.rank)], 1);
      graphics.fillRoundedRect(x + 5, rowY - 12, 24, 24, 4);

      this.add
        .text(x + 17, rowY, entry.rank.toString(), {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '10px',
          color: '#ffffff',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0.5);
      this.add
        .text(
          x + 36,
          rowY,
          truncateDisplayName(entry.displayName, width < 330 ? 15 : 23),
          {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '10px',
            color: '#25313b',
            resolution: TEXT_RESOLUTION,
          }
        )
        .setOrigin(0, 0.5);
      this.add
        .text(
          x + width - 10,
          rowY - 7,
          `${entry.guesses} ${entry.guesses === 1 ? 'guess' : 'guesses'}`,
          {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '10px',
            color: '#25313b',
            resolution: TEXT_RESOLUTION,
          }
        )
        .setOrigin(1, 0.5);
      this.add
        .text(
          x + width - 10,
          rowY + 8,
          formatLeaderboardTime(entry.durationMs),
          {
            fontFamily: 'Arial, sans-serif',
            fontSize: '10px',
            color: '#667380',
            resolution: TEXT_RESOLUTION,
          }
        )
        .setOrigin(1, 0.5);
      rowY += 40;
    });
  }

  private drawClueModal(): void {
    drawHowToPlayModal(this, () => {
      this.modal = 'none';
      this.renderScreen();
    });
  }

  private drawResultProgressBar(
    x: number,
    y: number,
    width: number,
    centerX: number
  ): void {
    if (!this.progress) {
      return;
    }
    const background = this.add.graphics();
    background.fillStyle(0xd8d0c5, 1);
    background.fillRoundedRect(x, y, width, 12, 6);
    background.lineStyle(1, COLORS.line, 0.28);
    background.strokeRoundedRect(x, y, width, 12, 6);
    const fill = this.add
      .rectangle(x, y + 6, width, 10, COLORS.green)
      .setOrigin(0, 0.5);
    const reward = this.dailyReward;
    const levelLabel = this.children.getByName('result-level-label');
    const xpLabel = this.children.getByName('result-xp-label');
    const streakXpLabel = this.children.getByName('result-streak-xp-label');
    const rewardAmount =
      reward && this.progress
        ? Math.max(0, this.progress.totalXp - reward.previousTotalXp)
        : (reward?.amount ?? 0);
    const baseDailyXp = Math.min(DAILY_BASE_XP, rewardAmount);
    const streakBonusXp = Math.max(0, rewardAmount - baseDailyXp);

    if (streakXpLabel instanceof GameObjects.Text) {
      streakXpLabel.setText(`+ ${streakBonusXp} XP`);
    }

    if (!reward || this.acknowledgedRewardIds.has(reward.rewardId)) {
      fill.setScale(
        Math.min(1, this.progress.levelXp / this.progress.xpForNextLevel),
        1
      );
      return;
    }

    const segments = buildXpAnimationSegments(
      reward.previousTotalXp,
      reward.previousTotalXp + rewardAmount
    );
    const animateSegment = (index: number): void => {
      const segment = segments[index];
      if (!segment) {
        if (levelLabel instanceof GameObjects.Text) {
          levelLabel.setText(`Level ${this.progress?.level ?? 1}`);
        }
        if (xpLabel instanceof GameObjects.Text && this.progress) {
          xpLabel.setText(
            `${this.progress.levelXp}/${this.progress.xpForNextLevel} XP + ${baseDailyXp} XP`
          );
          this.centerResultXpLabels(centerX);
        }
        void this.acknowledgeDailyReward(reward.rewardId);
        return;
      }
      if (levelLabel instanceof GameObjects.Text) {
        levelLabel.setText(`Level ${segment.level}`);
      }
      fill.setScale(segment.fromXp / segment.xpForNextLevel, 1);
      this.tweens.add({
        targets: fill,
        scaleX: segment.toXp / segment.xpForNextLevel,
        duration: 650,
        ease: 'Sine.easeOut',
        onUpdate: () => {
          if (xpLabel instanceof GameObjects.Text) {
            const shownXp = Math.round(segment.xpForNextLevel * fill.scaleX);
            xpLabel.setText(
              `${shownXp}/${segment.xpForNextLevel} XP + ${baseDailyXp} XP`
            );
            this.centerResultXpLabels(centerX);
          }
        },
        onComplete: () => {
          if (segment.completesLevel) {
            this.tweens.add({
              targets:
                levelLabel instanceof GameObjects.Text ? levelLabel : fill,
              scaleX: 1.12,
              scaleY: 1.12,
              yoyo: true,
              duration: 150,
            });
          }
          animateSegment(index + 1);
        },
      });
    };
    animateSegment(0);
  }

  private async acknowledgeDailyReward(rewardId: string): Promise<void> {
    if (this.acknowledgedRewardIds.has(rewardId)) {
      return;
    }
    this.acknowledgedRewardIds.add(rewardId);
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

  private showSolvedPatternReveal(): void {
    this.modal = 'none';
    this.markerMode = false;
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
    onClick: (pointer: Input.Pointer) => void,
    variant: ButtonVariant = 'dark',
    width?: number
  ): GameObjects.Container {
    const button = drawTileButton(this, {
      x,
      y,
      label,
      variant,
      ...(width === undefined ? {} : { width }),
      fontSize: 14,
      onClick,
    });
    this.trackInteractive(button);
    return button;
  }

  private openHomeScreen(pointer: Input.Pointer): void {
    try {
      if (pointer.event instanceof MouseEvent) {
        exitExpandedMode(pointer.event);
        return;
      }
    } catch {
      // Static previews do not provide Reddit's Devvit bridge.
    }

    try {
      window.open('splash.html', '_self');
    } catch {
      // Some embedded contexts may block same-frame navigation.
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
    if (!this.session) {
      return;
    }

    if (this.isCompletedDaily()) {
      if (this.modal === 'none' && !this.showingSolvedReveal) {
        this.showSolvedPatternReveal();
      }
      return;
    }

    const key = coordKey(coord);

    if (this.markerMode) {
      if (this.dailyUpdateInFlight) {
        return;
      }
      void this.toggleActiveMarker(coord);
      return;
    }

    if (this.dailyUpdateInFlight) {
      return;
    }

    if (this.markerQueue.hasPendingWrites) {
      this.markerQueue.queueGuess(coord);
      this.pendingTileKey = key;
      this.currentStatus = 'Checking tile...';
      this.redrawGame();
      this.setGameStatus(this.currentStatus);
      return;
    }

    if (this.session.guesses.some((guess) => coordKey(guess.coord) === key)) {
      return;
    }

    void this.submitActiveGuess(coord);
  }

  private isCompletedDaily(): boolean {
    return (
      this.session?.puzzleId.mode === 'daily' && this.session.solved === true
    );
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
      this.session = toggleMarkerInSession(this.session, coord);
      this.markerQueue.enqueueMarker(coord);
      this.currentStatus = 'X note updated.';
      this.lastGuessKey = coordKey(coord);
      this.renderScreen();
      void this.processDailyMarkerQueue();
      return;
    }

    this.session = toggleMarkerInSession(this.session, coord);
    this.currentStatus = 'X mark updated.';
    this.lastGuessKey = coordKey(coord);
    this.renderScreen();
  }

  private async processDailyMarkerQueue(): Promise<void> {
    const coord = this.markerQueue.beginNextWrite();
    if (!coord) {
      return;
    }
    try {
      const response = await fetch('/api/daily/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coord }),
      });
      if (!response.ok) {
        throw new Error(`Daily marker failed: ${response.status}`);
      }
      const data = toDailySessionResponse(await response.json());
      if (!data) {
        throw new Error('Daily marker response was invalid.');
      }
      this.markerQueue.settleCurrentWrite();
      this.applyDailyResponse(data);
      this.confirmedSession = data.session;
      this.reapplyPendingMarkers();
    } catch (error) {
      console.error('Daily marker update failed:', error);
      this.markerQueue.settleCurrentWrite();
      this.session = this.confirmedSession;
      this.reapplyPendingMarkers();
      this.currentStatus = 'Couldn’t save that X—try again.';
    } finally {
      if (this.scene.isActive()) {
        this.renderScreen();
      }
      if (this.markerQueue.hasPendingWrites) {
        void this.processDailyMarkerQueue();
      } else {
        const guess = this.markerQueue.takeQueuedGuess();
        if (guess) {
          this.pendingTileKey = null;
          void this.submitActiveGuess(guess);
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
      this.confirmedSession = data.session;
      if (url.endsWith('/guess')) {
        const lastGuess = data.session.guesses.at(-1);
        this.lastGuessKey = lastGuess ? coordKey(lastGuess.coord) : null;
      }
      this.currentStatus = data.session.solved
        ? `Solved in ${data.session.guesses.length} guesses.`
        : data.session.guesses.at(-1)?.wasGreen
          ? 'Pattern tile found—keep going!'
          : 'Clue revealed—choose your next tile.';
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
      this.drawCluePattern(graphics, tileX, tileY, size, radius, guess.clue);
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
        graphics.fillRoundedRect(segmentX, y, remainingWidth, size, radius);
        graphics.fillRect(segmentX, y, Math.min(radius, remainingWidth), size);
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
  if (value.lastPlayer === null) {
    response.lastPlayer = null;
  } else if (isLeaderboardEntry(value.lastPlayer)) {
    response.lastPlayer = value.lastPlayer;
  }
  if (isProgressSummary(value.progress)) {
    response.progress = value.progress;
  }
  if (isProgressReward(value.reward)) {
    response.reward = value.reward;
  }

  return response;
};

const isProgressSummary = (value: unknown): value is PlayerProgressSummary => {
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
    typeof value.solvedAt === 'number' &&
    (value.durationMs === undefined || typeof value.durationMs === 'number')
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const snapBoardSize = (size: number): number => {
  return Math.floor(size / BOARD_DIMENSION) * BOARD_DIMENSION;
};

const formatLeaderboardTime = (durationMs: number | undefined): string =>
  formatOptionalDuration(durationMs);

const formatDailyDate = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(parsed);
};

const truncateDisplayName = (name: string, maxLength: number): string => {
  return name.length <= maxLength ? name : `${name.slice(0, maxLength - 1)}…`;
};
