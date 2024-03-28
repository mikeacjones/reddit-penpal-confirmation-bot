import os
import praw_bot_wrapper
import sys
from pushover import Pushover
from datetime import datetime
from praw import models, Reddit
from helpers_flair import increment_flair
from helpers_submission import get_current_confirmation_post
from helpers_redditor import get_redditor
from helpers import load_secrets, sint, deEmojify
from settings import Settings
from logger import LOGGER
from helpers_submission import lock_previous_submissions, post_monthly_submission

SUBREDDIT_NAME = os.environ["SUBREDDIT_NAME"]
SECRETS = load_secrets(SUBREDDIT_NAME)
PUSHOVER = Pushover(SECRETS["PUSHOVER_APP_TOKEN"], SECRETS["PUSHOVER_USER_TOKEN"])
BOT = Reddit(
    client_id=SECRETS["REDDIT_CLIENT_ID"],
    client_secret=SECRETS["REDDIT_CLIENT_SECRET"],
    user_agent=SECRETS["REDDIT_USER_AGENT"],
    username=SECRETS["REDDIT_USERNAME"],
    password=SECRETS["REDDIT_PASSWORD"],
)
SETTINGS = Settings(BOT, SUBREDDIT_NAME)


def _should_process_comment(comment: models.Comment):
    if (
        not comment.saved
        and not comment.removed
        and comment.link_author == SETTINGS.BOT_NAME
        and hasattr(comment, "author_fullname")
        and comment.author_fullname != SETTINGS.FULLNAME
        and comment.is_root
        and comment.banned_by is None
    ):
        return True
    return False


@praw_bot_wrapper.stream_handler(SETTINGS.SUBREDDIT.stream.comments)
def handle_confirmation_thread_comment(
    comment: models.Comment, is_catchup=False
) -> str | None:
    """Handles a comment left on the confirmation thread."""
    if not is_catchup and not _should_process_comment(comment):
        return

    LOGGER.info("Processing new comment https://reddit.com%s", comment.permalink)
    all_matches = SETTINGS.CONFIRMATION_PATTERN.findall(comment.body)
    if not len(all_matches):
        comment.save()
        return

    reply_body = ""
    for match in all_matches:
        try:
            reply_body += "\n\n" + _handle_confirmation(comment, match)
        except Exception as ex:
            LOGGER.info("Exception occurred while handling confirmation")
            LOGGER.info(ex)

    comment.save()
    if reply_body != "":
        comment.reply(reply_body)
    return reply_body


def _handle_confirmation(comment: models.Comment, match: dict) -> str | None:
    mentioned_name, emails, letters = match
    emails, letters = sint(emails, 0), sint(letters, 0)
    mentioned_user = get_redditor(BOT, mentioned_name)

    if not mentioned_user:
        return BOT.USER_DOESNT_EXIST.format(
            comment=comment, mentioned_name=mentioned_name
        )

    if mentioned_user.fullname == comment.author_fullname:
        return BOT.CANT_UPDATE_YOURSELF

    old_flair, new_flair = increment_flair(SETTINGS, mentioned_user, emails, letters)
    if not old_flair or not new_flair:
        return SETTINGS.FLAIR_UPDATE_FAILED.format(mentioned_name=mentioned_name)

    LOGGER.info("Updated %s to %s for %s", old_flair, new_flair, mentioned_name)
    return deEmojify(
        SETTINGS.CONFIRMATION_TEMPLATE.format(
            mentioned_name=mentioned_name, old_flair=old_flair, new_flair=new_flair
        )
    )


@praw_bot_wrapper.stream_handler(BOT.inbox.stream)
def handle_new_mail(
    message: models.Message | models.Comment | models.Submission,
) -> None:
    """Monitors messages sent to the bot"""
    message.mark_read()
    if (
        not isinstance(message, models.Message)
        or message.author not in SETTINGS.CURRENT_MODS
    ):
        return
    if "reload" in message.body.lower():
        LOGGER.info("Mod requested settings reload")
        SETTINGS.reload(BOT, SUBREDDIT_NAME)
        message.reply("Successfully reloaded bot settings")
    message.mark_read()


@praw_bot_wrapper.outage_recovery_handler(outage_threshold=10)
def handle_catchup(started_at: datetime | None = None):
    # changed how we send the modmail so that it because an archivable message
    # mod discussions can't be archived which is annoying
    LOGGER.info("Running catchup function")
    if started_at:
        SETTINGS.SUBREDDIT.modmail.create(
            subject="Bot Recovered from Extended Outage",
            body=SETTINGS.OUTAGE_MESSAGE.format(
                started_at=started_at, subreddit_name=SUBREDDIT_NAME
            ),
            recipient=SETTINGS.ME,
        )
        PUSHOVER.send_message(
            f"Bot error for r/{os.getenv('SUBREDDIT_NAME', 'unknown')} - Server Error from Reddit APIs. Started at {started_at}"
        )
    current_confirmation_submission = get_current_confirmation_post(SETTINGS)
    current_confirmation_submission.comment_sort = "new"
    if not current_confirmation_submission:
        LOGGER.infO("Catchup skipped - no monthly post found")
        return
    _handle_catchup(current_confirmation_submission)
    LOGGER.info("Catchup finished")


def _handle_catchup(item: models.Submission | models.MoreComments):
    for comment in item.comments:
        if isinstance(comment, models.MoreComments):
            _handle_catchup(comment)
        if comment.stickied:  # ignore mod stickied comments
            continue
        if comment.saved:
            return
        handle_confirmation_thread_comment(comment, is_catchup=True)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "create-monthly":
            new_submission = post_monthly_submission(SETTINGS)
            lock_previous_submissions(SETTINGS, new_submission)
            PUSHOVER.send_message(f"Created monthly post for r/{SUBREDDIT_NAME}")
    else:
        LOGGER.info("Bot start up")
        PUSHOVER.send_message(f"Bot startup for r/{SUBREDDIT_NAME}")
        handle_catchup()
        praw_bot_wrapper.run()
