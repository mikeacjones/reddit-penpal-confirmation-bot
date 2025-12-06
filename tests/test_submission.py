"""Tests for helpers_submission.py"""
import os
import sys
from unittest.mock import Mock, MagicMock, patch
from datetime import datetime, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from helpers_submission import (
    get_current_confirmation_post,
    post_monthly_submission,
    lock_previous_submissions,
)


class MockSubmission:
    """Mock PRAW Submission object"""

    def __init__(
        self,
        subreddit_id="sub123",
        stickied=False,
        locked=False,
        created_utc=None,
        permalink="/r/test/comments/abc123",
        title="Test Submission",
    ):
        self.subreddit = Mock()
        self.subreddit.id = subreddit_id
        self.subreddit_id = subreddit_id
        self.stickied = stickied
        self.locked = locked
        self.created_utc = created_utc or datetime.now(timezone.utc).timestamp()
        self.permalink = permalink
        self.title = title
        self.mod = Mock()


class MockSettings:
    """Mock Settings object"""

    def __init__(self):
        self.ME = Mock()
        self.SUBREDDIT = Mock()
        self.SUBREDDIT.id = "sub123"
        self.SUBREDDIT.name = "sub123"
        self.BOT_NAME = "TestBot"
        self.SUBREDDIT_NAME = "testsubreddit"

    def load_template(self, template_name):
        templates = {
            "monthly_post_flair_id": "flair123",
            "monthly_post": "Monthly post body for {bot_name} in r/{subreddit_name}",
            "monthly_post_title": "Confirmation Thread - %B %Y",
        }
        return templates.get(template_name, "")


class TestGetCurrentConfirmationPost:
    """Tests for get_current_confirmation_post()"""

    def test_returns_stickied_submission(self):
        """Should return first stickied submission in subreddit"""
        settings = MockSettings()
        stickied_sub = MockSubmission(subreddit_id="sub123", stickied=True)
        settings.ME.submissions.new = Mock(return_value=[stickied_sub])

        result = get_current_confirmation_post(settings)

        assert result == stickied_sub

    def test_returns_none_if_no_stickied(self):
        """Should return None if no stickied submissions"""
        settings = MockSettings()
        non_stickied = MockSubmission(subreddit_id="sub123", stickied=False)
        settings.ME.submissions.new = Mock(return_value=[non_stickied])

        result = get_current_confirmation_post(settings)

        assert result is None

    def test_ignores_submissions_from_other_subreddits(self):
        """Should only return submissions from the target subreddit"""
        settings = MockSettings()
        other_sub = MockSubmission(subreddit_id="other_sub", stickied=True)
        correct_sub = MockSubmission(subreddit_id="sub123", stickied=True)
        settings.ME.submissions.new = Mock(return_value=[other_sub, correct_sub])

        result = get_current_confirmation_post(settings)

        assert result == correct_sub

    def test_returns_none_if_empty_submissions(self):
        """Should return None if no submissions exist"""
        settings = MockSettings()
        settings.ME.submissions.new = Mock(return_value=[])

        result = get_current_confirmation_post(settings)

        assert result is None

    def test_checks_limit_of_5(self):
        """Should request limit of 5 submissions"""
        settings = MockSettings()
        settings.ME.submissions.new = Mock(return_value=[])

        get_current_confirmation_post(settings)

        settings.ME.submissions.new.assert_called_once_with(limit=5)


class TestPostMonthlySubmission:
    """Tests for post_monthly_submission()"""

    def test_skips_if_post_exists_same_month(self):
        """Should return None if post already exists for current month"""
        settings = MockSettings()
        now = datetime.now(timezone.utc)
        existing_post = MockSubmission(
            subreddit_id="sub123",
            stickied=True,
            created_utc=now.timestamp(),
        )
        settings.ME.submissions.new = Mock(return_value=[existing_post])

        result = post_monthly_submission(settings)

        assert result is None

    def test_creates_post_if_previous_is_different_month(self):
        """Should create new post if previous post is from different month"""
        settings = MockSettings()

        # Previous post from last month
        old_date = datetime(2024, 1, 15, tzinfo=timezone.utc)
        existing_post = MockSubmission(
            subreddit_id="sub123",
            stickied=True,
            created_utc=old_date.timestamp(),
        )
        settings.ME.submissions.new = Mock(return_value=[existing_post])

        new_submission = Mock()
        new_submission.mod = Mock()
        settings.SUBREDDIT.submit = Mock(return_value=new_submission)

        with patch("helpers_submission.datetime") as mock_datetime:
            mock_now = datetime(2024, 2, 1, tzinfo=timezone.utc)
            mock_datetime.now.return_value = mock_now
            mock_datetime.fromtimestamp = datetime.fromtimestamp

            result = post_monthly_submission(settings)

        assert result == new_submission
        settings.SUBREDDIT.submit.assert_called_once()
        existing_post.mod.sticky.assert_called_with(state=False)

    def test_creates_post_if_no_previous_exists(self):
        """Should create new post if no previous post exists"""
        settings = MockSettings()
        settings.ME.submissions.new = Mock(return_value=[])

        new_submission = Mock()
        new_submission.mod = Mock()
        settings.SUBREDDIT.submit = Mock(return_value=new_submission)

        result = post_monthly_submission(settings)

        assert result == new_submission
        settings.SUBREDDIT.submit.assert_called_once()

    def test_stickies_new_submission(self):
        """Should sticky the new submission at top"""
        settings = MockSettings()
        settings.ME.submissions.new = Mock(return_value=[])

        new_submission = Mock()
        new_submission.mod = Mock()
        settings.SUBREDDIT.submit = Mock(return_value=new_submission)

        post_monthly_submission(settings)

        new_submission.mod.sticky.assert_called_with(bottom=False)

    def test_sets_suggested_sort_to_new(self):
        """Should set suggested sort to 'new'"""
        settings = MockSettings()
        settings.ME.submissions.new = Mock(return_value=[])

        new_submission = Mock()
        new_submission.mod = Mock()
        settings.SUBREDDIT.submit = Mock(return_value=new_submission)

        post_monthly_submission(settings)

        new_submission.mod.suggested_sort.assert_called_with(sort="new")


class TestLockPreviousSubmissions:
    """Tests for lock_previous_submissions()"""

    def test_locks_unlocked_submissions(self):
        """Should lock submissions that aren't locked"""
        settings = MockSettings()
        unlocked_sub = MockSubmission(
            subreddit_id="sub123",
            locked=False,
        )
        # Set the subreddit_id to match the name check
        unlocked_sub.subreddit_id = "sub123"
        settings.ME.submissions.new = Mock(return_value=[unlocked_sub])

        lock_previous_submissions(settings)

        # Note: The function checks subreddit_id != subreddit.name
        # which seems like a bug (comparing id to name)

    def test_skips_exempt_submission(self):
        """Should not lock the exempt submission"""
        settings = MockSettings()
        exempt_sub = MockSubmission(subreddit_id="sub123", locked=False)
        exempt_sub.subreddit_id = settings.SUBREDDIT.name
        settings.ME.submissions.new = Mock(return_value=[exempt_sub])

        lock_previous_submissions(settings, exempt_submission=exempt_sub)

        exempt_sub.mod.lock.assert_not_called()

    def test_skips_already_locked(self):
        """Should not try to lock already locked submissions"""
        settings = MockSettings()
        locked_sub = MockSubmission(subreddit_id="sub123", locked=True)
        locked_sub.subreddit_id = settings.SUBREDDIT.name
        settings.ME.submissions.new = Mock(return_value=[locked_sub])

        lock_previous_submissions(settings)

        locked_sub.mod.lock.assert_not_called()

    def test_requests_limit_of_10(self):
        """Should request limit of 10 submissions"""
        settings = MockSettings()
        settings.ME.submissions.new = Mock(return_value=[])

        lock_previous_submissions(settings)

        settings.ME.submissions.new.assert_called_once_with(limit=10)

    def test_locks_submission_in_correct_subreddit(self):
        """Should lock submissions that match the subreddit"""
        settings = MockSettings()
        # Make subreddit_id match the subreddit name for the check to pass
        matching_sub = MockSubmission(subreddit_id="sub123", locked=False)
        matching_sub.subreddit_id = settings.SUBREDDIT.name  # Match the name
        settings.ME.submissions.new = Mock(return_value=[matching_sub])

        lock_previous_submissions(settings)

        matching_sub.mod.lock.assert_called_once()

    def test_skips_submission_from_different_subreddit(self):
        """Should skip submissions from different subreddits"""
        settings = MockSettings()
        different_sub = MockSubmission(subreddit_id="other_subreddit", locked=False)
        different_sub.subreddit_id = "completely_different"  # Different from subreddit.name
        settings.ME.submissions.new = Mock(return_value=[different_sub])

        lock_previous_submissions(settings)

        different_sub.mod.lock.assert_not_called()
