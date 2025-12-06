import re
import os
from dotenv import load_dotenv


def load_secrets(subreddit_name: str) -> dict:
    """Load secrets from .env file or environment variables."""
    # Load .env file if it exists
    load_dotenv()

    return {
        "REDDIT_CLIENT_ID": os.getenv("REDDIT_CLIENT_ID"),
        "REDDIT_CLIENT_SECRET": os.getenv("REDDIT_CLIENT_SECRET"),
        "REDDIT_USER_AGENT": os.getenv("REDDIT_USER_AGENT"),
        "REDDIT_USERNAME": os.getenv("REDDIT_USERNAME"),
        "REDDIT_PASSWORD": os.getenv("REDDIT_PASSWORD"),
        "PUSHOVER_APP_TOKEN": os.getenv("PUSHOVER_APP_TOKEN", ""),
        "PUSHOVER_USER_TOKEN": os.getenv("PUSHOVER_USER_TOKEN", ""),
    }


def sint(str, default):
    try:
        return int(str)
    except ValueError:
        return default


def deEmojify(text):
    regrex_pattern = re.compile(
        pattern="["
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F1E0-\U0001F1FF"  # flags (iOS)
        "]+",
        flags=re.UNICODE,
    )
    return regrex_pattern.sub(r"", text)
