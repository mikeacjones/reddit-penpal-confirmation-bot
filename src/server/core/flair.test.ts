import { describe, expect, it } from 'vitest';
import {
  formatFlairText,
  isSpecialTemplate,
  parseFlairCounts,
  parseFlairTemplates,
  selectFlairTemplate,
  type RawFlairTemplate,
} from './flair';

const FLAIR_REGEX = '📧 Emails: (\\d+|{E}) \\| 📬 Letters: (\\d+|{L})';
const RANGED_REGEX = '((\\d+)-(\\d+):)📧 Emails: ({E}) \\| 📬 Letters: ({L})';
const SPECIAL_REGEX = '📧 Emails: ({E}) \\| 📬 Letters: ({L})';

const rawTemplates: RawFlairTemplate[] = [
  { id: 'starter', text: '0-49:📧 Emails: {E} | 📬 Letters: {L}', modOnly: false },
  { id: 'veteran', text: '50-9999:📧 Emails: {E} | 📬 Letters: {L}', modOnly: false },
  { id: 'mod', text: '0-9999:📧 Emails: {E} | 📬 Letters: {L}', modOnly: true },
  { id: 'volunteer', text: 'Volunteer - 📧 Emails: {E} | 📬 Letters: {L}', modOnly: false },
  { id: 'bot', text: 'Bot', modOnly: true },
];

const templates = parseFlairTemplates(rawTemplates, RANGED_REGEX, SPECIAL_REGEX);

describe('parseFlairCounts', () => {
  it('reads counts from flair text', () => {
    expect(parseFlairCounts('📧 Emails: 4 | 📬 Letters: 7', FLAIR_REGEX)).toEqual({
      emails: 4,
      letters: 7,
    });
  });

  it('treats placeholders, missing and unrelated flair as zero', () => {
    expect(parseFlairCounts('📧 Emails: {E} | 📬 Letters: {L}', FLAIR_REGEX)).toEqual({
      emails: 0,
      letters: 0,
    });
    expect(parseFlairCounts(undefined, FLAIR_REGEX)).toEqual({ emails: 0, letters: 0 });
    expect(parseFlairCounts('Moderator', FLAIR_REGEX)).toEqual({ emails: 0, letters: 0 });
  });
});

describe('parseFlairTemplates', () => {
  it('splits ranged and special templates and strips the range prefix', () => {
    expect(templates.ranged.map(({ id, min, max }) => ({ id, min, max }))).toEqual([
      { id: 'starter', min: 0, max: 49 },
      { id: 'veteran', min: 50, max: 9999 },
      { id: 'mod', min: 0, max: 9999 },
    ]);
    expect(templates.ranged[0]!.text).toBe('📧 Emails: {E} | 📬 Letters: {L}');
    expect(templates.special.map((t) => t.id)).toEqual(['volunteer']);
  });

  it('ignores templates matching neither pattern', () => {
    expect(isSpecialTemplate(templates, 'bot')).toBe(false);
    expect(templates.ranged.some((t) => t.id === 'bot')).toBe(false);
  });
});

describe('selectFlairTemplate', () => {
  it('selects the ranged template covering the total (inclusive)', () => {
    expect(selectFlairTemplate(templates, 0, undefined, false)?.id).toBe('starter');
    expect(selectFlairTemplate(templates, 49, undefined, false)?.id).toBe('starter');
    expect(selectFlairTemplate(templates, 50, undefined, false)?.id).toBe('veteran');
  });

  it('uses mod-only ranged templates for moderators', () => {
    expect(selectFlairTemplate(templates, 10, undefined, true)?.id).toBe('mod');
  });

  it('preserves special flair identified by css class', () => {
    expect(selectFlairTemplate(templates, 500, 'volunteer', false)?.id).toBe('volunteer');
  });

  it('returns undefined when nothing matches', () => {
    expect(selectFlairTemplate(templates, 10_000, undefined, false)).toBeUndefined();
  });
});

describe('formatFlairText', () => {
  it('fills in counts', () => {
    expect(
      formatFlairText('Volunteer - 📧 Emails: {E} | 📬 Letters: {L}', { emails: 2, letters: 9 })
    ).toBe('Volunteer - 📧 Emails: 2 | 📬 Letters: 9');
  });
});
