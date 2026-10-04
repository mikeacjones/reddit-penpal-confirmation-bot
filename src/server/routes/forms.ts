import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { setCounts } from '../services/counts';
import { describeError } from '../services/modmail';
import { syncUserFlair } from '../services/processor';
import { getSettings } from '../services/settings';

type SetCountsValues = {
  username?: string;
  emails?: number;
  letters?: number;
};

export const forms = new Hono();

const toCount = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

forms.post('/set-counts', async (c) => {
  const values = await c.req.json<SetCountsValues>();
  const username = values.username?.trim().replace(/^\/?u\//i, '');
  const emails = toCount(values.emails);
  const letters = toCount(values.letters);
  if (!username || emails === undefined || letters === undefined) {
    return c.json<UiResponse>({ showToast: 'Enter a username and non-negative whole numbers.' });
  }

  try {
    const user = await reddit.getUserByUsername(username);
    if (!user) return c.json<UiResponse>({ showToast: `u/${username} does not exist` });

    await setCounts(redis, user.username, { emails, letters });
    console.log(`u/${context.username} set u/${user.username} to ${emails}/${letters}`);

    const flair = await user.getUserFlairBySubreddit(context.subredditName);
    const sync = await syncUserFlair(await getSettings(), user.username, flair?.flairCssClass);
    return c.json<UiResponse>({
      showToast: sync.ok
        ? { text: `u/${user.username} is now: ${sync.text}`, appearance: 'success' }
        : `Counts saved for u/${user.username}, but flair could not be updated`,
    });
  } catch (error) {
    console.error('Set counts failed', error);
    return c.json<UiResponse>({ showToast: `Failed: ${describeError(error)}` });
  }
});
