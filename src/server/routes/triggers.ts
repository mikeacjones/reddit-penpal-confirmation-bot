import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  OnCommentSubmitRequest,
  OnModMailRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { isSameUser } from '../core/confirmation';
import { ensureMonthlyPostOrNotify } from '../services/monthly';
import { asThingId, processComment } from '../services/processor';
import { getSettings, isModerator, reloadSettings, type BotSettings } from '../services/settings';
import { runSweep } from '../services/sweep';

export const triggers = new Hono();

async function initializeInstallation(): Promise<void> {
  try {
    const settings = await reloadSettings();
    await ensureMonthlyPostOrNotify(settings);
    const summary = await runSweep(settings);
    console.log(`Install/upgrade sweep finished: ${JSON.stringify(summary)}`);
  } catch (error) {
    console.error('Install/upgrade initialization failed', error);
  }
}

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log(`App installed to r/${input.subreddit?.name}`);
  await initializeInstallation();
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-app-upgrade', async (c) => {
  const input = await c.req.json<OnAppUpgradeRequest>();
  console.log(`App upgraded in r/${input.subreddit?.name}`);
  await initializeInstallation();
  return c.json<TriggerResponse>({}, 200);
});

async function isAppPost(
  settings: BotSettings,
  postId: string,
  postAuthorId: string | undefined
): Promise<boolean> {
  if (postAuthorId && settings.appUserId) return postAuthorId === settings.appUserId;
  const post = await reddit.getPostById(asThingId('t3_', postId));
  return isSameUser(settings.appUsername, post.authorName);
}

triggers.post('/on-comment-submit', async (c) => {
  const input = await c.req.json<OnCommentSubmitRequest>();
  const comment = input.comment;
  if (!comment || comment.deleted || comment.spam) return c.json<TriggerResponse>({}, 200);

  const postId = asThingId('t3_', comment.postId);
  const isTopLevel = asThingId('t3_', comment.parentId) === postId;
  if (!isTopLevel) return c.json<TriggerResponse>({}, 200);

  const settings = await getSettings();
  const authorName = input.author?.name ?? '';
  if (!authorName || isSameUser(settings.appUsername, authorName)) {
    return c.json<TriggerResponse>({}, 200);
  }
  if (!(await isAppPost(settings, postId, input.post?.authorId))) {
    return c.json<TriggerResponse>({}, 200);
  }

  const outcome = await processComment(settings, {
    id: asThingId('t1_', comment.id),
    postId,
    body: comment.body,
    authorName,
    permalink: comment.permalink,
  });
  console.log(`Comment ${comment.id}: ${outcome}`);
  return c.json<TriggerResponse>({}, 200);
});

/**
 * Moderators can reload settings by sending "reload" in a mod discussion or as a
 * private moderator note, replacing the old "DM the bot" command.
 */
triggers.post('/on-mod-mail', async (c) => {
  const input = await c.req.json<OnModMailRequest>();
  const authorName = input.messageAuthor?.name;
  if (!authorName || input.messageAuthorType !== 'moderator') {
    return c.json<TriggerResponse>({}, 200);
  }

  const settings = await getSettings();
  if (isSameUser(settings.appUsername, authorName) || !isModerator(settings, authorName)) {
    return c.json<TriggerResponse>({}, 200);
  }

  const { conversation } = await reddit.modMail.getConversation({
    conversationId: input.conversationId,
  });
  const message = conversation?.messages[input.messageId];
  const body = (message?.bodyMarkdown ?? message?.body ?? '').trim().toLowerCase();
  const isPrivate = input.conversationType === 'internal' || message?.isInternal === true;
  if (!isPrivate || !/^!?reload\b/.test(body)) return c.json<TriggerResponse>({}, 200);

  console.log(`u/${authorName} requested a settings reload via modmail`);
  await reloadSettings();
  await reddit.modMail.reply({
    conversationId: input.conversationId,
    body: 'Successfully reloaded bot settings',
    isInternal: true,
  });
  return c.json<TriggerResponse>({}, 200);
});
