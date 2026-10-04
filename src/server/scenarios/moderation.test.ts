import { redis } from '@devvit/web/server';
import { describe, expect } from 'vitest';
import { getCounts } from '../services/counts';
import { getSettings } from '../services/settings';
import { FakeReddit, deliver, flairText, test } from '../testing/harness';

type ToastResponse = { showToast: string | { text: string; appearance: string } };

describe('set counts form', () => {
  test('overrides stored counts and updates flair', async () => {
    const world = new FakeReddit();
    world.addUser('alice', { text: flairText(1, 1) });

    const response = await deliver<ToastResponse>('/form/set-counts', {
      username: 'u/alice',
      emails: 20,
      letters: 5,
    });

    expect(await getCounts(redis, 'alice')).toEqual({ emails: 20, letters: 5 });
    expect(world.user('alice').flairText).toBe(flairText(20, 5));
    expect(response.showToast).toEqual({
      text: `u/alice is now: ${flairText(20, 5)}`,
      appearance: 'success',
    });
  });

  test('rejects invalid input', async () => {
    const world = new FakeReddit();
    world.addUser('alice');

    const response = await deliver<ToastResponse>('/form/set-counts', {
      username: 'alice',
      emails: -1,
      letters: 2.5,
    });

    expect(response.showToast).toBe('Enter a username and non-negative whole numbers.');
    expect(await getCounts(redis, 'alice')).toBeUndefined();
  });
});

describe('modmail reload command', () => {
  const reloadEvent = (author: string, authorType = 'moderator') => ({
    messageAuthor: { name: author },
    messageAuthorType: authorType,
    conversationId: 'conv1',
    messageId: 'msg1',
    conversationType: 'internal',
  });

  test('reloads settings when a moderator sends "reload" in a mod discussion', async () => {
    const world = new FakeReddit();
    world.moderators = ['modjane'];
    world.modmailMessages.set('msg1', { bodyMarkdown: 'reload', isInternal: true });
    await getSettings();

    world.wiki.set('confirmation-bot/cant_update_yourself', 'Nice try.');
    await deliver('/triggers/on-mod-mail', reloadEvent('modjane'));

    expect((await getSettings()).templates.cant_update_yourself).toBe('Nice try.');
    expect(world.modmailReplies).toEqual([
      { conversationId: 'conv1', body: 'Successfully reloaded bot settings', isInternal: true },
    ]);
  });

  test('ignores the command from non-moderators', async () => {
    const world = new FakeReddit();
    world.modmailMessages.set('msg1', { bodyMarkdown: 'reload', isInternal: true });

    await deliver('/triggers/on-mod-mail', reloadEvent('randomuser', 'participant_user'));

    expect(world.modmailReplies).toEqual([]);
  });
});

describe('sweep health', () => {
  test('alerts after three failed sweeps and reports recovery', async () => {
    const world = new FakeReddit();
    world.addPost({ stickied: true });
    world.listingFailures = [new Error('a'), new Error('b'), new Error('c')];

    for (let run = 0; run < 3; run++) await deliver('/cron/hourly-sweep');
    expect(world.modNotifications.map((note) => note.subject)).toEqual([
      'Confirmation bot: catch-up sweep failing',
    ]);

    await deliver('/cron/hourly-sweep');
    expect(world.modNotifications.map((note) => note.subject)).toEqual([
      'Confirmation bot: catch-up sweep failing',
      'Confirmation bot: recovered from outage',
    ]);
  });
});
