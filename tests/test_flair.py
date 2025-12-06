"""Tests for flair-related functions in helpers_flair.py"""
import os
import re
import sys
from unittest.mock import Mock, patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from helpers_flair import (
    parse_flair_counts,
    calculate_new_flair_counts,
    select_flair_template,
    format_flair_text,
    get_current_flair,
    set_redditor_flair,
    increment_flair,
)


# Sample flair pattern matching "📧 Emails: X | 📬 Letters: Y"
SAMPLE_FLAIR_PATTERN = re.compile(r"📧 Emails: (\d+|{E}) \| 📬 Letters: (\d+|{L})")


class TestParseFlairCounts:
    """Tests for parse_flair_counts() - extracting counts from flair text"""

    def test_valid_flair_text(self):
        emails, letters = parse_flair_counts(
            "📧 Emails: 5 | 📬 Letters: 10", SAMPLE_FLAIR_PATTERN
        )
        assert emails == 5
        assert letters == 10

    def test_zero_counts(self):
        emails, letters = parse_flair_counts(
            "📧 Emails: 0 | 📬 Letters: 0", SAMPLE_FLAIR_PATTERN
        )
        assert emails == 0
        assert letters == 0

    def test_none_flair_text(self):
        emails, letters = parse_flair_counts(None, SAMPLE_FLAIR_PATTERN)
        assert emails == 0
        assert letters == 0

    def test_empty_flair_text(self):
        emails, letters = parse_flair_counts("", SAMPLE_FLAIR_PATTERN)
        assert emails == 0
        assert letters == 0

    def test_non_matching_flair_text(self):
        emails, letters = parse_flair_counts(
            "Some random flair text", SAMPLE_FLAIR_PATTERN
        )
        assert emails == 0
        assert letters == 0

    def test_flair_with_prefix(self):
        # Test flair with additional text before the pattern
        emails, letters = parse_flair_counts(
            "Snail Mail Volunteer - 📧 Emails: 6 | 📬 Letters: 6", SAMPLE_FLAIR_PATTERN
        )
        assert emails == 6
        assert letters == 6

    def test_large_counts(self):
        emails, letters = parse_flair_counts(
            "📧 Emails: 999 | 📬 Letters: 1234", SAMPLE_FLAIR_PATTERN
        )
        assert emails == 999
        assert letters == 1234


class TestCalculateNewFlairCounts:
    """Tests for calculate_new_flair_counts() - computing new totals"""

    def test_add_to_zero(self):
        emails, letters, total = calculate_new_flair_counts(0, 0, 1, 1)
        assert emails == 1
        assert letters == 1
        assert total == 2

    def test_add_to_existing(self):
        emails, letters, total = calculate_new_flair_counts(5, 10, 2, 3)
        assert emails == 7
        assert letters == 13
        assert total == 20

    def test_add_only_emails(self):
        emails, letters, total = calculate_new_flair_counts(5, 5, 3, 0)
        assert emails == 8
        assert letters == 5
        assert total == 13

    def test_add_only_letters(self):
        emails, letters, total = calculate_new_flair_counts(5, 5, 0, 3)
        assert emails == 5
        assert letters == 8
        assert total == 13

    def test_add_nothing(self):
        emails, letters, total = calculate_new_flair_counts(10, 20, 0, 0)
        assert emails == 10
        assert letters == 20
        assert total == 30


class TestSelectFlairTemplate:
    """Tests for select_flair_template() - choosing the right template"""

    # Sample flair templates
    SAMPLE_FLAIR_TEMPLATES = {
        (0, 10): {"id": "template_0_10", "text": "📧 Emails: {E} | 📬 Letters: {L}", "mod_only": False},
        (11, 50): {"id": "template_11_50", "text": "Regular - 📧 Emails: {E} | 📬 Letters: {L}", "mod_only": False},
        (51, 100): {"id": "template_51_100", "text": "Veteran - 📧 Emails: {E} | 📬 Letters: {L}", "mod_only": False},
    }

    SAMPLE_SPECIAL_TEMPLATES = {
        "special_volunteer": {"id": "special_volunteer", "text": "Volunteer - 📧 Emails: {E} | 📬 Letters: {L}"},
        "moderator_flair": {"id": "moderator_flair", "text": "Mod - 📧 Emails: {E} | 📬 Letters: {L}"},
    }

    def test_select_first_range(self):
        template = select_flair_template(
            self.SAMPLE_FLAIR_TEMPLATES,
            self.SAMPLE_SPECIAL_TEMPLATES,
            total_count=5,
            current_flair_css_class=None,
            is_moderator=False,
        )
        assert template is not None
        assert template["id"] == "template_0_10"

    def test_select_middle_range(self):
        template = select_flair_template(
            self.SAMPLE_FLAIR_TEMPLATES,
            self.SAMPLE_SPECIAL_TEMPLATES,
            total_count=25,
            current_flair_css_class=None,
            is_moderator=False,
        )
        assert template is not None
        assert template["id"] == "template_11_50"

    def test_select_high_range(self):
        template = select_flair_template(
            self.SAMPLE_FLAIR_TEMPLATES,
            self.SAMPLE_SPECIAL_TEMPLATES,
            total_count=75,
            current_flair_css_class=None,
            is_moderator=False,
        )
        assert template is not None
        assert template["id"] == "template_51_100"

    def test_select_boundary_low(self):
        template = select_flair_template(
            self.SAMPLE_FLAIR_TEMPLATES,
            self.SAMPLE_SPECIAL_TEMPLATES,
            total_count=11,
            current_flair_css_class=None,
            is_moderator=False,
        )
        assert template is not None
        assert template["id"] == "template_11_50"

    def test_select_boundary_high(self):
        template = select_flair_template(
            self.SAMPLE_FLAIR_TEMPLATES,
            self.SAMPLE_SPECIAL_TEMPLATES,
            total_count=50,
            current_flair_css_class=None,
            is_moderator=False,
        )
        assert template is not None
        assert template["id"] == "template_11_50"

    def test_out_of_range_returns_none(self):
        template = select_flair_template(
            self.SAMPLE_FLAIR_TEMPLATES,
            self.SAMPLE_SPECIAL_TEMPLATES,
            total_count=150,
            current_flair_css_class=None,
            is_moderator=False,
        )
        assert template is None

    def test_special_flair_preserved(self):
        template = select_flair_template(
            self.SAMPLE_FLAIR_TEMPLATES,
            self.SAMPLE_SPECIAL_TEMPLATES,
            total_count=5,  # Would normally get template_0_10
            current_flair_css_class="special_volunteer",
            is_moderator=False,
        )
        assert template is not None
        assert template["id"] == "special_volunteer"

    def test_unknown_special_flair_falls_back_to_range(self):
        template = select_flair_template(
            self.SAMPLE_FLAIR_TEMPLATES,
            self.SAMPLE_SPECIAL_TEMPLATES,
            total_count=5,
            current_flair_css_class="unknown_flair_class",
            is_moderator=False,
        )
        assert template is not None
        assert template["id"] == "template_0_10"


class TestFormatFlairText:
    """Tests for format_flair_text() - inserting counts into template"""

    def test_basic_format(self):
        result = format_flair_text("📧 Emails: {E} | 📬 Letters: {L}", 5, 10)
        assert result == "📧 Emails: 5 | 📬 Letters: 10"

    def test_zero_counts(self):
        result = format_flair_text("📧 Emails: {E} | 📬 Letters: {L}", 0, 0)
        assert result == "📧 Emails: 0 | 📬 Letters: 0"

    def test_with_prefix(self):
        result = format_flair_text("Veteran - 📧 Emails: {E} | 📬 Letters: {L}", 100, 200)
        assert result == "Veteran - 📧 Emails: 100 | 📬 Letters: 200"

    def test_large_numbers(self):
        result = format_flair_text("{E} emails, {L} letters", 9999, 12345)
        assert result == "9999 emails, 12345 letters"


# ============================================================================
# Tests for PRAW-dependent functions (using mocks)
# ============================================================================


class MockSettings:
    """Mock Settings object for testing PRAW-dependent functions"""

    def __init__(self):
        self.SUBREDDIT = Mock()
        self.FLAIR_PATTERN = SAMPLE_FLAIR_PATTERN
        self.FLAIR_TEMPLATES = {
            (0, 10): {"id": "template_0_10", "text": "📧 Emails: {E} | 📬 Letters: {L}", "mod_only": False},
            (11, 50): {"id": "template_11_50", "text": "Regular - 📧 Emails: {E} | 📬 Letters: {L}", "mod_only": False},
        }
        self.SPECIAL_FLAIR_TEMPLATES = {
            "volunteer": {"id": "volunteer", "text": "Volunteer - 📧 Emails: {E} | 📬 Letters: {L}"},
        }
        self.CURRENT_MODS = ["ModUser1", "ModUser2"]


class TestGetCurrentFlair:
    """Tests for get_current_flair() - fetching flair via PRAW API"""

    def test_returns_flair_dict(self):
        """Should return flair dictionary from PRAW API"""
        settings = MockSettings()
        mock_redditor = Mock()
        flair_data = {"flair_text": "📧 Emails: 5 | 📬 Letters: 3", "flair_css_class": "template_0_10"}
        settings.SUBREDDIT.flair = Mock(return_value=iter([flair_data]))

        result = get_current_flair(settings, mock_redditor)

        assert result == flair_data
        settings.SUBREDDIT.flair.assert_called_once_with(mock_redditor)

    def test_handles_no_flair(self):
        """Should handle user with no flair"""
        settings = MockSettings()
        mock_redditor = Mock()
        flair_data = {"flair_text": None, "flair_css_class": None}
        settings.SUBREDDIT.flair = Mock(return_value=iter([flair_data]))

        result = get_current_flair(settings, mock_redditor)

        assert result["flair_text"] is None


class TestSetRedditorFlair:
    """Tests for set_redditor_flair() - setting flair via PRAW API"""

    def test_calls_flair_set(self):
        """Should call PRAW flair.set with correct parameters"""
        settings = MockSettings()
        mock_redditor = Mock()
        template = {"id": "template_123", "text": "📧 Emails: {E} | 📬 Letters: {L}"}

        set_redditor_flair(settings, mock_redditor, "📧 Emails: 5 | 📬 Letters: 3", template)

        settings.SUBREDDIT.flair.set.assert_called_once_with(
            mock_redditor,
            text="📧 Emails: 5 | 📬 Letters: 3",
            flair_template_id="template_123",
        )


class TestIncrementFlair:
    """Tests for increment_flair() - the full flair update workflow"""

    def test_increment_new_user(self):
        """Should set flair for user with no existing flair"""
        settings = MockSettings()
        mock_redditor = Mock()
        mock_redditor.__str__ = Mock(return_value="TestUser")

        # User has no flair
        settings.SUBREDDIT.flair = Mock(
            return_value=iter([{"flair_text": None, "flair_css_class": None}])
        )

        old_flair, new_flair = increment_flair(settings, mock_redditor, 1, 2)

        assert old_flair == "No Flair"
        assert new_flair == "📧 Emails: 1 | 📬 Letters: 2"
        settings.SUBREDDIT.flair.set.assert_called_once()

    def test_increment_existing_flair(self):
        """Should increment counts for user with existing flair"""
        settings = MockSettings()
        mock_redditor = Mock()
        mock_redditor.__str__ = Mock(return_value="TestUser")

        # User has existing flair
        settings.SUBREDDIT.flair = Mock(
            return_value=iter([{
                "flair_text": "📧 Emails: 3 | 📬 Letters: 4",
                "flair_css_class": "template_0_10"
            }])
        )

        old_flair, new_flair = increment_flair(settings, mock_redditor, 2, 1)

        assert old_flair == "📧 Emails: 3 | 📬 Letters: 4"
        assert new_flair == "📧 Emails: 5 | 📬 Letters: 5"

    def test_increment_preserves_special_flair(self):
        """Should preserve special flair template when incrementing"""
        settings = MockSettings()
        mock_redditor = Mock()
        mock_redditor.__str__ = Mock(return_value="VolunteerUser")

        # User has special volunteer flair
        settings.SUBREDDIT.flair = Mock(
            return_value=iter([{
                "flair_text": "Volunteer - 📧 Emails: 5 | 📬 Letters: 5",
                "flair_css_class": "volunteer"
            }])
        )

        old_flair, new_flair = increment_flair(settings, mock_redditor, 1, 1)

        assert "Volunteer" in new_flair
        assert "📧 Emails: 6" in new_flair

    def test_increment_returns_none_when_no_template_match(self):
        """Should return (None, None) when count exceeds all templates"""
        settings = MockSettings()
        mock_redditor = Mock()
        mock_redditor.__str__ = Mock(return_value="HighCountUser")

        # User has very high counts that exceed template ranges
        settings.SUBREDDIT.flair = Mock(
            return_value=iter([{
                "flair_text": "📧 Emails: 100 | 📬 Letters: 100",
                "flair_css_class": None
            }])
        )

        old_flair, new_flair = increment_flair(settings, mock_redditor, 1, 1)

        # Total would be 202, which exceeds max template range of 50
        assert old_flair is None
        assert new_flair is None

    def test_increment_promotes_to_higher_template(self):
        """Should upgrade to higher tier template when count crosses threshold"""
        settings = MockSettings()
        mock_redditor = Mock()
        mock_redditor.__str__ = Mock(return_value="PromotedUser")

        # User at edge of first tier (total = 10)
        settings.SUBREDDIT.flair = Mock(
            return_value=iter([{
                "flair_text": "📧 Emails: 5 | 📬 Letters: 5",
                "flair_css_class": "template_0_10"
            }])
        )

        old_flair, new_flair = increment_flair(settings, mock_redditor, 1, 0)

        # Total is now 11, should get template_11_50
        assert "Regular" in new_flair
        assert "📧 Emails: 6" in new_flair
