"""Speedcubing timer API + static frontend."""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, col, select

from app.database import get_session, init_db
from app.models import (
    Solve,
    SolveCreate,
    SolveRead,
    SolveUpdate,
    SolvesResponse,
)
from app.stats import compute_stats

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Cubing Timer", version="1.0.0", lifespan=lifespan)

# Wide-open CORS so the frontend works whether it is served by this app, by a
# separate dev server, or opened straight from the filesystem.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def to_read(solve: Solve) -> SolveRead:
    return SolveRead(
        id=solve.id,
        time_ms=solve.time_ms,
        scramble=solve.scramble,
        penalty=solve.penalty,
        created_at=solve.created_at,
        session_id=solve.session_id,
        effective_ms=solve.effective_ms,
    )


def _get_or_404(session: Session, solve_id: int) -> Solve:
    solve = session.get(Solve, solve_id)
    if solve is None:
        raise HTTPException(status_code=404, detail=f"Solve {solve_id} not found")
    return solve


@app.post("/api/solves", response_model=SolveRead, status_code=201)
def create_solve(payload: SolveCreate, session: Session = Depends(get_session)) -> SolveRead:
    """Record a new solve."""
    solve = Solve(**payload.model_dump())
    session.add(solve)
    session.commit()
    session.refresh(solve)
    return to_read(solve)


@app.get("/api/solves", response_model=SolvesResponse)
def list_solves(
    session_id: Optional[str] = None,
    limit: Optional[int] = Query(default=None, ge=1, le=10_000),
    session: Session = Depends(get_session),
) -> SolvesResponse:
    """Solve history, newest first, plus current/best Ao5 and Ao12.

    Stats are always computed over the full session history; ``limit`` only
    trims the returned list.
    """
    statement = select(Solve)
    if session_id is not None:
        statement = statement.where(Solve.session_id == session_id)
    statement = statement.order_by(col(Solve.created_at).desc(), col(Solve.id).desc())

    solves = list(session.exec(statement).all())
    stats = compute_stats(solves)

    visible = solves[:limit] if limit is not None else solves
    return SolvesResponse(solves=[to_read(s) for s in visible], stats=stats)


@app.patch("/api/solves/{solve_id}", response_model=SolveRead)
def update_solve(
    solve_id: int,
    payload: SolveUpdate,
    session: Session = Depends(get_session),
) -> SolveRead:
    """Set the penalty on a solve to "none", "+2" or "DNF"."""
    solve = _get_or_404(session, solve_id)
    solve.penalty = payload.penalty
    session.add(solve)
    session.commit()
    session.refresh(solve)
    return to_read(solve)


@app.delete("/api/solves/{solve_id}", status_code=204)
def delete_solve(solve_id: int, session: Session = Depends(get_session)) -> None:
    """Remove a solve from the history."""
    solve = _get_or_404(session, solve_id)
    session.delete(solve)
    session.commit()


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
