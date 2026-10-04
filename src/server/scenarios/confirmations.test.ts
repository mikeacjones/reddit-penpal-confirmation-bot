import { redis } from '@devvit/web/server';
import { describe, expect } from 'vitest';
import { getCounts, listPendingFlair } from '../services/counts';
import { APP_USER, FakeReddit, deliver, flairText, test } from '../testing/harness';

function setup() {
  const world = new FakeReddit();
  const thread = world.addPost({ stickied: true });
  world.addUser('bob');
  return { world, thread };
}

describe('confirmation comments', () => {
  test('seeds a new user from their flair and applies the confirmation', async () => {
    const { world, thread } = setup();
    world.addUser('alice', { text: flairText(2, 3) });

    const event = world.addComment(thread.id, 'bob', 'u/alice - 1 - 2');
    await deliver('/triggers/on-comment-submit', event);

    expect(await getCounts(redis, 'alice')).toEqual({ emails: 3, letters: 5 });
    expect(world.flairUpdates).toEqual([
      { username: 'alice', flairTemplateId: 'tpl-new', text: flairText(3, 5), cssClass: undefined },
    ]);
    expect(world.repliesTo(event.comment.id)).toEqual([
      'Updated u/alice from  Emails: 2 |  Letters: 3 to  Emails: 3 |  Letters: 5',
    ]);
  });

  test('keeps counting from Redis once seeded, ignoring hand-edited flair', async () => {
    const { world, thread } = setup();
    world.addUser('alice', { text: flairText(2, 3) });
    await deliver('/triggers/on-comment-submit', world.addComment(thread.id, 'bob', 'u/alice 1 1'));

    world.user('alice').flairText = flairText(100, 100);
    await deliver('/triggers/on-comment-submit', world.addComment(thread.id, 'bob', 'u/alice 1 1'));

    expect(await getCounts(redis, 'alice')).toEqual({ emails: 4, letters: 5 });
    expect(world.user('alice').flairText).toBe(flairText(4, 5));
  });

  test('moves users up to the next ranged flair', async () => {
    const { world, thread } = setup();
    world.addUser('alice', { text: flairText(4, 4) });

    await deliver('/triggers/on-comment-submit', world.addComment(thread.id, 'bob', 'u/alice 1 1'));

    expect(world.flairUpdates.at(-1)).toMatchObject({
      flairTemplateId: 'tpl-regular',
      text: flairText(5, 5),
    });
  });

  test('gives moderators the mod-only flair', async () => {
    const { world, thread } = setup();
    world.addUser('alice');
    world.moderators = ['alice'];

    await deliver('/triggers/on-comment-submit', world.addComment(thread.id, 'bob', 'u/alice 1 1'));

    expect(world.flairUpdates.at(-1)).toMatchObject({ flairTemplateId: 'tpl-mod' });
  });

  test('keeps a non-ranged flair while updating its counts', async () => {
    const { world, thread } = setup();
    world.addUser('alice', { text: `🌟 ${flairText(1, 1)}`, cssClass: 'tpl-star' });

    await deliver('/triggers/on-comment-submit', world.addComment(thread.id, 'bob', 'u/alice 1 1'));

    expect(world.flairUpdates.at(-1)).toEqual({
      username: 'alice',
      flairTemplateId: 'tpl-star',
      text: `🌟 ${flairText(2, 2)}`,
      cssClass: 'tpl-star',
    });
  });

  test('handles several confirmations in one comment with a single reply', async () => {
    const { world, thread } = setup();
    world.addUser('alice');
    world.addUser('carol');

    const event = world.addComment(thread.id, 'bob', 'u/alice 1 0\nu/carol - 0 - 2');
    await deliver('/triggers/on-comment-submit', event);

    expect(await getCounts(redis, 'alice')).toEqual({ emails: 1, letters: 0 });
    expect(await getCounts(redis, 'carol')).toEqual({ emails: 0, letters: 2 });
    const replies = world.repliesTo(event.comment.id);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('u/alice');
    expect(replies[0]).toContain('u/carol');
  });

  test('refuses self-confirmation', async () => {
    const { world, thread } = setup();

    const event = world.addComment(thread.id, 'bob', 'u/bob 5 5');
    await deliver('/triggers/on-comment-submit', event);

    expect(await getCounts(redis, 'bob')).toBeUndefined();
    expect(world.repliesTo(event.comment.id)).toEqual(['You cannot confirm yourself.']);
  });

  test('replies when the mentioned user does not exist', async () => {
    const { world, thread } = setup();

    const event = world.addComment(thread.id, 'bob', 'u/ghost 1 1');
    await deliver('/triggers/on-comment-submit', event);

    expect(world.repliesTo(event.comment.id)).toEqual(['u/ghost does not exist.']);
  });

  test('ignores replies, other posts and its own comments', async () => {
    const { world, thread } = setup();
    world.addUser('alice');
    const otherPost = world.addPost({ authorName: 'someone' });
    const parent = world.addComment(thread.id, 'bob', 'hello');

    await deliver(
      '/triggers/on-comment-submit',
      world.addComment(thread.id, 'bob', 'u/alice 1 1', { parentId: parent.comment.id })
    );
    await deliver(
      '/triggers/on-comment-submit',
      world.addComment(otherPost.id, 'bob', 'u/alice 1 1')
    );
    await deliver(
      '/triggers/on-comment-submit',
      world.addComment(thread.id, APP_USER.username, 'u/alice 1 1')
    );

    expect(await getCounts(redis, 'alice')).toBeUndefined();
    expect(world.replies).toEqual([]);
  });
});

describe('retries and catch-up', () => {
  test('applies a confirmation once even when delivered repeatedly and swept', async () => {
    const { world, thread } = setup();
    world.addUser('alice');

    const event = world.addComment(thread.id, 'bob', 'u/alice 1 1');
    await deliver('/triggers/on-comment-submit', event);
    await deliver('/triggers/on-comment-submit', event);
    await deliver('/cron/hourly-sweep');

    expect(await getCounts(redis, 'alice')).toEqual({ emails: 1, letters: 1 });
    expect(world.repliesTo(event.comment.id)).toHaveLength(1);
  });

  test('the hourly sweep processes comments the trigger missed', async () => {
    const { world, thread } = setup();
    world.addUser('alice');

    const event = world.addComment(thread.id, 'bob', 'u/alice 2 3');
    await deliver('/cron/hourly-sweep');

    expect(await getCounts(redis, 'alice')).toEqual({ emails: 2, letters: 3 });
    expect(world.repliesTo(event.comment.id)).toHaveLength(1);
  });

  test('does not double count when replying fails and the comment is retried', async () => {
    const { world, thread } = setup();
    world.addUser('alice');
    world.replyFailures = [new Error('Reddit is down')];

    const event = world.addComment(thread.id, 'bob', 'u/alice 1 1');
    await deliver('/triggers/on-comment-submit', event);
    expect(world.replies).toEqual([]);

    await deliver('/cron/hourly-sweep');

    expect(await getCounts(redis, 'alice')).toEqual({ emails: 1, letters: 1 });
    expect(world.repliesTo(event.comment.id)).toHaveLength(1);
  });

  test('gives up after three failures and tells the moderators', async () => {
    const { world, thread } = setup();
    world.addUser('alice');
    world.replyFailures = [new Error('one'), new Error('two'), new Error('three')];

    const event = world.addComment(thread.id, 'bob', 'u/alice 1 1');
    for (let attempt = 0; attempt < 4; attempt++) {
      await deliver('/triggers/on-comment-submit', event);
    }

    expect(world.replies).toEqual([]);
    expect(world.modNotifications).toHaveLength(1);
    expect(world.modNotifications[0]?.subject).toBe(
      'Confirmation bot: confirmation could not be processed'
    );
    expect(world.modNotifications[0]?.bodyMarkdown).toContain('three');
  });

  test('queues failed flair updates and retries them on the next sweep', async () => {
    const { world, thread } = setup();
    world.addUser('alice');
    world.failFlairFor.add('alice');

    const event = world.addComment(thread.id, 'bob', 'u/alice 1 1');
    await deliver('/triggers/on-comment-submit', event);

    expect(await getCounts(redis, 'alice')).toEqual({ emails: 1, letters: 1 });
    expect(world.repliesTo(event.comment.id)[0]).toContain('Unable to update flair for `u/alice`');
    expect(await listPendingFlair(redis)).toEqual(['alice']);

    await deliver('/cron/hourly-sweep');
    expect(world.modNotifications.map((note) => note.subject)).toEqual([
      'Confirmation bot: flair updates failing',
    ]);

    world.failFlairFor.clear();
    await deliver('/cron/hourly-sweep');

    expect(world.user('alice').flairText).toBe(flairText(1, 1));
    expect(await listPendingFlair(redis)).toEqual([]);
  });
});
