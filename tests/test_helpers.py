"""Tests for helper functions in helpers.py"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from helpers import sint, deEmojify, load_secrets


class TestSint:
    """Tests for sint() - safe integer conversion"""

    def test_valid_integer_string(self):
        assert sint("5", 0) == 5

    def test_valid_negative_integer(self):
        assert sint("-10", 0) == -10

    def test_invalid_string_returns_default(self):
        assert sint("blah", 0) == 0

    def test_invalid_string_with_custom_default(self):
        assert sint("invalid", 42) == 42

    def test_empty_string_returns_default(self):
        assert sint("", 0) == 0

    def test_float_string_returns_default(self):
        # int() doesn't parse floats
        assert sint("3.14", 0) == 0

    def test_whitespace_returns_default(self):
        assert sint("  ", 0) == 0


class TestDeEmojify:
    """Tests for deEmojify() - emoji removal"""

    def test_removes_email_emoji(self):
        result = deEmojify("📧 Emails: 1 | 📬 Letters: 1")
        assert result == " Emails: 1 |  Letters: 1"

    def test_no_emojis_unchanged(self):
        result = deEmojify("Plain text without emojis")
        assert result == "Plain text without emojis"

    def test_empty_string(self):
        result = deEmojify("")
        assert result == ""

    def test_only_emojis(self):
        result = deEmojify("😀😎🎉")
        assert result == ""

    def test_mixed_content(self):
        result = deEmojify("Hello 🌍 World 🎈!")
        assert result == "Hello  World !"


class TestLoadSecrets:
    """Tests for load_secrets() - environment variable loading"""

    def test_returns_dict_with_all_keys(self):
        secrets = load_secrets("test_subreddit")

        expected_keys = [
            "PUSHOVER_APP_TOKEN",
            "PUSHOVER_USER_TOKEN",
            "REDDIT_USERNAME",
            "REDDIT_PASSWORD",
            "REDDIT_CLIENT_ID",
            "REDDIT_CLIENT_SECRET",
            "REDDIT_USER_AGENT",
        ]
        for key in expected_keys:
            assert key in secrets

    def test_loads_env_variables(self):
        # Set a test env var
        os.environ["REDDIT_CLIENT_ID"] = "test_client_id_123"
        secrets = load_secrets("test")
        assert secrets["REDDIT_CLIENT_ID"] == "test_client_id_123"
        # Clean up
        del os.environ["REDDIT_CLIENT_ID"]

    def test_missing_env_returns_empty_string(self):
        # Ensure env var doesn't exist
        if "REDDIT_CLIENT_ID" in os.environ:
            del os.environ["REDDIT_CLIENT_ID"]
        secrets = load_secrets("test")
        assert secrets["REDDIT_CLIENT_ID"] == ""
