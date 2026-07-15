import { navigateTo, requestExpandedMode } from '@devvit/web/client';
import type {
  DailyLeaderboardResponse,
  LeaderboardEntry,
} from '../shared/game';
import {
  createDailyPuzzleId,
  leaderboardRankColor,
  selectLeaderboardDisplayRows,
} from '../shared/game';
import { todayUtcDate } from '../shared/pattern';
import { formatOptionalDuration } from '../shared/time';
import type { PlayerProgressSummary } from '../shared/progression';
import type { VersusInviteSummary } from '../shared/versus';
import { getVersusInvite } from './versusClient';
import {
  clearVersusInviteIntent,
  markVersusInviteHandled,
  readVersusShareData,
  rememberVersusInviteIntent,
  wasVersusInviteHandled,
} from './versusShare';

const dailyButton = document.getElementById('daily-button');
const versusButton = document.getElementById('versus-button');
const leaderboardDialog = document.getElementById('leaderboard-dialog');
const leaderboardClose = document.getElementById('leaderboard-close');
const leaderboardList = document.getElementById('leaderboard-list');
const interactiveBoard = document.getElementById('interactive-board');
const subredditUrl = 'https://www.reddit.com/r/TileFinder/';
const versusKicker = versusButton?.querySelector('.button-kicker');
const dailyNumber = document.getElementById('daily-number');
const dailyStreak = document.getElementById('daily-streak');
const inviteDialog = document.getElementById('invite-dialog');
const inviteMessage = document.getElementById('invite-message');
const inviteStatus = document.getElementById('invite-status');
const inviteAccept = document.getElementById('invite-accept');
const inviteDecline = document.getElementById('invite-decline');
let splashInviteId: string | null = null;

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

type GameEntrypoint = 'game' | 'versus';

const openExpandedGame = (
  event: MouseEvent,
  entrypoint: GameEntrypoint
): void => {
  try {
    requestExpandedMode(event, entrypoint);
    return;
  } catch {
    // Static previews do not provide Reddit's Devvit bridge.
  }

  try {
    window.open(entrypoint === 'versus' ? 'versus.html' : 'game.html', '_self');
  } catch {
    // Some embedded previews may block same-frame navigation.
  }
};

if (dailyButton instanceof HTMLButtonElement) {
  dailyButton.addEventListener('click', (event) => {
    openExpandedGame(event, 'game');
  });
}

if (versusButton instanceof HTMLButtonElement) {
  versusButton.addEventListener('click', (event) => {
    versusButton.classList.add('pulse');
    window.setTimeout(() => versusButton.classList.remove('pulse'), 420);
    openExpandedGame(event, 'versus');
  });
}

if (inviteAccept instanceof HTMLButtonElement) {
  inviteAccept.addEventListener('click', (event) => {
    if (!splashInviteId || inviteAccept.disabled) {
      return;
    }
    markVersusInviteHandled(splashInviteId);
    rememberVersusInviteIntent(splashInviteId);
    inviteAccept.textContent = 'Opening...';
    inviteAccept.disabled = true;
    openExpandedGame(event, 'versus');
  });
}

if (inviteDecline instanceof HTMLButtonElement) {
  inviteDecline.addEventListener('click', () => closeInviteDialog());
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
    if (inviteDialog instanceof HTMLElement && !inviteDialog.hidden) {
      closeInviteDialog();
      return;
    }
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

void loadSplashProgress();
renderDailyNumber();
showSharedInvite();

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
  const isJoinAction = action === 'join';
  const icon = isJoinAction
    ? document.createElement('span')
    : document.createElement('img');

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
  if (icon instanceof HTMLImageElement) {
    icon.src = '/assets/trophy.svg';
    icon.alt = '';
    icon.decoding = 'async';
  } else {
    icon.textContent = 'r/';
  }

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
    navigateTo(subredditUrl);
  } catch {
    try {
      window.open(subredditUrl, '_blank', 'noopener,noreferrer');
    } catch {
      // Static previews and some embed contexts may block opening new tabs.
    }
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

  void loadDailyLeaderboard();
}

function closeLeaderboard(): void {
  if (!(leaderboardDialog instanceof HTMLElement) || leaderboardDialog.hidden) {
    return;
  }

  leaderboardDialog.hidden = true;
  getLeaderboardButton()?.setAttribute('aria-expanded', 'false');

  getLeaderboardButton()?.focus();
}

function showSharedInvite(): void {
  const shared = readVersusShareData();
  if (
    !shared ||
    wasVersusInviteHandled(shared.inviteId) ||
    !(inviteDialog instanceof HTMLElement)
  ) {
    return;
  }
  splashInviteId = shared.inviteId;
  inviteDialog.hidden = false;
  if (inviteAccept instanceof HTMLButtonElement) {
    inviteAccept.disabled = false;
    inviteAccept.textContent = 'Accept';
    inviteAccept.focus();
  }
  void loadInvitePreview(shared.inviteId);
}

async function loadInvitePreview(inviteId: string): Promise<void> {
  try {
    const response = await getVersusInvite(inviteId);
    if (splashInviteId !== inviteId) {
      return;
    }
    renderInvitePreview(response.invite);
  } catch {
    if (splashInviteId === inviteId && inviteStatus instanceof HTMLElement) {
      inviteStatus.textContent = 'We will verify this invitation when you open it.';
    }
  }
}

function renderInvitePreview(invite: VersusInviteSummary): void {
  if (inviteMessage instanceof HTMLElement) {
    inviteMessage.textContent = `${invite.creatorDisplayName} has invited you to a 1v1 match.`;
  }
  if (!(inviteAccept instanceof HTMLButtonElement)) {
    return;
  }
  const canOpen =
    invite.status === 'open' ||
    (invite.role === 'acceptor' &&
      (invite.status === 'accepted-awaiting-pattern' || invite.status === 'matched'));
  inviteAccept.disabled = !canOpen;
  inviteAccept.textContent = invite.status === 'open' ? 'Accept' : 'Continue';

  if (invite.role === 'creator') {
    setInviteUnavailable('This is your invitation. Send it to another player.');
  } else if (!canOpen) {
    setInviteUnavailable('This invitation is no longer available.');
  }
}

function setInviteUnavailable(message: string): void {
  if (inviteMessage instanceof HTMLElement) {
    inviteMessage.textContent = message;
  }
  if (inviteStatus instanceof HTMLElement) {
    inviteStatus.textContent = '';
  }
  if (inviteDecline instanceof HTMLButtonElement) {
    inviteDecline.textContent = 'Close';
  }
}

function closeInviteDialog(): void {
  if (!(inviteDialog instanceof HTMLElement)) {
    return;
  }
  inviteDialog.hidden = true;
  if (splashInviteId) {
    markVersusInviteHandled(splashInviteId);
  }
  splashInviteId = null;
  clearVersusInviteIntent();
  if (inviteDecline instanceof HTMLButtonElement) {
    inviteDecline.textContent = 'Decline';
  }
  versusButton?.focus();
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

async function loadSplashProgress(): Promise<void> {
  try {
    const response = await fetch('/api/progress');
    if (!response.ok) {
      return;
    }
    const progress = toProgressSummary(await response.json());
    if (!progress) {
      return;
    }

    if (dailyStreak instanceof HTMLElement) {
      dailyStreak.textContent = `🔥 ${progress.dailyStreak}`;
      dailyStreak.setAttribute(
        'aria-label',
        `${progress.dailyStreak} day Daily streak`
      );
    }
    if (versusKicker instanceof HTMLElement) {
      const record = progress.versus;
      versusKicker.textContent = `Level ${progress.level} · ${record.wins}W ${record.losses}L ${record.draws}D`;
    }
  } catch {
    // Keep the static button labels when Reddit data is unavailable.
  }
}

function renderDailyNumber(): void {
  if (!(dailyNumber instanceof HTMLElement)) {
    return;
  }
  const puzzleNumber = createDailyPuzzleId(todayUtcDate()).puzzleNumber;
  dailyNumber.textContent = `#${puzzleNumber}`;
  dailyNumber.setAttribute('aria-label', `Daily puzzle ${puzzleNumber}`);
}

async function loadDailyLeaderboard(): Promise<void> {
  renderLeaderboardMessage("Loading today's rankings...");

  try {
    const response = await fetch('/api/daily/leaderboard');
    if (!response.ok) {
      throw new Error(`Leaderboard failed: ${response.status}`);
    }
    const data = toDailyLeaderboardResponse(await response.json());
    if (!data) {
      throw new Error('Leaderboard response was invalid.');
    }
    renderLeaderboard(data.leaderboard, data.playerRank);
  } catch {
    renderLeaderboardMessage('Daily leaderboard is unavailable right now.');
  }
}

function renderLeaderboard(
  leaderboard: LeaderboardEntry[],
  playerRank: LeaderboardEntry | null
): void {
  if (!(leaderboardList instanceof HTMLOListElement)) {
    return;
  }

  const rows = selectLeaderboardDisplayRows(leaderboard, playerRank);

  leaderboardList.replaceChildren();
  if (rows.length === 0) {
    renderLeaderboardMessage('No one has finished today yet.');
    return;
  }

  for (const row of rows) {
    const item = document.createElement('li');
    if (row.kind === 'ellipsis') {
      item.className = 'is-ellipsis';
      item.textContent = '…';
      leaderboardList.append(item);
      continue;
    }
    const entry = row.entry;
    const rank = document.createElement('span');
    const player = document.createElement('span');
    const score = document.createElement('span');

    if (row.isPlayer) {
      item.classList.add('is-player');
    }
    rank.className = `rank rank-color-${leaderboardRankColor(entry.rank)}`;
    rank.textContent = entry.rank.toString();
    player.className = 'player';
    player.textContent = entry.displayName;
    score.className = 'score';
    const guesses = document.createElement('span');
    const time = document.createElement('span');
    guesses.className = 'score-guesses';
    time.className = 'score-time';
    guesses.textContent = `${entry.guesses} ${entry.guesses === 1 ? 'guess' : 'guesses'}`;
    time.textContent = formatLeaderboardTime(entry.durationMs);
    score.append(guesses, time);
    item.append(rank, player, score);
    leaderboardList.append(item);
  }
}

function renderLeaderboardMessage(message: string): void {
  if (!(leaderboardList instanceof HTMLOListElement)) {
    return;
  }

  const item = document.createElement('li');
  const label = document.createElement('span');
  item.className = 'leaderboard-message';
  label.className = 'player';
  label.textContent = message;
  item.append(label);
  leaderboardList.replaceChildren(item);
}

function toProgressSummary(value: unknown): PlayerProgressSummary | null {
  if (!isRecord(value) || value.type !== 'progress' || !isRecord(value.progress)) {
    return null;
  }

  const progress = value.progress;
  const versus = progress.versus;
  if (
    !isRecord(versus) ||
    !isNumber(progress.totalXp) ||
    !isNumber(progress.dailyStreak) ||
    !(typeof progress.lastDailyDate === 'string' || progress.lastDailyDate === null) ||
    !isNumber(progress.level) ||
    !isNumber(progress.levelXp) ||
    !isNumber(progress.xpForNextLevel) ||
    !isNumber(versus.wins) ||
    !isNumber(versus.losses) ||
    !isNumber(versus.draws)
  ) {
    return null;
  }

  return {
    totalXp: progress.totalXp,
    dailyStreak: progress.dailyStreak,
    lastDailyDate: progress.lastDailyDate,
    level: progress.level,
    levelXp: progress.levelXp,
    xpForNextLevel: progress.xpForNextLevel,
    versus: {
      wins: versus.wins,
      losses: versus.losses,
      draws: versus.draws,
    },
  };
}

function toDailyLeaderboardResponse(
  value: unknown
): DailyLeaderboardResponse | null {
  if (
    !isRecord(value) ||
    value.type !== 'daily-leaderboard' ||
    !Array.isArray(value.leaderboard)
  ) {
    return null;
  }

  const leaderboard = value.leaderboard.filter(isLeaderboardEntry);
  if (leaderboard.length !== value.leaderboard.length) {
    return null;
  }

  const playerRank = value.playerRank;
  if (!(playerRank === null || isLeaderboardEntry(playerRank))) {
    return null;
  }

  return { type: 'daily-leaderboard', leaderboard, playerRank };
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  return (
    isRecord(value) &&
    isNumber(value.rank) &&
    typeof value.displayName === 'string' &&
    isNumber(value.guesses) &&
    isNumber(value.solvedAt) &&
    (value.durationMs === undefined || isNumber(value.durationMs))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatLeaderboardTime(durationMs: number | undefined): string {
  return formatOptionalDuration(durationMs);
}
