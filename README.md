[![CI (main)](https://github.com/mikeacjones/reddit-penpal-confirmation-bot/actions/workflows/test-and-deploy.yml/badge.svg?branch=main)](https://github.com/mikeacjones/reddit-penpal-confirmation-bot/actions/workflows/test-and-deploy.yml)

# Pen Pal Confirmation Bot v2

## About

The Pen Pal Confirmation Bot is a flair bot that tracks how many emails and letters users have exchanged. It watches top-level comments on its monthly confirmation thread and updates the mentioned user's flair.

Version 2 is a [Reddit Devvit Web](https://developers.reddit.com/docs) app. It is hosted by Reddit and installed per subreddit; there is no server, Docker image or Reddit API credentials to manage.

**Top Level Comment:** a comment replying directly to the post, not a reply to another comment.

The bot scans these comments for a mention of another user followed by `#-#`, where the first number is emails and the second is letters. For example, `u/digitalmayhap - 1 - 2` adds 1 email and 2 letters to u/digitalmayhap.

The default detection regex is `u/([a-zA-Z0-9_-]{3,})\s+\\?-?\s*(\d+)(?:\s+|\s*-\s*)(\d+)`, which accepts formats such as:

- u/digitalmayhap - 1 - 2
- u/digitalmayhap - 1 2
- u/digitalmayhap 1 2
- u/digitalmayhap 1 - 2

To test a pattern, use [https://regex101.com](https://regex101.com) with the "ECMAScript (JavaScript)" flavor.

## How it works

- **Comment trigger:** every new top-level comment on a thread authored by the app is processed immediately.
- **Hourly sweep:** a scheduled job rescans the newest comments on the current and previous confirmation threads and processes anything the trigger missed. It also retries failed flair updates and creates the monthly thread if it is missing.
- **Monthly thread:** created at 00:00 UTC on the 1st. The previous thread is unstickied, the new one is stickied with "new" as the suggested sort, and older threads are locked.

### Counts are stored by the bot

The bot keeps every user's email and letter counts in its own Redis storage, which is the source of truth. Flair is only the display of those counts.

- The first time a user is confirmed, the bot seeds their stored counts from their current flair.
- After that, flair edits made by hand are **not** read back and will be overwritten on the next confirmation. To correct a user's counts, use the **Set a user's confirmation counts** moderator menu action.
- Each confirmation is applied exactly once, even if a comment is retried by the sweep.

## Moderator tools

Available from the subreddit's moderator menu:

| Action                           | What it does                                                     |
| -------------------------------- | ---------------------------------------------------------------- |
| Reload confirmation bot settings | Re-reads the wiki templates, flair templates and moderator list. |
| Run confirmation catch-up        | Runs the sweep immediately.                                      |
| Create monthly confirmation post | Creates this month's thread if it does not exist yet.            |
| Set a user's confirmation counts | Overrides a user's stored counts and updates their flair.        |

Settings can also be reloaded by sending a message starting with `reload` in a **Mod Discussion** or as a private moderator note in modmail.

Settings are cached for up to an hour, so reload after editing wiki pages or flair templates.

### Notifications

The bot reports problems through modmail notifications and the app logs (`npx devvit logs <subreddit>`):

- The monthly thread could not be created, or its wiki pages are not configured.
- The hourly sweep failed three times in a row, and again when it recovers (using the `outage_recovery` template).
- A comment failed to process three times.
- Flair updates are still failing after retries (at most once a day).

## Configuration

All text is configured through wiki pages under `confirmation-bot/`. If a page does not exist, the default in [`templates/`](templates) is used.

### Flair Templates

The bot supports two flair types: ranged and non-ranged. Ranged flairs are applied based on the total of emails and letters exchanged. Non-ranged flairs track counts without enforcing a range and remain until manually changed.

Flairs that match neither format, such as `Bot` or mod-specific flairs, are never modified by the bot.

#### Defining a Ranged Flair

`MIN-MAX:📧 Emails: {E} | 📬 Letters: {L}`

Ranges are inclusive. For example, a 0-49 range applies until the count reaches 50, at which point the next flair is assigned. Arbitrary text and colors can be added, and the "mod only" flag marks flairs used for moderators.

> If no ranged flair is flagged "mod only", moderators who want to track their exchanges need to use a non-ranged flair.

#### Defining a Non-Ranged Flair

`📧 Emails: {E} | 📬 Letters: {L}`

Additional text can precede or follow the template, for example `Snail Mail Volunteer - 📧 Emails: {E} | 📬 Letters: {L}`.

Non-ranged flairs are recognised by the user's flair CSS class matching the template ID. The bot sets this CSS class whenever it writes a non-ranged flair; when assigning one by hand, set the CSS class to the template ID.

### Monthly Post

The bot must author the monthly posts to track their comments. If the title or body wiki page is not set, the thread is not created and moderators are notified.

#### Title

`confirmation-bot/monthly_post_title`, formatted with [strftime directives](https://docs.python.org/3/library/datetime.html#strftime-and-strptime-behavior) in UTC, e.g. `%B %Y Confirmation Thread` gives "March 2024 Confirmation Thread".

#### Content

`confirmation-bot/monthly_post`. Available variables:

- `bot_name`: the app account's username.
- `subreddit_name`: the subreddit's name.
- `previous_month_submission`: the previous thread, with `title`, `permalink`, `url` and `id` (e.g. `{previous_month_submission.permalink}`).
- `now`: the current UTC date; supports date formats such as `{now:%B %Y}`.

#### Flair

`confirmation-bot/monthly_post_flair_id`: the post flair template ID applied to the thread.

### Confirmation Reply Message

`confirmation-bot/confirmation_message`. Variables:

- `mentioned_name`: the mentioned user's username.
- `old_flair`: the user's flair before this confirmation.
- `new_flair`: the user's updated flair.

### Can't Update Yourself

`confirmation-bot/cant_update_yourself`: static reply when a user tries to confirm themselves.

### User Doesn't Exist

`confirmation-bot/user_doesnt_exist`. Variables:

- `mentioned_name`: the name the user tagged.

### Flair Update Failed

`confirmation-bot/flair_update_failed`. Variables:

- `mentioned_name`: the mentioned user's username.

### Regex Templates

`confirmation_regex_pattern`, `flair_regex`, `ranged_flair_template_regex` and `special_flair_template_regex` hold the JavaScript regular expressions described above.

## Development

Requires Node 24+ and a Reddit account connected to [developers.reddit.com](https://developers.reddit.com).

```bash
npm install
npm run login      # authenticate the Devvit CLI
npm run dev        # playtest on your test subreddit
npm test           # type check + unit tests
npm run deploy     # upload a new version
npm run launch     # upload and submit for review
```

Source layout:

- `devvit.json`: triggers, scheduled jobs, menu actions and permissions.
- `src/server/routes/`: HTTP endpoints Reddit calls for triggers, cron jobs, menus and forms.
- `src/server/services/`: Redis counts, comment processing, sweep, monthly post, settings and modmail.
- `src/server/core/`: pure parsing, flair and formatting logic (unit tested).
- `templates/`: default values for the wiki-configured templates.
