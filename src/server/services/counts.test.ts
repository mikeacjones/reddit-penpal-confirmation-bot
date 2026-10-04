import { describe, expect, it } from 'vitest';
import {
  acquireCommentLock,
  applyConfirmation,
  countsKey,
  getCounts,
  isCommentDone,
  markCommentDone,
  releaseCommentLock,
  setCounts,
  type RedisStore,
  type RedisTx,
} from './counts';

/** In-memory Redis with optimistic WATCH/MULTI/EXEC semantics. */
class FakeRedis implements RedisStore {
  strings = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  versions = new Map<string, number>();
  ttl = new Map<string, number>();
  /** Runs once right before the next EXEC, to simulate a concurrent writer. */
  beforeExec: (() => void) | undefined;

  private bump(key: string) {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
  }

  async watch(...keys: string[]): Promise<RedisTx> {
    const watched = new Map(keys.map((key) => [key, this.versions.get(key) ?? 0]));
    const queue: (() => unknown)[] = [];
    const enqueue = async (op: () => unknown) => {
      queue.push(op);
    };
    return {
      multi: async () => {},
      unwatch: async () => {},
      exec: async () => {
        const hook = this.beforeExec;
        this.beforeExec = undefined;
        hook?.();
        for (const [key, version] of watched) {
          if ((this.versions.get(key) ?? 0) !== version) return null;
        }
        return queue.map((op) => op());
      },
      hSet: (key, values) => enqueue(() => this.hSetSync(key, values)),
      hSetNX: (key, field, value) =>
        enqueue(() => {
          if (this.hashes.get(key)?.has(field)) return 0;
          return this.hSetSync(key, { [field]: value });
        }),
      hIncrBy: (key, field, value) => enqueue(() => this.hIncrBySync(key, field, value)),
      set: (key, value) => enqueue(() => this.setSync(key, value)),
    };
  }

  private setSync(key: string, value: string) {
    this.strings.set(key, value);
    this.bump(key);
    return 'OK';
  }

  private hSetSync(key: string, values: Record<string, string>) {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    for (const [field, value] of Object.entries(values)) hash.set(field, value);
    this.hashes.set(key, hash);
    this.bump(key);
    return Object.keys(values).length;
  }

  hIncrBySync(key: string, field: string, value: number) {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    const next = (Number(hash.get(field)) || 0) + value;
    hash.set(field, String(next));
    this.hashes.set(key, hash);
    this.bump(key);
    return next;
  }

  async get(key: string) {
    return this.strings.get(key);
  }
  async set(key: string, value: string) {
    return this.setSync(key, value);
  }
  async del(...keys: string[]) {
    for (const key of keys) {
      this.strings.delete(key);
      this.hashes.delete(key);
      this.ttl.delete(key);
      this.bump(key);
    }
  }
  async incrBy(key: string, value: number) {
    const next = (Number(this.strings.get(key)) || 0) + value;
    this.setSync(key, String(next));
    return next;
  }
  async expire(key: string, seconds: number) {
    this.ttl.set(key, seconds);
  }
  async expireTime(key: string) {
    return this.ttl.has(key) ? 1 : -1;
  }
  async hGetAll(key: string) {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }
  async hSet(key: string, values: Record<string, string>) {
    return this.hSetSync(key, values);
  }
  async zAdd() {
    return 1;
  }
  async zRem() {
    return 1;
  }
  async zRange() {
    return [];
  }
}

const base = { commentId: 't1_abc', matchIndex: 0, emails: 1, letters: 2 };

describe('applyConfirmation', () => {
  it('seeds a new user from flair and applies the increment', async () => {
    const redis = new FakeRedis();
    const result = await applyConfirmation(redis, {
      ...base,
      username: 'PenPal',
      seed: { emails: 10, letters: 5 },
    });

    expect(result).toEqual({
      before: { emails: 10, letters: 5 },
      after: { emails: 11, letters: 7 },
      seeded: true,
      alreadyApplied: false,
    });
    expect(await getCounts(redis, 'penpal')).toEqual({ emails: 11, letters: 7 });
  });

  it('ignores flair once Redis has an entry', async () => {
    const redis = new FakeRedis();
    await setCounts(redis, 'penpal', { emails: 3, letters: 3 });
    const result = await applyConfirmation(redis, {
      ...base,
      username: 'penpal',
      seed: { emails: 999, letters: 999 },
    });

    expect(result.seeded).toBe(false);
    expect(result.after).toEqual({ emails: 4, letters: 5 });
  });

  it('applies each confirmation exactly once across retries', async () => {
    const redis = new FakeRedis();
    const input = { ...base, username: 'penpal', seed: { emails: 0, letters: 0 } };
    const first = await applyConfirmation(redis, input);
    const retry = await applyConfirmation(redis, input);

    expect(retry.alreadyApplied).toBe(true);
    expect(retry.before).toEqual(first.before);
    expect(retry.after).toEqual(first.after);
    expect(await getCounts(redis, 'penpal')).toEqual({ emails: 1, letters: 2 });
  });

  it('treats separate matches in one comment independently', async () => {
    const redis = new FakeRedis();
    const seed = { emails: 0, letters: 0 };
    await applyConfirmation(redis, { ...base, username: 'penpal', seed });
    await applyConfirmation(redis, { ...base, matchIndex: 1, username: 'penpal', seed });

    expect(await getCounts(redis, 'penpal')).toEqual({ emails: 2, letters: 4 });
  });

  it('retries when a concurrent writer changes the counts', async () => {
    const redis = new FakeRedis();
    await setCounts(redis, 'penpal', { emails: 1, letters: 1 });
    redis.beforeExec = () => redis.hIncrBySync(countsKey('penpal'), 'emails', 5);

    const result = await applyConfirmation(redis, {
      ...base,
      username: 'penpal',
      seed: { emails: 0, letters: 0 },
    });

    expect(result.before).toEqual({ emails: 6, letters: 1 });
    expect(await getCounts(redis, 'penpal')).toEqual({ emails: 7, letters: 3 });
  });

  it('does not reseed when another confirmation bootstraps the user first', async () => {
    const redis = new FakeRedis();
    const key = countsKey('penpal');
    redis.beforeExec = () => {
      redis.hIncrBySync(key, 'emails', 10 + 1);
      redis.hIncrBySync(key, 'letters', 10 + 2);
    };

    const result = await applyConfirmation(redis, {
      ...base,
      username: 'penpal',
      seed: { emails: 10, letters: 10 },
    });

    expect(result.seeded).toBe(false);
    expect(await getCounts(redis, 'penpal')).toEqual({ emails: 12, letters: 14 });
  });

  it('gives up after sustained contention', async () => {
    const redis = new FakeRedis();
    const key = countsKey('penpal');
    const original = redis.watch.bind(redis);
    redis.watch = async (...keys) => {
      const tx = await original(...keys);
      redis.beforeExec = () => redis.hIncrBySync(key, 'emails', 1);
      return tx;
    };

    await expect(
      applyConfirmation(redis, { ...base, username: 'penpal', seed: { emails: 0, letters: 0 } })
    ).rejects.toThrow(/contention/);
  });
});

describe('comment markers', () => {
  it('locks a comment to a single processor', async () => {
    const redis = new FakeRedis();
    expect(await acquireCommentLock(redis, 't1_x')).toBe(true);
    expect(await acquireCommentLock(redis, 't1_x')).toBe(false);
    await releaseCommentLock(redis, 't1_x');
    expect(await acquireCommentLock(redis, 't1_x')).toBe(true);
  });

  it('tracks finished comments', async () => {
    const redis = new FakeRedis();
    expect(await isCommentDone(redis, 't1_x')).toBe(false);
    await markCommentDone(redis, 't1_x');
    expect(await isCommentDone(redis, 't1_x')).toBe(true);
  });
});
