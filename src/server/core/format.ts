const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86_400_000) + 1;
}

/**
 * Formats a date in UTC using Python `strftime` directives, so wiki templates
 * written for the original bot (e.g. `%B %Y Confirmation Thread`) keep working.
 */
export function strftime(format: string, date: Date): string {
  return format.replace(/%(-?)([a-zA-Z%])/g, (whole, noPad: string, directive: string) => {
    const p = (value: number, width = 2) => (noPad ? String(value) : pad(value, width));
    const hours = date.getUTCHours();
    switch (directive) {
      case 'a':
        return WEEKDAYS[date.getUTCDay()]!.slice(0, 3);
      case 'A':
        return WEEKDAYS[date.getUTCDay()]!;
      case 'b':
        return MONTHS[date.getUTCMonth()]!.slice(0, 3);
      case 'B':
        return MONTHS[date.getUTCMonth()]!;
      case 'd':
        return p(date.getUTCDate());
      case 'H':
        return p(hours);
      case 'I':
        return p(hours % 12 === 0 ? 12 : hours % 12);
      case 'j':
        return p(dayOfYear(date), 3);
      case 'm':
        return p(date.getUTCMonth() + 1);
      case 'M':
        return p(date.getUTCMinutes());
      case 'p':
        return hours < 12 ? 'AM' : 'PM';
      case 'S':
        return p(date.getUTCSeconds());
      case 'y':
        return p(date.getUTCFullYear() % 100);
      case 'Y':
        return String(date.getUTCFullYear());
      case 'Z':
        return 'UTC';
      case 'z':
        return '+0000';
      case '%':
        return '%';
      default:
        return whole;
    }
  });
}

function resolvePath(vars: Record<string, unknown>, path: string): unknown {
  let current: unknown = vars;
  for (const part of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * A subset of Python's `str.format`: supports `{name}`, dotted attribute access
 * (`{previous_month_submission.permalink}`), date format specs (`{now:%B %Y}`)
 * and `{{` / `}}` escapes. Unknown placeholders are left untouched.
 */
export function formatTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(
    /\{\{|\}\}|\{([A-Za-z_][\w.]*)(?::([^{}]*))?\}/g,
    (whole, path: string | undefined, spec: string | undefined) => {
      if (whole === '{{') return '{';
      if (whole === '}}') return '}';
      const value = resolvePath(vars, path!);
      if (value === undefined) return whole;
      if (value instanceof Date) return spec ? strftime(spec, value) : value.toISOString();
      return String(value);
    }
  );
}

const EMOJI_PATTERN =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]+/gu;

export function deEmojify(text: string): string {
  return text.replace(EMOJI_PATTERN, '');
}

export function toInt(value: string | undefined | null, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Reddit returns wiki markdown HTML-escaped. */
export function unescapeWiki(content: string): string {
  return content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
