"""Pytest configuration and shared fixtures"""
import os
import sys

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


# Set dummy environment variables for tests that import main.py
# This prevents errors when loading modules that read env vars at import time
os.environ.setdefault("SUBREDDIT_NAME", "test_subreddit")
os.environ.setdefault("REDDIT_CLIENT_ID", "test_client_id")
os.environ.setdefault("REDDIT_CLIENT_SECRET", "test_client_secret")
os.environ.setdefault("REDDIT_USER_AGENT", "test_user_agent")
os.environ.setdefault("REDDIT_USERNAME", "test_username")
os.environ.setdefault("REDDIT_PASSWORD", "test_password")
os.environ.setdefault("PUSHOVER_APP_TOKEN", "test_pushover_app")
os.environ.setdefault("PUSHOVER_USER_TOKEN", "test_pushover_user")
