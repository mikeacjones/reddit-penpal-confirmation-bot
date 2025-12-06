"""Tests for helpers_redditor.py"""
import os
import sys
from unittest.mock import Mock, MagicMock
import prawcore

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from helpers_redditor import get_redditor


class TestGetRedditor:
    """Tests for get_redditor() function"""

    def test_get_redditor_valid_user(self):
        """Should return redditor object for valid user"""
        mock_bot = Mock()
        mock_redditor = Mock()
        mock_redditor.id = "abc123"
        mock_bot.redditor = Mock(return_value=mock_redditor)

        result = get_redditor(mock_bot, "valid_user")

        assert result == mock_redditor
        mock_bot.redditor.assert_called_once_with("valid_user")

    def test_get_redditor_not_found(self):
        """Should return None for non-existent user"""
        mock_bot = Mock()
        mock_bot.redditor = Mock(side_effect=prawcore.exceptions.NotFound(Mock()))

        result = get_redditor(mock_bot, "nonexistent_user")

        assert result is None

    def test_get_redditor_suspended_user(self):
        """Should return None when accessing id raises NotFound (suspended user)"""
        mock_bot = Mock()
        mock_redditor = Mock()
        # Accessing .id on suspended user raises NotFound
        type(mock_redditor).id = property(
            lambda self: (_ for _ in ()).throw(prawcore.exceptions.NotFound(Mock()))
        )
        mock_bot.redditor = Mock(return_value=mock_redditor)

        result = get_redditor(mock_bot, "suspended_user")

        assert result is None

    def test_get_redditor_with_underscore_name(self):
        """Should handle usernames with underscores"""
        mock_bot = Mock()
        mock_redditor = Mock()
        mock_redditor.id = "xyz789"
        mock_bot.redditor = Mock(return_value=mock_redditor)

        result = get_redditor(mock_bot, "user_with_underscores")

        assert result == mock_redditor
        mock_bot.redditor.assert_called_once_with("user_with_underscores")

    def test_get_redditor_with_numbers(self):
        """Should handle usernames with numbers"""
        mock_bot = Mock()
        mock_redditor = Mock()
        mock_redditor.id = "id123"
        mock_bot.redditor = Mock(return_value=mock_redditor)

        result = get_redditor(mock_bot, "user123")

        assert result == mock_redditor

    def test_get_redditor_case_preserved(self):
        """Should preserve username case when calling PRAW"""
        mock_bot = Mock()
        mock_redditor = Mock()
        mock_redditor.id = "id"
        mock_bot.redditor = Mock(return_value=mock_redditor)

        get_redditor(mock_bot, "MixedCaseUser")

        mock_bot.redditor.assert_called_once_with("MixedCaseUser")
