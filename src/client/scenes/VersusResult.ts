import { GameObjects, Scene } from 'phaser';
import { coordKey } from '../../shared/pattern';
import type {
  VersusMatchSummary,
  VersusReplayGuess,
  VersusScore,
} from '../../shared/versus';
import type { PlayerProgressSummary } from '../../shared/progression';
import {
  TILE_WARS_COLORS,
  drawRaisedPanel,
  drawTileHeading,
  drawTileWarsBackdrop,
} from './tileWarsTheme';

type ResultSceneData = {
  match: VersusMatchSummary;
  progress?: PlayerProgressSummary;
};
type ColorName = 'red' | 'blue' | 'orange';
type ButtonVariant = 'dark' | 'green' | 'orange';

const TEXT_RESOLUTION =
  typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
const COLORS = TILE_WARS_COLORS;

export class VersusResult extends Scene {
  private match: VersusMatchSummary | null = null;
  private progress: PlayerProgressSummary | null = null;

  constructor() {
    super('VersusResult');
  }

  init(data: ResultSceneData): void {
    this.match = data.match;
    this.progress = data.progress ?? null;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0xf6f0e8);
    this.scale.on('resize', this.render, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.render, this);
    });
    this.render();
  }

  private render(): void {
    this.tweens.killAll();
    this.children.removeAll(true);
    this.input.resetCursor();
    if (!this.match) {
      this.scene.start('VersusLobby');
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const mobile = width < 700;
    drawTileWarsBackdrop(this, width, height);
    drawTileHeading(this, 'Result', width / 2, 34, mobile);
    this.add
      .text(
        width / 2,
        78,
        `You ${this.match.rivalry.wins} - ${this.match.rivalry.losses} ${this.match.opponentDisplayName}${this.match.rivalry.draws ? `  (${this.match.rivalry.draws} draw${this.match.rivalry.draws === 1 ? '' : 's'})` : ''}`,
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: mobile ? '14px' : '16px',
          color: '#f28d13',
        }
      )
      .setOrigin(0.5);

    if (this.match.outcome === 'draw' || this.match.outcome === 'no-contest') {
      this.add
        .text(
          width / 2,
          103,
          this.match.outcome === 'draw' ? 'DRAW' : 'NO CONTEST',
          {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '18px',
            color: '#f28d13',
          }
        )
        .setOrigin(0.5);
    }

    const panelWidth = mobile ? Math.min(width - 30, 390) : Math.min(360, width * 0.4);
    const panelHeight = mobile ? 204 : 326;
    const firstY = mobile ? 122 : 112;
    const myX = mobile ? width / 2 : width / 2 - panelWidth / 2 - 15;
    const opponentX = mobile ? width / 2 : width / 2 + panelWidth / 2 + 15;
    this.drawPlayerPanel(
      myX,
      firstY,
      panelWidth,
      panelHeight,
      'You',
      this.match.myScore,
      this.match.myReplay,
      this.match.outcome === 'win'
    );

    const progressY = mobile ? firstY + panelHeight * 2 + 27 : firstY + panelHeight + 38;
    this.add
      .text(width / 2, progressY, `+${this.match.xpEarned} XP`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '20px',
        color: this.match.xpEarned > 0 ? '#16a66a' : '#6b7280',
      })
      .setOrigin(0.5);
    if (this.progress) {
      this.drawProgressBar(progressY + 24);
    }
    this.drawPlayerPanel(
      opponentX,
      mobile ? firstY + panelHeight + 12 : firstY,
      panelWidth,
      panelHeight,
      this.match.opponentDisplayName,
      this.match.opponentScore,
      this.match.opponentReplay,
      this.match.outcome === 'loss'
    );

    const buttonsY = height - 32;
    this.createButton(
      width / 2 - 92,
      buttonsY,
      'Lobby',
      () => this.scene.start('VersusLobby'),
      'orange'
    );
    this.createButton(
      width / 2 + 92,
      buttonsY,
      'Rematch',
      () =>
        this.scene.start('VersusLobby', {
          rematchMatchId: this.match?.matchId,
        }),
      'green'
    );
  }

  private drawProgressBar(y: number): void {
    if (!this.progress) {
      return;
    }
    const width = Math.min(this.scale.width - 48, 360);
    const x = (this.scale.width - width) / 2;
    const ratio = Math.min(
      1,
      this.progress.levelXp / this.progress.xpForNextLevel
    );
    const graphics = this.add.graphics();
    graphics.fillStyle(0xd8d0c5, 1);
    graphics.fillRoundedRect(x, y, width, 12, 6);
    graphics.fillStyle(COLORS.green, 1);
    graphics.fillRoundedRect(x, y, width * ratio, 12, 6);
    this.add
      .text(
        this.scale.width / 2,
        y + 6,
        `Level ${this.progress.level}  ${this.progress.levelXp}/${this.progress.xpForNextLevel}`,
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '10px',
          color: '#18212b',
        }
      )
      .setOrigin(0.5);
  }

  private drawPlayerPanel(
    centerX: number,
    y: number,
    width: number,
    height: number,
    name: string,
    score: VersusScore | null,
    replay: VersusReplayGuess[],
    winner: boolean
  ): void {
    const x = centerX - width / 2;
    const graphics = drawRaisedPanel(
      this,
      x,
      y,
      width,
      height,
      winner ? COLORS.green : COLORS.line,
      COLORS.panel
    );
    graphics.setAlpha(0);
    this.tweens.add({
      targets: graphics,
      alpha: 1,
      y: { from: 8, to: 0 },
      duration: 280,
      delay: winner ? 70 : 130,
      ease: 'Back.easeOut',
    });

    if (winner) {
      this.add
        .text(centerX, y - 12, 'WINNER', {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '16px',
          color: '#ffffff',
          backgroundColor: '#16a66a',
          padding: { left: 10, right: 10, top: 4, bottom: 4 },
        })
        .setOrigin(0.5);
    }

    this.add
      .text(centerX, y + 24, name, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: width < 320 ? '16px' : '18px',
        color: '#18212b',
        align: 'center',
        wordWrap: { width: width - 24 },
      })
      .setOrigin(0.5);
    this.add
      .text(
        centerX,
        y + 50,
        score
          ? `${score.guesses} guesses - ${formatDuration(score.durationMs)}`
          : 'Did not finish',
        {
          fontFamily: 'Arial, sans-serif',
          fontSize: '14px',
          color: '#33404c',
        }
      )
      .setOrigin(0.5);

    const gridSize = Math.min(width - 48, height - 92, 225);
    this.drawReplayGrid(centerX - gridSize / 2, y + 72, gridSize, replay);
  }

  private drawReplayGrid(
    x: number,
    y: number,
    size: number,
    replay: VersusReplayGuess[]
  ): void {
    const cell = size / 5;
    const guesses = new Map(replay.map((guess) => [coordKey(guess.coord), guess]));
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const guess = guesses.get(coordKey({ row, col }));
        const cellX = x + col * cell;
        const cellY = y + row * cell;
        const graphics = this.add.graphics();
        const tileX = cellX + 2;
        const tileY = cellY + 2;
        const tileSize = cell - 4;
        const radius = Math.max(3, cell * 0.1);
        graphics.fillStyle(COLORS.shadow, 0.14);
        graphics.fillRoundedRect(tileX + 2, tileY + 3, tileSize, tileSize, radius);
        if (guess?.clue.green) {
          graphics.fillStyle(COLORS.green, 1);
          graphics.fillRoundedRect(tileX, tileY, tileSize, tileSize, radius);
        } else if (guess) {
          this.drawReplayClue(
            graphics,
            tileX,
            tileY,
            tileSize,
            radius,
            guess
          );
        } else {
          graphics.fillStyle(COLORS.paper, 1);
          graphics.fillRoundedRect(tileX, tileY, tileSize, tileSize, radius);
        }
        graphics.lineStyle(1, COLORS.line, 0.8);
        graphics.strokeRoundedRect(tileX, tileY, tileSize, tileSize, radius);

        if (guess) {
          this.add
            .text(cellX + cell / 2, cellY + cell / 2, String(guess.order), {
              fontFamily: 'Arial Black, Arial, sans-serif',
              fontSize: `${Math.max(10, Math.floor(cell * 0.3))}px`,
              color: '#18212b',
            })
            .setOrigin(0.5);
        }
      }
    }
  }

  private drawReplayClue(
    graphics: GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    radius: number,
    guess: VersusReplayGuess
  ): void {
    const colors: ColorName[] = [];
    if (guess.clue.red > 0) colors.push('red');
    if (guess.clue.blue > 0) colors.push('blue');
    if (guess.clue.orange > 0) colors.push('orange');

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
  ): GameObjects.Text {
    const base =
      variant === 'green'
        ? '#16a66a'
        : variant === 'orange'
          ? '#f28d13'
          : '#25313b';
    const hover =
      variant === 'green'
        ? '#27bf7d'
        : variant === 'orange'
          ? '#ffad2d'
          : '#354555';
    const button = this.add
      .text(x, y, label, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
        backgroundColor: base,
        padding: { left: 12, right: 12, top: 7, bottom: 7 },
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
}

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
