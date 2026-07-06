export const GRID_SIZE = 5;
export const MIN_PATTERN_SIZE = 4;
export const MAX_PATTERN_SIZE = 7;

export type Coord = {
  row: number;
  col: number;
};

export type ClueMode = 'balanced' | 'proximity';

export type ClueResult = {
  green: boolean;
  red: number;
  blue: number;
  orange: number;
};

export type ValidationResult = {
  valid: boolean;
  message: string;
};

export type WeightedColor = {
  color: 'red' | 'blue' | 'orange';
  weight: number;
};

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const DAY_MS = 24 * 60 * 60 * 1000;

export const todayUtcDate = (now: Date = new Date()): string => {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS)
    .toISOString()
    .slice(0, 10);
};

export const coordKey = (coord: Coord): string => `${coord.row},${coord.col}`;

export const coordLabel = (coord: Coord): string => {
  return `${LETTERS[coord.col]}${coord.row + 1}`;
};

export const sameCoord = (a: Coord, b: Coord): boolean => {
  return a.row === b.row && a.col === b.col;
};

export const allCoords = (): Coord[] => {
  const coords: Coord[] = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      coords.push({ row, col });
    }
  }
  return coords;
};

export const parseCoord = (value: string): Coord | null => {
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-E][1-5]$/.test(trimmed)) {
    return null;
  }

  return {
    col: LETTERS.indexOf(trimmed.charAt(0)),
    row: Number.parseInt(trimmed.charAt(1), 10) - 1,
  };
};

export const parsePatternInput = (input: string): Coord[] => {
  const tokens = input
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return tokens.map((token) => {
    const coord = parseCoord(token);
    if (!coord) {
      throw new Error(`Invalid coordinate: ${token}`);
    }
    return coord;
  });
};

export const validatePattern = (pattern: Coord[]): ValidationResult => {
  if (pattern.length < MIN_PATTERN_SIZE || pattern.length > MAX_PATTERN_SIZE) {
    return {
      valid: false,
      message: `Pattern must contain ${MIN_PATTERN_SIZE}-${MAX_PATTERN_SIZE} tiles.`,
    };
  }

  const seen = new Set<string>();
  for (const coord of pattern) {
    if (
      coord.row < 0 ||
      coord.row >= GRID_SIZE ||
      coord.col < 0 ||
      coord.col >= GRID_SIZE
    ) {
      return {
        valid: false,
        message: `Tile ${coordLabel(coord)} is outside the board.`,
      };
    }

    const key = coordKey(coord);
    if (seen.has(key)) {
      return {
        valid: false,
        message: `Tile ${coordLabel(coord)} is duplicated.`,
      };
    }
    seen.add(key);
  }

  if (!isConnected(pattern)) {
    return {
      valid: false,
      message: 'Pattern tiles must touch as one connected shape.',
    };
  }

  return {
    valid: true,
    message: 'Pattern is valid.',
  };
};

export const isConnected = (pattern: Coord[]): boolean => {
  if (pattern.length === 0) {
    return false;
  }

  const first = pattern.at(0);
  if (!first) {
    return false;
  }

  const remaining = new Set(pattern.map(coordKey));
  const queue: Coord[] = [first];
  remaining.delete(coordKey(first));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    for (const neighbor of neighbors(current)) {
      const key = coordKey(neighbor);
      if (remaining.has(key)) {
        remaining.delete(key);
        queue.push(neighbor);
      }
    }
  }

  return remaining.size === 0;
};

export const generatePattern = (
  seed: string,
  date: string = todayUtcDate()
): Coord[] => {
  const random = seededRandom(`${date}:${seed}`);
  const targetSize =
    MIN_PATTERN_SIZE +
    Math.floor(random() * (MAX_PATTERN_SIZE - MIN_PATTERN_SIZE + 1));
  const coords = allCoords();
  const pattern = [chooseCoord(coords, random)];

  while (pattern.length < targetSize) {
    const occupied = new Set(pattern.map(coordKey));
    const candidates = uniqueCoords(
      pattern.flatMap((coord) =>
        neighbors(coord).filter((neighbor) => !occupied.has(coordKey(neighbor)))
      )
    );
    const next = chooseCoord(candidates, random);
    pattern.push(next);
  }

  return pattern;
};

export const getClue = (guess: Coord, pattern: Coord[]): ClueResult => {
  const green = pattern.some((coord) => sameCoord(coord, guess));
  const sources = green
    ? pattern.filter((coord) => !sameCoord(coord, guess))
    : pattern;

  const verticalDistances = sources
    .filter((coord) => coord.col === guess.col)
    .map((coord) => Math.abs(coord.row - guess.row));
  const horizontalDistances = sources
    .filter((coord) => coord.row === guess.row)
    .map((coord) => Math.abs(coord.col - guess.col));
  const diagonalDistances = sources
    .filter(
      (coord) =>
        Math.abs(coord.row - guess.row) === Math.abs(coord.col - guess.col)
    )
    .map((coord) => Math.abs(coord.row - guess.row));

  return {
    green,
    red: proximityWeight(verticalDistances),
    blue: proximityWeight(horizontalDistances),
    orange: proximityWeight(diagonalDistances),
  };
};

export const getWeightedColors = (
  clue: ClueResult,
  mode: ClueMode
): WeightedColor[] => {
  const values: WeightedColor[] = [
    { color: 'red', weight: clue.red },
    { color: 'blue', weight: clue.blue },
    { color: 'orange', weight: clue.orange },
  ];
  const activeValues = values.filter((item) => item.weight > 0);

  if (mode === 'balanced') {
    return activeValues.map((item) => ({ color: item.color, weight: 1 }));
  }

  return activeValues;
};

export const getRemainingCount = (
  pattern: Coord[],
  foundTiles: Iterable<string>
): number => {
  const found = new Set(foundTiles);
  return pattern.filter((coord) => !found.has(coordKey(coord))).length;
};

const neighbors = (coord: Coord): Coord[] => {
  const result: Coord[] = [];
  for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
    for (let colDelta = -1; colDelta <= 1; colDelta += 1) {
      if (rowDelta === 0 && colDelta === 0) {
        continue;
      }

      const row = coord.row + rowDelta;
      const col = coord.col + colDelta;
      if (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) {
        result.push({ row, col });
      }
    }
  }
  return result;
};

const uniqueCoords = (coords: Coord[]): Coord[] => {
  const seen = new Set<string>();
  const result: Coord[] = [];

  for (const coord of coords) {
    const key = coordKey(coord);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(coord);
    }
  }

  return result;
};

const chooseCoord = (coords: Coord[], random: () => number): Coord => {
  const coord = coords[Math.floor(random() * coords.length)];
  if (!coord) {
    throw new Error('No coordinates available.');
  }
  return coord;
};

const proximityWeight = (distances: number[]): number => {
  const nearest = Math.min(...distances.filter((distance) => distance > 0));
  if (!Number.isFinite(nearest)) {
    return 0;
  }
  return 1 / nearest;
};

const seededRandom = (seed: string): (() => number) => {
  let state = hashString(seed);
  if (state === 0) {
    state = 1;
  }

  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};
