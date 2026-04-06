"""
Safety middleware — checks user input for crisis/high-risk signals
before the message enters the main generation loop.
"""

from backend.config import SAFETY_KEYWORDS_HIGH, SAFETY_KEYWORDS_MEDIUM


def check(text: str) -> dict:
    """
    Scan *text* for high-risk and medium-risk keywords.

    Returns
    -------
    dict  with keys:
        is_flagged   : bool
        risk_level   : "none" | "medium" | "high"
        matched      : list[str]   — the keywords that matched
    """
    lower = text.lower()
    matched_high = [kw for kw in SAFETY_KEYWORDS_HIGH if kw in lower]
    matched_med = [kw for kw in SAFETY_KEYWORDS_MEDIUM if kw in lower]

    if matched_high:
        return {
            "is_flagged": True,
            "risk_level": "high",
            "matched": matched_high,
        }
    if matched_med:
        return {
            "is_flagged": True,
            "risk_level": "medium",
            "matched": matched_med,
        }
    return {
        "is_flagged": False,
        "risk_level": "none",
        "matched": [],
    }
