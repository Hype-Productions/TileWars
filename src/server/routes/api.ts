import { Hono } from 'hono';
import type { DailyResponse } from '../../shared/api';
import { todayUtcDate } from '../../shared/pattern';

export const api = new Hono();

api.get('/daily', (c) => {
  return c.json<DailyResponse>({
    type: 'daily',
    date: todayUtcDate(),
    seed: 'pattern',
  });
});
