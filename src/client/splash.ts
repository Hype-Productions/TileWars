import { requestExpandedMode } from '@devvit/web/client';

const dailyButton = document.getElementById('daily-button');
const versusButton = document.getElementById('versus-button');
const interactiveBoard = document.getElementById('interactive-board');

const tileColors = [
  'tile-cream',
  'tile-blue',
  'tile-red',
  'tile-orange',
  'tile-green',
] as const;

const titleColors = ['tile-green', 'tile-red', 'tile-blue', 'tile-orange'] as const;

type TileColor = (typeof tileColors)[number];
type BoardCoord = readonly [number, number];

const openExpandedGame = (event: MouseEvent): void => {
  try {
    requestExpandedMode(event, 'game');
  } catch {
    // Static previews do not provide Reddit's Devvit bridge.
  }
};

if (dailyButton instanceof HTMLButtonElement) {
  dailyButton.addEventListener('click', (event) => {
    openExpandedGame(event);
  });
}

if (versusButton instanceof HTMLButtonElement) {
  versusButton.addEventListener('click', (event) => {
    versusButton.classList.add('pulse');
    window.setTimeout(() => versusButton.classList.remove('pulse'), 420);
    openExpandedGame(event);
  });
}

if (interactiveBoard instanceof HTMLElement) {
  buildBoard(interactiveBoard);
  window.addEventListener('resize', () => buildBoard(interactiveBoard));

  interactiveBoard.addEventListener('pointerdown', (event) => {
    const tile = event.target;

    if (!(tile instanceof HTMLButtonElement) || !tile.classList.contains('board-tile')) {
      return;
    }

    cycleTile(tile);
  });
}

document.querySelectorAll('.letter-tile').forEach((tile) => {
  tile.addEventListener('pointerdown', () => {
    cycleTitleTiles();
  });
});

function buildBoard(board: HTMLElement): void {
  const columns = window.matchMedia('(max-width: 640px)').matches ? 7 : 12;
  const tileSize = window.matchMedia('(max-width: 640px)').matches ? 48 : 58;
  const rows = Math.max(9, Math.ceil(window.innerHeight / tileSize) + 2);
  const patternKeys = greenPatternKeys(columns, rows);

  board.style.setProperty('--board-columns', columns.toString());
  board.replaceChildren();

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const tile = document.createElement('button');
      const key = tileKey(row, col);
      const patternTile = patternKeys.has(key);
      const color = patternTile ? 'tile-green' : seededBoardColor(row, col);

      tile.type = 'button';
      tile.className = `board-tile ${color}${patternTile ? ' is-pattern' : ''}`;
      tile.dataset.colorIndex = tileColors.indexOf(color).toString();
      tile.dataset.row = row.toString();
      tile.dataset.col = col.toString();
      tile.setAttribute('tabindex', '-1');
      tile.setAttribute('aria-label', 'Reveal tile clue colors');
      board.append(tile);
    }
  }
}

function greenPatternKeys(columns: number, rows: number): Set<string> {
  const shapes: BoardCoord[][] =
    columns <= 7
      ? [
          [
            [1, 1],
            [2, 1],
            [2, 2],
            [3, 2],
            [4, 2],
          ],
          [
            [rows - 5, columns - 3],
            [rows - 4, columns - 3],
            [rows - 4, columns - 2],
            [rows - 3, columns - 2],
            [rows - 2, columns - 2],
          ],
          [
            [rows - 4, 1],
            [rows - 4, 2],
            [rows - 3, 2],
            [rows - 2, 2],
          ],
        ]
      : [
          [
            [1, 1],
            [1, 2],
            [2, 2],
            [3, 2],
            [3, 3],
            [4, 3],
          ],
          [
            [1, columns - 4],
            [2, columns - 4],
            [2, columns - 3],
            [3, columns - 3],
            [4, columns - 3],
            [4, columns - 2],
          ],
          [
            [rows - 4, 2],
            [rows - 4, 3],
            [rows - 3, 3],
            [rows - 2, 3],
            [rows - 2, 4],
          ],
          [
            [rows - 5, columns - 4],
            [rows - 4, columns - 4],
            [rows - 3, columns - 4],
            [rows - 3, columns - 3],
            [rows - 2, columns - 3],
          ],
        ];

  const keys = new Set<string>();

  for (const shape of shapes) {
    for (const [row, col] of shape) {
      if (row >= 0 && row < rows && col >= 0 && col < columns) {
        keys.add(tileKey(row, col));
      }
    }
  }

  return keys;
}

function seededBoardColor(row: number, col: number): TileColor {
  const value = (row * 11 + col * 7 + row * col) % 18;

  if (value === 2 || value === 9 || value === 13) {
    return 'tile-blue';
  }
  if (value === 5 || value === 16) {
    return 'tile-red';
  }
  if (value === 8 || value === 14) {
    return 'tile-orange';
  }

  return 'tile-cream';
}

function cycleTile(tile: HTMLButtonElement): void {
  const currentIndex = Number.parseInt(tile.dataset.colorIndex ?? '0', 10);
  const nextIndex = Number.isNaN(currentIndex)
    ? 1
    : (currentIndex + 1) % tileColors.length;
  const nextColor = tileColors[nextIndex] ?? 'tile-cream';

  tile.classList.remove(...tileColors, 'is-scan');
  tile.classList.add(nextColor, 'is-scan');
  tile.dataset.colorIndex = nextIndex.toString();
  window.setTimeout(() => tile.classList.remove('is-scan'), 520);
}

function cycleTitleTiles(): void {
  const letters = document.querySelectorAll('.letter-tile');

  letters.forEach((letter) => {
    const currentIndex = titleColors.findIndex((color) =>
      letter.classList.contains(color)
    );
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % titleColors.length;
    const color = titleColors[nextIndex] ?? 'tile-green';

    letter.classList.remove(...tileColors, 'title-pop');
    letter.classList.add(color, 'title-pop');
    window.setTimeout(() => letter.classList.remove('title-pop'), 420);
  });
}

function tileKey(row: number, col: number): string {
  return `${row},${col}`;
}
