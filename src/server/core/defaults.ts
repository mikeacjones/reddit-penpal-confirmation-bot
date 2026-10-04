import cantUpdateYourself from '../../../templates/cant_update_yourself.md?raw';
import confirmationMessage from '../../../templates/confirmation_message.md?raw';
import confirmationRegexPattern from '../../../templates/confirmation_regex_pattern.md?raw';
import flairRegex from '../../../templates/flair_regex.md?raw';
import flairUpdateFailed from '../../../templates/flair_update_failed.md?raw';
import monthlyPost from '../../../templates/monthly_post.md?raw';
import monthlyPostFlairId from '../../../templates/monthly_post_flair_id.md?raw';
import monthlyPostTitle from '../../../templates/monthly_post_title.md?raw';
import outageRecovery from '../../../templates/outage_recovery.md?raw';
import rangedFlairTemplateRegex from '../../../templates/ranged_flair_template_regex.md?raw';
import specialFlairTemplateRegex from '../../../templates/special_flair_template_regex.md?raw';
import userDoesntExist from '../../../templates/user_doesnt_exist.md?raw';

export const TEMPLATE_NAMES = [
  'cant_update_yourself',
  'confirmation_message',
  'confirmation_regex_pattern',
  'flair_regex',
  'flair_update_failed',
  'monthly_post',
  'monthly_post_flair_id',
  'monthly_post_title',
  'outage_recovery',
  'ranged_flair_template_regex',
  'special_flair_template_regex',
  'user_doesnt_exist',
] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export const UNSET_TEMPLATE = 'SET THIS TEMPLATE';

export const DEFAULT_TEMPLATES: Record<TemplateName, string> = {
  cant_update_yourself: cantUpdateYourself,
  confirmation_message: confirmationMessage,
  confirmation_regex_pattern: confirmationRegexPattern,
  flair_regex: flairRegex,
  flair_update_failed: flairUpdateFailed,
  monthly_post: monthlyPost,
  monthly_post_flair_id: monthlyPostFlairId,
  monthly_post_title: monthlyPostTitle,
  outage_recovery: outageRecovery,
  ranged_flair_template_regex: rangedFlairTemplateRegex,
  special_flair_template_regex: specialFlairTemplateRegex,
  user_doesnt_exist: userDoesntExist,
};

export function isUnset(template: string): boolean {
  return template.trim() === '' || template.trim() === UNSET_TEMPLATE;
}
