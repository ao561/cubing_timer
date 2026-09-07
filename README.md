# Cubing Timer

A minimal speedsolving timer: FastAPI + SQLite backend, vanilla JS frontend,
light and dark themes, ten WCA events with a real 3D scramble preview.
WCA-compliant scrambles are generated **client-side** with
[cubing.js](https://js.cubing.net/cubing/) loaded from a CDN, so the server
only stores solves and computes averages.

## Requirements

- Python 3.10+
- An internet connection on first page load (for the cubing.js CDN modules).
  If the scramble module is unreachable, the frontend falls back to a simple
  random scramble; if the 3D-rendering module is unreachable, the preview
  panel shows a text notice instead (the timer itself keeps working either
  way).

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

### Events

The dropdown in the top bar picks the WCA event: 2x2x2 through 7x7x7,
3x3x3 One-Handed, 3x3x3 Blindfolded, Pyraminx, and Skewb. Switching events
fetches a scramble for that event and swaps the history/stats sidebar to that
event's own solves — under the hood, a solve's `session_id` doubles as its
event id, so this reuses the existing per-session filtering with no schema
changes. Your last-picked event is remembered in `localStorage`.

### Scramble preview

The panel in the bottom-right corner is a real 3D, WebGL rendering of the
scrambled puzzle — drag it to orbit. It's rendered by cubing.js's own
[`<twisty-player>`](https://js.cubing.net/cubing/twisty/) component rather
than a hand-rolled renderer, so every event gets the exact geometry WCA
competitions use (cube, tetrahedron, or corner-turning cube) with no
per-puzzle code of our own. The button in its caption switches to a flat 2D
net showing every face at once, which some solvers find easier to read a
scramble from.

### Theme

The sun/moon button in the top bar switches between light and dark. With no
choice stored the page follows your OS `prefers-color-scheme`; once you pick one
it is remembered in `localStorage` and overrides the system in both directions.

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/solves` | Save a solve. Body: `{time_ms, scramble, penalty, session_id}` |
| `GET` | `/api/solves` | History (newest first) plus stats. Query: `session_id`, `limit` — the frontend passes the current event id as `session_id` |
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
│   ├── app.js        # timer state machine, events, cubing.js scrambles, theme, API calls
│   └── style.css     # <twisty-player> is cubing.js's own custom element
├── requirements.txt
└── README.md
```
