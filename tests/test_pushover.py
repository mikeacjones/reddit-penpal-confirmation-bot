"""Tests for Pushover notification class"""
import os
import sys
from unittest.mock import Mock, patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from pushover import Pushover


class TestPushoverInit:
    """Tests for Pushover initialization"""

    def test_init_stores_tokens(self):
        """Should store app and user tokens"""
        pushover = Pushover("app_token_123", "user_token_456")
        assert pushover.APP_TOKEN == "app_token_123"
        assert pushover.USER_TOKEN == "user_token_456"

    def test_init_creates_session(self):
        """Should create a requests session with correct headers"""
        pushover = Pushover("app", "user")
        assert pushover.SESSION is not None
        assert pushover.SESSION.headers["Content-type"] == "application/x-www-form-urlencoded"


class TestPushoverSendMessage:
    """Tests for Pushover.send_message()"""

    def test_send_message_success(self):
        """Should send message and return response"""
        pushover = Pushover("app_token", "user_token")

        mock_response = Mock()
        mock_response.status_code = 200
        pushover.SESSION = Mock()
        pushover.SESSION.post = Mock(return_value=mock_response)

        result = pushover.send_message("Test message")

        assert result == mock_response
        pushover.SESSION.post.assert_called_once_with(
            "https://api.pushover.net/1/messages.json",
            data={
                "token": "app_token",
                "user": "user_token",
                "message": "Test message",
            },
        )

    def test_send_message_with_special_characters(self):
        """Should handle messages with special characters"""
        pushover = Pushover("app", "user")
        pushover.SESSION = Mock()
        pushover.SESSION.post = Mock(return_value=Mock())

        pushover.send_message("Test with émojis 🎉 and spëcial chars!")

        call_args = pushover.SESSION.post.call_args
        assert call_args[1]["data"]["message"] == "Test with émojis 🎉 and spëcial chars!"

    def test_send_message_exception_returns_none(self):
        """Should return None and log exception on error"""
        pushover = Pushover("app", "user")
        pushover.SESSION = Mock()
        pushover.SESSION.post = Mock(side_effect=Exception("Network error"))

        result = pushover.send_message("Test message")

        assert result is None

    def test_send_message_empty_message(self):
        """Should handle empty messages"""
        pushover = Pushover("app", "user")
        pushover.SESSION = Mock()
        pushover.SESSION.post = Mock(return_value=Mock())

        pushover.send_message("")

        call_args = pushover.SESSION.post.call_args
        assert call_args[1]["data"]["message"] == ""

    def test_send_message_long_message(self):
        """Should handle long messages"""
        pushover = Pushover("app", "user")
        pushover.SESSION = Mock()
        pushover.SESSION.post = Mock(return_value=Mock())

        long_message = "A" * 1000
        pushover.send_message(long_message)

        call_args = pushover.SESSION.post.call_args
        assert call_args[1]["data"]["message"] == long_message
