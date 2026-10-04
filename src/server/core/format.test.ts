import { describe, expect, it } from 'vitest';
import { deEmojify, formatTemplate, strftime, toInt, unescapeWiki } from './format';

const march = new Date(Date.UTC(2024, 2, 5, 14, 7, 9));

describe('strftime', () => {
  it('formats the default monthly title', () => {
    expect(strftime('%B %Y Confirmation Thread', march)).toBe('March 2024 Confirmation Thread');
  });

  it('supports common directives and no-pad flag', () => {
    expect(strftime('%Y-%m-%d %H:%M:%S', march)).toBe('2024-03-05 14:07:09');
    expect(strftime('%b %-d, %y (%a/%A) %j %I%p %%', march)).toBe(
      'Mar 5, 24 (Tue/Tuesday) 065 02PM %'
    );
  });

  it('leaves unknown directives untouched', () => {
    expect(strftime('%Q', march)).toBe('%Q');
  });
});

describe('formatTemplate', () => {
  it('substitutes simple and dotted placeholders', () => {
    expect(
      formatTemplate('{mentioned_name}: {old_flair} -> {new_flair} ({prev.title})', {
        mentioned_name: 'digitalmayhap',
        old_flair: 'a',
        new_flair: 'b',
        prev: { title: 'Feb' },
      })
    ).toBe('digitalmayhap: a -> b (Feb)');
  });

  it('applies date format specs and brace escapes', () => {
    expect(formatTemplate('{{literal}} {now:%B %Y}', { now: march })).toBe('{literal} March 2024');
  });

  it('keeps unknown placeholders', () => {
    expect(formatTemplate('Hello {missing}', {})).toBe('Hello {missing}');
  });
});

describe('helpers', () => {
  it('strips emoji like the original bot', () => {
    expect(deEmojify('📧 Emails: 1 | 📬 Letters: 2')).toBe(' Emails: 1 |  Letters: 2');
  });

  it('parses ints with fallback', () => {
    expect(toInt('12')).toBe(12);
    expect(toInt('{E}')).toBe(0);
    expect(toInt(undefined, 3)).toBe(3);
  });

  it('unescapes wiki markdown', () => {
    expect(unescapeWiki('&gt; quote &amp; &lt;b&gt;')).toBe('> quote & <b>');
  });
});
