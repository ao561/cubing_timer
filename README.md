# Cubing Timer

A minimal speedsolving timer: FastAPI + SQLite backend, vanilla JS frontend.
WCA-compliant 3x3 scrambles are generated **client-side** with
[cubing.js](https://js.cubing.net/cubing/) loaded from a CDN, so the server only
stores solves and computes averages.

## Requirements

- Python 3.10+
- An internet connection on first page load (for the cubing.js CDN module). If
  the CDN is unreachable the frontend falls back to a simple random scramble.

## Install

```bash
cd cubing_timer
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --reload
```

Then open <http://127.0.0.1:8000>. Interactive API docs live at
<http://127.0.0.1:8000/docs>.

The SQLite database is created automatically at `cubing_timer/solves.db` on
first start.

## Using the timer

| Action | Keyboard | Touch |
| --- | --- | --- |
| Prime the timer | hold `Space` (red → green after 350 ms) | press and hold the timer area |
| Start | release `Space` while green | lift your finger while green |
| Stop | press any key | tap the timer area |

Stopping the timer automatically POSTs the solve and pulls a fresh scramble.
Hover a solve in the sidebar to mark it `OK` / `+2` / `DNF` or delete it.

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/solves` | Save a solve. Body: `{time_ms, scramble, penalty, session_id}` |
| `GET` | `/api/solves` | History (newest first) plus stats. Query: `session_id`, `limit` |
| `PATCH` | `/api/solves/{id}` | Set penalty. Body: `{"penalty": "none" \| "+2" \| "DNF"}` |
| `DELETE` | `/api/solves/{id}` | Delete a solve |

`GET /api/solves` returns:

```json
{
  "solves": [
    {
      "id": 1,
      "time_ms": 12345,
      "scramble": "R U R' U' ...",
      "penalty": "none",
      "created_at": "2026-09-07T12:00:00Z",
      "session_id": "default",
      "effective_ms": 12345
    }
  ],
  "stats": {
    "count": 1,
    "best": 12345,
    "worst": 12345,
    "mean": 12345.0,
    "current_ao5": null,
    "best_ao5": null,
    "current_ao12": null,
    "best_ao12": null
  }
}
```

`effective_ms` is the time after penalties (`+2` adds 2000 ms, `DNF` is `null`).
Stats are computed over the whole session history, not just the returned page.

### Average rules

Averages follow WCA convention: drop the best and worst attempt, take the mean
of the rest. A DNF counts as the worst attempt; two or more DNFs in a window
make that average a DNF (`null`).

## Layout

```
cubing_timer/
├── app/
│   ├── main.py       # FastAPI app, routes, CORS, static mount
│   ├── models.py     # Solve table + request/response schemas
│   ├── database.py   # SQLite engine and session dependency
│   └── stats.py      # Ao5 / Ao12 calculations
├── static/
│   ├── index.html
│   ├── app.js        # timer state machine, cubing.js scrambles, API calls
│   └── style.css
├── requirements.txt
└── README.md
```
