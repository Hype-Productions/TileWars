import { requestExpandedMode } from '@devvit/web/client';

const dailyButton = document.getElementById('daily-button');
const versusButton = document.getElementById('versus-button');
const leaderboardDialog = document.getElementById('leaderboard-dialog');
const leaderboardClose = document.getElementById('leaderboard-close');
const interactiveBoard = document.getElementById('interactive-board');
const subredditUrl = 'https://www.reddit.com/r/TileFinder/';

const tileColors = [
  'tile-cream',
  'tile-blue',
  'tile-red',
  'tile-orange',
  'tile-green',
] as const;

const titleColors = [
  'tile-green',
  'tile-red',
  'tile-blue',
  'tile-orange',
] as const;

type TileColor = (typeof tileColors)[number];
type BoardCoord = readonly [number, number];
type BoardAction = 'join' | 'leaderboard';

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

if (leaderboardClose instanceof HTMLButtonElement) {
  leaderboardClose.addEventListener('click', () => closeLeaderboard());
}

if (leaderboardDialog instanceof HTMLElement) {
  leaderboardDialog.addEventListener('pointerdown', (event) => {
    if (event.target === leaderboardDialog) {
      closeLeaderboard();
    }
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeLeaderboard();
  }
});

if (interactiveBoard instanceof HTMLElement) {
  buildBoard(interactiveBoard);
  window.addEventListener('resize', () => buildBoard(interactiveBoard));

  interactiveBoard.addEventListener('pointerdown', (event) => {
    const tile = getBoardTile(event.target);

    if (!tile || tile.classList.contains('board-action')) {
      return;
    }

    cycleTile(tile);
  });

  interactiveBoard.addEventListener('click', (event) => {
    const tile = getBoardTile(event.target);

    if (!tile || !tile.classList.contains('board-action')) {
      return;
    }

    handleBoardAction(tile);
  });

  interactiveBoard.addEventListener('pointerover', (event) => {
    const tile = getBoardTile(event.target);

    if (tile) {
      tile.classList.add('is-near');
    }
  });

  interactiveBoard.addEventListener('pointerout', (event) => {
    const tile = getBoardTile(event.target);

    if (tile) {
      tile.classList.remove('is-near');
    }
  });
}

document.querySelectorAll('.letter-tile').forEach((tile) => {
  tile.addEventListener('pointerdown', () => {
    cycleTitleTiles();
  });
});

window.setInterval(() => {
  pulseTitleLetter();
}, 3600);

function buildBoard(board: HTMLElement): void {
  const columns = window.matchMedia('(max-width: 640px)').matches ? 7 : 12;
  const tileSize = window.matchMedia('(max-width: 640px)').matches ? 48 : 58;
  const rows = Math.max(9, Math.ceil(window.innerHeight / tileSize) + 2);
  const patternKeys = greenPatternKeys(columns, rows);

  board.style.setProperty('--board-columns', columns.toString());
  board.replaceChildren();

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const action = boardActionFor(row, col, columns);
      if (action) {
        board.append(createActionTile(action));
        continue;
      }

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

function boardActionFor(
  row: number,
  col: number,
  columns: number
): BoardAction | null {
  if (row !== 0) {
    return null;
  }

  if (col === columns - 1) {
    return 'leaderboard';
  }

  if (col === columns - 2) {
    return 'join';
  }

  return null;
}

function createActionTile(action: BoardAction): HTMLButtonElement {
  const tile = document.createElement('button');
  const icon = document.createElement('span');
  const isJoinAction = action === 'join';

  tile.type = 'button';
  tile.className = `board-tile board-action ${
    isJoinAction ? 'join-action' : 'leaderboard-action'
  }`;
  tile.dataset.action = action;
  tile.setAttribute(
    'aria-label',
    isJoinAction ? 'Join the subreddit' : 'Open leaderboard'
  );

  if (!isJoinAction) {
    tile.setAttribute('aria-haspopup', 'dialog');
    tile.setAttribute('aria-controls', 'leaderboard-dialog');
  }

  icon.className = 'board-action-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = isJoinAction ? 'r/' : '\uD83C\uDFC6';

  tile.append(icon);
  return tile;
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
  const value = (row * 11 + col * 7 + row * col) % 20;

  if ([1, 9, 13, 19].includes(value)) {
    return 'tile-blue';
  }
  if ([2, 15, 18].includes(value)) {
    return 'tile-red';
  }
  if ([3, 8, 16].includes(value)) {
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

function handleBoardAction(tile: HTMLButtonElement): void {
  tile.classList.add('pulse');
  window.setTimeout(() => tile.classList.remove('pulse'), 420);

  if (tile.dataset.action === 'leaderboard') {
    openLeaderboard();
    return;
  }

  if (tile.dataset.action === 'join') {
    openSubreddit();
  }
}

function getBoardTile(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const tile = target.closest('.board-tile');
  return tile instanceof HTMLButtonElement ? tile : null;
}

function getLeaderboardButton(): HTMLButtonElement | null {
  const button = document.querySelector('[data-action="leaderboard"]');
  return button instanceof HTMLButtonElement ? button : null;
}

function openSubreddit(): void {
  try {
    window.open(subredditUrl, '_blank', 'noopener,noreferrer');
  } catch {
    // Static previews and some embed contexts may block opening new tabs.
  }
}

function openLeaderboard(): void {
  if (!(leaderboardDialog instanceof HTMLElement)) {
    return;
  }

  leaderboardDialog.hidden = false;
  getLeaderboardButton()?.setAttribute('aria-expanded', 'true');

  if (leaderboardClose instanceof HTMLButtonElement) {
    leaderboardClose.focus();
  }
}

function closeLeaderboard(): void {
  if (!(leaderboardDialog instanceof HTMLElement) || leaderboardDialog.hidden) {
    return;
  }

  leaderboardDialog.hidden = true;
  getLeaderboardButton()?.setAttribute('aria-expanded', 'false');

  getLeaderboardButton()?.focus();
}

function pulseTitleLetter(): void {
  const letters = document.querySelectorAll<HTMLElement>('.letter-tile');
  if (letters.length === 0) {
    return;
  }

  const index = Math.floor(Date.now() / 3600) % letters.length;
  const letter = letters[index];
  if (!letter) {
    return;
  }

  letter.classList.add('title-idle');
  window.setTimeout(() => letter.classList.remove('title-idle'), 580);
}

function cycleTitleTiles(): void {
  const letters = document.querySelectorAll('.letter-tile');

  letters.forEach((letter) => {
    const currentIndex = titleColors.findIndex((color) =>
      letter.classList.contains(color)
    );
    const nextIndex =
      currentIndex < 0 ? 0 : (currentIndex + 1) % titleColors.length;
    const color = titleColors[nextIndex] ?? 'tile-green';

    letter.classList.remove(...tileColors, 'title-pop');
    letter.classList.add(color, 'title-pop');
    window.setTimeout(() => letter.classList.remove('title-pop'), 420);
  });
}

function tileKey(row: number, col: number): string {
  return `${row},${col}`;
}
