import { context } from '@devvit/web/server';
import { Hono } from 'hono';
import type { ProgressAcknowledgeRequest } from '../../shared/progression';
import { todayUtcDate } from '../../shared/pattern';
import {
  acknowledgeProgressRewards,
  loadProgressResponse,
} from '../core/progressStorage';
import { syncCurrentUserProgressFlair } from '../core/progressFlair';

export const progressApi = new Hono();

progressApi.get('/', async (c) => {
  const response = await loadProgressResponse(currentUserId(), todayUtcDate());
  await syncCurrentUserProgressFlair(response.progress);
  return c.json(response);
});

progressApi.post('/rewards/ack', async (c) => {
  const request: unknown = await c.req.json<ProgressAcknowledgeRequest>();
  const rewardIds =
    isRecord(request) && Array.isArray(request.rewardIds)
      ? request.rewardIds.filter(
          (rewardId): rewardId is string => typeof rewardId === 'string'
        )
      : [];
  await acknowledgeProgressRewards(currentUserId(), rewardIds.slice(0, 20));
  return c.json({ status: 'ok' as const });
});

const currentUserId = (): string => {
  return context.userId ?? context.loid ?? 'local-progress-preview';
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
