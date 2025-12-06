import re
from helpers import sint
from logger import LOGGER


def parse_flair_counts(flair_text: str | None, flair_pattern: re.Pattern) -> tuple[int, int]:
    """Parse email and letter counts from flair text.

    Args:
        flair_text: The current flair text (may be None or empty)
        flair_pattern: Compiled regex pattern to extract counts

    Returns:
        Tuple of (emails, letters) counts. Returns (0, 0) if no flair or no match.
    """
    if not flair_text:
        return (0, 0)

    match = flair_pattern.search(flair_text)
    if not match:
        return (0, 0)

    emails, letters = match.groups()
    return (sint(emails, 0), sint(letters, 0))


def calculate_new_flair_counts(
    current_emails: int,
    current_letters: int,
    new_emails: int,
    new_letters: int,
) -> tuple[int, int, int]:
    """Calculate new flair counts and total.

    Args:
        current_emails: Current email count
        current_letters: Current letter count
        new_emails: Emails to add
        new_letters: Letters to add

    Returns:
        Tuple of (new_email_count, new_letter_count, total_count)
    """
    total_emails = current_emails + new_emails
    total_letters = current_letters + new_letters
    total = total_emails + total_letters
    return (total_emails, total_letters, total)


def select_flair_template(
    flair_templates: dict,
    special_flair_templates: dict,
    total_count: int,
    current_flair_css_class: str | None,
    is_moderator: bool,
) -> dict | None:
    """Select the appropriate flair template based on count and user status.

    Args:
        flair_templates: Dict mapping (min, max) tuples to flair templates
        special_flair_templates: Dict mapping css_class to special templates
        total_count: Total email + letter count
        current_flair_css_class: CSS class of user's current flair (if any)
        is_moderator: Whether the user is a moderator

    Returns:
        The appropriate flair template dict, or None if no match
    """
    # Check if user has a special flair that should be preserved
    if current_flair_css_class and current_flair_css_class in special_flair_templates:
        return special_flair_templates[current_flair_css_class]

    # Find ranged template matching the count
    for (min_count, max_count), template in flair_templates.items():
        if min_count <= total_count <= max_count:
            # If template is mod-only, check if user is mod
            if template.get("mod_only", False) == is_moderator:
                return template

    return None


def format_flair_text(template_text: str, emails: int, letters: int) -> str:
    """Format flair text with email and letter counts.

    Args:
        template_text: Template string with {E} and {L} placeholders
        emails: Email count
        letters: Letter count

    Returns:
        Formatted flair text
    """
    return template_text.format(E=emails, L=letters)


# ============================================================================
# PRAW-dependent functions (not unit tested directly)
# ============================================================================

def get_current_flair(settings, redditor) -> dict:
    """Uses an API call to ensure we have the latest flair text."""
    return next(settings.SUBREDDIT.flair(redditor))


def set_redditor_flair(settings, redditor, new_flair_text: str, flair_template: dict) -> None:
    """Set a user's flair via PRAW API."""
    settings.SUBREDDIT.flair.set(
        redditor, text=new_flair_text, flair_template_id=flair_template["id"]
    )


def increment_flair(settings, redditor, new_emails: int, new_letters: int) -> tuple[str | None, str | None]:
    """Increment a user's flair counts.

    This function combines PRAW API calls with pure logic.

    Args:
        settings: Bot settings object
        redditor: PRAW Redditor object
        new_emails: Number of emails to add
        new_letters: Number of letters to add

    Returns:
        Tuple of (old_flair_text, new_flair_text), or (None, None) on error
    """
    # Get current flair via API
    current_flair = get_current_flair(settings, redditor)
    current_flair_text = current_flair["flair_text"] if current_flair else None
    current_flair_css = current_flair.get("flair_css_class") if current_flair else None

    # Parse current counts
    current_emails, current_letters = parse_flair_counts(
        current_flair_text, settings.FLAIR_PATTERN
    )

    # Handle display text for "no flair" case
    display_old_flair = current_flair_text if current_flair_text else "No Flair"

    # Calculate new counts
    total_emails, total_letters, total = calculate_new_flair_counts(
        current_emails, current_letters, new_emails, new_letters
    )

    # Select appropriate template
    is_moderator = str(redditor) in settings.CURRENT_MODS
    new_flair_template = select_flair_template(
        settings.FLAIR_TEMPLATES,
        settings.SPECIAL_FLAIR_TEMPLATES,
        total,
        current_flair_css,
        is_moderator,
    )

    if not new_flair_template:
        return (None, None)

    # Format and set new flair
    new_flair_text = format_flair_text(new_flair_template["text"], total_emails, total_letters)
    set_redditor_flair(settings, redditor, new_flair_text, new_flair_template)

    LOGGER.info("Updated flair for %s: %s -> %s", redditor, display_old_flair, new_flair_text)
    return (display_old_flair, new_flair_text)
