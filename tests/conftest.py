import sys
import pytest
import praw_bot_wrapper
import os
import base64
import urllib
from praw import Reddit
from betamax import Betamax
from betamax_helpers import sanitize_cassette

sys.path.append("src")
from settings import Settings
from helpers import load_secrets

SUBREDDIT_NAME = os.environ["SUBREDDIT_NAME"]
secrets = load_secrets(SUBREDDIT_NAME)

with Betamax.configure() as config:
    # Tell Betamax where to find the cassettes (recorded requests and responses)
    config.cassette_library_dir = "tests/cassettes"
    # Hide the OAuth2 credentials in recorded interactions
    config.before_record(callback=sanitize_cassette)
    config.define_cassette_placeholder(
        "<REDDIT-AUTH>",
        base64.b64encode(
            "{0}:{1}".format(
                secrets["REDDIT_USERNAME"], secrets["REDDIT_PASSWORD"]
            ).encode("utf-8")
        ).decode("utf-8"),
    )
    config.define_cassette_placeholder(
        "<REDDIT-PASSWORD>", urllib.parse.quote(secrets["REDDIT_PASSWORD"])
    )
    config.define_cassette_placeholder(
        "<REDDIT-CLIENT-ID>", secrets["REDDIT_CLIENT_ID"]
    )
    config.define_cassette_placeholder(
        "<REDDIT-CLIENT-SECRET>", secrets["REDDIT_CLIENT_SECRET"]
    )
    config.define_cassette_placeholder(
        "<PUSHOVER-APP-TOKEN>", secrets["PUSHOVER_APP_TOKEN"]
    )
    config.define_cassette_placeholder(
        "<PUSHOVER-USER-TOKEN>", secrets["PUSHOVER_USER_TOKEN"]
    )

BOT = Reddit(
    client_id=secrets["REDDIT_CLIENT_ID"],
    client_secret=secrets["REDDIT_CLIENT_SECRET"],
    user_agent=secrets["REDDIT_USER_AGENT"],
    username=secrets["REDDIT_USERNAME"],
    password=secrets["REDDIT_PASSWORD"],
)
http = BOT._core._requestor._http
http.headers["Accept-Encoding"] = "identity"
RECORDER = Betamax(http)

with RECORDER.use_cassette("load_settings"):
    SETTINGS = Settings(BOT, SUBREDDIT_NAME)


@pytest.fixture
def settings() -> Settings:
    return SETTINGS


@pytest.fixture
def bot() -> Reddit:
    return BOT


@pytest.fixture
def recorder() -> Betamax:
    return RECORDER
