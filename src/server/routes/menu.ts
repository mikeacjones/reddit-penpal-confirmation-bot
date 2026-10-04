import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { ensureMonthlyPost } from '../services/monthly';
import { describeError } from '../services/modmail';
import { getSettings, reloadSettings } from '../services/settings';
import { runSweep } from '../services/sweep';

export const menu = new Hono();

menu.post('/reload-settings', async (c) => {
  await c.req.json<MenuItemRequest>();
  try {
    const settings = await reloadSettings();
    const { ranged, special } = settings.flairTemplates;
    return c.json<UiResponse>({
      showToast: {
        text: `Settings reloaded (${ranged.length} ranged, ${special.length} non-ranged flair templates)`,
        appearance: 'success',
      },
    });
  } catch (error) {
    console.error('Settings reload failed', error);
    return c.json<UiResponse>({ showToast: `Reload failed: ${describeError(error)}` });
  }
});

menu.post('/run-sweep', async (c) => {
  await c.req.json<MenuItemRequest>();
  try {
    const summary = await runSweep(await getSettings());
    return c.json<UiResponse>({
      showToast: {
        text: `Catch-up done: ${summary.processed} processed, ${summary.failed} failed`,
        appearance: 'success',
      },
    });
  } catch (error) {
    console.error('Manual sweep failed', error);
    return c.json<UiResponse>({ showToast: `Catch-up failed: ${describeError(error)}` });
  }
});

menu.post('/create-monthly', async (c) => {
  await c.req.json<MenuItemRequest>();
  try {
    const outcome = await ensureMonthlyPost(await getSettings());
    const messages = {
      created: 'Monthly confirmation thread created',
      exists: 'This month’s confirmation thread already exists',
      'in-progress': 'Monthly thread creation is already in progress',
      'not-configured': 'Monthly post wiki pages are not configured',
    } as const;
    return c.json<UiResponse>({ showToast: messages[outcome] });
  } catch (error) {
    console.error('Manual monthly post failed', error);
    return c.json<UiResponse>({ showToast: `Monthly post failed: ${describeError(error)}` });
  }
});

menu.post('/set-counts', async (c) => {
  await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>({
    showForm: {
      name: 'setCounts',
      form: {
        title: 'Set confirmation counts',
        description:
          'Overrides the counts the bot has stored for a user and updates their flair. Use this instead of editing flair by hand.',
        acceptLabel: 'Save',
        fields: [
          { name: 'username', label: 'Username (without u/)', type: 'string', required: true },
          { name: 'emails', label: 'Emails', type: 'number', required: true, defaultValue: 0 },
          { name: 'letters', label: 'Letters', type: 'number', required: true, defaultValue: 0 },
        ],
      },
    },
  });
});
