import { context, reddit, redis } from '@devvit/web/server';
import { DEFAULT_TEMPLATES, TEMPLATE_NAMES, type TemplateName } from '../core/defaults';
import { parseFlairTemplates, type FlairTemplates } from '../core/flair';
import { unescapeWiki } from '../core/format';

const CACHE_KEY = 'settings:cache';
const CACHE_TTL_MS = 60 * 60 * 1000;
const WIKI_PREFIX = 'confirmation-bot';

export type BotSettings = {
  templates: Record<TemplateName, string>;
  flairTemplates: FlairTemplates;
  moderators: string[];
  appUsername: string;
  appUserId: string | undefined;
  loadedAt: string;
};

async function loadTemplate(name: TemplateName): Promise<string> {
  try {
    const page = await reddit.getWikiPage(context.subredditName, `${WIKI_PREFIX}/${name}`);
    return unescapeWiki(page.content);
  } catch {
    return DEFAULT_TEMPLATES[name];
  }
}

async function loadSettings(): Promise<BotSettings> {
  const subredditName = context.subredditName;
  const entries = await Promise.all(
    TEMPLATE_NAMES.map(async (name) => [name, await loadTemplate(name)] as const)
  );
  const templates = Object.fromEntries(entries) as Record<TemplateName, string>;

  const [rawFlairTemplates, moderators, appUser] = await Promise.all([
    reddit.getUserFlairTemplates(subredditName),
    reddit.getModerators({ subredditName }).all(),
    reddit.getAppUser(),
  ]);

  const flairTemplates = parseFlairTemplates(
    rawFlairTemplates.map((template) => ({
      id: template.id,
      text: template.text,
      modOnly: template.modOnly,
    })),
    templates.ranged_flair_template_regex,
    templates.special_flair_template_regex
  );

  for (const template of flairTemplates.ranged) {
    console.log(`Loaded ranged flair ${template.min}-${template.max}: ${template.text}`);
  }
  for (const template of flairTemplates.special) {
    console.log(`Loaded non-ranged flair: ${template.text}`);
  }

  return {
    templates,
    flairTemplates,
    moderators: moderators.map((moderator) => moderator.username.toLowerCase()),
    appUsername: appUser?.username ?? context.appSlug,
    appUserId: appUser?.id,
    loadedAt: new Date().toISOString(),
  };
}

async function storeSettings(settings: BotSettings): Promise<void> {
  await redis.set(CACHE_KEY, JSON.stringify(settings), {
    expiration: new Date(Date.now() + CACHE_TTL_MS),
  });
}

export async function getSettings(): Promise<BotSettings> {
  const cached = await redis.get(CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as BotSettings;
    } catch {
      console.warn('Discarding unreadable settings cache');
    }
  }
  const settings = await loadSettings();
  await storeSettings(settings);
  return settings;
}

export async function reloadSettings(): Promise<BotSettings> {
  await redis.del(CACHE_KEY);
  const settings = await loadSettings();
  await storeSettings(settings);
  return settings;
}

export function isModerator(settings: BotSettings, username: string | undefined): boolean {
  return username !== undefined && settings.moderators.includes(username.toLowerCase());
}
