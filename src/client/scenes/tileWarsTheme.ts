import { GameObjects, Scene } from 'phaser';

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
} as const;

const TITLE_COLORS = [
  TILE_WARS_COLORS.green,
  TILE_WARS_COLORS.red,
  TILE_WARS_COLORS.blue,
  TILE_WARS_COLORS.orange,
] as const;

export const drawTileWarsBackdrop = (
  scene: Scene,
  width: number,
  height: number
): GameObjects.Graphics => {
  const graphics = scene.add.graphics().setDepth(-20).setScrollFactor(0);
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

export const drawTileHeading = (
  scene: Scene,
  text: string,
  x: number,
  y: number,
  mobile: boolean,
  maxSize = 34
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

  container.setAlpha(0).setScale(0.94);
  scene.tweens.add({
    targets: container,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    duration: 260,
    ease: 'Back.easeOut',
  });
  return container;
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
