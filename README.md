[![Devvit](https://github.com/mikeacjones/reddit-penpal-confirmation-bot/actions/workflows/devvit.yml/badge.svg?branch=main)](https://github.com/mikeacjones/reddit-penpal-confirmation-bot/actions/workflows/devvit.yml)

# Pen Pal Confirmation Bot

A [Devvit](https://developers.reddit.com/docs) app that tracks emails and letters exchanged between users. It posts a monthly confirmation thread, and when a user leaves a top-level comment such as `u/digitalmayhap - 1 - 2`, it adds 1 email and 2 letters to that user's flair.

Counts are stored by the app, seeded from a user's flair the first time they are confirmed. Hand-edited flair is overwritten on the next confirmation, so correct counts with the **Set a user's confirmation counts** menu action.

## Setup

### Flair templates

Create user flair templates in one of two formats. Templates in neither format are ignored.

- **Ranged:** `MIN-MAX:📧 Emails: {E} | 📬 Letters: {L}`. Assigned automatically by total count (inclusive). Moderators get templates flagged "mod only".
- **Non-ranged:** any text containing `📧 Emails: {E} | 📬 Letters: {L}`. Assigned by hand (set the flair CSS class to the template ID) and kept while counts update.

### Wiki pages

Text is configured with wiki pages under `confirmation-bot/`. Missing pages fall back to [`templates/`](templates).

| Page                    | Purpose                       | Variables                                                        |
| ----------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `monthly_post_title`    | Thread title (strftime, UTC)  | e.g. `%B %Y Confirmation Thread`                                 |
| `monthly_post`          | Thread body                   | `bot_name`, `subreddit_name`, `previous_month_submission`, `now` |
| `monthly_post_flair_id` | Post flair template ID        |                                                                  |
| `confirmation_message`  | Reply on success              | `mentioned_name`, `old_flair`, `new_flair`                       |
| `cant_update_yourself`  | Reply to self-confirmation    |                                                                  |
| `user_doesnt_exist`     | Reply for unknown users       | `mentioned_name`                                                 |
| `flair_update_failed`   | Reply when flair can't be set | `mentioned_name`                                                 |

The thread is not created until `monthly_post_title` and `monthly_post` are set.

## Moderator tools

From the subreddit moderator menu:

- **Reload confirmation bot settings** after editing wiki pages or flair templates (also: send `reload` in a Mod Discussion).
- **Run confirmation catch-up** to process missed comments now. This also runs hourly.
- **Create monthly confirmation post** if this month's thread is missing.
- **Set a user's confirmation counts** to correct a user's totals.

Failures are reported through modmail notifications.

## Development

Requires Node 24+.

```bash
npm install
npm run login    # authenticate the Devvit CLI
npm run dev      # playtest on a test subreddit
npm test         # type check, unit and scenario tests
```

## Deployment

Deploys run from GitHub Actions:

- **Other branches:** each push uploads a prerelease (for example `1.0.0.4201`) and installs it on the dev subreddit set in `devvit.json`.
- **`main`:** each push submits the next version for Reddit review as a public app, then commits the version and tags it `vX.Y.Z`. The patch number is bumped automatically; to release a minor or major version, set it in `package.json`.

Once Reddit approves a version, moderators update the app from the subreddit's installed apps page.

The workflow needs a `DEVVIT_AUTH_TOKEN` secret: the contents of `~/.devvit/token` after `npm run login`.
