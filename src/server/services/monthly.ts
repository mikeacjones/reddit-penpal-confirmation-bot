import { context, reddit, redis, type Post } from '@devvit/web/server';
import { isUnset } from '../core/defaults';
import { formatTemplate, strftime } from '../core/format';
import { describeError, notifyMods } from './modmail';
import type { BotSettings } from './settings';

const CURRENT_POST_KEY = 'meta:current_post_id';
const PREVIOUS_POST_KEY = 'meta:previous_post_id';
const LAST_MONTHLY_KEY = 'meta:last_monthly_ym';
const MONTHLY_LOCK_SECONDS = 10 * 60;

export type MonthlyOutcome = 'created' | 'exists' | 'in-progress' | 'not-configured';

export const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

async function getRecentAppPosts(settings: BotSettings, limit = 10): Promise<Post[]> {
  const posts = await reddit
    .getPostsByUser({ username: settings.appUsername, sort: 'new', limit })
    .all();
  const subredditName = context.subredditName.toLowerCase();
  return posts.filter((post) => post.subredditName.toLowerCase() === subredditName);
}

/** The app's stickied post in this subreddit, i.e. the live confirmation thread. */
export async function findCurrentConfirmationPost(
  settings: BotSettings
): Promise<Post | undefined> {
  return (await getRecentAppPosts(settings)).find((post) => post.stickied);
}

/** Current and previous confirmation thread ids, discovering the current one if unknown. */
export async function getTrackedPostIds(settings: BotSettings): Promise<string[]> {
  let current = await redis.get(CURRENT_POST_KEY);
  if (!current) {
    const post = await findCurrentConfirmationPost(settings);
    if (post) {
      current = post.id;
      await redis.set(CURRENT_POST_KEY, current);
    }
  }
  const previous = await redis.get(PREVIOUS_POST_KEY);
  return [current, previous].filter((id): id is string => Boolean(id));
}

async function lockPreviousPosts(settings: BotSettings, exemptPostId: string): Promise<void> {
  for (const post of await getRecentAppPosts(settings)) {
    if (post.id === exemptPostId || post.locked) continue;
    console.log(`Locking previous confirmation thread https://reddit.com${post.permalink}`);
    await post.lock();
  }
}

async function recordMonthlyPost(ym: string, currentId: string, previousId?: string) {
  await redis.set(CURRENT_POST_KEY, currentId);
  if (previousId) await redis.set(PREVIOUS_POST_KEY, previousId);
  await redis.set(LAST_MONTHLY_KEY, ym);
}

/**
 * Creates this month's confirmation thread unless it already exists: unstickies
 * the previous thread, submits and stickies the new one (suggested sort "new")
 * and locks older threads. Safe to call from the cron, install hooks and sweep.
 */
export async function ensureMonthlyPost(
  settings: BotSettings,
  now = new Date()
): Promise<MonthlyOutcome> {
  const ym = monthKey(now);
  if ((await redis.get(LAST_MONTHLY_KEY)) === ym) return 'exists';

  const lockKey = `lock:monthly:${ym}`;
  if ((await redis.incrBy(lockKey, 1)) !== 1) return 'in-progress';
  await redis.expire(lockKey, MONTHLY_LOCK_SECONDS);

  try {
    const previous = await findCurrentConfirmationPost(settings);
    if (previous && monthKey(previous.createdAt) === ym) {
      await recordMonthlyPost(ym, previous.id);
      return 'exists';
    }

    const { templates } = settings;
    if (isUnset(templates.monthly_post_title) || isUnset(templates.monthly_post)) {
      await notifyMods(
        'monthly post not configured',
        'The monthly confirmation thread was not created because the `confirmation-bot/monthly_post_title` or `confirmation-bot/monthly_post` wiki page is not set.'
      );
      return 'not-configured';
    }

    if (previous?.stickied) await previous.unsticky();

    const flairId = templates.monthly_post_flair_id.trim();
    const post = await reddit.submitPost({
      subredditName: context.subredditName,
      title: strftime(templates.monthly_post_title.trim(), now),
      text: formatTemplate(templates.monthly_post, {
        bot_name: settings.appUsername,
        subreddit_name: context.subredditName,
        previous_month_submission: previous
          ? {
              id: previous.id,
              title: previous.title,
              permalink: previous.permalink,
              url: previous.url,
            }
          : { title: 'No Previous Confirmation Thread', permalink: '' },
        now,
      }),
      sendreplies: false,
      runAs: 'APP',
      ...(isUnset(flairId) ? {} : { flairId }),
    });

    await post.sticky(1);
    await post.setSuggestedCommentSort('NEW');
    await lockPreviousPosts(settings, post.id);
    await recordMonthlyPost(ym, post.id, previous?.id);

    console.log(`Created monthly confirmation thread https://reddit.com${post.permalink}`);
    return 'created';
  } finally {
    await redis.del(lockKey);
  }
}

/** Monthly post creation with failures reported to modmail. */
export async function ensureMonthlyPostOrNotify(
  settings: BotSettings
): Promise<MonthlyOutcome | 'failed'> {
  try {
    return await ensureMonthlyPost(settings);
  } catch (error) {
    console.error('Monthly post creation failed', error);
    await notifyMods(
      'monthly post failed',
      `Creating the monthly confirmation thread failed. The hourly sweep will retry.\n\nError: \`${describeError(error)}\``
    );
    return 'failed';
  }
}
