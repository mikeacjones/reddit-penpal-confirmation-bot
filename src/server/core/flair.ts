import { toInt } from './format';

export type Counts = {
  emails: number;
  letters: number;
};

export type RawFlairTemplate = {
  id: string;
  text: string;
  modOnly: boolean;
};

export type RangedFlairTemplate = RawFlairTemplate & {
  min: number;
  max: number;
};

export type FlairTemplates = {
  ranged: RangedFlairTemplate[];
  special: RawFlairTemplate[];
};

export function parseFlairCounts(flairText: string | undefined, flairPattern: string): Counts {
  if (!flairText) return { emails: 0, letters: 0 };
  const match = new RegExp(flairPattern.trim()).exec(flairText);
  if (!match) return { emails: 0, letters: 0 };
  return { emails: toInt(match[1]), letters: toInt(match[2]) };
}

/**
 * Splits subreddit user flair templates into ranged templates (`MIN-MAX:` prefix,
 * prefix stripped from the display text) and non-ranged "special" templates.
 * Templates matching neither pattern are never touched by the bot.
 */
export function parseFlairTemplates(
  templates: RawFlairTemplate[],
  rangedPattern: string,
  specialPattern: string
): FlairTemplates {
  const rangedRegex = new RegExp(rangedPattern.trim());
  const specialRegex = new RegExp(specialPattern.trim());
  const ranged: RangedFlairTemplate[] = [];
  const special: RawFlairTemplate[] = [];

  for (const template of templates) {
    const match = rangedRegex.exec(template.text);
    if (match && match[1] !== undefined) {
      ranged.push({
        ...template,
        text: template.text.replace(match[1], ''),
        min: toInt(match[2]),
        max: toInt(match[3]),
      });
    } else if (specialRegex.test(template.text)) {
      special.push(template);
    }
  }
  return { ranged, special };
}

/**
 * Users holding a special (non-ranged) flair keep it. Otherwise pick the ranged
 * template covering the total whose mod-only flag matches the user's mod status.
 */
export function selectFlairTemplate(
  templates: FlairTemplates,
  total: number,
  currentCssClass: string | undefined,
  isModerator: boolean
): RawFlairTemplate | undefined {
  if (currentCssClass) {
    const special = templates.special.find((template) => template.id === currentCssClass);
    if (special) return special;
  }
  return templates.ranged.find(
    (template) => template.min <= total && total <= template.max && template.modOnly === isModerator
  );
}

export function formatFlairText(templateText: string, counts: Counts): string {
  return templateText
    .replace(/\{E\}/g, String(counts.emails))
    .replace(/\{L\}/g, String(counts.letters));
}

export function isSpecialTemplate(templates: FlairTemplates, templateId: string): boolean {
  return templates.special.some((template) => template.id === templateId);
}
