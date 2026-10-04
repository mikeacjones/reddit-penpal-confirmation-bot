import type { Counts } from '../core/flair';

/** The subset of the Devvit Redis client used here, so tests can supply a fake. */
export type RedisTx = {
  multi(): Promise<void>;
  exec(): Promise<unknown[] | null | undefined>;
  unwatch(): Promise<unknown>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<unknown>;
  hSetNX(key: string, field: string, value: string): Promise<unknown>;
  hIncrBy(key: string, field: string, value: number): Promise<unknown>;
  set(key: string, value: string, options?: { nx?: boolean; expiration?: Date }): Promise<unknown>;
};

export type RedisStore = {
  watch(...keys: string[]): Promise<RedisTx>;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, options?: { nx?: boolean; expiration?: Date }): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
  incrBy(key: string, value: number): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  expireTime(key: string): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<number>;
  zAdd(key: string, ...members: { member: string; score: number }[]): Promise<number>;
  zRem(key: string, members: string[]): Promise<number>;
  zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: { by: 'score' | 'lex' | 'rank' }
  ): Promise<{ member: string; score: number }[]>;
};

/** Markers outlive the monthly thread they belong to (threads lock after a month). */
const MARKER_TTL_MS = 120 * 24 * 60 * 60 * 1000;
const COMMENT_LOCK_SECONDS = 5 * 60;
const MAX_TX_ATTEMPTS = 10;
const PENDING_FLAIR_KEY = 'flair:pending';

export const countsKey = (username: string) => `counts:${username.toLowerCase()}`;
const appliedKey = (commentId: string, index: number) => `applied:${commentId}:${index}`;
const doneKey = (commentId: string) => `comment:done:${commentId}`;
const lockKey = (commentId: string) => `comment:lock:${commentId}`;
const attemptsKey = (commentId: string) => `comment:attempts:${commentId}`;

const markerExpiration = () => new Date(Date.now() + MARKER_TTL_MS);

export type ApplyConfirmationInput = {
  username: string;
  commentId: string;
  matchIndex: number;
  emails: number;
  letters: number;
  /** Counts to seed Redis with if the user has no entry yet (parsed from current flair). */
  seed: Counts;
};

export type ApplyConfirmationResult = {
  before: Counts;
  after: Counts;
  seeded: boolean;
  alreadyApplied: boolean;
};

function readCounts(hash: Record<string, string>): Counts | undefined {
  if (hash.emails === undefined || hash.letters === undefined) return undefined;
  return { emails: Number(hash.emails) || 0, letters: Number(hash.letters) || 0 };
}

export async function getCounts(store: RedisStore, username: string): Promise<Counts | undefined> {
  return readCounts(await store.hGetAll(countsKey(username)));
}

/**
 * Atomically applies one confirmation to a user's counts.
 *
 * Redis is the source of truth. A user without an entry is seeded from `seed`
 * in the same transaction as the increment, so concurrent confirmations cannot
 * lose the seed. The per-match `applied` marker is written in that transaction
 * too, making retries (trigger + hourly sweep) exactly-once per confirmation.
 */
export async function applyConfirmation(
  store: RedisStore,
  input: ApplyConfirmationInput
): Promise<ApplyConfirmationResult> {
  const key = countsKey(input.username);
  const marker = appliedKey(input.commentId, input.matchIndex);

  for (let attempt = 0; attempt < MAX_TX_ATTEMPTS; attempt++) {
    const tx = await store.watch(key, marker);
    const [applied, hash] = await Promise.all([store.get(marker), store.hGetAll(key)]);

    if (applied) {
      await tx.unwatch();
      const recorded = JSON.parse(applied) as { before: Counts; after: Counts };
      return { ...recorded, seeded: false, alreadyApplied: true };
    }

    const existing = readCounts(hash);
    const before = existing ?? input.seed;
    const after = {
      emails: before.emails + input.emails,
      letters: before.letters + input.letters,
    };
    const now = new Date().toISOString();

    await tx.multi();
    if (!existing) {
      await tx.hSetNX(key, 'emails', String(input.seed.emails));
      await tx.hSetNX(key, 'letters', String(input.seed.letters));
      await tx.hSetNX(key, 'seededAt', now);
    }
    await tx.hIncrBy(key, 'emails', input.emails);
    await tx.hIncrBy(key, 'letters', input.letters);
    await tx.hSet(key, { updatedAt: now });
    await tx.set(marker, JSON.stringify({ before, after }), { expiration: markerExpiration() });

    let result: unknown[] | null | undefined;
    try {
      result = await tx.exec();
    } catch {
      result = null;
    }
    if (Array.isArray(result) && result.length > 0) {
      return { before, after, seeded: !existing, alreadyApplied: false };
    }
  }
  throw new Error(`Could not update counts for u/${input.username}: too much contention`);
}

/** Moderator override: replaces a user's counts outright. */
export async function setCounts(
  store: RedisStore,
  username: string,
  counts: Counts
): Promise<void> {
  await store.hSet(countsKey(username), {
    emails: String(counts.emails),
    letters: String(counts.letters),
    updatedAt: new Date().toISOString(),
  });
}

export async function isCommentDone(store: RedisStore, commentId: string): Promise<boolean> {
  return (await store.get(doneKey(commentId))) !== undefined;
}

export async function markCommentDone(store: RedisStore, commentId: string): Promise<void> {
  await store.set(doneKey(commentId), new Date().toISOString(), {
    expiration: markerExpiration(),
  });
  await store.del(attemptsKey(commentId));
}

/**
 * Short-lived lock so the comment trigger and the hourly sweep never process
 * the same comment concurrently. Expires on its own if a handler dies.
 */
export async function acquireCommentLock(store: RedisStore, commentId: string): Promise<boolean> {
  const key = lockKey(commentId);
  const holders = await store.incrBy(key, 1);
  if (holders === 1) {
    await store.expire(key, COMMENT_LOCK_SECONDS);
    return true;
  }
  if ((await store.expireTime(key)) < 0) {
    await store.expire(key, COMMENT_LOCK_SECONDS);
  }
  return false;
}

export async function releaseCommentLock(store: RedisStore, commentId: string): Promise<void> {
  await store.del(lockKey(commentId));
}

export async function recordCommentFailure(store: RedisStore, commentId: string): Promise<number> {
  const key = attemptsKey(commentId);
  const attempts = await store.incrBy(key, 1);
  await store.expire(key, Math.floor(MARKER_TTL_MS / 1000));
  return attempts;
}

export async function addPendingFlair(store: RedisStore, username: string): Promise<void> {
  await store.zAdd(PENDING_FLAIR_KEY, { member: username.toLowerCase(), score: Date.now() });
}

export async function removePendingFlair(store: RedisStore, username: string): Promise<void> {
  await store.zRem(PENDING_FLAIR_KEY, [username.toLowerCase()]);
}

export async function listPendingFlair(store: RedisStore, limit = 50): Promise<string[]> {
  const members = await store.zRange(PENDING_FLAIR_KEY, 0, limit - 1, { by: 'rank' });
  return members.map((entry) => entry.member);
}
