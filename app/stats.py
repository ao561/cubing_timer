"""WCA-style average calculations.

An "average of N" drops the single best and single worst attempt and takes the
arithmetic mean of the remaining N-2. A DNF counts as the worst attempt; two or
more DNFs in the same window make the whole average a DNF (``None``).
"""

from typing import List, Optional, Sequence

from app.models import Solve, Stats


def average_of_n(window: Sequence[Optional[int]]) -> Optional[float]:
    """Average of a window of effective times (``None`` == DNF).

    Returns ``None`` if the window is the wrong size or the average is a DNF.
    """
    n = len(window)
    if n < 3:
        return None

    dnfs = sum(1 for t in window if t is None)
    if dnfs > 1:
        return None

    times = sorted(t for t in window if t is not None)
    if dnfs == 1:
        # The DNF is the worst attempt, so only the best is trimmed.
        counted = times[1:]
    else:
        counted = times[1:-1]

    return sum(counted) / len(counted)


def _rolling_averages(times: Sequence[Optional[int]], n: int) -> List[Optional[float]]:
    """Average-of-n for every consecutive window, oldest window first."""
    if len(times) < n:
        return []
    return [average_of_n(times[i : i + n]) for i in range(len(times) - n + 1)]


def _best(values: Sequence[Optional[float]]) -> Optional[float]:
    valid = [v for v in values if v is not None]
    return min(valid) if valid else None


def compute_stats(solves_desc: Sequence[Solve]) -> Stats:
    """Build the aggregate stats block from solves ordered newest-first."""
    chronological = list(reversed(solves_desc))
    times = [s.effective_ms for s in chronological]
    valid = [t for t in times if t is not None]

    stats = Stats(count=len(times))
    if valid:
        stats.best = min(valid)
        stats.worst = max(valid)
        stats.mean = sum(valid) / len(valid)

    for n, current_field, best_field in (
        (5, "current_ao5", "best_ao5"),
        (12, "current_ao12", "best_ao12"),
    ):
        rolling = _rolling_averages(times, n)
        if rolling:
            # The last window is the most recent n solves.
            setattr(stats, current_field, rolling[-1])
            setattr(stats, best_field, _best(rolling))

    return stats
