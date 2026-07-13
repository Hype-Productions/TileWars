import { GameObjects, Scene } from 'phaser';
import {
  type Coord,
  coordKey,
  coordLabel,
  generatePattern,
  getRemainingCount,
  getWeightedColors,
  parsePatternInput,
  todayUtcDate,
  validatePattern,
} from '../../shared/pattern';
import {
  type DailySessionResponse,
  type LeaderboardEntry,
  type PlayerSession,
  applyGuessToSession,
  createCustomPuzzleId,
  createDailyPuzzleId,
  createInitialSession,
  createShareText,
  dailyPatternForPuzzle,
  setClueModeInSession,
  toggleMarkerInSession,
} from '../../shared/game';
import type {
  PlayerProgressSummary,
  ProgressResponse,
  ProgressReward,
} from '../../shared/progression';
import {
  createInitialProgress,
  summarizeProgress,
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
type Screen = 'landing' | 'game';
type CustomPane = 'closed' | 'menu' | 'seed' | 'pattern';
type Modal = 'none' | 'clues' | 'result';

const BOARD_DIMENSION = 5;
const TEXT_RESOLUTION =
  typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);

const COLORS: Record<
  ColorName | 'green' | 'base' | 'line' | 'marked' | 'pending',
  number
> = {
    base: 0xf8f1e8,
    line: 0x25313b,
    marked: 0xede0cf,
    pending: 0xfff0bf,
    green: 0x43c978,
    red: 0xef5350,
    blue: 0x3f8cff,
    orange: 0xffa323,
  };

export class PatternGame extends Scene {
  private screen: Screen = 'landing';
  private customPane: CustomPane = 'closed';
  private pattern: Coord[] = [];
  private session: PlayerSession | null = null;
  private leaderboard: LeaderboardEntry[] = [];
  private playerRank: LeaderboardEntry | null = null;
  private tileViews: TileView[] = [];
  private interactiveObjects: GameObjects.GameObject[] = [];
  private markerMode = false;
  private modal: Modal = 'none';
  private customSeed = 'pattern';
  private gameLabel = 'Daily';
  private currentStatus = 'Choose a mode to start.';
  private boardSize = 360;
  private boardX = 0;
  private boardY = 0;
  private tileSize = 72;
  private pickerKeys = new Set<string>();
  private pendingTileKey: string | null = null;
  private dailyUpdateInFlight = false;
  private progress: PlayerProgressSummary | null = null;
  private dailyReward: ProgressReward | null = null;
  private acknowledgedRewardIds = new Set<string>();

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
    this.showLanding('Choose a mode to start.');
    void this.loadProgress();
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

    if (this.screen === 'landing') {
      this.drawLanding();
      return;
    }

    this.drawGame();
  }

  private showLanding(status: string): void {
    this.screen = 'landing';
    this.currentStatus = status;
    this.renderScreen();
    this.setLandingStatus(status);
  }

  private startDailyGame(): void {
    this.currentStatus = 'Loading daily puzzle...';
    this.renderScreen();
    void this.loadDailySession();
  }

  private startSeedGame(seed: string): void {
    this.gameLabel = `Seed ${seed}`;
    this.pattern = generatePattern(seed, 'custom');
    this.session = createInitialSession(
      createCustomPuzzleId('custom-seed', seed),
      this.pattern.length
    );
    this.startGame('Find the linked pattern.');
  }

  private startPickedPattern(): void {
    const pattern = this.selectedPickerPattern();
    const validation = validatePattern(pattern);
    if (!validation.valid) {
      this.setLandingStatus(validation.message);
      return;
    }

    this.gameLabel = 'Custom pattern';
    this.pattern = pattern;
    this.session = createInitialSession(
      createCustomPuzzleId('custom-pattern', 'picked'),
      this.pattern.length
    );
    this.startGame('Find the linked pattern.');
  }

  private startGame(status: string, modal: Modal = 'none'): void {
    this.screen = 'game';
    this.markerMode = false;
    this.modal = modal;
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
      this.gameLabel = `Daily #${puzzleId.puzzleNumber}`;
      this.startGame('Local daily preview. Reddit persistence is unavailable here.');
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
    this.gameLabel = `Daily #${data.session.puzzleId.puzzleNumber}`;
    if (data.progress) {
      this.progress = data.progress;
    }
    this.dailyReward = data.reward ?? null;
  }

  private async loadProgress(): Promise<void> {
    try {
      const response = await fetch('/api/progress');
      if (!response.ok) {
        throw new Error(`Progress failed: ${response.status}`);
      }
      const value: unknown = await response.json();
      if (isProgressResponse(value)) {
        this.progress = value.progress;
        if (this.screen === 'landing') {
          this.renderScreen();
        }
      }
    } catch {
      if (isLocalPreview()) {
        this.progress = summarizeProgress(createInitialProgress());
        if (this.screen === 'landing') {
          this.renderScreen();
        }
      }
    }
  }

  private drawLanding(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.resize(width, height);

    this.add
      .text(width / 2, 42, 'Pattern Tiles', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: `${Math.min(36, Math.max(28, width * 0.07))}px`,
        color: '#18212b',
      })
      .setOrigin(0.5);

    if (this.progress) {
      this.add
        .text(width - 22, 42, `🔥 ${this.progress.dailyStreak}`, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '18px',
          color: '#d9480f',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(1, 0.5);
    }

    this.add
      .text(width / 2, 82, 'Find a hidden linked shape from color clues.', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '17px',
        color: '#33404c',
        align: 'center',
        wordWrap: { width: Math.min(520, width - 32) },
      })
      .setOrigin(0.5);

    const centerX = width / 2;
    const topY = Math.max(132, height * 0.2);
    this.createButton(centerX - 142, topY, 'Daily', () => this.startDailyGame());
    this.createButton(centerX, topY, 'Versus', () => {
      this.scene.start('VersusLobby');
    });
    this.createButton(centerX + 142, topY, 'Custom', () => {
      this.customPane = 'menu';
      this.showLanding('Choose a custom setup.');
    });

    if (this.customPane === 'menu') {
      this.drawCustomMenu(topY + 78);
    } else if (this.customPane === 'seed') {
      this.drawSeedMenu(topY + 76);
    } else if (this.customPane === 'pattern') {
      this.drawPatternPicker(topY + 64);
    }

    this.add
      .text(width / 2, height - 28, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#33404c',
        align: 'center',
        wordWrap: { width: Math.min(560, width - 32) },
      })
      .setName('landing-status')
      .setOrigin(0.5);
  }

  private drawCustomMenu(y: number): void {
    const centerX = this.scale.width / 2;
    this.createButton(centerX - 118, y, 'Random seed', () => {
      this.customPane = 'seed';
      this.customSeed = this.randomSeed();
      this.showLanding(`Random seed ready: ${this.customSeed}`);
    });
    this.createButton(centerX + 118, y, 'Pick pattern', () => {
      this.customPane = 'pattern';
      this.pickerKeys.clear();
      this.showLanding('Pick 4-7 connected tiles.');
    });
  }

  private drawSeedMenu(y: number): void {
    const centerX = this.scale.width / 2;
    this.add
      .text(centerX, y - 38, `Seed: ${this.customSeed}`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '20px',
        color: '#18212b',
      })
      .setOrigin(0.5);

    this.createButton(centerX - 112, y + 10, 'New number', () => {
      this.customSeed = this.randomSeed();
      this.showLanding(`Random seed ready: ${this.customSeed}`);
    });
    this.createButton(centerX + 112, y + 10, 'Start seed', () => {
      this.startSeedGame(this.customSeed);
    });
  }

  private drawPatternPicker(y: number): void {
    const width = this.scale.width;
    const pickerSize = Math.min(width - 60, 260);
    const cell = pickerSize / 5;
    const startX = (width - pickerSize) / 2;
    const graphics = this.add.graphics();

    this.add
      .text(width / 2, y - 26, 'Pick 4-7 connected tiles', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '18px',
        color: '#18212b',
      })
      .setOrigin(0.5);

    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const coord = { row, col };
        const key = coordKey(coord);
        const x = startX + col * cell;
        const tileY = y + row * cell;
        const selected = this.pickerKeys.has(key);

        graphics.fillStyle(selected ? COLORS.green : COLORS.base, 1);
        graphics.fillRoundedRect(x + 3, tileY + 3, cell - 6, cell - 6, 6);
        graphics.lineStyle(2, COLORS.line, 1);
        graphics.strokeRoundedRect(x + 3, tileY + 3, cell - 6, cell - 6, 6);

        this.add
          .text(x + cell / 2, tileY + cell / 2, coordLabel(coord), {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: `${Math.max(12, cell * 0.22)}px`,
            color: '#18212b',
          })
          .setOrigin(0.5);

        const pickerZone = this.add
          .zone(x, tileY, cell, cell)
          .setOrigin(0)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => {
            if (selected) {
              this.pickerKeys.delete(key);
            } else {
              this.pickerKeys.add(key);
            }
            this.showLanding(this.pickerValidationMessage());
          });
        this.trackInteractive(pickerZone);
      }
    }

    const controlsY = y + pickerSize + 38;
    this.createButton(width / 2 - 102, controlsY, 'Clear', () => {
      this.pickerKeys.clear();
      this.showLanding('Pick 4-7 connected tiles.');
    });
    this.createButton(width / 2 + 102, controlsY, 'Start pattern', () => {
      this.startPickedPattern();
    });
  }

  private drawGame(): void {
    if (!this.session) {
      this.showLanding('No active game session.');
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const mobile = width < 760;
    this.cameras.resize(width, height);

    this.add
      .text(width / 2, 28, 'Pattern Tiles', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: `${mobile ? 26 : 30}px`,
        color: '#18212b',
      })
      .setOrigin(0.5);

    if (this.progress) {
      this.add
        .text(width - 18, 28, `🔥 ${this.progress.dailyStreak}`, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: mobile ? '15px' : '18px',
          color: '#d9480f',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(1, 0.5);
    }

    this.add
      .text(width / 2, 60, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: `${mobile ? 15 : 18}px`,
        color: '#33404c',
        align: 'center',
      })
      .setName('stats')
      .setOrigin(0.5);

    this.layoutBoard(mobile);
    this.createTiles();
    if (mobile) {
      this.createButton(width / 2 + 124, 94, 'Clues', () => {
        this.modal = 'clues';
        this.renderScreen();
      });
    } else {
      this.drawRulesPanel(false);
    }
    const buttonY = mobile ? height - 30 : height - 44;
    this.createButton(
      width / 2 - 124,
      buttonY,
      mobile ? this.shortModeLabel() : this.modeLabel(),
      () => {
        void this.setActiveClueMode(
          this.session?.clueMode === 'balanced' ? 'proximity' : 'balanced'
        );
      }
    ).setName('mode-button');
    this.createButton(
      width / 2,
      buttonY,
      mobile ? this.shortMarkerModeLabel() : this.markerModeLabel(),
      () => {
        this.markerMode = !this.markerMode;
        this.renderScreen();
      }
    ).setName('marker-button');
    this.createButton(width / 2 + 124, buttonY, mobile ? 'New' : 'New game', () => {
      this.customPane = 'closed';
      this.showLanding('Choose a mode to start.');
    });

    this.add
      .text(width / 2, buttonY - 42, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#33404c',
        align: 'center',
        wordWrap: { width: Math.min(560, width - 28) },
      })
      .setName('game-status')
      .setOrigin(0.5);

    this.redrawGame();
    this.setGameStatus(this.currentStatus);

    if (this.modal === 'clues') {
      this.drawModal('Clues', this.clueLines(), []);
    } else if (this.modal === 'result') {
      this.drawResultModal();
    }
  }

  private layoutBoard(mobile: boolean): void {
    const width = this.scale.width;
    const height = this.scale.height;
    let rawBoardSize: number;

    if (mobile) {
      rawBoardSize = Math.max(250, Math.min(width - 28, height - 210, 360));
      this.boardSize = snapBoardSize(rawBoardSize);
      this.boardX = Math.round((width - this.boardSize) / 2);
      this.boardY = 108;
    } else {
      const rulesWidth = 270;
      rawBoardSize = Math.max(
        320,
        Math.min(width - rulesWidth - 90, height - 190, 460)
      );
      this.boardSize = snapBoardSize(rawBoardSize);
      this.boardX = Math.round(Math.max(28, (width - rulesWidth - this.boardSize) / 2));
      this.boardY = Math.round(Math.max(88, (height - this.boardSize) / 2 - 12));
    }

    this.tileSize = this.boardSize / BOARD_DIMENSION;
  }

  private createTiles(): void {
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const coord = { row, col };
        const graphics = this.add.graphics();
        const label = this.add
          .text(0, 0, coordLabel(coord), {
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
          .setInteractive({ useHandCursor: true });

        zone.on('pointerdown', () => {
          this.handleTile(coord);
        });
        this.trackInteractive(zone);

        this.tileViews.push({ coord, graphics, label, marker, zone });
      }
    }
  }

  private drawRulesPanel(mobile: boolean): void {
    const panelX = mobile ? this.scale.width / 2 : this.boardX + this.boardSize + 154;
    const panelY = mobile ? this.boardY + this.boardSize + 22 : this.boardY + 22;
    const textWidth = mobile ? Math.min(this.scale.width - 28, 520) : 250;

    this.add
      .text(panelX, panelY, 'Clues', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '18px',
        color: '#18212b',
      })
      .setOrigin(mobile ? 0.5 : 0.5);

    const rows = this.clueRows();

    rows.forEach((row, index) => {
      const y = panelY + 30 + index * (mobile ? 24 : 28);
      const left = mobile ? panelX - textWidth / 2 + 6 : panelX - textWidth / 2;
      const graphics = this.add.graphics();
      graphics.fillStyle(row.color, 1);
      graphics.fillRoundedRect(left, y - 8, 16, 16, 4);
      this.add
        .text(left + 26, y, row.label, {
          fontFamily: 'Arial, sans-serif',
          fontSize: mobile ? '14px' : '15px',
          color: '#33404c',
        })
        .setOrigin(0, 0.5);
    });
  }

  private drawResultModal(): void {
    if (!this.session) {
      return;
    }

    const lines = [
      `Solved in ${this.session.guesses.length} guesses`,
      this.playerRank
        ? `Rank #${this.playerRank.rank} today`
        : this.session.puzzleId.mode === 'daily'
          ? 'Result saved'
          : 'Custom result',
    ];
    if (this.dailyReward) {
      lines.push(`+${this.dailyReward.amount} XP - ${this.dailyReward.label}`);
    }
    if (this.progress) {
      lines.push(
        `Level ${this.progress.level} - ${this.progress.levelXp}/${this.progress.xpForNextLevel} XP`
      );
    }
    const leaderboardLines = this.leaderboard
      .slice(0, 3)
      .map((entry) => `#${entry.rank} ${entry.displayName}: ${entry.guesses}`);
    const buttons = [
      {
        label: 'Copy result',
        onClick: () => {
          void this.copyResult();
        },
      },
    ];

    if (this.session.puzzleId.mode === 'daily') {
      buttons.push({
        label: 'Dev reset',
        onClick: () => {
          void this.resetDailyForTesting();
        },
      });
    }

    buttons.push({
        label: 'Close',
        onClick: () => {
          this.modal = 'none';
          this.renderScreen();
        },
    });

    const modal = this.drawModal(
      'Solved',
      [...lines, ...leaderboardLines],
      buttons,
      this.progress ? 34 : 0
    );
    if (this.progress) {
      this.drawResultProgressBar(
        modal.x + 34,
        modal.buttonY - 43,
        modal.width - 68
      );
    }
    if (this.dailyReward) {
      void this.acknowledgeDailyReward(this.dailyReward.rewardId);
    }
  }

  private drawModal(
    title: string,
    lines: string[],
    buttons: { label: string; onClick: () => void }[],
    extraHeight = 0
  ): { x: number; y: number; width: number; height: number; buttonY: number } {
    const width = this.scale.width;
    const height = this.scale.height;
    const modalWidth = Math.min(width - 32, 420);
    const modalHeight = Math.min(
      height - 48,
      150 + lines.length * 24 + (buttons.length > 0 ? 48 : 0) + extraHeight
    );
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

    overlay.fillStyle(0x111820, 0.42);
    overlay.fillRect(0, 0, width, height);
    panel.fillStyle(0xf8f1e8, 1);
    panel.fillRoundedRect(x, y, modalWidth, modalHeight, 10);
    panel.lineStyle(2, COLORS.line, 1);
    panel.strokeRoundedRect(x, y, modalWidth, modalHeight, 10);

    this.add
      .text(width / 2, y + 28, title, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '22px',
        color: '#18212b',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, y + 70, lines.join('\n'), {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#33404c',
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: modalWidth - 36 },
      })
      .setOrigin(0.5, 0);

    const buttonY = y + modalHeight - 30;
    if (buttons.length === 0) {
      this.createButton(width / 2, buttonY, 'Close', () => {
        this.modal = 'none';
        this.renderScreen();
      });
      return { x, y, width: modalWidth, height: modalHeight, buttonY };
    }

    const spacing = Math.min(136, modalWidth / Math.max(buttons.length, 1));
    const startX = width / 2 - ((buttons.length - 1) * spacing) / 2;
    buttons.forEach((button, index) => {
      this.createButton(startX + index * spacing, buttonY, button.label, button.onClick);
    });
    return { x, y, width: modalWidth, height: modalHeight, buttonY };
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

  private clueRows(): { label: string; color: number }[] {
    return [
      { label: 'Part of pattern', color: COLORS.green },
      { label: 'Same column', color: COLORS.red },
      { label: 'Same row', color: COLORS.blue },
      { label: 'Diagonal', color: COLORS.orange },
      { label: 'X mode marks no-guess notes', color: COLORS.line },
    ];
  }

  private clueLines(): string[] {
    return [
      'Green: tile is in the pattern',
      'Red: same vertical column',
      'Blue: same horizontal row',
      'Orange: diagonal from a pattern tile',
      'X mode: visual no-guess notes',
    ];
  }

  private createButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void
  ): GameObjects.Text {
    const button = this.add
      .text(x, y, label, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '15px',
        color: '#ffffff',
        backgroundColor: '#25313b',
        padding: { left: 12, right: 12, top: 8, bottom: 8 },
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    button.on('pointerover', () => button.setStyle({ backgroundColor: '#354555' }));
    button.on('pointerout', () => {
      button.setStyle({
        backgroundColor:
          label.startsWith('X') && this.markerMode ? '#d9480f' : '#25313b',
      });
    });
    button.on('pointerdown', onClick);
    if (label.startsWith('X') && this.markerMode) {
      button.setStyle({ backgroundColor: '#d9480f' });
    }
    this.trackInteractive(button);
    return button;
  }

  private async copyResult(): Promise<void> {
    if (!this.session) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createShareText(this.session));
      this.currentStatus = 'Result copied.';
    } catch {
      this.currentStatus = 'Could not copy result in this browser.';
    }
    this.renderScreen();
  }

  private async resetDailyForTesting(): Promise<void> {
    if (!this.session || this.session.puzzleId.mode !== 'daily') {
      return;
    }

    this.modal = 'none';
    this.currentStatus = 'Resetting daily test history...';
    await this.postDailyUpdate('/api/daily/dev-reset', {});
    this.currentStatus = 'Daily test history reset.';
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
      this.currentStatus = 'Checking tile...';
      this.redrawGame();
      this.setGameStatus(this.currentStatus);
      await this.postDailyUpdate('/api/daily/guess', { coord });
      return;
    }

    this.session = applyGuessToSession(this.session, this.pattern, coord);
    this.currentStatus = this.session.solved
      ? `Solved in ${this.session.guesses.length} guesses.`
      : this.session.guesses.at(-1)?.wasGreen
        ? 'Pattern tile found.'
        : 'Clue added.';
    if (this.session.solved) {
      this.modal = 'result';
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
    this.renderScreen();
  }

  private async setActiveClueMode(clueMode: 'balanced' | 'proximity'): Promise<void> {
    if (!this.session) {
      return;
    }

    if (this.session.puzzleId.mode === 'daily' && this.pattern.length === 0) {
      await this.postDailyUpdate('/api/daily/mode', { clueMode });
      return;
    }

    this.session = setClueModeInSession(this.session, clueMode);
    this.currentStatus = 'Clue display mode updated.';
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
      this.currentStatus = data.session.solved
        ? `Solved in ${data.session.guesses.length} guesses.`
        : 'Daily progress saved.';
      if (data.session.solved) {
        this.modal = 'result';
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

    const stats = this.children.getByName('stats');
    if (stats instanceof GameObjects.Text) {
      const remaining =
        this.session.totalTiles > 0
          ? Math.max(0, this.session.totalTiles - this.session.foundKeys.length)
          : getRemainingCount(this.pattern, this.session.foundKeys);
      stats.setText(
        `Remaining: ${remaining}   Guesses: ${this.session.guesses.length}   ${this.gameLabel}`
      );
    }

    const guesses = this.guessMap();
    for (const view of this.tileViews) {
      this.drawTile(view, guesses);
    }
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
    const gap = Math.max(4, this.tileSize * 0.05);
    const size = this.tileSize - gap;
    const radius = Math.max(5, this.tileSize * 0.08);
    const guess = guesses.get(key);
    const pending = key === this.pendingTileKey;
    const graphics = view.graphics;

    graphics.setPosition(0, 0);
    graphics.clear();

    if (pending && !guess) {
      graphics.fillStyle(COLORS.pending, 1);
      graphics.fillRoundedRect(x + gap / 2, y + gap / 2, size, size, radius);
      graphics.lineStyle(3, COLORS.orange, 0.85);
      graphics.strokeRoundedRect(x + gap / 2, y + gap / 2, size, size, radius);
    } else if (guess?.clue.green) {
      graphics.fillStyle(COLORS.green, 1);
      graphics.fillRoundedRect(x + gap / 2, y + gap / 2, size, size, radius);
      const weights = getWeightedColors(guess.clue, this.session.clueMode);
      if (weights.length > 0) {
        const inset = size * 0.22;
        this.drawWeightedArea(
          graphics,
          x + gap / 2 + inset,
          y + gap / 2 + inset,
          size - inset * 2,
          size - inset * 2,
          weights
        );
      }
    } else if (guess) {
      const weights = getWeightedColors(guess.clue, this.session.clueMode);
      if (weights.length > 0) {
        this.drawWeightedArea(
          graphics,
          x + gap / 2,
          y + gap / 2,
          size,
          size,
          weights
        );
      } else {
        graphics.fillStyle(0xffffff, 1);
        graphics.fillRoundedRect(x + gap / 2, y + gap / 2, size, size, radius);
      }
    } else {
      graphics.fillStyle(
        this.session.markerKeys.includes(key) ? COLORS.marked : COLORS.base,
        1
      );
      graphics.fillRoundedRect(x + gap / 2, y + gap / 2, size, size, radius);
    }

    if (!pending || guess) {
      graphics.lineStyle(2, COLORS.line, 1);
      graphics.strokeRoundedRect(x + gap / 2, y + gap / 2, size, size, radius);
    }

    view.label.setPosition(x + this.tileSize / 2, y + this.tileSize / 2);
    view.label.setFontSize(Math.max(12, Math.floor(this.tileSize * 0.19)));
    view.label.setColor(guess?.clue.green ? '#0b2818' : '#18212b');

    view.marker.setPosition(x + this.tileSize / 2, y + this.tileSize / 2);
    view.marker.setFontSize(Math.max(24, Math.floor(this.tileSize * 0.5)));
    view.marker.setVisible(this.session.markerKeys.includes(key));

    view.zone.setPosition(x + gap / 2, y + gap / 2);
    view.zone.setSize(size, size);

    if (pending && !guess) {
      this.animatePendingTile(view);
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

  private drawWeightedArea(
    graphics: GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    weights: { color: ColorName; weight: number }[]
  ): void {
    const total = weights.reduce((sum, item) => sum + item.weight, 0);
    let cursor = x;

    weights.forEach((item, index) => {
      const isLast = index === weights.length - 1;
      const sliceWidth = isLast ? x + width - cursor : (width * item.weight) / total;
      graphics.fillStyle(COLORS[item.color], 1);
      graphics.fillRect(cursor, y, sliceWidth, height);
      cursor += sliceWidth;
    });
  }

  private selectedPickerPattern(): Coord[] {
    const labels = Array.from(this.pickerKeys).map((key) => {
      const [row, col] = key.split(',');
      return coordLabel({
        row: Number.parseInt(row ?? '0', 10),
        col: Number.parseInt(col ?? '0', 10),
      });
    });

    return parsePatternInput(labels.join(','));
  }

  private pickerValidationMessage(): string {
    const validation = validatePattern(this.selectedPickerPattern());
    return validation.valid ? 'Pattern is valid. Start when ready.' : validation.message;
  }

  private randomSeed(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private modeLabel(): string {
    return this.session?.clueMode === 'proximity'
      ? 'Proximity clues'
      : 'Balanced clues';
  }

  private markerModeLabel(): string {
    return this.markerMode ? 'X mode on' : 'X mode off';
  }

  private shortModeLabel(): string {
    return this.session?.clueMode === 'proximity' ? 'Proximity' : 'Balanced';
  }

  private shortMarkerModeLabel(): string {
    return this.markerMode ? 'X on' : 'X off';
  }

  private setLandingStatus(message: string): void {
    const status = this.children.getByName('landing-status');
    if (status instanceof GameObjects.Text) {
      status.setText(message);
    }
  }

  private setGameStatus(message: string): void {
    const status = this.children.getByName('game-status');
    if (status instanceof GameObjects.Text) {
      status.setText(message);
    }
  }
}

const toDailySessionResponse = (value: unknown): DailySessionResponse | null => {
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

const isProgressResponse = (value: unknown): value is ProgressResponse => {
  return (
    isRecord(value) &&
    value.type === 'progress' &&
    isProgressSummary(value.progress) &&
    Array.isArray(value.pendingRewards)
  );
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

const isLocalPreview = (): boolean => {
  return (
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' ||
      window.location.hostname === 'localhost')
  );
};
