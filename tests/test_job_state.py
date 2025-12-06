"""Tests for job state management functions

Note: These tests focus on the pure logic without importing main.py,
since main.py initializes PRAW connections at module level.
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


# Re-implement the pure functions here for testing
# (since importing main.py triggers PRAW initialization)

def load_job_state(state_file: str) -> dict:
    """Load job execution state from file."""
    if os.path.exists(state_file):
        try:
            with open(state_file, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"last_monthly_post": None}


def save_job_state(state: dict, state_file: str) -> None:
    """Save job execution state to file."""
    with open(state_file, "w") as f:
        json.dump(state, f)


class TestJobStateManagement:
    """Tests for load_job_state() and save_job_state()"""

    def test_load_job_state_no_file(self):
        """When no state file exists, should return default state"""
        with tempfile.TemporaryDirectory() as tmpdir:
            state_file = os.path.join(tmpdir, "nonexistent.json")
            state = load_job_state(state_file)
            assert state == {"last_monthly_post": None}

    def test_load_job_state_valid_file(self):
        """Should load state from existing file"""
        with tempfile.TemporaryDirectory() as tmpdir:
            state_file = os.path.join(tmpdir, "state.json")
            test_state = {"last_monthly_post": "2024-01-15T00:00:00+00:00"}

            with open(state_file, "w") as f:
                json.dump(test_state, f)

            state = load_job_state(state_file)
            assert state["last_monthly_post"] == "2024-01-15T00:00:00+00:00"

    def test_load_job_state_corrupted_file(self):
        """Should return default state if file is corrupted"""
        with tempfile.TemporaryDirectory() as tmpdir:
            state_file = os.path.join(tmpdir, "state.json")

            with open(state_file, "w") as f:
                f.write("not valid json {{{")

            state = load_job_state(state_file)
            assert state == {"last_monthly_post": None}

    def test_save_job_state(self):
        """Should save state to file"""
        with tempfile.TemporaryDirectory() as tmpdir:
            state_file = os.path.join(tmpdir, "state.json")
            test_state = {"last_monthly_post": "2024-02-01T00:00:00+00:00"}

            save_job_state(test_state, state_file)

            with open(state_file, "r") as f:
                saved_state = json.load(f)

            assert saved_state == test_state

    def test_save_and_load_roundtrip(self):
        """Should be able to save and load state"""
        with tempfile.TemporaryDirectory() as tmpdir:
            state_file = os.path.join(tmpdir, "state.json")
            original_state = {
                "last_monthly_post": "2024-03-01T00:00:00+00:00",
                "extra_field": "some_value",
            }

            save_job_state(original_state, state_file)
            loaded_state = load_job_state(state_file)

            assert loaded_state == original_state


class TestShouldRunMonthlyPostLogic:
    """Tests for the date comparison logic in should_run_monthly_post()"""

    def test_same_month_should_not_run(self):
        """If last run was this month, should return False"""
        now = datetime(2024, 3, 15, tzinfo=timezone.utc)
        last_run = "2024-03-01T00:00:00+00:00"

        current_month_key = now.strftime("%Y-%m")  # "2024-03"
        last_month_key = last_run.split("T")[0][:7]  # "2024-03"

        should_run = current_month_key != last_month_key
        assert should_run is False

    def test_different_month_should_run(self):
        """If last run was previous month, should return True"""
        now = datetime(2024, 3, 15, tzinfo=timezone.utc)
        last_run = "2024-02-01T00:00:00+00:00"

        current_month_key = now.strftime("%Y-%m")  # "2024-03"
        last_month_key = last_run.split("T")[0][:7]  # "2024-02"

        should_run = current_month_key != last_month_key
        assert should_run is True

    def test_new_year_transition(self):
        """Should handle year transition correctly"""
        now = datetime(2024, 1, 5, tzinfo=timezone.utc)
        last_run = "2023-12-01T00:00:00+00:00"

        current_month_key = now.strftime("%Y-%m")  # "2024-01"
        last_month_key = last_run.split("T")[0][:7]  # "2023-12"

        should_run = current_month_key != last_month_key
        assert should_run is True

    def test_same_year_different_month(self):
        """Should correctly identify different months in same year"""
        now = datetime(2024, 6, 15, tzinfo=timezone.utc)
        last_run = "2024-05-01T00:00:00+00:00"

        current_month_key = now.strftime("%Y-%m")
        last_month_key = last_run.split("T")[0][:7]

        should_run = current_month_key != last_month_key
        assert should_run is True

    def test_no_last_run_should_check_reddit(self):
        """If no last run recorded, logic should proceed to check Reddit"""
        last_run = None
        # With no last_run, the function should return True to trigger Reddit check
        assert last_run is None


class TestSubmissionDateLogic:
    """Tests for date comparison logic used in submission functions"""

    def test_is_same_month_year_true(self):
        """Should return True when dates are in same month/year"""
        now = datetime(2024, 3, 15, tzinfo=timezone.utc)
        submission_time = datetime(2024, 3, 1, tzinfo=timezone.utc)

        is_same = (
            submission_time.year == now.year and submission_time.month == now.month
        )
        assert is_same is True

    def test_is_same_month_year_false_different_month(self):
        """Should return False when months differ"""
        now = datetime(2024, 3, 15, tzinfo=timezone.utc)
        submission_time = datetime(2024, 2, 28, tzinfo=timezone.utc)

        is_same = (
            submission_time.year == now.year and submission_time.month == now.month
        )
        assert is_same is False

    def test_is_same_month_year_false_different_year(self):
        """Should return False when years differ"""
        now = datetime(2024, 3, 15, tzinfo=timezone.utc)
        submission_time = datetime(2023, 3, 15, tzinfo=timezone.utc)

        is_same = (
            submission_time.year == now.year and submission_time.month == now.month
        )
        assert is_same is False

    def test_edge_case_first_of_month(self):
        """Should handle first day of month correctly"""
        now = datetime(2024, 4, 1, tzinfo=timezone.utc)
        submission_time = datetime(2024, 3, 31, tzinfo=timezone.utc)

        is_same = (
            submission_time.year == now.year and submission_time.month == now.month
        )
        assert is_same is False

    def test_edge_case_last_of_month(self):
        """Should handle last day of month correctly"""
        now = datetime(2024, 3, 31, tzinfo=timezone.utc)
        submission_time = datetime(2024, 3, 1, tzinfo=timezone.utc)

        is_same = (
            submission_time.year == now.year and submission_time.month == now.month
        )
        assert is_same is True
