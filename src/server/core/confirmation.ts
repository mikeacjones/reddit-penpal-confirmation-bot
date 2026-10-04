import { toInt } from './format';

export type Confirmation = {
  username: string;
  emails: number;
  letters: number;
};

/**
 * Extracts every `u/name emails letters` confirmation from a comment body.
 * The pattern must expose three capture groups: username, emails, letters.
 */
export function parseConfirmations(body: string, pattern: string): Confirmation[] {
  const regex = new RegExp(pattern.trim(), 'g');
  const confirmations: Confirmation[] = [];
  for (const match of body.matchAll(regex)) {
    const [, username, emails, letters] = match;
    if (!username) continue;
    confirmations.push({ username, emails: toInt(emails), letters: toInt(letters) });
  }
  return confirmations;
}

export function isSameUser(a: string, b: string | undefined): boolean {
  return b !== undefined && a.toLowerCase() === b.toLowerCase();
}
