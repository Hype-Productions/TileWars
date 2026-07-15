import { GameObjects, Scene } from 'phaser';
import { coordKey } from '../../shared/pattern';
import type {
  VersusMatchSummary,
  VersusReplayGuess,
  VersusScore,
} from '../../shared/versus';
import type { RivalryOpponentSummary } from '../../shared/progression';
import { formatDuration } from '../../shared/time';
import {
  TILE_WARS_COLORS,
  clearSceneContent,
  drawPlainRivalryRecord,
  drawRaisedPanel,
  drawTileButton,
  ensureTileWarsSceneShell,
  type TileWarsSceneShell,
} from './tileWarsTheme';

type ResultSceneData = {
  match: VersusMatchSummary;
  completedAt?: number;
  historyReturn?: {
    opponent: RivalryOpponentSummary;
    scrollOffset: number;
  };
};
type ColorName = 'red' | 'blue' | 'orange';
type ButtonVariant = 'dark' | 'orange';
const COLORS = TILE_WARS_COLORS;

export class VersusResult extends Scene {
  private match: VersusMatchSummary | null = null;
  private sceneShell: TileWarsSceneShell | null = null;
  private completedAt: number | null = null;
  private historyReturn: ResultSceneData['historyReturn'] = undefined;

  constructor() {
    super('VersusResult');
  }

  init(data: ResultSceneData): void {
    this.match = data.match;
    this.completedAt = data.completedAt ?? null;
    this.historyReturn = data.historyReturn;
  }

  create(): void {
    this.sceneShell = null;
    this.cameras.main.setBackgroundColor(0xf6f0e8);
    this.scale.on('resize', this.render, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.render, this);
    });
    this.render();
  }

  private render(): void {
    clearSceneContent(this, this.sceneShell);
    if (!this.match) {
      this.scene.start('VersusLobby');
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const mobile = width < 700;
    this.sceneShell = ensureTileWarsSceneShell(this, this.sceneShell, {
      width,
      height,
      headingY: 28,
      mobile,
      maxHeadingSize: mobile ? 25 : 31,
    });
    const banner = this.outcomePresentation();
    this.add
      .text(
        width / 2,
        mobile ? 62 : 72,
        banner.label,
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: mobile ? '20px' : '25px',
          color: banner.color,
        }
      )
      .setOrigin(0.5);
    const detailShift = this.completedAt ? 14 : 0;
    if (this.completedAt) {
      this.add
        .text(width / 2, mobile ? 82 : 92, new Date(this.completedAt).toLocaleDateString(), {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '11px',
          color: '#53606b',
        })
        .setOrigin(0.5);
    }
    const rivalryY = (mobile ? 91 : 102) + detailShift;
    drawPlainRivalryRecord(this, width / 2, rivalryY, this.match.rivalry, 14);

    const firstY = (mobile ? 111 : height < 600 ? 116 : 120) + detailShift;
    const panelWidth = mobile ? Math.min(width - 30, 390) : Math.min(360, width * 0.4);
    const mobilePanelGap = 24;
    const buttonsY = height - (mobile ? 25 : 32);
    const mobilePanelSpace = buttonsY - 28 - firstY - mobilePanelGap;
    const panelHeight = mobile
      ? Math.min(300, Math.max(96, mobilePanelSpace / 2))
      : Math.max(160, Math.min(326, height - 220));
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

    this.drawPlayerPanel(
      opponentX,
      mobile ? firstY + panelHeight + mobilePanelGap : firstY,
      panelWidth,
      panelHeight,
      this.match.opponentDisplayName,
      this.match.opponentScore,
      this.match.opponentReplay,
      this.match.outcome === 'loss'
    );

    this.createButton(
      width / 2,
      buttonsY,
      'Back',
      () => this.goBack(),
      'orange'
    );
  }

  private goBack(): void {
    if (this.historyReturn) {
      this.scene.wake('VersusLobby');
      this.scene.stop();
      return;
    }
    this.scene.start('VersusLobby');
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
      .text(centerX, y + 18, name, {
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
        y + 40,
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

    const gridSize = Math.min(width - 40, height - 60, 225);
    this.drawReplayGrid(centerX - gridSize / 2, y + 53, gridSize, replay);
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
  ): GameObjects.Container {
    return drawTileButton(this, {
      x,
      y,
      label,
      onClick: () => onClick(),
      variant,
      width: 130,
    });
  }

  private outcomePresentation(): { label: string; color: string } {
    if (this.match?.outcome === 'win') {
      return { label: 'You Won!', color: '#35d07f' };
    }
    if (this.match?.outcome === 'loss') {
      return { label: 'You Lost', color: '#ff5365' };
    }
    if (this.match?.outcome === 'draw') {
      return { label: 'Draw!', color: '#ffb12d' };
    }
    return { label: 'Match Complete', color: '#25313b' };
  }
}

