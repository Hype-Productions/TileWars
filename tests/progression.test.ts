import { describe, expect, it } from 'vitest';
import {
  activeDailyStreak,
  buildXpAnimationSegments,
  createInitialProgress,
  dailyXpForStreak,
  nextDailyStreak,
  rivalryOutcomeColor,
  rivalryOutcomeSlots,
  summarizeProgress,
  versusXpForResult,
  xpRequiredForLevel,
} from '../src/shared/progression';

describe('progression', () => {
  it('scales levels gently and caps requirements', () => {
    expect(xpRequiredForLevel(1)).toBe(300);
    expect(xpRequiredForLevel(2)).toBe(350);
    expect(xpRequiredForLevel(20)).toBe(1250);
    expect(xpRequiredForLevel(55)).toBe(3000);
    expect(xpRequiredForLevel(500)).toBe(3000);
    expect(summarizeProgress({ ...createInitialProgress(), totalXp: 315 })).toMatchObject({
      level: 2,
      levelXp: 15,
      xpForNextLevel: 350,
    });
  });

  it('grows and caps Daily XP', () => {
    expect(dailyXpForStreak(1)).toBe(150);
    expect(dailyXpForStreak(2)).toBe(160);
    expect(dailyXpForStreak(3)).toBe(170);
    expect(dailyXpForStreak(51)).toBe(650);
    expect(dailyXpForStreak(100)).toBe(650);
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

  it('builds XP animation segments across a level boundary', () => {
    expect(buildXpAnimationSegments(100, 150)).toEqual([
      {
        level: 1,
        fromXp: 100,
        toXp: 150,
        xpForNextLevel: 300,
        completesLevel: false,
      },
    ]);
    expect(buildXpAnimationSegments(250, 300)).toEqual([
      {
        level: 1,
        fromXp: 250,
        toXp: 300,
        xpForNextLevel: 300,
        completesLevel: true,
      },
    ]);
    expect(buildXpAnimationSegments(280, 330)).toEqual([
      {
        level: 1,
        fromXp: 280,
        toXp: 300,
        xpForNextLevel: 300,
        completesLevel: true,
      },
      {
        level: 2,
        fromXp: 0,
        toXp: 30,
        xpForNextLevel: 350,
        completesLevel: false,
      },
    ]);
    expect(buildXpAnimationSegments(280, 700)).toEqual([
      {
        level: 1,
        fromXp: 280,
        toXp: 300,
        xpForNextLevel: 300,
        completesLevel: true,
      },
      {
        level: 2,
        fromXp: 0,
        toXp: 350,
        xpForNextLevel: 350,
        completesLevel: true,
      },
      {
        level: 3,
        fromXp: 0,
        toXp: 50,
        xpForNextLevel: 400,
        completesLevel: false,
      },
    ]);
    expect(buildXpAnimationSegments(100, 100)).toEqual([]);
  });

  it('pads recent rivalry outcomes to five chronological slots', () => {
    expect(rivalryOutcomeSlots(['win', 'draw', 'loss'])).toEqual([
      'win',
      'draw',
      'loss',
      null,
      null,
    ]);
    expect(rivalryOutcomeColor('win')).toBe('green');
    expect(rivalryOutcomeColor('loss')).toBe('red');
    expect(rivalryOutcomeColor('draw')).toBe('orange');
    expect(rivalryOutcomeColor(null)).toBe('cream');
  });
});
