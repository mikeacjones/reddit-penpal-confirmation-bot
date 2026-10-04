import { context, reddit, redis } from '@devvit/web/server';
import { isSameUser } from '../core/confirmation';
import { formatTemplate } from '../core/format';
import { isCommentDone } from './counts';
import { describeError, notifyMods } from './modmail';
import { ensureMonthlyPost, getTrackedPostIds } from './monthly';
import { asThingId, processComment, retryPendingFlair } from './processor';
import { getSettings, type BotSettings } from './settings';

/** Stop scanning a thread after this many consecutive already-processed comments. */
const DONE_STREAK_LIMIT = 25;
const MAX_COMMENTS_PER_POST = 1000;
const FAILURE_ALERT_THRESHOLD = 3;

const FAILURES_KEY = 'meta:sweep:failures';
const FAILING_SINCE_KEY = 'meta:sweep:failing_since';
const FLAIR_ALERT_KEY = 'meta:sweep:flair_alert_sent';
const FLAIR_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type SweepSummary = {
  posts: number;
  scanned: number;
  processed: number;
  failed: number;
  flairStillFailing: string[];
};

/**
 * Walks the newest top-level comments of the current and previous confirmation
 * threads and processes anything the comment trigger missed.
 */
export async function runSweep(settings: BotSettings): Promise<SweepSummary> {
  const summary: SweepSummary = {
    posts: 0,
    scanned: 0,
    processed: 0,
    failed: 0,
    flairStillFailing: [],
  };

  for (const postId of await getTrackedPostIds(settings)) {
    summary.posts++;
    let doneStreak = 0;
    const comments = reddit.getComments({
      postId: asThingId('t3_', postId),
      sort: 'new',
      limit: MAX_COMMENTS_PER_POST,
      pageSize: 100,
    });

    for await (const comment of comments) {
      summary.scanned++;
      if (comment.parentId !== comment.postId) continue;
      if (comment.stickied || comment.removed) continue;
      if (isSameUser(settings.appUsername, comment.authorName)) continue;

      if (await isCommentDone(redis, comment.id)) {
        if (++doneStreak >= DONE_STREAK_LIMIT) break;
        continue;
      }
      doneStreak = 0;

      const outcome = await processComment(settings, {
        id: comment.id,
        postId: comment.postId,
        body: comment.body,
        authorName: comment.authorName,
        permalink: comment.permalink,
      });
      if (outcome === 'done') summary.processed++;
      if (outcome === 'failed') summary.failed++;
    }
  }

  summary.flairStillFailing = await retryPendingFlair(settings);
  return summary;
}

async function recordSweepFailure(error: unknown): Promise<void> {
  const failures = await redis.incrBy(FAILURES_KEY, 1);
  if (failures === 1) await redis.set(FAILING_SINCE_KEY, new Date().toISOString());
  if (failures === FAILURE_ALERT_THRESHOLD) {
    await notifyMods(
      'catch-up sweep failing',
      `The hourly catch-up sweep has failed ${failures} times in a row. Confirmations may be delayed until it recovers.\n\nLatest error: \`${describeError(error)}\``
    );
  }
}

async function recordSweepSuccess(settings: BotSettings): Promise<void> {
  const failures = Number(await redis.get(FAILURES_KEY)) || 0;
  if (failures >= FAILURE_ALERT_THRESHOLD) {
    const startedAt = (await redis.get(FAILING_SINCE_KEY)) ?? 'unknown';
    await notifyMods(
      'recovered from outage',
      formatTemplate(settings.templates.outage_recovery, {
        started_at: startedAt,
        subreddit_name: context.subredditName,
      })
    );
  }
  if (failures > 0) await redis.del(FAILURES_KEY, FAILING_SINCE_KEY);
}

async function alertOnStuckFlair(usernames: string[]): Promise<void> {
  if (usernames.length === 0 || (await redis.get(FLAIR_ALERT_KEY))) return;
  await redis.set(FLAIR_ALERT_KEY, '1', {
    expiration: new Date(Date.now() + FLAIR_ALERT_INTERVAL_MS),
  });
  await notifyMods(
    'flair updates failing',
    [
      'These users have up-to-date counts stored by the bot, but their flair could not be updated. The bot keeps retrying every hour.',
      '',
      ...usernames.map((username) => `- u/${username}`),
    ].join('\n')
  );
}

/** Hourly job: catch up the monthly post, missed comments and failed flair writes. */
export async function runScheduledSweep(): Promise<SweepSummary | undefined> {
  try {
    const settings = await getSettings();
    try {
      await ensureMonthlyPost(settings);
    } catch (error) {
      console.error('Monthly post catch-up failed during sweep', error);
    }
    const summary = await runSweep(settings);
    console.log(`Sweep finished: ${JSON.stringify(summary)}`);
    await recordSweepSuccess(settings);
    await alertOnStuckFlair(summary.flairStillFailing);
    return summary;
  } catch (error) {
    console.error('Sweep failed', error);
    await recordSweepFailure(error);
    return undefined;
  }
}
