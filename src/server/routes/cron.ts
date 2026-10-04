import { Hono } from 'hono';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';
import { ensureMonthlyPostOrNotify } from '../services/monthly';
import { getSettings } from '../services/settings';
import { runScheduledSweep } from '../services/sweep';

export const cron = new Hono();

cron.post('/hourly-sweep', async (c) => {
  await c.req.json<TaskRequest>();
  await runScheduledSweep();
  return c.json<TaskResponse>({}, 200);
});

cron.post('/monthly-post', async (c) => {
  await c.req.json<TaskRequest>();
  const outcome = await ensureMonthlyPostOrNotify(await getSettings());
  console.log(`Monthly post job: ${outcome}`);
  return c.json<TaskResponse>({}, 200);
});
