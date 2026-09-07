"""Database model and request/response schemas."""

from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel
from sqlmodel import Field, SQLModel


class Penalty(str, Enum):
    NONE = "none"
    PLUS_TWO = "+2"
    DNF = "DNF"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Solve(SQLModel, table=True):
    """A single recorded attempt."""

    id: Optional[int] = Field(default=None, primary_key=True)
    time_ms: int = Field(index=True, description="Raw time in milliseconds, before penalties.")
    scramble: str = ""
    penalty: Penalty = Field(default=Penalty.NONE)
    created_at: datetime = Field(default_factory=_utcnow, index=True)
    session_id: str = Field(default="default", index=True)

    @property
    def effective_ms(self) -> Optional[int]:
        """Time including penalties. ``None`` means DNF."""
        if self.penalty is Penalty.DNF:
            return None
        if self.penalty is Penalty.PLUS_TWO:
            return self.time_ms + 2000
        return self.time_ms


class SolveCreate(BaseModel):
    time_ms: int = Field(ge=0)
    scramble: str = ""
    penalty: Penalty = Penalty.NONE
    session_id: str = "default"


class SolveUpdate(BaseModel):
    penalty: Penalty


class SolveRead(BaseModel):
    id: int
    time_ms: int
    scramble: str
    penalty: Penalty
    created_at: datetime
    session_id: str
    effective_ms: Optional[int]


class Stats(BaseModel):
    """Aggregate statistics. ``None`` values mean "not enough solves" or DNF."""

    count: int
    best: Optional[int] = None
    worst: Optional[int] = None
    mean: Optional[float] = None
    current_ao5: Optional[float] = None
    best_ao5: Optional[float] = None
    current_ao12: Optional[float] = None
    best_ao12: Optional[float] = None


class SolvesResponse(BaseModel):
    solves: List[SolveRead]
    stats: Stats
