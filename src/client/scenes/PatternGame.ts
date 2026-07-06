import { GameObjects, Scene } from 'phaser';
import {
  type ClueMode,
  type ClueResult,
  type Coord,
  coordKey,
  coordLabel,
  generatePattern,
  getClue,
  getRemainingCount,
  getWeightedColors,
  parsePatternInput,
  todayUtcDate,
  validatePattern,
} from '../../shared/pattern';

type StoredGuess = {
  coord: Coord;
  clue: ClueResult;
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

const COLORS: Record<ColorName | 'green' | 'base' | 'line' | 'marked', number> =
  {
    base: 0xf8f1e8,
    line: 0x25313b,
    marked: 0xede0cf,
    green: 0x43c978,
    red: 0xef5350,
    blue: 0x3f8cff,
    orange: 0xffa323,
  };

export class PatternGame extends Scene {
  private screen: Screen = 'landing';
  private customPane: CustomPane = 'closed';
  private pattern: Coord[] = [];
  private guesses = new Map<string, StoredGuess>();
  private foundKeys = new Set<string>();
  private markerKeys = new Set<string>();
  private tileViews: TileView[] = [];
  private mode: ClueMode = 'balanced';
  private markerMode = false;
  private seed = 'pattern';
  private activeDate = todayUtcDate();
  private gameLabel = 'Daily';
  private boardSize = 360;
  private boardX = 0;
  private boardY = 0;
  private tileSize = 72;
  private pickerKeys = new Set<string>();

  constructor() {
    super('PatternGame');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0xf6f0e8);
    this.scale.on('resize', () => this.renderScreen());
    this.showLanding('Choose a mode to start.');
  }

  private renderScreen(): void {
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
    this.renderScreen();
    this.setLandingStatus(status);
  }

  private startDailyGame(): void {
    this.activeDate = todayUtcDate();
    this.seed = 'pattern';
    this.gameLabel = `Daily ${this.activeDate}`;
    this.pattern = generatePattern(this.seed, this.activeDate);
    this.startGame();
  }

  private startSeedGame(seed: string): void {
    this.activeDate = 'custom';
    this.seed = seed;
    this.gameLabel = `Seed ${seed}`;
    this.pattern = generatePattern(seed, 'custom');
    this.startGame();
  }

  private startPickedPattern(): void {
    const pattern = this.selectedPickerPattern();
    const validation = validatePattern(pattern);
    if (!validation.valid) {
      this.setLandingStatus(validation.message);
      return;
    }

    this.activeDate = 'custom';
    this.seed = 'picked';
    this.gameLabel = 'Custom pattern';
    this.pattern = pattern;
    this.startGame();
  }

  private startGame(): void {
    this.screen = 'game';
    this.guesses.clear();
    this.foundKeys.clear();
    this.markerKeys.clear();
    this.markerMode = false;
    this.renderScreen();
    this.setGameStatus('Find the linked pattern.');
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
    this.createButton(centerX - 86, topY, 'Daily', () => this.startDailyGame());
    this.createButton(centerX + 86, topY, 'Custom', () => {
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
      this.seed = this.randomSeed();
      this.showLanding(`Random seed ready: ${this.seed}`);
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
      .text(centerX, y - 38, `Seed: ${this.seed}`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '20px',
        color: '#18212b',
      })
      .setOrigin(0.5);

    this.createButton(centerX - 112, y + 10, 'New number', () => {
      this.seed = this.randomSeed();
      this.showLanding(`Random seed ready: ${this.seed}`);
    });
    this.createButton(centerX + 112, y + 10, 'Start seed', () => {
      this.startSeedGame(this.seed);
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

        this.add
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
    this.drawRulesPanel(mobile);

    const buttonY = mobile ? height - 30 : height - 44;
    this.createButton(
      width / 2 - 124,
      buttonY,
      mobile ? this.shortModeLabel() : this.modeLabel(),
      () => {
      this.mode = this.mode === 'balanced' ? 'proximity' : 'balanced';
      this.renderScreen();
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
  }

  private layoutBoard(mobile: boolean): void {
    const width = this.scale.width;
    const height = this.scale.height;

    if (mobile) {
      this.boardSize = Math.max(220, Math.min(width - 28, height - 420, 330));
      this.boardX = (width - this.boardSize) / 2;
      this.boardY = 90;
    } else {
      const rulesWidth = 270;
      this.boardSize = Math.max(320, Math.min(width - rulesWidth - 90, height - 190, 460));
      this.boardX = Math.max(28, (width - rulesWidth - this.boardSize) / 2);
      this.boardY = Math.max(88, (height - this.boardSize) / 2 - 12);
    }

    this.tileSize = this.boardSize / 5;
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
          })
          .setOrigin(0.5);
        const marker = this.add
          .text(0, 0, 'X', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '34px',
            color: '#1f2933',
          })
          .setOrigin(0.5);
        const zone = this.add
          .zone(0, 0, 10, 10)
          .setOrigin(0)
          .setInteractive({ useHandCursor: true });

        zone.on('pointerdown', () => {
          this.handleTile(coord);
        });

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

    const rows = [
      { label: 'Part of pattern', color: COLORS.green },
      { label: 'Same column', color: COLORS.red },
      { label: 'Same row', color: COLORS.blue },
      { label: 'Diagonal', color: COLORS.orange },
      { label: 'X mode marks no-guess notes', color: COLORS.line },
    ];

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
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    button.on('pointerover', () => button.setStyle({ backgroundColor: '#354555' }));
    button.on('pointerout', () => {
      button.setStyle({
        backgroundColor:
          label.startsWith('X mode') && this.markerMode ? '#d9480f' : '#25313b',
      });
    });
    button.on('pointerdown', onClick);
    if (label.startsWith('X mode') && this.markerMode) {
      button.setStyle({ backgroundColor: '#d9480f' });
    }
    return button;
  }

  private handleTile(coord: Coord): void {
    const key = coordKey(coord);

    if (this.markerMode) {
      if (!this.guesses.has(key) && !this.foundKeys.has(key)) {
        if (this.markerKeys.has(key)) {
          this.markerKeys.delete(key);
        } else {
          this.markerKeys.add(key);
        }
      }
      this.renderScreen();
      return;
    }

    if (this.guesses.has(key)) {
      return;
    }

    this.markerKeys.delete(key);
    const clue = getClue(coord, this.pattern);
    this.guesses.set(key, { coord, clue });

    if (clue.green) {
      this.foundKeys.add(key);
    }

    const remaining = getRemainingCount(this.pattern, this.foundKeys);
    if (remaining === 0) {
      this.renderScreen();
      this.setGameStatus(`Solved in ${this.guesses.size} guesses.`);
      return;
    }

    this.renderScreen();
    this.setGameStatus(clue.green ? 'Pattern tile found.' : 'Clue added.');
  }

  private redrawGame(): void {
    const stats = this.children.getByName('stats');
    if (stats instanceof GameObjects.Text) {
      const remaining = getRemainingCount(this.pattern, this.foundKeys);
      stats.setText(
        `Remaining: ${remaining}   Guesses: ${this.guesses.size}   ${this.gameLabel}`
      );
    }

    for (const view of this.tileViews) {
      this.drawTile(view);
    }
  }

  private drawTile(view: TileView): void {
    const key = coordKey(view.coord);
    const x = this.boardX + view.coord.col * this.tileSize;
    const y = this.boardY + view.coord.row * this.tileSize;
    const gap = Math.max(4, this.tileSize * 0.05);
    const size = this.tileSize - gap;
    const radius = Math.max(5, this.tileSize * 0.08);
    const guess = this.guesses.get(key);
    const graphics = view.graphics;

    graphics.clear();

    if (guess?.clue.green) {
      graphics.fillStyle(COLORS.green, 1);
      graphics.fillRoundedRect(x + gap / 2, y + gap / 2, size, size, radius);
      const weights = getWeightedColors(guess.clue, this.mode);
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
      const weights = getWeightedColors(guess.clue, this.mode);
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
        this.markerKeys.has(key) ? COLORS.marked : COLORS.base,
        1
      );
      graphics.fillRoundedRect(x + gap / 2, y + gap / 2, size, size, radius);
    }

    graphics.lineStyle(2, COLORS.line, 1);
    graphics.strokeRoundedRect(x + gap / 2, y + gap / 2, size, size, radius);

    view.label.setPosition(x + this.tileSize / 2, y + this.tileSize / 2);
    view.label.setFontSize(Math.max(12, Math.floor(this.tileSize * 0.19)));
    view.label.setColor(guess?.clue.green ? '#0b2818' : '#18212b');

    view.marker.setPosition(x + this.tileSize / 2, y + this.tileSize / 2);
    view.marker.setFontSize(Math.max(24, Math.floor(this.tileSize * 0.5)));
    view.marker.setVisible(this.markerKeys.has(key));

    view.zone.setPosition(x + gap / 2, y + gap / 2);
    view.zone.setSize(size, size);
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
    return this.mode === 'balanced' ? 'Balanced clues' : 'Proximity clues';
  }

  private markerModeLabel(): string {
    return this.markerMode ? 'X mode on' : 'X mode off';
  }

  private shortModeLabel(): string {
    return this.mode === 'balanced' ? 'Balanced' : 'Proximity';
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
