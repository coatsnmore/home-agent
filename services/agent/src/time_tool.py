"""Current real-world date, time, and timezone tool."""

import datetime
from typing import Optional
import zoneinfo
from strands import tool


@tool
def get_current_datetime(timezone: Optional[str] = None) -> str:
    """Get the current real-world date, day of the week, time, and timezone.

    Use this tool when:
    - The user asks 'what is today's date?', 'what time is it?', 'what day is it?', or relative date questions.
    - Anchoring temporal internet searches for news or current events to ensure you search for the current year and month.

    Args:
        timezone: Optional IANA timezone string (e.g. 'America/New_York', 'US/Eastern', 'UTC'). If omitted, uses local system timezone.
    """
    start_time = datetime.datetime.now()
    try:
        tz = zoneinfo.ZoneInfo(timezone) if timezone else None
    except Exception:
        tz = None

    now = datetime.datetime.now(tz)
    result = (
        f"Today is {now.strftime('%A, %B %d, %Y')}. "
        f"The current time is {now.strftime('%I:%M:%S %p')} {now.strftime('%Z').strip()}."
    )
    

    return result
