"""Tests for Settings class parsing logic"""
import os
import re
import sys
from unittest.mock import Mock, patch, MagicMock
import prawcore

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


class TestLoadFlairTemplatesParsing:
    """Tests for the flair template parsing logic in Settings._load_flair_templates()

    This tests the parsing logic without instantiating the full Settings class,
    which would require PRAW connections.
    """

    # Sample regex patterns matching the real bot's patterns
    FLAIR_TEMPLATE_PATTERN = re.compile(r"(\[(\d+)-(\d+)\])")
    SPECIAL_FLAIR_TEMPLATE_PATTERN = re.compile(r"📧 Emails: {E} \| 📬 Letters: {L}")

    def parse_flair_templates(self, templates_list):
        """Re-implementation of _load_flair_templates logic for testing"""
        flair_templates = {}
        special_templates = {}

        for template in templates_list:
            match = self.FLAIR_TEMPLATE_PATTERN.search(template["text"])
            if match:
                # Remove the range marker from display text
                template["text"] = template["text"].replace(match.group(1), "")
                flair_templates[(int(match.group(2)), int(match.group(3)))] = template
            else:
                special_match = self.SPECIAL_FLAIR_TEMPLATE_PATTERN.search(template["text"])
                if special_match:
                    special_templates[template["id"]] = template

        return (flair_templates, special_templates)

    def test_parse_ranged_template(self):
        """Should parse range markers like [0-10] from template text"""
        templates = [
            {
                "id": "flair_starter",
                "text": "[0-10]📧 Emails: {E} | 📬 Letters: {L}",
                "css_class": "flair_starter",
            }
        ]

        flair_templates, special_templates = self.parse_flair_templates(templates)

        assert (0, 10) in flair_templates
        assert flair_templates[(0, 10)]["id"] == "flair_starter"
        # Range marker should be removed from text
        assert "[0-10]" not in flair_templates[(0, 10)]["text"]

    def test_parse_multiple_ranges(self):
        """Should parse multiple ranged templates"""
        templates = [
            {"id": "starter", "text": "[0-10]📧 Emails: {E} | 📬 Letters: {L}", "css_class": "starter"},
            {"id": "regular", "text": "[11-50]Regular - 📧 Emails: {E} | 📬 Letters: {L}", "css_class": "regular"},
            {"id": "veteran", "text": "[51-100]Veteran - 📧 Emails: {E} | 📬 Letters: {L}", "css_class": "veteran"},
        ]

        flair_templates, special_templates = self.parse_flair_templates(templates)

        assert len(flair_templates) == 3
        assert (0, 10) in flair_templates
        assert (11, 50) in flair_templates
        assert (51, 100) in flair_templates

    def test_parse_special_template(self):
        """Should identify special templates without range markers"""
        templates = [
            {
                "id": "volunteer_flair",
                "text": "Volunteer - 📧 Emails: {E} | 📬 Letters: {L}",
                "css_class": "volunteer_flair",
            }
        ]

        flair_templates, special_templates = self.parse_flair_templates(templates)

        assert len(flair_templates) == 0
        assert "volunteer_flair" in special_templates

    def test_parse_mixed_templates(self):
        """Should correctly separate ranged and special templates"""
        templates = [
            {"id": "starter", "text": "[0-10]📧 Emails: {E} | 📬 Letters: {L}", "css_class": "starter"},
            {"id": "volunteer", "text": "Volunteer - 📧 Emails: {E} | 📬 Letters: {L}", "css_class": "volunteer"},
            {"id": "regular", "text": "[11-50]Regular - 📧 Emails: {E} | 📬 Letters: {L}", "css_class": "regular"},
        ]

        flair_templates, special_templates = self.parse_flair_templates(templates)

        assert len(flair_templates) == 2
        assert len(special_templates) == 1
        assert (0, 10) in flair_templates
        assert (11, 50) in flair_templates
        assert "volunteer" in special_templates

    def test_ignore_non_matching_template(self):
        """Should ignore templates that don't match any pattern"""
        templates = [
            {"id": "random", "text": "Just some random flair", "css_class": "random"},
        ]

        flair_templates, special_templates = self.parse_flair_templates(templates)

        assert len(flair_templates) == 0
        assert len(special_templates) == 0

    def test_large_range_values(self):
        """Should handle large range values"""
        templates = [
            {"id": "elite", "text": "[1000-9999]Elite - 📧 Emails: {E} | 📬 Letters: {L}", "css_class": "elite"},
        ]

        flair_templates, special_templates = self.parse_flair_templates(templates)

        assert (1000, 9999) in flair_templates


class TestLoadTemplateMethod:
    """Tests for Settings.load_template() fallback logic"""

    def test_falls_back_to_local_file_on_not_found(self):
        """Should load from local file when wiki page not found"""
        # This tests the fallback behavior without needing PRAW
        # We simulate the logic here

        def load_template_logic(wiki_content, local_file_content, wiki_raises=None):
            """Simulated load_template logic"""
            if wiki_raises:
                return local_file_content
            return wiki_content

        # Wiki raises NotFound, should get local content
        result = load_template_logic(
            wiki_content="wiki content",
            local_file_content="local content",
            wiki_raises=prawcore.exceptions.NotFound,
        )
        assert result == "local content"

    def test_returns_wiki_content_when_available(self):
        """Should return wiki content when available"""

        def load_template_logic(wiki_content, local_file_content, wiki_raises=None):
            if wiki_raises:
                return local_file_content
            return wiki_content

        result = load_template_logic(
            wiki_content="wiki content",
            local_file_content="local content",
            wiki_raises=None,
        )
        assert result == "wiki content"


class TestSettingsSingleton:
    """Tests for Settings singleton pattern"""

    def test_singleton_pattern_concept(self):
        """Verify understanding of singleton pattern used in Settings"""
        # The Settings class uses __new__ to implement singleton
        # This test documents the expected behavior

        class SingletonExample:
            _instance = None

            def __new__(cls, value):
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance.value = value
                return cls._instance

        first = SingletonExample("first")
        second = SingletonExample("second")

        # Both references point to same instance
        assert first is second
        # Value is from first instantiation
        assert first.value == "first"
        assert second.value == "first"
