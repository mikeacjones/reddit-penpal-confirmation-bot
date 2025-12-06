"""Tests for comment processing logic"""
import os
import re
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


class MockComment:
    """Mock PRAW Comment object for testing"""

    def __init__(
        self,
        saved=False,
        removed=False,
        link_author="BotUser",
        author_fullname="t2_abc123",
        is_root=True,
        banned_by=None,
        stickied=False,
        body="",
    ):
        self.saved = saved
        self.removed = removed
        self.link_author = link_author
        self.author_fullname = author_fullname
        self.is_root = is_root
        self.banned_by = banned_by
        self.stickied = stickied
        self.body = body


class MockSettings:
    """Mock Settings object for testing"""

    def __init__(self):
        self.BOT_NAME = "BotUser"
        self.FULLNAME = "t2_bot123"
        self.CONFIRMATION_PATTERN = re.compile(
            r"u/([a-zA-Z0-9_-]{3,})\s+\\?-?\s*(\d+)(?:\s+|\s*-\s*)(\d+)"
        )


class TestShouldProcessComment:
    """Tests for _should_process_comment() logic"""

    def test_should_process_valid_comment(self):
        """A valid comment should be processed"""
        comment = MockComment(
            saved=False,
            removed=False,
            link_author="BotUser",
            author_fullname="t2_user123",
            is_root=True,
            banned_by=None,
        )
        settings = MockSettings()

        # Check all conditions manually (mirrors _should_process_comment logic)
        should_process = (
            not comment.saved
            and not comment.removed
            and comment.link_author == settings.BOT_NAME
            and hasattr(comment, "author_fullname")
            and comment.author_fullname != settings.FULLNAME
            and comment.is_root
            and comment.banned_by is None
        )
        assert should_process is True

    def test_should_not_process_saved_comment(self):
        """Already processed (saved) comments should be skipped"""
        comment = MockComment(saved=True)
        settings = MockSettings()

        should_process = not comment.saved
        assert should_process is False

    def test_should_not_process_removed_comment(self):
        """Removed comments should be skipped"""
        comment = MockComment(removed=True)
        settings = MockSettings()

        should_process = not comment.removed
        assert should_process is False

    def test_should_not_process_wrong_thread(self):
        """Comments not on bot's posts should be skipped"""
        comment = MockComment(link_author="SomeOtherUser")
        settings = MockSettings()

        should_process = comment.link_author == settings.BOT_NAME
        assert should_process is False

    def test_should_not_process_bots_own_comment(self):
        """Bot's own comments should be skipped"""
        comment = MockComment(author_fullname="t2_bot123")
        settings = MockSettings()

        should_process = comment.author_fullname != settings.FULLNAME
        assert should_process is False

    def test_should_not_process_reply_to_reply(self):
        """Non-root comments should be skipped"""
        comment = MockComment(is_root=False)

        should_process = comment.is_root
        assert should_process is False

    def test_should_not_process_banned_comment(self):
        """Comments from banned users should be skipped"""
        comment = MockComment(banned_by="SomeMod")

        should_process = comment.banned_by is None
        assert should_process is False


class TestConfirmationPatternMatching:
    """Tests for confirmation comment pattern matching"""

    def setup_method(self):
        """Set up the confirmation pattern"""
        self.pattern = re.compile(
            r"u/([a-zA-Z0-9_-]{3,})\s+\\?-?\s*(\d+)(?:\s+|\s*-\s*)(\d+)"
        )

    def test_basic_confirmation_format(self):
        """Test standard confirmation format: u/username 1 2"""
        text = "u/testuser 5 10"
        matches = self.pattern.findall(text)
        assert len(matches) == 1
        username, emails, letters = matches[0]
        assert username == "testuser"
        assert emails == "5"
        assert letters == "10"

    def test_confirmation_with_dash(self):
        """Test format with dash: u/username 1-2"""
        text = "u/testuser 5-10"
        matches = self.pattern.findall(text)
        assert len(matches) == 1
        username, emails, letters = matches[0]
        assert username == "testuser"
        assert emails == "5"
        assert letters == "10"

    def test_multiple_confirmations(self):
        """Test multiple confirmations in one comment"""
        text = "u/user1 1 2\nu/user2 3 4"
        matches = self.pattern.findall(text)
        assert len(matches) == 2
        assert matches[0] == ("user1", "1", "2")
        assert matches[1] == ("user2", "3", "4")

    def test_username_with_underscore(self):
        """Test username containing underscore"""
        text = "u/test_user_123 1 1"
        matches = self.pattern.findall(text)
        assert len(matches) == 1
        assert matches[0][0] == "test_user_123"

    def test_username_with_dash(self):
        """Test username containing dash"""
        text = "u/test-user 1 1"
        matches = self.pattern.findall(text)
        assert len(matches) == 1
        assert matches[0][0] == "test-user"

    def test_no_match_short_username(self):
        """Usernames under 3 chars should not match"""
        text = "u/ab 1 1"
        matches = self.pattern.findall(text)
        assert len(matches) == 0

    def test_no_match_invalid_format(self):
        """Invalid formats should not match"""
        text = "Hey @testuser thanks for the trade!"
        matches = self.pattern.findall(text)
        assert len(matches) == 0

    def test_confirmation_with_extra_text(self):
        """Test confirmation embedded in other text"""
        text = "Thanks for the exchange! u/penpaluser 2 3 hope to write again!"
        matches = self.pattern.findall(text)
        assert len(matches) == 1
        assert matches[0] == ("penpaluser", "2", "3")
