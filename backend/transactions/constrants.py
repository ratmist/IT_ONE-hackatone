CRIT_LEVEL = {"low": 1, "medium": 2, "high": 3, "critical": 4}

def crit_to_level(val) -> int:
    if val is None:
        return 0
    if isinstance(val, int):
        return val
    s = str(val).strip().lower()
    return CRIT_LEVEL.get(s, 0)
