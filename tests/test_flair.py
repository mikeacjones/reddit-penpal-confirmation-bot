"""Tests for flair-related functions in helpers_flair.py"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from helpers_flair import (
    parse_flair_counts,
    calculate_new_flair_counts,
    select_flair_template,
    format_flair_text,
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
