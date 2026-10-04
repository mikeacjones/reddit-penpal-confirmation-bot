import { describe, expect, it } from 'vitest';
import { isSameUser, parseConfirmations } from './confirmation';

const PATTERN = String.raw`u/([a-zA-Z0-9_-]{3,})\s+\\?-?\s*(\d+)(?:\s+|\s*-\s*)(\d+)`;

describe('parseConfirmations', () => {
  it.each([
    'u/digitalmayhap - 1 - 2',
    'u/digitalmayhap - 1 2',
    'u/digitalmayhap 1 2',
    'u/digitalmayhap 1 - 2',
    'u/digitalmayhap \\- 1 - 2',
  ])('parses "%s"', (body) => {
    expect(parseConfirmations(body, PATTERN)).toEqual([
      { username: 'digitalmayhap', emails: 1, letters: 2 },
    ]);
  });

  it('finds multiple confirmations in one comment', () => {
    const body = 'Thanks!\n\nu/first_user 3 0\n\nu/second-user - 0 - 4';
    expect(parseConfirmations(body, PATTERN)).toEqual([
      { username: 'first_user', emails: 3, letters: 0 },
      { username: 'second-user', emails: 0, letters: 4 },
    ]);
  });

  it('returns nothing for non-confirmations', () => {
    expect(parseConfirmations('just chatting with u/someone', PATTERN)).toEqual([]);
  });

  it('tolerates a trailing newline in the wiki pattern', () => {
    expect(parseConfirmations('u/abc 1 1', `${PATTERN}\n`)).toHaveLength(1);
  });
});

describe('isSameUser', () => {
  it('compares case-insensitively', () => {
    expect(isSameUser('Alice', 'alice')).toBe(true);
    expect(isSameUser('Alice', 'bob')).toBe(false);
    expect(isSameUser('Alice', undefined)).toBe(false);
  });
});
