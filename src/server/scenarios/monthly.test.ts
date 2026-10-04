import { afterEach, describe, expect, vi } from 'vitest';
import { FakeReddit, deliver, test } from '../testing/harness';

const OCTOBER = new Date('2026-10-01T00:00:05Z');

function atTime(date: Date) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(date);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('monthly confirmation thread', () => {
  test('replaces last month’s thread with a new stickied thread', async () => {
    atTime(OCTOBER);
    const world = new FakeReddit();
    const september = world.addPost({
      title: 'September 2026 Confirmation Thread',
      createdAt: new Date('2026-09-01T00:00:05Z'),
      stickied: true,
    });

    await deliver('/cron/monthly-post');

    const october = world.posts[0];
    expect(october).toMatchObject({
      title: 'October 2026 Confirmation Thread',
      text: `Last month: ${september.permalink}`,
      stickied: true,
      locked: false,
      suggestedSort: 'NEW',
      flairId: '954b0f12-e0c8-11ee-94e1-f6da9c3e5220',
    });
    expect(september).toMatchObject({ stickied: false, locked: true });
  });

  test('creates the thread only once per month', async () => {
    atTime(OCTOBER);
    const world = new FakeReddit();

    await deliver('/cron/monthly-post');
    await deliver('/cron/monthly-post');
    await deliver('/cron/hourly-sweep');
    await deliver('/menu/create-monthly');

    expect(world.posts).toHaveLength(1);
  });

  test('picks up this month’s thread if it already exists', async () => {
    atTime(OCTOBER);
    const world = new FakeReddit();
    world.addPost({ createdAt: new Date('2026-10-01T00:00:01Z'), stickied: true });

    await deliver('/cron/monthly-post');

    expect(world.posts).toHaveLength(1);
  });

  test('tells the moderators when the thread templates are not set', async () => {
    atTime(OCTOBER);
    const world = new FakeReddit();
    world.wiki.delete('confirmation-bot/monthly_post');

    await deliver('/cron/monthly-post');

    expect(world.posts).toEqual([]);
    expect(world.modNotifications.map((note) => note.subject)).toEqual([
      'Confirmation bot: monthly post not configured',
    ]);
  });
});
