import { GameObjects, Scene } from 'phaser';
import { coordKey, getWeightedColors } from '../../shared/pattern';
import type {
  VersusMatchSummary,
  VersusReplayGuess,
  VersusScore,
} from '../../shared/versus';
import type { PlayerProgressSummary } from '../../shared/progression';

type ResultSceneData = {
  match: VersusMatchSummary;
  progress?: PlayerProgressSummary;
};
type ColorName = 'red' | 'blue' | 'orange';

const TEXT_RESOLUTION =
  typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
const COLORS: Record<ColorName | 'green' | 'base' | 'line', number> = {
  base: 0xf8f1e8,
  line: 0x25313b,
  green: 0x43c978,
  red: 0xef5350,
  blue: 0x3f8cff,
  orange: 0xffa323,
};

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
    this.children.removeAll(true);
    this.input.resetCursor();
    if (!this.match) {
      this.scene.start('VersusLobby');
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const mobile = width < 700;
    this.add
      .text(width / 2, 30, 'Match result', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: mobile ? '26px' : '32px',
        color: '#18212b',
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5);
    this.add
      .text(
        width / 2,
        66,
        `You ${this.match.rivalry.wins} - ${this.match.rivalry.losses} ${this.match.opponentDisplayName}${this.match.rivalry.draws ? `  (${this.match.rivalry.draws} draw${this.match.rivalry.draws === 1 ? '' : 's'})` : ''}`,
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: mobile ? '14px' : '16px',
          color: '#d9480f',
        }
      )
      .setOrigin(0.5);

    if (this.match.outcome === 'draw' || this.match.outcome === 'no-contest') {
      this.add
        .text(
          width / 2,
          91,
          this.match.outcome === 'draw' ? 'DRAW' : 'NO CONTEST',
          {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '18px',
            color: '#d9480f',
          }
        )
        .setOrigin(0.5);
    }

    const panelWidth = mobile ? Math.min(width - 30, 390) : Math.min(360, width * 0.4);
    const panelHeight = mobile ? 210 : 330;
    const firstY = mobile ? 108 : 104;
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
        color: this.match.xpEarned > 0 ? '#218c4a' : '#6b7280',
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
    this.createButton(width / 2 - 92, buttonsY, 'Lobby', () => {
      this.scene.start('VersusLobby');
    });
    this.createButton(width / 2 + 92, buttonsY, 'Rematch', () => {
      this.scene.start('VersusLobby', { rematchMatchId: this.match?.matchId });
    });
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
    graphics.fillStyle(0x43c978, 1);
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
    const graphics = this.add.graphics();
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(x, y, width, height, 8);
    graphics.lineStyle(winner ? 4 : 2, winner ? COLORS.green : COLORS.line, 1);
    graphics.strokeRoundedRect(x, y, width, height, 8);

    if (winner) {
      this.add
        .text(centerX, y - 12, 'WINNER', {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '16px',
          color: '#ffffff',
          backgroundColor: '#218c4a',
          padding: { left: 10, right: 10, top: 4, bottom: 4 },
        })
        .setOrigin(0.5);
    }

    this.add
      .text(centerX, y + 24, name, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '18px',
        color: '#18212b',
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
        if (guess?.clue.green) {
          graphics.fillStyle(COLORS.green, 1);
          graphics.fillRect(cellX + 2, cellY + 2, cell - 4, cell - 4);
        } else if (guess) {
          const weights = getWeightedColors(guess.clue, 'balanced');
          if (weights.length === 0) {
            graphics.fillStyle(0xffffff, 1);
            graphics.fillRect(cellX + 2, cellY + 2, cell - 4, cell - 4);
          } else {
            const slice = (cell - 4) / weights.length;
            weights.forEach((weight, index) => {
              graphics.fillStyle(COLORS[weight.color], 1);
              graphics.fillRect(
                cellX + 2 + index * slice,
                cellY + 2,
                slice,
                cell - 4
              );
            });
          }
        } else {
          graphics.fillStyle(COLORS.base, 1);
          graphics.fillRect(cellX + 2, cellY + 2, cell - 4, cell - 4);
        }
        graphics.lineStyle(1, COLORS.line, 0.8);
        graphics.strokeRect(cellX + 2, cellY + 2, cell - 4, cell - 4);

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

  private createButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void
  ): GameObjects.Text {
    const button = this.add
      .text(x, y, label, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
        backgroundColor: '#25313b',
        padding: { left: 12, right: 12, top: 7, bottom: 7 },
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    button.on('pointerover', () => {
      button.setStyle({ backgroundColor: '#354555' });
    });
    button.on('pointerout', () => {
      button.setStyle({ backgroundColor: '#25313b' });
    });
    button.on('pointerdown', onClick);
    return button;
  }
}

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
