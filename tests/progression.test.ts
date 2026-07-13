import { describe, expect, it } from 'vitest';
import {
  activeDailyStreak,
  createInitialProgress,
  dailyXpForStreak,
  nextDailyStreak,
  summarizeProgress,
  versusXpForResult,
  xpRequiredForLevel,
} from '../src/shared/progression';

describe('progression', () => {
  it('scales levels gently and caps requirements', () => {
    expect(xpRequiredForLevel(1)).toBe(300);
    expect(xpRequiredForLevel(2)).toBe(350);
    expect(xpRequiredForLevel(20)).toBe(1000);
    expect(summarizeProgress({ ...createInitialProgress(), totalXp: 315 })).toMatchObject({
      level: 2,
      levelXp: 15,
      xpForNextLevel: 350,
    });
  });

  it('grows and caps Daily XP', () => {
    expect(dailyXpForStreak(1)).toBe(150);
    expect(dailyXpForStreak(2)).toBe(165);
    expect(dailyXpForStreak(11)).toBe(300);
    expect(dailyXpForStreak(100)).toBe(300);
  });

  it('keeps strict consecutive UTC streaks', () => {
    expect(nextDailyStreak(null, 0, '2026-07-10')).toBe(1);
    expect(nextDailyStreak('2026-07-10', 1, '2026-07-11')).toBe(2);
    expect(nextDailyStreak('2026-07-10', 8, '2026-07-12')).toBe(1);
    expect(nextDailyStreak('2026-07-11', 4, '2026-07-11')).toBe(4);
    expect(
      activeDailyStreak(
        { ...createInitialProgress(), dailyStreak: 4, lastDailyDate: '2026-07-10' },
        '2026-07-12'
      )
    ).toBe(0);
  });

  it('rewards completion without rewarding forfeits', () => {
    expect(versusXpForResult('win', true)).toBe(100);
    expect(versusXpForResult('draw', true)).toBe(70);
    expect(versusXpForResult('loss', true)).toBe(40);
    expect(versusXpForResult('loss', false)).toBe(0);
    expect(versusXpForResult('no-contest', false)).toBe(0);
  });
});
