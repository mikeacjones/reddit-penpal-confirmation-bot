import { context, reddit, redis } from '@devvit/web/server';
import type { T1 } from '@devvit/web/shared';
import { isSameUser, parseConfirmations, type Confirmation } from '../core/confirmation';
import {
  formatFlairText,
  isSpecialTemplate,
  parseFlairCounts,
  selectFlairTemplate,
  type Counts,
} from '../core/flair';
import { deEmojify, formatTemplate } from '../core/format';
import {
  acquireCommentLock,
  addPendingFlair,
  applyConfirmation,
  getCounts,
  isCommentDone,
  listPendingFlair,
  markCommentDone,
  recordCommentFailure,
  releaseCommentLock,
  removePendingFlair,
} from './counts';
import { describeError, notifyMods } from './modmail';
import { isModerator, type BotSettings } from './settings';

const MAX_COMMENT_ATTEMPTS = 3;

export type ConfirmationComment = {
  id: string;
  postId: string;
  body: string;
  authorName: string;
  permalink?: string | undefined;
};

export type ProcessOutcome = 'done' | 'already-done' | 'locked' | 'failed';

export const asThingId = <P extends 't1_' | 't3_'>(prefix: P, id: string): `${P}${string}` =>
  (id.startsWith(prefix) ? id : `${prefix}${id}`) as `${P}${string}`;

type FlairSyncResult = { ok: true; text: string } | { ok: false };

function renderFlair(
  settings: BotSettings,
  username: string,
  counts: Counts,
  cssClass: string | undefined
): string | undefined {
  const template = selectFlairTemplate(
    settings.flairTemplates,
    counts.emails + counts.letters,
    cssClass,
    isModerator(settings, username)
  );
  return template ? formatFlairText(template.text, counts) : undefined;
}

/**
 * Writes a user's flair from their Redis counts. On API failure the user is
 * queued so the hourly sweep can retry; Redis stays authoritative either way.
 */
export async function syncUserFlair(
  settings: BotSettings,
  username: string,
  currentCssClass: string | undefined
): Promise<FlairSyncResult> {
  const counts = await getCounts(redis, username);
  if (!counts) return { ok: false };

  const template = selectFlairTemplate(
    settings.flairTemplates,
    counts.emails + counts.letters,
    currentCssClass,
    isModerator(settings, username)
  );
  if (!template) {
    console.warn(`No flair template matches u/${username} (${counts.emails}/${counts.letters})`);
    return { ok: false };
  }

  const text = formatFlairText(template.text, counts);
  try {
    await reddit.setUserFlair({
      subredditName: context.subredditName,
      username,
      flairTemplateId: template.id,
      text,
      ...(isSpecialTemplate(settings.flairTemplates, template.id) ? { cssClass: template.id } : {}),
    });
    await removePendingFlair(redis, username);
    return { ok: true, text };
  } catch (error) {
    console.error(`Failed to set flair for u/${username}`, error);
    await addPendingFlair(redis, username);
    return { ok: false };
  }
}

async function handleConfirmation(
  settings: BotSettings,
  comment: ConfirmationComment,
  confirmation: Confirmation,
  matchIndex: number
): Promise<string> {
  const { templates } = settings;
  const mentionedName = confirmation.username;

  const user = await reddit.getUserByUsername(mentionedName).catch(() => undefined);
  if (!user) {
    return formatTemplate(templates.user_doesnt_exist, {
      mentioned_name: mentionedName,
      comment: { id: comment.id, author: comment.authorName, body: comment.body },
    });
  }

  if (isSameUser(user.username, comment.authorName)) {
    return templates.cant_update_yourself;
  }

  const flair = await user.getUserFlairBySubreddit(context.subredditName);
  const result = await applyConfirmation(redis, {
    username: user.username,
    commentId: comment.id,
    matchIndex,
    emails: confirmation.emails,
    letters: confirmation.letters,
    seed: parseFlairCounts(flair?.flairText, templates.flair_regex),
  });
  if (result.seeded) {
    console.log(`Seeded u/${user.username} from flair: ${JSON.stringify(result.before)}`);
  }

  const sync = await syncUserFlair(settings, user.username, flair?.flairCssClass);
  if (!sync.ok) {
    return formatTemplate(templates.flair_update_failed, { mentioned_name: mentionedName });
  }

  const oldFlair = result.seeded
    ? flair?.flairText || 'No Flair'
    : (renderFlair(settings, user.username, result.before, flair?.flairCssClass) ??
      (flair?.flairText || 'No Flair'));

  console.log(`Updated u/${user.username}: ${oldFlair} -> ${sync.text}`);
  return deEmojify(
    formatTemplate(templates.confirmation_message, {
      mentioned_name: mentionedName,
      old_flair: oldFlair,
      new_flair: sync.text,
    })
  );
}

/**
 * Processes every confirmation in a top-level comment and replies once.
 * Safe to call repeatedly: finished comments are skipped and each confirmation
 * is applied to Redis at most once, so failures are retried by the sweep.
 */
export async function processComment(
  settings: BotSettings,
  comment: ConfirmationComment
): Promise<ProcessOutcome> {
  if (await isCommentDone(redis, comment.id)) return 'already-done';
  if (!(await acquireCommentLock(redis, comment.id))) return 'locked';

  try {
    const confirmations = parseConfirmations(
      comment.body,
      settings.templates.confirmation_regex_pattern
    );
    if (confirmations.length > 0) {
      console.log(`Processing ${confirmations.length} confirmation(s) in ${comment.id}`);
    }

    const lines: string[] = [];
    for (const [index, confirmation] of confirmations.entries()) {
      lines.push(await handleConfirmation(settings, comment, confirmation, index));
    }

    if (lines.length > 0) {
      await reddit.submitComment({
        id: asThingId('t1_', comment.id) as T1,
        text: lines.join('\n\n'),
        runAs: 'APP',
      });
    }
    await markCommentDone(redis, comment.id);
    return 'done';
  } catch (error) {
    const attempts = await recordCommentFailure(redis, comment.id);
    console.error(`Failed to process ${comment.id} (attempt ${attempts})`, error);
    if (attempts >= MAX_COMMENT_ATTEMPTS) {
      await markCommentDone(redis, comment.id);
      await notifyMods(
        'confirmation could not be processed',
        [
          `A confirmation comment failed ${attempts} times and will not be retried automatically.`,
          '',
          `Comment: ${comment.permalink ? `https://reddit.com${comment.permalink}` : comment.id}`,
          '',
          `Error: \`${describeError(error)}\``,
        ].join('\n')
      );
    }
    return 'failed';
  } finally {
    await releaseCommentLock(redis, comment.id);
  }
}

/** Retries flair writes that failed earlier. Returns usernames still failing. */
export async function retryPendingFlair(settings: BotSettings): Promise<string[]> {
  const failing: string[] = [];
  for (const username of await listPendingFlair(redis)) {
    try {
      const user = await reddit.getUserByUsername(username);
      if (!user) {
        await removePendingFlair(redis, username);
        continue;
      }
      const flair = await user.getUserFlairBySubreddit(context.subredditName);
      const sync = await syncUserFlair(settings, user.username, flair?.flairCssClass);
      if (!sync.ok) failing.push(username);
    } catch (error) {
      console.error(`Pending flair retry failed for u/${username}`, error);
      failing.push(username);
    }
  }
  return failing;
}
