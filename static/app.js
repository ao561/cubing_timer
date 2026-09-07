// Cubing Timer — scrambles are generated client-side with cubing.js; the
// backend only stores results and computes averages.
//
// The scramble preview is rendered by cubing.js's own <twisty-player>
// (WebGL, real 3D, drag-to-orbit built in) rather than a hand-rolled
// renderer — it already knows the exact geometry for every WCA puzzle, so
// reusing it is both less code and more accurate than reimplementing each
// puzzle's turning logic from scratch.
import { randomScrambleForEvent } from "https://cdn.cubing.net/v0/js/cubing/scramble";
import "https://cdn.cubing.net/v0/js/cubing/twisty";

const API = "/api/solves";
const HOLD_MS = 350; // how long Space must be held before the timer arms

// WCA event id -> { label, puzzle for <twisty-player>, fallback scrambler }.
// `session_id` on a solve doubles as its event id, so history/stats already
// come back scoped per event with no backend changes.
const EVENTS = {
  "222": { label: "2x2x2", puzzle: "2x2x2", fallback: () => fallbackCubeScramble(2, 9) },
  "333": { label: "3x3x3", puzzle: "3x3x3", fallback: () => fallbackCubeScramble(3, 20) },
  "333oh": { label: "3x3x3 One-Handed", puzzle: "3x3x3", fallback: () => fallbackCubeScramble(3, 20) },
  "333bf": { label: "3x3x3 Blindfolded", puzzle: "3x3x3", fallback: () => fallbackCubeScramble(3, 20) },
  "444": { label: "4x4x4", puzzle: "4x4x4", fallback: () => fallbackCubeScramble(4, 40) },
  "555": { label: "5x5x5", puzzle: "5x5x5", fallback: () => fallbackCubeScramble(5, 60) },
  "666": { label: "6x6x6", puzzle: "6x6x6", fallback: () => fallbackCubeScramble(6, 80) },
  "777": { label: "7x7x7", puzzle: "7x7x7", fallback: () => fallbackCubeScramble(7, 100) },
  pyram: { label: "Pyraminx", puzzle: "pyraminx", fallback: fallbackPyraminxScramble },
  skewb: { label: "Skewb", puzzle: "skewb", fallback: fallbackSkewbScramble },
};

let currentEvent = "333";

const el = {
  eventSelect: document.getElementById("event-select"),
  scramble: document.getElementById("scramble"),
  newScramble: document.getElementById("new-scramble"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon"),
  cubePanel: document.getElementById("cube-panel"),
  cubePlayer: document.getElementById("cube-player"),
  cubeFallback: document.getElementById("cube-fallback"),
  cubeView: document.getElementById("cube-view"),
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
//
// Last-resort scramblers, used only if the cubing.js CDN module is
// unreachable. They don't reproduce WCA's exact random-state algorithms, but
// they're enough to keep practising on while offline.

const CUBE_FACES = ["U", "D", "L", "R", "F", "B"];
const SUFFIXES = ["", "'", "2"];

/** Random face turns for an NxN cube, using wide moves once N is big enough. */
function fallbackCubeScramble(n, length) {
  const moves = [];
  let last = "";
  while (moves.length < length) {
    const face = CUBE_FACES[Math.floor(Math.random() * CUBE_FACES.length)];
    if (face === last) continue;
    last = face;
    const suffix = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
    if (n >= 4 && Math.random() < 0.4) {
      const depth = 2 + Math.floor(Math.random() * (n - 3)); // 2..n-2
      moves.push(`${depth > 2 ? depth : ""}${face}w${suffix}`);
    } else {
      moves.push(face + suffix);
    }
  }
  return moves.join(" ");
}

function fallbackPyraminxScramble(length = 11) {
  const faces = ["U", "L", "R", "B"];
  const tips = ["u", "l", "r", "b"];
  const moves = [];
  let last = "";
  while (moves.length < length) {
    const face = faces[Math.floor(Math.random() * faces.length)];
    if (face === last) continue;
    last = face;
    moves.push(face + (Math.random() < 0.5 ? "" : "'"));
  }
  for (const tip of tips) {
    if (Math.random() < 0.5) moves.push(tip + (Math.random() < 0.5 ? "" : "'"));
  }
  return moves.join(" ");
}

function fallbackSkewbScramble(length = 11) {
  const faces = ["U", "L", "R", "B"];
  const moves = [];
  let last = "";
  while (moves.length < length) {
    const face = faces[Math.floor(Math.random() * faces.length)];
    if (face === last) continue;
    last = face;
    moves.push(face + (Math.random() < 0.5 ? "" : "'"));
  }
  return moves.join(" ");
}

let currentScramble = "";
let pendingScramble = null;

async function generateScramble() {
  try {
    const alg = await randomScrambleForEvent(currentEvent);
    return alg.toString();
  } catch (err) {
    console.warn("cubing.js scramble failed, using fallback", err);
    return EVENTS[currentEvent].fallback();
  }
}

/** Show a fresh scramble, reusing the one pre-generated during the last solve. */
async function nextScramble() {
  el.scramble.textContent = "Scrambling…";
  const scramble = await (pendingScramble ?? generateScramble());
  pendingScramble = null;
  currentScramble = scramble;
  el.scramble.textContent = scramble;
  drawCube();
}

// ------------------------------------------------------------------ theme

// localStorage is unavailable in some privacy modes; preferences are a nicety,
// so fall back silently rather than breaking the timer.
function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) { /* ignore */ }
}

const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)");

/** The theme actually on screen, whether it came from the OS or the toggle. */
function activeTheme() {
  return document.documentElement.dataset.theme
    || (systemPrefersDark.matches ? "dark" : "light");
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  writePref("theme", theme);
  syncThemeButton();
}

function syncThemeButton() {
  const dark = activeTheme() === "dark";
  el.themeIcon.textContent = dark ? "☀" : "☾";
  el.themeToggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
}

el.themeToggle.addEventListener("click", () => {
  applyTheme(activeTheme() === "dark" ? "light" : "dark");
  el.themeToggle.blur(); // so Space primes the timer instead of re-clicking
});

// Follow the OS while the user has not made an explicit choice.
systemPrefersDark.addEventListener("change", () => {
  if (!document.documentElement.dataset.theme) syncThemeButton();
});

// ----------------------------------------------------------- cube preview

let visualization = readPref("cubeVisualization") === "2D" ? "2D" : "PG3D";

// If the twisty module itself never finishes loading (offline on first
// visit), the custom element stays an inert, empty tag forever — fall back
// to a text notice instead of a blank corner.
customElements.whenDefined("twisty-player").then(
  () => { el.cubeFallback.hidden = true; },
);
setTimeout(() => {
  if (!customElements.get("twisty-player")) {
    el.cubePlayer.hidden = true;
    el.cubeFallback.hidden = false;
  }
}, 6000);

// TwistyPlayer's `.puzzle` is write-only (reading it throws), so track what
// we last set ourselves instead of asking the element.
let lastPuzzle = null;

/** Push the current event + scramble into the <twisty-player>. */
function drawCube() {
  const player = el.cubePlayer;
  player.visualization = visualization;
  const puzzle = EVENTS[currentEvent].puzzle;
  if (puzzle !== lastPuzzle) {
    player.puzzle = puzzle;
    lastPuzzle = puzzle;
  }
  player.alg = "";
  player.experimentalSetupAlg = currentScramble;
}

el.cubeView.addEventListener("click", () => {
  visualization = visualization === "2D" ? "PG3D" : "2D";
  writePref("cubeVisualization", visualization);
  el.cubeView.textContent = visualization === "2D" ? "3D" : "2D";
  drawCube();
  el.cubeView.blur();
});
el.cubeView.textContent = visualization === "2D" ? "3D" : "2D";

// ----------------------------------------------------------------- events

const savedEvent = readPref("event");
if (savedEvent && EVENTS[savedEvent]) currentEvent = savedEvent;
el.eventSelect.value = currentEvent;

el.eventSelect.addEventListener("change", () => {
  currentEvent = el.eventSelect.value;
  writePref("event", currentEvent);
  pendingScramble = null;
  nextScramble();
  refresh();
  el.eventSelect.blur(); // so Space primes the timer instead of reopening the list
});

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
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

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
        session_id: currentEvent,
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
    render(await request(`${API}?session_id=${encodeURIComponent(currentEvent)}`));
  } catch (err) {
    console.error(err);
    toast("Could not load solve history.");
  }
}

// ------------------------------------------------------------------- start

el.newScramble.addEventListener("click", () => {
  pendingScramble = null;
  nextScramble();
  el.newScramble.blur();
});

syncThemeButton();
setState(State.IDLE);
nextScramble();
refresh();
