// Cubing Timer — scrambles are generated client-side with cubing.js; the
// backend only stores results and computes averages.

import { randomScrambleForEvent } from "https://cdn.cubing.net/v0/js/cubing/scramble";

const API = "/api/solves";
const SESSION_ID = "default";
const HOLD_MS = 350; // how long Space must be held before the timer arms
const EVENT = "333";

const el = {
  scramble: document.getElementById("scramble"),
  newScramble: document.getElementById("new-scramble"),
  zone: document.getElementById("timer-zone"),
  time: document.getElementById("time"),
  list: document.getElementById("solve-list"),
  empty: document.getElementById("empty-state"),
  toast: document.getElementById("toast"),
  best: document.getElementById("stat-best"),
  ao5: document.getElementById("stat-ao5"),
  ao5Best: document.getElementById("stat-ao5-best"),
  ao12: document.getElementById("stat-ao12"),
  ao12Best: document.getElementById("stat-ao12-best"),
  count: document.getElementById("stat-count"),
  mean: document.getElementById("stat-mean"),
};

// ---------------------------------------------------------------- formatting

function formatMs(ms) {
  if (ms === null || ms === undefined) return "DNF";
  const total = Math.floor(ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  const tail = `${seconds}.${String(millis).padStart(3, "0")}`;
  return minutes > 0 ? `${minutes}:${tail.padStart(6, "0")}` : tail;
}

const formatStat = (ms) => (ms === null || ms === undefined ? "—" : formatMs(ms));

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toast.handle);
  toast.handle = setTimeout(() => (el.toast.hidden = true), 2600);
}

// ---------------------------------------------------------------- scrambling

const MOVES = ["U", "D", "L", "R", "F", "B"];
const SUFFIXES = ["", "'", "2"];

/** Last-resort scramble if the cubing.js CDN module is unreachable. */
function fallbackScramble(length = 20) {
  const moves = [];
  let last = "";
  while (moves.length < length) {
    const face = MOVES[Math.floor(Math.random() * MOVES.length)];
    if (face === last) continue;
    last = face;
    moves.push(face + SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)]);
  }
  return moves.join(" ");
}

let currentScramble = "";
let pendingScramble = null;

async function generateScramble() {
  try {
    const alg = await randomScrambleForEvent(EVENT);
    return alg.toString();
  } catch (err) {
    console.warn("cubing.js scramble failed, using fallback", err);
    return fallbackScramble();
  }
}

/** Show a fresh scramble, reusing the one pre-generated during the last solve. */
async function nextScramble() {
  el.scramble.textContent = "Scrambling…";
  const scramble = await (pendingScramble ?? generateScramble());
  pendingScramble = null;
  currentScramble = scramble;
  el.scramble.textContent = scramble;
}

// -------------------------------------------------------------------- timer

const State = {
  IDLE: "idle",
  HOLDING: "holding",
  READY: "ready",
  RUNNING: "running",
};

let state = State.IDLE;
let startedAt = 0;
let holdTimer = null;
let rafId = null;
let ignoreUntilRelease = false;

function setState(next) {
  state = next;
  el.zone.dataset.state = next;
}

function tick() {
  el.time.textContent = formatMs(performance.now() - startedAt);
  rafId = requestAnimationFrame(tick);
}

function prime() {
  if (state !== State.IDLE) return;
  setState(State.HOLDING);
  el.time.textContent = "0.000";
  holdTimer = setTimeout(() => setState(State.READY), HOLD_MS);
}

function cancelPrime() {
  clearTimeout(holdTimer);
  setState(State.IDLE);
}

function start() {
  clearTimeout(holdTimer);
  setState(State.RUNNING);
  startedAt = performance.now();
  // Pre-generate the next scramble while the solve is in progress so it is
  // ready the instant the timer stops.
  pendingScramble = generateScramble();
  rafId = requestAnimationFrame(tick);
}

function stop() {
  cancelAnimationFrame(rafId);
  setState(State.IDLE);
  const elapsed = Math.round(performance.now() - startedAt);
  el.time.textContent = formatMs(elapsed);
  saveSolve(elapsed, currentScramble);
  nextScramble();
}

/** Release the pointer/key that stopped the timer before allowing a re-prime. */
function releaseLock() {
  ignoreUntilRelease = false;
}

// Keyboard
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;

  if (state === State.RUNNING) {
    event.preventDefault();
    ignoreUntilRelease = true;
    stop();
    return;
  }

  if (event.code !== "Space" || event.repeat || ignoreUntilRelease) return;
  event.preventDefault();
  prime();
});

document.addEventListener("keyup", (event) => {
  if (ignoreUntilRelease) {
    releaseLock();
    return;
  }
  if (event.code !== "Space") return;
  event.preventDefault();

  if (state === State.READY) start();
  else if (state === State.HOLDING) cancelPrime();
});

// Touch
el.zone.addEventListener("touchstart", (event) => {
  event.preventDefault();
  if (state === State.RUNNING) {
    ignoreUntilRelease = true;
    stop();
    return;
  }
  if (!ignoreUntilRelease) prime();
}, { passive: false });

el.zone.addEventListener("touchend", (event) => {
  event.preventDefault();
  if (ignoreUntilRelease) {
    releaseLock();
    return;
  }
  if (state === State.READY) start();
  else if (state === State.HOLDING) cancelPrime();
}, { passive: false });

// --------------------------------------------------------------------- API

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.status === 204 ? null : response.json();
}

async function saveSolve(timeMs, scramble) {
  try {
    await request(API, {
      method: "POST",
      body: JSON.stringify({
        time_ms: timeMs,
        scramble,
        penalty: "none",
        session_id: SESSION_ID,
      }),
    });
    await refresh();
  } catch (err) {
    console.error(err);
    toast("Could not save that solve — is the server running?");
  }
}

async function setPenalty(id, penalty) {
  try {
    await request(`${API}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ penalty }),
    });
    await refresh();
  } catch (err) {
    console.error(err);
    toast("Could not update the penalty.");
  }
}

async function deleteSolve(id) {
  try {
    await request(`${API}/${id}`, { method: "DELETE" });
    await refresh();
  } catch (err) {
    console.error(err);
    toast("Could not delete that solve.");
  }
}

// --------------------------------------------------------------- rendering

function solveLabel(solve) {
  if (solve.penalty === "DNF") return "DNF";
  const time = formatMs(solve.effective_ms);
  return solve.penalty === "+2" ? `${time}+` : time;
}

function renderSolve(solve, number) {
  const li = document.createElement("li");
  li.className = "solve";
  li.title = solve.scramble;

  const index = document.createElement("span");
  index.className = "solve-index";
  index.textContent = number;

  const time = document.createElement("span");
  time.className = "solve-time";
  if (solve.penalty === "DNF") time.classList.add("dnf");
  if (solve.penalty === "+2") time.classList.add("plus2");
  time.textContent = solveLabel(solve);

  const actions = document.createElement("div");
  actions.className = "solve-actions";

  for (const [label, penalty] of [["OK", "none"], ["+2", "+2"], ["DNF", "DNF"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(solve.penalty === penalty));
    button.addEventListener("click", () => setPenalty(solve.id, penalty));
    actions.append(button);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "chip delete";
  remove.textContent = "✕";
  remove.title = "Delete solve";
  remove.addEventListener("click", () => deleteSolve(solve.id));
  actions.append(remove);

  li.append(index, time, actions);
  return li;
}

function render({ solves, stats }) {
  el.list.replaceChildren(
    ...solves.map((solve, i) => renderSolve(solve, solves.length - i)),
  );
  el.empty.hidden = solves.length > 0;

  el.best.textContent = formatStat(stats.best);
  el.ao5.textContent = formatStat(stats.current_ao5);
  el.ao5Best.textContent = formatStat(stats.best_ao5);
  el.ao12.textContent = formatStat(stats.current_ao12);
  el.ao12Best.textContent = formatStat(stats.best_ao12);
  el.count.textContent = stats.count;
  el.mean.textContent = formatStat(stats.mean);
}

async function refresh() {
  try {
    render(await request(`${API}?session_id=${encodeURIComponent(SESSION_ID)}`));
  } catch (err) {
    console.error(err);
    toast("Could not load solve history.");
  }
}

// ------------------------------------------------------------------- start

el.newScramble.addEventListener("click", () => {
  pendingScramble = null;
  nextScramble();
});

setState(State.IDLE);
nextScramble();
refresh();
