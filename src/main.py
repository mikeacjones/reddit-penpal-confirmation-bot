import os
import json
import praw_bot_wrapper
import sys
from pushover import Pushover
from datetime import datetime, timezone
from praw import models, Reddit
from helpers_flair import increment_flair
from helpers_submission import get_current_confirmation_post
from helpers_redditor import get_redditor
from helpers import load_secrets, sint, deEmojify
from settings import Settings
from logger import LOGGER
from helpers_submission import lock_previous_submissions, post_monthly_submission
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

# ============================================================================
# Configuration
# ============================================================================

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

# ============================================================================
# Job State Management (for catch-up after restarts)
# ============================================================================

JOB_STATE_FILE = "/tmp/reddit-bot-job-state.json"


def load_job_state() -> dict:
    """Load job execution state from file."""
    if os.path.exists(JOB_STATE_FILE):
        try:
            with open(JOB_STATE_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            LOGGER.warning("Failed to load job state: %s", e)
    return {
        "last_monthly_post": None,
    }


def save_job_state(state: dict) -> None:
    """Save job execution state to file."""
    try:
        with open(JOB_STATE_FILE, "w") as f:
            json.dump(state, f)
    except Exception as e:
        LOGGER.error("Failed to save job state: %s", e)


def should_run_monthly_post() -> bool:
    """Check if monthly post job should run (catch-up logic).

    First checks job state file. If no state exists, queries Reddit API
    to check bot's last post. If recent post is from current month,
    considers it caught up without running again.
    """
    now = datetime.now(timezone.utc)
    current_month_key = now.strftime("%Y-%m")

    state = load_job_state()
    last_run = state.get("last_monthly_post")

    # If we have recorded state, use it
    if last_run:
        last_month_key = last_run.split("T")[0][:7]
        return current_month_key != last_month_key

    # No recorded state - check Reddit API for bot's last post
    try:
        current_post = get_current_confirmation_post(SETTINGS)
        if current_post:
            post_date = datetime.fromtimestamp(current_post.created_utc, tz=timezone.utc)
            post_month_key = post_date.strftime("%Y-%m")

            LOGGER.info(
                "No job state found. Checking Reddit: last post from %s (current month: %s)",
                post_month_key,
                current_month_key
            )

            if post_month_key == current_month_key:
                # Recent post exists for current month - consider caught up
                LOGGER.info("Monthly post already exists for current month (from Reddit)")
                record_job_execution("last_monthly_post")
                return False
    except Exception as e:
        LOGGER.error("Failed to check Reddit for last post: %s", e)

    # Run if: no state file, no posts, or posts are from previous month
    return True


def record_job_execution(job_name: str) -> None:
    """Record the execution time of a job."""
    state = load_job_state()
    state[job_name] = datetime.now(timezone.utc).isoformat()
    save_job_state(state)


# ============================================================================
# Comment Processing
# ============================================================================

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
        return SETTINGS.USER_DOESNT_EXIST.format(
            comment=comment, mentioned_name=mentioned_name
        )

    if mentioned_user.fullname == comment.author_fullname:
        return SETTINGS.CANT_UPDATE_YOURSELF

    old_flair, new_flair = increment_flair(SETTINGS, mentioned_user, emails, letters)
    if not old_flair or not new_flair:
        return SETTINGS.FLAIR_UPDATE_FAILED.format(mentioned_name=mentioned_name)

    LOGGER.info("Updated %s to %s for %s", old_flair, new_flair, mentioned_name)
    return deEmojify(
        SETTINGS.CONFIRMATION_TEMPLATE.format(
            mentioned_name=mentioned_name, old_flair=old_flair, new_flair=new_flair
        )
    )


# ============================================================================
# Mail Handler
# ============================================================================

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


# ============================================================================
# Outage Recovery
# ============================================================================

@praw_bot_wrapper.outage_recovery_handler(outage_threshold=10)
def handle_catchup(started_at: datetime | None = None):
    # send the modmail this way so it is archivable
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
    if not current_confirmation_submission:
        LOGGER.info("Catchup skipped - no monthly post found")
        return
    current_confirmation_submission.comment_sort = "new"
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


# ============================================================================
# Monthly Post Management
# ============================================================================

def create_monthly_post() -> None:
    """Create the monthly confirmation thread and lock previous submissions."""
    new_submission = post_monthly_submission(SETTINGS)
    if new_submission:
        lock_previous_submissions(SETTINGS, new_submission)
        PUSHOVER.send_message(f"Created monthly post for r/{SUBREDDIT_NAME}")
        LOGGER.info("Created monthly post: https://reddit.com%s", new_submission.permalink)
    else:
        LOGGER.info("Monthly post already exists for this month")


def scheduled_monthly_post_job() -> None:
    """Scheduled job wrapper for monthly post creation."""
    try:
        if should_run_monthly_post():
            LOGGER.info("Running scheduled monthly post job")
            create_monthly_post()
            record_job_execution("last_monthly_post")
        else:
            LOGGER.debug("Skipping monthly post job (already ran this month)")
    except Exception as e:
        LOGGER.error("Scheduled monthly post job failed: %s", e, exc_info=True)
        PUSHOVER.send_message(f"Monthly post job failed for r/{SUBREDDIT_NAME}: {str(e)[:100]}")


# ============================================================================
# Scheduler Management
# ============================================================================

def initialize_scheduler() -> BackgroundScheduler:
    """Initialize and configure the background scheduler for monthly jobs."""
    scheduler = BackgroundScheduler()

    # Schedule monthly post creation on the 1st of each month at 00:00 UTC
    scheduler.add_job(
        scheduled_monthly_post_job,
        CronTrigger(day=1, hour=0, minute=0),
        id="monthly_post",
        name="Monthly Post Creation",
        replace_existing=True,
    )

    LOGGER.info("Scheduler initialized with job: monthly_post")
    return scheduler


def run_with_scheduler() -> None:
    """Start the bot with both scheduler and stream handler running."""
    scheduler = initialize_scheduler()
    scheduler.start()
    LOGGER.info("Scheduler started")

    try:
        # Run the stream handler (this blocks indefinitely)
        praw_bot_wrapper.run()
    except KeyboardInterrupt:
        LOGGER.info("Keyboard interrupt received")
    finally:
        scheduler.shutdown()
        LOGGER.info("Scheduler shutdown")


# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    try:
        if len(sys.argv) > 1:
            command = sys.argv[1]

            if command == "create-monthly":
                create_monthly_post()

            elif command == "catch-up":
                handle_catchup()

            else:
                print(f"Unknown command: {command}")
                print("Available commands: create-monthly, catch-up")
                sys.exit(1)

        else:
            # Normal operation - start the bot with scheduler
            LOGGER.info("Bot starting up")
            PUSHOVER.send_message(f"Bot startup for r/{SUBREDDIT_NAME}")

            # Catch up on any missed comments
            handle_catchup()

            # Check and execute any missed scheduled jobs
            if should_run_monthly_post():
                LOGGER.info("Catch-up: Running monthly post job")
                scheduled_monthly_post_job()

            # Start streaming with scheduler (this blocks indefinitely)
            run_with_scheduler()

    except KeyboardInterrupt:
        LOGGER.info("Bot shutdown requested")
        PUSHOVER.send_message(f"Bot shutdown for r/{SUBREDDIT_NAME}")

    except Exception as ex:
        LOGGER.exception("Fatal error in main")
        PUSHOVER.send_message(f"Bot crashed for r/{SUBREDDIT_NAME}")
        PUSHOVER.send_message(str(ex)[:200])
        raise
