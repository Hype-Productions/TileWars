import { GameObjects, Input, Scene, Scenes } from 'phaser';
import type { RivalryOutcome } from '../../shared/progression';
import {
  rivalryOutcomeColor,
  rivalryOutcomeSlots,
} from '../../shared/progression';

export const TILE_WARS_COLORS = {
  background: 0xf6f0e8,
  base: 0xf8f1e8,
  paper: 0xfff6dd,
  panel: 0xfffbef,
  line: 0x25313b,
  shadow: 0x142130,
  marked: 0xede0cf,
  pending: 0xfff0bf,
  green: 0x35d07f,
  red: 0xff5365,
  blue: 0x339dff,
  orange: 0xffb12d,
  reddit: 0xff4500,
} as const;

export type TileButtonVariant =
  | 'dark'
  | 'blue'
  | 'green'
  | 'orange'
  | 'red'
  | 'reddit';

type TileButtonOptions = {
  x: number;
  y: number;
  label: string;
  onClick: (pointer: Input.Pointer) => void;
  variant?: TileButtonVariant;
  width?: number;
  height?: number;
  fontSize?: number;
  disabled?: boolean;
};

type GameplayHudOptions = {
  centerX: number;
  labelY: number;
  tileY: number;
  totalTiles: number;
  foundTiles: number;
  guesses: number;
  tileSize: number;
  gap?: number;
  groupGap?: number;
};

export type TileWarsSceneShell = {
  backdrop: GameObjects.Graphics;
  heading: GameObjects.Container;
  signature: string;
};

const TITLE_COLORS = [
  TILE_WARS_COLORS.green,
  TILE_WARS_COLORS.red,
  TILE_WARS_COLORS.blue,
  TILE_WARS_COLORS.orange,
] as const;

const TEXT_RESOLUTION =
  typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);

const improveTextRendering = (gameObject: GameObjects.GameObject): void => {
  if (!(gameObject instanceof GameObjects.Text)) {
    return;
  }
  gameObject.setResolution(TEXT_RESOLUTION);
  if (gameObject.style.fontFamily.includes('Arial Black')) {
    gameObject.setFontStyle('bold');
  }
};

const installTextRenderingDefaults = (scene: Scene): void => {
  scene.events.off(Scenes.Events.ADDED_TO_SCENE, improveTextRendering);
  scene.events.on(Scenes.Events.ADDED_TO_SCENE, improveTextRendering);
};

const paintTileWarsBackdrop = (
  graphics: GameObjects.Graphics,
  width: number,
  height: number
): GameObjects.Graphics => {
  graphics.clear();
  graphics.fillGradientStyle(0xfff1b8, 0xc8f4ff, 0xd5ffc7, 0xffc7e7, 1);
  graphics.fillRect(0, 0, width, height);

  const tile = Math.max(34, Math.min(58, Math.floor(width / 15)));
  const gap = 8;
  const colors = [
    TILE_WARS_COLORS.paper,
    TILE_WARS_COLORS.paper,
    TILE_WARS_COLORS.paper,
    TILE_WARS_COLORS.blue,
    TILE_WARS_COLORS.orange,
    TILE_WARS_COLORS.red,
  ];

  for (let y = -tile; y < height + tile; y += tile + gap) {
    for (let x = -tile; x < width + tile; x += tile + gap) {
      const value =
        Math.abs(Math.floor(x / 13) + Math.floor(y / 17)) % colors.length;
      const color = colors[value] ?? TILE_WARS_COLORS.paper;
      const alpha = color === TILE_WARS_COLORS.paper ? 0.3 : 0.2;

      graphics.fillStyle(color, alpha);
      graphics.fillRoundedRect(x, y, tile, tile, 7);
      graphics.lineStyle(1, TILE_WARS_COLORS.line, 0.08);
      graphics.strokeRoundedRect(x, y, tile, tile, 7);
    }
  }

  return graphics;
};

export const drawTileWarsBackdrop = (
  scene: Scene,
  width: number,
  height: number
): GameObjects.Graphics =>
  paintTileWarsBackdrop(
    scene.add.graphics().setDepth(-20).setScrollFactor(0),
    width,
    height
  );

export const drawTileHeading = (
  scene: Scene,
  text: string,
  x: number,
  y: number,
  mobile: boolean,
  maxSize = 34,
  animate = true
): GameObjects.Container => {
  const letters = [...text.replace(/\s+/g, '').toUpperCase()];
  const size = Math.min(maxSize, mobile ? 29 : 34);
  const gap = mobile ? 4 : 5;
  const totalWidth = letters.length * size + Math.max(0, letters.length - 1) * gap;
  const left = -totalWidth / 2;
  const container = scene.add.container(x, y);
  const graphics = scene.add.graphics();
  container.add(graphics);

  letters.forEach((letter, index) => {
    const tileX = left + index * (size + gap);
    const color = TITLE_COLORS[index % TITLE_COLORS.length] ?? TILE_WARS_COLORS.green;
    graphics.fillStyle(TILE_WARS_COLORS.shadow, 0.2);
    graphics.fillRoundedRect(tileX + 3, -size / 2 + 4, size, size, 6);
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(tileX, -size / 2, size, size, 6);
    graphics.lineStyle(2, TILE_WARS_COLORS.line, 0.72);
    graphics.strokeRoundedRect(tileX, -size / 2, size, size, 6);

    const label = scene.add
      .text(tileX + size / 2, 0, letter, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: `${Math.floor(size * 0.56)}px`,
        color: '#ffffff',
      })
      .setOrigin(0.5);
    container.add(label);
  });

  if (animate) {
    container.setAlpha(0).setScale(0.94);
    scene.tweens.add({
      targets: container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 260,
      ease: 'Back.easeOut',
    });
  }
  return container;
};

export const clearSceneContent = (
  scene: Scene,
  shell: TileWarsSceneShell | null
): void => {
  const retained = new Set<GameObjects.GameObject>(
    shell ? [shell.backdrop, shell.heading] : []
  );
  const dynamicObjects = scene.children.list.filter(
    (object) => !retained.has(object)
  );
  for (const object of dynamicObjects) {
    scene.tweens.killTweensOf(object);
    object.destroy();
  }
  scene.input.resetCursor();
};

export const ensureTileWarsSceneShell = (
  scene: Scene,
  current: TileWarsSceneShell | null,
  options: {
    width: number;
    height: number;
    headingY: number;
    mobile: boolean;
    maxHeadingSize?: number;
  }
): TileWarsSceneShell => {
  installTextRenderingDefaults(scene);
  const maxHeadingSize = options.maxHeadingSize ?? 34;
  const signature = [
    options.width,
    options.headingY,
    options.mobile ? 1 : 0,
    maxHeadingSize,
  ].join(':');
  if (current?.signature === signature) {
    paintTileWarsBackdrop(current.backdrop, options.width, options.height);
    return current;
  }

  const animate = current === null;
  current?.backdrop.destroy();
  current?.heading.destroy();
  const backdrop = drawTileWarsBackdrop(scene, options.width, options.height);
  const heading = drawTileHeading(
    scene,
    'TILEWARS',
    options.width / 2,
    options.headingY,
    options.mobile,
    maxHeadingSize,
    animate
  );
  return { backdrop, heading, signature };
};

export const drawTileWarsLoadingMessage = (
  scene: Scene,
  message: string
): GameObjects.Text => {
  const width = scene.scale.width;
  const height = scene.scale.height;
  return scene.add
    .text(width / 2, Math.max(118, height * 0.3), message, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '18px',
      color: '#25313b',
      align: 'center',
      wordWrap: { width: Math.min(520, width - 32) },
    })
    .setOrigin(0.5);
};

export const drawRaisedPanel = (
  scene: Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  borderColor: number = TILE_WARS_COLORS.line,
  fillColor: number = TILE_WARS_COLORS.panel
): GameObjects.Graphics => {
  const graphics = scene.add.graphics();
  graphics.fillStyle(TILE_WARS_COLORS.shadow, 0.2);
  graphics.fillRoundedRect(x + 5, y + 7, width, height, 8);
  graphics.fillStyle(fillColor, 1);
  graphics.fillRoundedRect(x, y, width, height, 8);
  graphics.lineStyle(2, borderColor, 0.9);
  graphics.strokeRoundedRect(x, y, width, height, 8);
  return graphics;
};

export const drawTileButton = (
  scene: Scene,
  options: TileButtonOptions
): GameObjects.Container => {
  const variant = options.variant ?? 'dark';
  const width = options.width ?? Math.max(78, Math.min(148, options.label.length * 8 + 30));
  const height = options.height ?? 38;
  const colors: Record<TileButtonVariant, number> = {
    dark: TILE_WARS_COLORS.line,
    blue: TILE_WARS_COLORS.blue,
    green: TILE_WARS_COLORS.green,
    orange: TILE_WARS_COLORS.orange,
    red: TILE_WARS_COLORS.red,
    reddit: TILE_WARS_COLORS.reddit,
  };
  const base = colors[variant];
  const container = scene.add.container(options.x, options.y);
  const graphics = scene.add.graphics();
  const label = scene.add
    .text(0, 0, options.label, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: `${options.fontSize ?? 13}px`,
      color: '#ffffff',
      align: 'center',
    })
    .setOrigin(0.5);
  const zone = scene.add
    .zone(-width / 2, -height / 2, width, height)
    .setOrigin(0);
  container.add([graphics, label, zone]);

  const draw = (color: number, offset = 0): void => {
    graphics.clear();
    graphics.fillStyle(TILE_WARS_COLORS.shadow, options.disabled ? 0.1 : 0.24);
    graphics.fillRoundedRect(-width / 2 + 3, -height / 2 + 5, width, height, 8);
    graphics.fillStyle(color, options.disabled ? 0.48 : 1);
    graphics.fillRoundedRect(-width / 2, -height / 2 + offset, width, height, 8);
    graphics.lineStyle(2, TILE_WARS_COLORS.line, options.disabled ? 0.35 : 0.82);
    graphics.strokeRoundedRect(-width / 2, -height / 2 + offset, width, height, 8);
    label.setY(offset).setAlpha(options.disabled ? 0.62 : 1);
  };
  draw(base);

  if (!options.disabled) {
    zone
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => {
        draw(lightenTileColor(base), -2);
      })
      .on('pointerout', () => draw(base))
      .on('pointerdown', () => draw(base, 3))
      .on('pointerup', (pointer: Input.Pointer) => {
        draw(lightenTileColor(base), -2);
        options.onClick(pointer);
      });
  }

  return container;
};

export const drawHeaderChip = (
  scene: Scene,
  x: number,
  y: number,
  label: string,
  color: number,
  width = 82,
  height = 30
): GameObjects.Container => {
  const container = scene.add.container(x, y);
  const graphics = scene.add.graphics();
  graphics.fillStyle(TILE_WARS_COLORS.shadow, 0.2);
  graphics.fillRoundedRect(-width / 2 + 3, -height / 2 + 4, width, height, 7);
  graphics.fillStyle(color, 1);
  graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 7);
  graphics.lineStyle(2, TILE_WARS_COLORS.line, 0.78);
  graphics.strokeRoundedRect(-width / 2, -height / 2, width, height, 7);
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '13px',
      color: '#ffffff',
    })
    .setOrigin(0.5);
  container.add([graphics, text]);
  return container;
};

export const drawGameplayStatsHud = (
  scene: Scene,
  options: GameplayHudOptions
): GameObjects.Container => {
  const count = Math.max(1, Math.min(8, options.totalTiles));
  const gap = options.gap ?? 4;
  const groupGap = options.groupGap ?? 26;
  const foundWidth =
    count * options.tileSize + Math.max(0, count - 1) * gap;
  const totalWidth = foundWidth + groupGap + options.tileSize;
  const left = -totalWidth / 2;
  const foundCenter = left + foundWidth / 2;
  const guessX = left + foundWidth + groupGap + options.tileSize / 2;
  const container = scene.add.container(options.centerX, 0);
  const graphics = scene.add.graphics();
  container.add(graphics);
  container.add(
    scene.add
      .text(foundCenter, options.labelY, 'TILES FOUND', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: options.tileSize <= 28 ? '10px' : '11px',
        color: '#25313b',
      })
      .setOrigin(0.5)
  );
  container.add(
    scene.add
      .text(guessX, options.labelY, 'GUESSES', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: options.tileSize <= 28 ? '10px' : '11px',
        color: '#25313b',
      })
      .setOrigin(0.5)
  );
  for (let index = 0; index < count; index += 1) {
    const tileX = left + index * (options.tileSize + gap);
    const lit = index < options.foundTiles;
    graphics.fillStyle(TILE_WARS_COLORS.shadow, lit ? 0.22 : 0.1);
    graphics.fillRoundedRect(
      tileX + 2,
      options.tileY - options.tileSize / 2 + 3,
      options.tileSize,
      options.tileSize,
      6
    );
    graphics.fillStyle(
      lit ? TILE_WARS_COLORS.green : TILE_WARS_COLORS.paper,
      lit ? 1 : 0.8
    );
    graphics.fillRoundedRect(
      tileX,
      options.tileY - options.tileSize / 2,
      options.tileSize,
      options.tileSize,
      6
    );
    graphics.lineStyle(2, TILE_WARS_COLORS.line, lit ? 0.76 : 0.36);
    graphics.strokeRoundedRect(
      tileX,
      options.tileY - options.tileSize / 2,
      options.tileSize,
      options.tileSize,
      6
    );
  }
  const guessLeft = guessX - options.tileSize / 2;
  const guessTop = options.tileY - options.tileSize / 2;
  graphics.fillStyle(TILE_WARS_COLORS.shadow, 0.24);
  graphics.fillRoundedRect(
    guessLeft + 3,
    guessTop + 4,
    options.tileSize,
    options.tileSize,
    7
  );
  graphics.fillStyle(TILE_WARS_COLORS.blue, 1);
  graphics.fillRoundedRect(
    guessLeft,
    guessTop,
    options.tileSize,
    options.tileSize,
    7
  );
  graphics.lineStyle(2, TILE_WARS_COLORS.line, 0.84);
  graphics.strokeRoundedRect(
    guessLeft,
    guessTop,
    options.tileSize,
    options.tileSize,
    7
  );
  container.add(
    scene.add
      .text(guessX, options.tileY, options.guesses.toString(), {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: options.guesses > 99 ? '14px' : options.tileSize <= 28 ? '17px' : '19px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
  );
  return container;
};

export const drawHowToPlayModal = (
  scene: Scene,
  onClose: () => void
): GameObjects.Container => {
  const width = scene.scale.width;
  const height = scene.scale.height;
  const landscape = width >= 600 && height < 500;
  const compact = width < 520 || height < 650;
  const mobile = width < 520;
  const modalInset = mobile ? 5 : 10;
  const modalWidth = Math.min(
    width - modalInset * 2,
    landscape ? 760 : compact ? 420 : 540
  );
  const modalHeight = Math.min(
    height - modalInset * 2,
    landscape ? height - 10 : compact ? 590 : 620
  );
  const x = (width - modalWidth) / 2;
  const y = (height - modalHeight) / 2;
  const container = scene.add.container(0, 0);
  const blocker = scene.add.zone(0, 0, width, height).setOrigin(0).setInteractive();
  const overlay = scene.add.graphics();
  overlay.fillStyle(0x111820, 0.46);
  overlay.fillRect(0, 0, width, height);
  const panel = drawRaisedPanel(
    scene,
    x,
    y,
    modalWidth,
    modalHeight,
    TILE_WARS_COLORS.line,
    TILE_WARS_COLORS.panel
  );
  container.add([blocker, overlay, panel]);
  container.add(
    scene.add
      .text(width / 2, y + 27, 'How to Play', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: compact ? '24px' : '26px',
        color: '#18212b',
      })
      .setOrigin(0.5)
  );
  const steps = [
    '1. Tap a tile to make a guess.',
    '2. Use clue colors to narrow the hidden connected pattern.',
    '3. Find every green tile to complete the challenge.',
  ];
  const contentLeft = landscape ? x + 24 : x + 16;
  const stepWidth = landscape ? modalWidth * 0.48 - 34 : modalWidth - 32;
  steps.forEach((step, index) => {
    container.add(
      scene.add
        .text(contentLeft, y + 64 + index * (landscape ? 34 : compact ? 31 : 34), step, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: compact ? '13px' : '14px',
          color: '#25313b',
          wordWrap: { width: stepWidth },
        })
        .setOrigin(0, 0.5)
    );
  });
  const sampleSize = landscape ? Math.min(148, modalHeight - 188) : compact ? 128 : 148;
  const cell = sampleSize / 5;
  const sampleX = landscape
    ? x + modalWidth * 0.25 - sampleSize / 2
    : width / 2 - sampleSize / 2;
  const sampleY = landscape ? y + 158 : y + (compact ? 151 : 158);
  const samples = new Map<string, { color: number; label?: string }>([
    ['1,2', { color: TILE_WARS_COLORS.red }],
    ['2,1', { color: TILE_WARS_COLORS.blue }],
    ['2,2', { color: TILE_WARS_COLORS.green }],
    ['3,3', { color: TILE_WARS_COLORS.orange }],
    ['4,0', { color: TILE_WARS_COLORS.paper, label: 'X' }],
  ]);
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const tileX = sampleX + col * cell + 2;
      const tileY = sampleY + row * cell + 2;
      const tileSize = cell - 4;
      const sample = samples.get(`${row},${col}`);
      const tile = scene.add.graphics();
      tile.fillStyle(sample?.color ?? TILE_WARS_COLORS.paper, sample ? 1 : 0.76);
      tile.fillRoundedRect(tileX, tileY, tileSize, tileSize, 4);
      tile.lineStyle(1, TILE_WARS_COLORS.line, sample ? 0.78 : 0.3);
      tile.strokeRoundedRect(tileX, tileY, tileSize, tileSize, 4);
      container.add(tile);
      if (sample?.label) {
        container.add(
          scene.add
            .text(tileX + tileSize / 2, tileY + tileSize / 2, sample.label, {
              fontFamily: 'Arial Black, Arial, sans-serif',
              fontSize: `${Math.floor(cell * 0.54)}px`,
              color: '#25313b',
            })
            .setOrigin(0.5)
        );
      }
    }
  }
  const clues = [
    { label: 'Green — This tile is part of the pattern.', colors: [TILE_WARS_COLORS.green] },
    { label: 'Red — The pattern has at least one tile in this column.', colors: [TILE_WARS_COLORS.red] },
    { label: 'Blue — The pattern has at least one tile in this row.', colors: [TILE_WARS_COLORS.blue] },
    { label: 'Orange — At least one pattern tile lies diagonally from here.', colors: [TILE_WARS_COLORS.orange] },
    { label: 'Multicolored tiles give a combination of clues.', colors: [TILE_WARS_COLORS.red, TILE_WARS_COLORS.blue, TILE_WARS_COLORS.orange] },
    { label: 'X — Mark tiles you’ve ruled out to plan your next move.', colors: [TILE_WARS_COLORS.line] },
  ];
  const clueX = landscape ? x + modalWidth * 0.53 : x + 16;
  const clueStart = landscape ? y + 78 : sampleY + sampleSize + (compact ? 16 : 20);
  const availableClueWidth = landscape
    ? modalWidth * 0.45 - 32
    : modalWidth - 62;
  const clueStep = landscape ? 43 : compact ? 37 : 39;
  clues.forEach((clue, index) => {
    const rowY = clueStart + index * clueStep;
    const swatch = scene.add.graphics();
    const swatchGap = clue.colors.length > 1 ? 1 : 0;
    const swatchWidth = (24 - swatchGap * (clue.colors.length - 1)) / clue.colors.length;
    clue.colors.forEach((color, colorIndex) => {
      swatch.fillStyle(color, 1);
      swatch.fillRoundedRect(
        clueX + colorIndex * (swatchWidth + swatchGap),
        rowY - 12,
        swatchWidth,
        24,
        clue.colors.length > 1 ? 2 : 6
      );
    });
    swatch.lineStyle(1, TILE_WARS_COLORS.line, 0.55);
    swatch.strokeRoundedRect(clueX, rowY - 12, 24, 24, 6);
    container.add(swatch);
    container.add(
      scene.add
        .text(clueX + 34, rowY, clue.label, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: compact ? '12px' : '13px',
          color: '#25313b',
          wordWrap: { width: availableClueWidth },
          lineSpacing: 2,
        })
        .setOrigin(0, 0.5)
    );
  });
  const close = drawTileButton(scene, {
    x: landscape ? x + modalWidth * 0.75 : width / 2,
    y: y + modalHeight - 27,
    label: 'Close',
    variant: 'dark',
    width: 124,
    height: 38,
    onClick: () => onClose(),
  });
  container.add(close);
  return container;
};

export const drawOutcomeStrip = (
  scene: Scene,
  x: number,
  y: number,
  outcomes: RivalryOutcome[],
  size = 20,
  gap = 5
): GameObjects.Container => {
  const container = scene.add.container(x, y);
  rivalryOutcomeSlots(outcomes).forEach((outcome, index) => {
    const left = index * (size + gap);
    const graphics = scene.add.graphics();
    const color = {
      green: TILE_WARS_COLORS.green,
      red: TILE_WARS_COLORS.red,
      orange: TILE_WARS_COLORS.orange,
      cream: TILE_WARS_COLORS.paper,
    }[rivalryOutcomeColor(outcome)];
    graphics.fillStyle(TILE_WARS_COLORS.shadow, outcome ? 0.18 : 0.08);
    graphics.fillRoundedRect(left + 2, 3, size, size, 5);
    graphics.fillStyle(color, outcome ? 1 : 0.78);
    graphics.fillRoundedRect(left, 0, size, size, 5);
    graphics.lineStyle(2, TILE_WARS_COLORS.line, outcome ? 0.72 : 0.3);
    graphics.strokeRoundedRect(left, 0, size, size, 5);
    container.add(graphics);
    if (outcome) {
      const label = scene.add
        .text(left + size / 2, size / 2, outcome.charAt(0).toUpperCase(), {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: `${Math.max(10, Math.floor(size * 0.58))}px`,
          color: '#ffffff',
        })
        .setOrigin(0.5);
      container.add(label);
    }
  });
  return container;
};

export const drawStaticXpBar = (
  scene: Scene,
  x: number,
  y: number,
  width: number,
  levelXp: number,
  xpForNextLevel: number,
  height = 12
): GameObjects.Graphics => {
  const graphics = scene.add.graphics();
  const ratio = xpForNextLevel > 0 ? Math.min(1, levelXp / xpForNextLevel) : 0;
  graphics.fillStyle(0xd8d0c5, 1);
  graphics.fillRoundedRect(x, y, width, height, height / 2);
  if (ratio > 0) {
    graphics.fillStyle(TILE_WARS_COLORS.green, 1);
    graphics.fillRoundedRect(x, y, width * ratio, height, height / 2);
  }
  graphics.lineStyle(1, TILE_WARS_COLORS.line, 0.28);
  graphics.strokeRoundedRect(x, y, width, height, height / 2);
  return graphics;
};

export const drawPlainRivalryRecord = (
  scene: Scene,
  centerX: number,
  y: number,
  record: { wins: number; losses: number; draws: number },
  fontSize = 14
): GameObjects.Text[] => {
  const values = [
    { label: `${record.wins}W`, color: '#218c4a' },
    { label: `${record.losses}L`, color: '#c83d3d' },
    { label: `${record.draws}D`, color: '#a66b00' },
  ];
  const labels = values.map((value) =>
    scene.add
      .text(0, y, value.label, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: `${fontSize}px`,
        color: value.color,
      })
      .setOrigin(0, 0.5)
  );
  const gap = 12;
  const totalWidth = labels.reduce((sum, label) => sum + label.width, 0) + gap * 2;
  let x = centerX - totalWidth / 2;
  labels.forEach((label) => {
    label.setX(x);
    x += label.width + gap;
  });
  return labels;
};

const lightenTileColor = (color: number): number => {
  const red = Math.min(255, ((color >> 16) & 0xff) + 24);
  const green = Math.min(255, ((color >> 8) & 0xff) + 24);
  const blue = Math.min(255, (color & 0xff) + 24);
  return (red << 16) | (green << 8) | blue;
};
