"use strict";

/* ================= Constants ================= */

// Court coordinate system = SVG viewBox units (feet).
const VB = { minX: -3.5, minY: -6, w: 57, h: 62 };
const CLAMP = { minX: -3, maxX: 53, minY: -5.5, maxY: 55 };
// Each sequential action (screen wave, pass, cut wave) gets this long, so a
// busy step lasts proportionally longer than a simple one.
const SECONDS_PER_PHASE = 1.8;
const STORAGE_KEY = "playbook-plays-v1";
const SVG_NS = "http://www.w3.org/2000/svg";

const TOKEN_DEFS = [
  { id: "P1", label: "1", type: "offense" },
  { id: "P2", label: "2", type: "offense" },
  { id: "P3", label: "3", type: "offense" },
  { id: "P4", label: "4", type: "offense" },
  { id: "P5", label: "5", type: "offense" },
  { id: "BALL", label: "", type: "ball" },
];
const PLAYER_IDS = ["P1", "P2", "P3", "P4", "P5"];
// The ball renders slightly beside its owner so it doesn't cover the number.
const BALL_OFFSET = { x: 1.5, y: -1.2 };

/* ================= State =================

A play is a list of steps. Each step holds:
  pos:   {playerId: {x, y}}                      — where the five players stand
  moves: {playerId: {to, via, type}}             — drawn arrows to the NEXT step
         to   = destination point
         via  = quadratic bezier control point, or null for a straight arrow
         type = "move" | "screen"
  ball:  playerId                                — who holds the ball this step
  pass:  {to: playerId, via} | null              — pass thrown during this step
Invariants: if steps[i].moves[p] exists and steps[i+1] exists,
steps[i+1].pos[p] equals moves[p].to; and steps[i+1].ball follows
steps[i].pass?.to ?? steps[i].ball. The ball has no stored position —
it is always derived from its owner (or the pass in flight).
*/

let plays = [];
let currentPlayId = null;
let currentStep = 0;   // integer step being edited
let playhead = 0;      // float position on the timeline (in segments)
let playing = false;
let lastFrameTime = null;
let tool = "select";   // select | arrow | screen | eraser

/* ================= i18n ================= */

const I18N = {
  en: {
    appTitle: "Cejudo's Playbook",
    createNew: "＋ CREATE NEW",
    stepSingular: "step", stepPlural: "steps",
    back: "← Plays", rename: "✎ Rename", deletePlay: "Delete",
    nextStep: "Next step ＋", deleteStep: "Delete step", resetAll: "Reset all",
    step: "Step", stepLower: "step",
    cancel: "Cancel", create: "Create", renameConfirm: "Rename",
    deleteConfirm: "Delete", resetConfirm: "Reset",
    newPlayTitle: "New play", renameTitle: "Rename play",
    deleteTitle: "Delete play?",
    deleteMsg: (n) => `"${n}" will be deleted permanently.`,
    resetTitle: "Reset play?",
    resetMsg: "All steps and arrows will be removed. The starting positions of step 1 are kept.",
    untitled: "Untitled play", playDefault: "Play",
    exportTitle: "Export play", formatLabel: "Format",
    fmtGif: "GIF animation", fmtVideo: "Video (MP4 / WebM)", fmtPdf: "PDF — all steps",
    moveDur: "Movement duration (seconds)", pauseDur: "Pause between steps (seconds)",
    exportGo: "Export",
    renderingFrames: (a, b) => `Rendering frames… ${a}/${b}`,
    encodingGif: (p) => `Encoding GIF… ${p}%`,
    recording: (a, b) => `Recording… ${a}s / ${b}s (real time)`,
    renderingPage: (a, b) => `Rendering page ${a}/${b}…`,
    exportDone: "Done — file downloaded.",
    exportFailed: "Export failed: ",
    noVideo: "This browser does not support video recording.",
    noVideoFormat: "No supported video format found.",
    pdfStepLabel: (i, n) => `Step ${i} of ${n}`,
    handleEnd: "Drag to change the destination",
    handleMid: "Drag to curve the arrow",
    handleRot: "Drag to rotate the screen",
    ttSelect: "Select / move players (1) — only on step 1",
    ttArrow: "Movement arrow — drag from a player to where they cut (2)",
    ttScreen: "Screen / block — drag from the screener to where they set it (3)",
    ttEraser: "Eraser — click an arrow or a player to remove its arrow (4)",
    ttBack: "Back to all plays", ttRename: "Rename current play",
    ttExport: "Export as GIF, video or PDF", ttDelete: "Delete current play",
    ttDeleteStep: "Delete current step", ttResetAll: "Clear all steps",
    ttPrev: "Previous step", ttNext: "Next step", ttPlay: "Play / Pause",
    ttSpeed: "Playback speed",
    ttUndo: "Undo (Ctrl+Z)", ttRedo: "Redo (Ctrl+Y / Ctrl+Shift+Z)",
    ttGrip: "Drag to move the toolbar (double-click to reset)",
    ttZoomIn: "Zoom in", ttZoomOut: "Zoom out",
    ttZoomReset: "Reset zoom (or double-click the court)",
    ttReorder: "Drag to reorder",
    ttShare: "Share play as a link",
    shareCopiedTitle: "Link copied",
    shareCopiedMsg: "The share link is in your clipboard — send it to anyone.",
    shareLinkTitle: "Share link",
    sharedTitle: "Shared play",
    sharedMsg: (n) => `Add "${n}" to your plays?`,
    sharedAdd: "Add",
    sharedErrMsg: "This share link is not valid.",
    renamedToast: (n) => `That name was already in use — this play is now called "${n}".`,
    sharedAddedToast: (n) => `Shared play "${n}" added to your plays.`,
    exportAll: "⤓ Export all (.zip)", importAll: "⤒ Import (.zip)",
    ttExportAll: "Download every play as a .zip backup",
    ttImportAll: "Import plays from a .zip backup",
    importDoneTitle: "Import complete",
    importDoneMsg: (a, u) => `${a} new plays imported, ${u} updated.`,
    importErrTitle: "Import failed",
    importErrMsg: "That file doesn't look like a Playbook backup (.zip).",
  },
  es: {
    appTitle: "Cejudo's Playbook",
    createNew: "＋ CREAR NUEVA",
    stepSingular: "paso", stepPlural: "pasos",
    back: "← Jugadas", rename: "✎ Renombrar", deletePlay: "Eliminar",
    nextStep: "Siguiente paso ＋", deleteStep: "Eliminar paso", resetAll: "Reiniciar todo",
    step: "Paso", stepLower: "paso",
    cancel: "Cancelar", create: "Crear", renameConfirm: "Renombrar",
    deleteConfirm: "Eliminar", resetConfirm: "Reiniciar",
    newPlayTitle: "Nueva jugada", renameTitle: "Renombrar jugada",
    deleteTitle: "¿Eliminar jugada?",
    deleteMsg: (n) => `"${n}" se eliminará permanentemente.`,
    resetTitle: "¿Reiniciar jugada?",
    resetMsg: "Se eliminarán todos los pasos y flechas. Se mantendrán las posiciones iniciales del paso 1.",
    untitled: "Jugada sin nombre", playDefault: "Jugada",
    exportTitle: "Exportar jugada", formatLabel: "Formato",
    fmtGif: "Animación GIF", fmtVideo: "Vídeo (MP4 / WebM)", fmtPdf: "PDF — todos los pasos",
    moveDur: "Duración del movimiento (segundos)", pauseDur: "Pausa entre pasos (segundos)",
    exportGo: "Exportar",
    renderingFrames: (a, b) => `Generando fotogramas… ${a}/${b}`,
    encodingGif: (p) => `Codificando GIF… ${p}%`,
    recording: (a, b) => `Grabando… ${a}s / ${b}s (tiempo real)`,
    renderingPage: (a, b) => `Generando página ${a}/${b}…`,
    exportDone: "Listo — archivo descargado.",
    exportFailed: "Error al exportar: ",
    noVideo: "Este navegador no admite grabación de vídeo.",
    noVideoFormat: "No se encontró un formato de vídeo compatible.",
    pdfStepLabel: (i, n) => `Paso ${i} de ${n}`,
    handleEnd: "Arrastra para cambiar el destino",
    handleMid: "Arrastra para curvar la flecha",
    handleRot: "Arrastra para girar el bloqueo",
    ttSelect: "Seleccionar / mover jugadores (1) — solo en el paso 1",
    ttArrow: "Flecha de movimiento — arrastra desde un jugador hasta donde corta (2)",
    ttScreen: "Bloqueo — arrastra desde el bloqueador hasta donde lo pone (3)",
    ttEraser: "Borrador — pulsa una flecha o un jugador para quitar su flecha (4)",
    ttBack: "Volver a todas las jugadas", ttRename: "Renombrar la jugada",
    ttExport: "Exportar como GIF, vídeo o PDF", ttDelete: "Eliminar la jugada",
    ttDeleteStep: "Eliminar el paso actual", ttResetAll: "Borrar todos los pasos",
    ttPrev: "Paso anterior", ttNext: "Paso siguiente", ttPlay: "Reproducir / Pausa",
    ttSpeed: "Velocidad de reproducción",
    ttUndo: "Deshacer (Ctrl+Z)", ttRedo: "Rehacer (Ctrl+Y / Ctrl+Mayús+Z)",
    ttGrip: "Arrastra para mover la barra (doble clic para restablecer)",
    ttZoomIn: "Acercar", ttZoomOut: "Alejar",
    ttZoomReset: "Restablecer zoom (o doble clic en la pista)",
    ttReorder: "Arrastra para reordenar",
    ttShare: "Compartir la jugada con un enlace",
    shareCopiedTitle: "Enlace copiado",
    shareCopiedMsg: "El enlace está en tu portapapeles — envíaselo a quien quieras.",
    shareLinkTitle: "Enlace para compartir",
    sharedTitle: "Jugada compartida",
    sharedMsg: (n) => `¿Añadir "${n}" a tus jugadas?`,
    sharedAdd: "Añadir",
    sharedErrMsg: "El enlace no es válido.",
    renamedToast: (n) => `Ese nombre ya existía — la jugada ahora se llama "${n}".`,
    sharedAddedToast: (n) => `Jugada compartida "${n}" añadida a tus jugadas.`,
    exportAll: "⤓ Exportar todo (.zip)", importAll: "⤒ Importar (.zip)",
    ttExportAll: "Descargar todas las jugadas como copia de seguridad .zip",
    ttImportAll: "Importar jugadas desde una copia de seguridad .zip",
    importDoneTitle: "Importación completada",
    importDoneMsg: (a, u) => `${a} jugadas nuevas importadas, ${u} actualizadas.`,
    importErrTitle: "Error al importar",
    importErrMsg: "El archivo no parece una copia de seguridad de Playbook (.zip).",
  },
};

let lang = localStorage.getItem("playbook-lang") ||
  ((navigator.language || "en").startsWith("es") ? "es" : "en");

function t(key, ...args) {
  const v = (I18N[lang] && I18N[lang][key]) ?? I18N.en[key];
  return typeof v === "function" ? v(...args) : v;
}

/* ================= DOM ================= */

const $ = (id) => document.getElementById(id);
const homeEl = $("home");
const editorEl = $("editor");
const stageWrapEl = document.querySelector(".stage-wrap");
const playListEl = $("playList");
const stageEl = $("stage");
const tokensEl = $("tokens");
const handlesEl = $("handles");
const arrowsGroup = $("arrowsGroup");
const previewGroup = $("previewGroup");
const playNameEl = $("playName");
const stepChipsEl = $("stepChips");
const scrubber = $("scrubber");
const playBtn = $("playBtn");
const stepIndicator = $("stepIndicator");
const timelineTicks = $("timelineTicks");
const speedSelect = $("speedSelect");
const toolbar = $("toolbar");
const modalEl = $("modal");

/* ================= Language ================= */

function applyLang() {
  localStorage.setItem("playbook-lang", lang);
  $("langHome").value = lang;
  $("langEditor").value = lang;
  $("homeTitle").textContent = t("appTitle");
  document.title = t("appTitle");

  const texts = {
    createNewBtn: "createNew", backBtn: "back",
    deletePlayLabel: "deletePlay",
    modalCancel: "cancel", exportCancel: "cancel", exportGo: "exportGo",
    exportTitle: "exportTitle", exportFormatLabel: "formatLabel",
    exportMoveLabel: "moveDur", exportPauseLabel: "pauseDur",
    exportAllBtn: "exportAll", importAllBtn: "importAll",
  };
  for (const [id, key] of Object.entries(texts)) $(id).textContent = t(key);

  const titles = {
    backBtn: "ttBack", renamePencil: "ttRename", exportBtn: "ttExport",
    shareBtn: "ttShare",
    deletePlayBtn: "ttDelete",
    prevBtn: "ttPrev", nextBtn: "ttNext",
    playBtn: "ttPlay", speedSelect: "ttSpeed",
    undoBtn: "ttUndo", redoBtn: "ttRedo", toolGrip: "ttGrip",
    exportAllBtn: "ttExportAll", importAllBtn: "ttImportAll",
    addStepBtn: "nextStep", resetAllBtn: "ttResetAll",
    zoomIn: "ttZoomIn", zoomOut: "ttZoomOut", zoomLabel: "ttZoomReset",
  };
  for (const [id, key] of Object.entries(titles)) $(id).title = t(key);

  const toolTitles = { select: "ttSelect", arrow: "ttArrow", screen: "ttScreen", eraser: "ttEraser" };
  for (const [toolName, key] of Object.entries(toolTitles)) {
    toolbar.querySelector(`[data-tool="${toolName}"]`).title = t(key);
  }

  const fmtOpts = $("exportFormat").options;
  fmtOpts[0].text = t("fmtGif");
  fmtOpts[1].text = t("fmtVideo");
  fmtOpts[2].text = t("fmtPdf");

  if (!editorEl.hidden && currentPlay()) renderAll();
  else renderHome();
}

for (const id of ["langHome", "langEditor"]) {
  $(id).addEventListener("change", (e) => {
    lang = e.target.value;
    applyLang();
  });
}

/* ================= Toast ================= */

let toastTimer = null;

function showToast(msg) {
  const el = $("toast");
  $("toastMsg").textContent = msg;
  clearTimeout(toastTimer);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  const el = $("toast");
  el.classList.remove("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 300);
}

$("toastClose").addEventListener("click", hideToast);

/* ================= Modal ================= */

// openModal resolves with the input text (or true when there is no input),
// or null if cancelled.
function openModal({ title, message = "", input = false, value = "", confirmLabel = "OK", danger = false, noCancel = false }) {
  return new Promise((resolve) => {
    $("modalTitle").textContent = title;
    $("modalMsg").textContent = message;
    $("modalMsg").hidden = !message;
    $("modalCancel").hidden = noCancel;
    const inputEl = $("modalInput");
    inputEl.hidden = !input;
    inputEl.value = value;
    const okBtn = $("modalOk");
    okBtn.textContent = confirmLabel;
    okBtn.classList.toggle("btn-danger-solid", danger);
    okBtn.classList.toggle("btn-primary", !danger);
    modalEl.hidden = false;
    if (input) inputEl.focus(), inputEl.select();
    else okBtn.focus();

    const close = (result) => {
      modalEl.hidden = true;
      okBtn.removeEventListener("click", onOk);
      $("modalCancel").removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    };
    const onOk = () => close(input ? inputEl.value : true);
    const onCancel = () => close(null);
    const onKey = (e) => {
      if (e.code === "Escape") { e.stopPropagation(); onCancel(); }
      if (e.code === "Enter") { e.stopPropagation(); onOk(); }
    };
    okBtn.addEventListener("click", onOk);
    $("modalCancel").addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey, true);
  });
}

/* ================= Persistence ================= */

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ plays, currentPlayId }));
}

// Older saves stored steps as flat {tokenId: {x,y}, screens: [...]}.
function migratePlay(p) {
  if (!p.steps.length || p.steps[0].pos) return p;
  const steps = p.steps.map((s) => {
    const pos = {};
    for (const d of TOKEN_DEFS) pos[d.id] = s[d.id] ? { ...s[d.id] } : { x: -3, y: 8 };
    return { pos, moves: {} };
  });
  for (let i = 0; i < steps.length - 1; i++) {
    for (const d of TOKEN_DEFS) {
      const a = steps[i].pos[d.id];
      const b = steps[i + 1].pos[d.id];
      if (Math.hypot(b.x - a.x, b.y - a.y) > 0.01) {
        steps[i].moves[d.id] = { to: { ...b }, via: null, type: "move" };
      }
    }
  }
  return { id: p.id, name: p.name, steps };
}

function nearestPlayerIn(pos, p, excludeId) {
  let best = null, bd = Infinity;
  for (const id of PLAYER_IDS) {
    if (id === excludeId) continue;
    const d = Math.hypot(pos[id].x - p.x, pos[id].y - p.y);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

// The ball used to be a free token with its own pos/moves; now it is
// attached to a player and passes are explicit.
function migrateBall(p) {
  if (!p.steps.length || p.steps[0].ball) return p;
  p.steps.forEach((s, i) => {
    const bp = (s.pos && s.pos.BALL) || { x: 0, y: 0 };
    s.ball = nearestPlayerIn(s.pos, bp, null) || "P1";
    const bm = s.moves && s.moves.BALL;
    if (bm) {
      const ref = p.steps[i + 1] ? p.steps[i + 1].pos : s.pos;
      const to = nearestPlayerIn(ref, bm.to, null);
      s.pass = to && to !== s.ball ? { to, via: bm.via || null } : null;
    } else {
      s.pass = null;
    }
    delete s.pos.BALL;
    delete s.moves.BALL;
  });
  // re-chain ownership
  for (let i = 1; i < p.steps.length; i++) {
    p.steps[i].ball = p.steps[i - 1].pass ? p.steps[i - 1].pass.to : p.steps[i - 1].ball;
    if (p.steps[i].pass && p.steps[i].pass.to === p.steps[i].ball) p.steps[i].pass = null;
  }
  return p;
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.plays)) {
      plays = data.plays.map((p) => migrateBall(migratePlay(p)));
    }
  } catch (_) { plays = []; }
}

/* ================= Navigation ================= */

function showHome() {
  playing = false;
  document.body.classList.remove("playing");
  editorEl.hidden = true;
  homeEl.hidden = false;
  renderHome();
}

function openPlay(id) {
  currentPlayId = id;
  currentStep = 0;
  playhead = 0;
  playing = false;
  clearHistory();
  homeEl.hidden = true;
  editorEl.hidden = false;
  save();
  setTool("select");
  renderAll();
  applyToolbarPos();
  resetZoom();
}

let cardDragJustEnded = false;

function renderHome() {
  playListEl.innerHTML = "";
  for (const p of plays) {
    const card = document.createElement("div");
    card.className = "play-card";
    card.dataset.id = p.id;

    const grip = document.createElement("span");
    grip.className = "card-grip";
    grip.title = t("ttReorder");
    grip.innerHTML =
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">' +
      '<circle cx="9" cy="5" r="1.8"/><circle cx="15" cy="5" r="1.8"/>' +
      '<circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/>' +
      '<circle cx="9" cy="19" r="1.8"/><circle cx="15" cy="19" r="1.8"/></svg>';
    attachCardReorder(grip, card);

    const name = document.createElement("span");
    name.className = "card-name";
    name.textContent = p.name;

    const del = document.createElement("button");
    del.className = "card-del";
    del.title = t("ttDelete");
    del.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 7 H20 M10 4 H14 M6.5 7 L7.5 20 H16.5 L17.5 7 M10 11 V16 M14 11 V16"/></svg>';
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await openModal({
        title: t("deleteTitle"),
        message: t("deleteMsg", p.name),
        confirmLabel: t("deleteConfirm"),
        danger: true,
      });
      if (!ok) return;
      plays = plays.filter((x) => x.id !== p.id);
      save();
      renderHome();
    });

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = p.steps.length + " " + (p.steps.length === 1 ? t("stepSingular") : t("stepPlural"));

    card.append(grip, name, meta, del);
    card.addEventListener("click", () => {
      if (cardDragJustEnded) return;
      openPlay(p.id);
    });
    playListEl.appendChild(card);
  }
}

// Drag the grip to reorder plays in the list.
function attachCardReorder(grip, card) {
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { grip.setPointerCapture(e.pointerId); } catch (_) {}
    const startY = e.clientY;
    let moved = false;

    const move = (ev) => {
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) > 6) {
        moved = true;
        card.classList.add("dragging-card");
      }
      if (moved) card.style.transform = `translateY(${dy}px)`;
    };
    const up = (ev) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      card.classList.remove("dragging-card");
      card.style.transform = "";
      if (!moved) return;
      cardDragJustEnded = true;
      setTimeout(() => { cardDragJustEnded = false; }, 200);
      // new index = how many other cards' centres sit above the drop point
      const others = [...playListEl.querySelectorAll(".play-card")].filter((c) => c !== card);
      const newIdx = others.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.top + r.height / 2 < ev.clientY;
      }).length;
      const oldIdx = plays.findIndex((p) => p.id === card.dataset.id);
      if (oldIdx >= 0 && newIdx !== oldIdx) {
        const [p] = plays.splice(oldIdx, 1);
        plays.splice(newIdx, 0, p);
        save();
      }
      renderHome();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  });
}

/* ================= Play management ================= */

function defaultStep() {
  // Players lined up out of bounds above the baseline, ball with player 1.
  const pos = {};
  PLAYER_IDS.forEach((id, i) => {
    pos[id] = { x: 9 + i * 8, y: -3 };
  });
  return { pos, moves: {}, ball: "P1", pass: null };
}

function createPlay(name) {
  const play = {
    id: "play-" + Math.random().toString(36).slice(2, 10),
    name,
    steps: [defaultStep()],
  };
  plays.push(play);
  save();
  return play;
}

function currentPlay() {
  return plays.find((p) => p.id === currentPlayId);
}

// Play names are unique: collisions get a -N suffix (first free number).
function uniquePlayName(desired, excludeId) {
  const taken = (n) => plays.some((p) => p.id !== excludeId && p.name === n);
  if (!taken(desired)) return desired;
  let n = 1;
  while (taken(`${desired}-${n}`)) n++;
  return `${desired}-${n}`;
}

/* ================= Geometry ================= */

function clampPoint(p) {
  return {
    x: Math.min(Math.max(p.x, CLAMP.minX), CLAMP.maxX),
    y: Math.min(Math.max(p.y, CLAMP.minY), CLAMP.maxY),
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function bezierPoint(a, c, b, u) {
  const w = 1 - u;
  return {
    x: w * w * a.x + 2 * u * w * c.x + u * u * b.x,
    y: w * w * a.y + 2 * u * w * c.y + u * u * b.y,
  };
}

function pointerToCourt(ev) {
  const rect = stageEl.getBoundingClientRect();
  return clampPoint({
    x: VB.minX + ((ev.clientX - rect.left) / rect.width) * VB.w,
    y: VB.minY + ((ev.clientY - rect.top) / rect.height) * VB.h,
  });
}

function toPercent(pos) {
  return {
    left: ((pos.x - VB.minX) / VB.w) * 100,
    top: ((pos.y - VB.minY) / VB.h) * 100,
  };
}

/* ================= Timeline model ================= */

function ballPoint(p) {
  return { x: p.x + BALL_OFFSET.x, y: p.y + BALL_OFFSET.y };
}

function hasMoves(step) {
  return Object.keys(step.moves).length > 0 || !!step.pass;
}

// Positions after applying a step's drawn arrows.
function derivedNextPos(step) {
  const out = {};
  for (const id of PLAYER_IDS) {
    const m = step.moves[id];
    out[id] = m ? { ...m.to } : { ...step.pos[id] };
  }
  return out;
}

function pathNearPoint(a, via, b, p, thresh) {
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const q = via
      ? bezierPoint(a, via, b, u)
      : { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
    if (Math.hypot(q.x - p.x, q.y - p.y) < thresh) return true;
  }
  return false;
}

// Players whose cut uses a screen: their path passes near a screen spot.
function screenReceivers(step) {
  const out = new Set();
  const screenDests = Object.values(step.moves)
    .filter((m) => m.type === "screen")
    .map((m) => m.to);
  if (!screenDests.length) return out;
  for (const [id, m] of Object.entries(step.moves)) {
    if (m.type === "screen") continue;
    if (screenDests.some((sd) => pathNearPoint(step.pos[id], m.via, m.to, sd, 4))) {
      out.add(id);
    }
  }
  return out;
}

// A pass with timing "after" is thrown to where its receiver ENDS UP: the
// receiver's cut runs first, then the ball flies, then the passer may move.
function passIsDelayed(step) {
  return !!(step.pass && step.pass.timing === "after" && step.moves[step.pass.to]);
}

// Start/end points of the pass arrow (court coords, ball-offset applied).
function passEndpoints(step) {
  const a = ballPoint(step.pos[step.ball]);
  const delayed = passIsDelayed(step);
  const b = ballPoint(delayed ? step.moves[step.pass.to].to : step.pos[step.pass.to]);
  return { a, b, delayed };
}

// Order of events inside a step:
//   normal pass:  pass → screeners + other cuts → screen-using cuts
//   delayed pass: screeners + cuts (incl. receiver) → screen-using cuts →
//                 pass to the receiver's end position → the passer's own cut
function segmentPhases(step) {
  const receivers = screenReceivers(step);
  const delayed = passIsDelayed(step);
  const owner = step.ball;
  const moverIds = Object.keys(step.moves);
  const phases = [];
  if (step.pass && !delayed) phases.push("pass");
  if (moverIds.some((id) => !receivers.has(id) && !(delayed && id === owner))) phases.push("main");
  if (moverIds.some((id) => receivers.has(id) && !(delayed && id === owner))) phases.push("recv");
  if (step.pass && delayed) {
    phases.push("pass");
    if (step.moves[owner]) phases.push("ownermove");
  }
  return { phases, receivers, delayed, owner };
}

// Arrows on the last step play as a pending segment even before
// "Next step" commits them, so drawing is immediately watchable.
function segmentCount(play) {
  const n = play.steps.length;
  return n - 1 + (hasMoves(play.steps[n - 1]) ? 1 : 0);
}

// Playback duration of a segment at 1x: one slot per sequential phase.
function segmentDuration(play, i) {
  const step = play.steps[Math.min(i, play.steps.length - 1)];
  return Math.max(segmentPhases(step).phases.length, 1) * SECONDS_PER_PHASE;
}

// Where everyone ends up after the segment starting at stepIdx.
function segmentTargetPos(play, stepIdx) {
  if (stepIdx + 1 < play.steps.length) return play.steps[stepIdx + 1].pos;
  return derivedNextPos(play.steps[stepIdx]);
}

// Positions of every token at a (possibly fractional) playhead value.
function positionsAt(t) {
  const play = currentPlay();
  const segs = segmentCount(play);
  const out = {};
  if (segs === 0) {
    const step0 = play.steps[0];
    for (const id of PLAYER_IDS) out[id] = { ...step0.pos[id] };
    out.BALL = ballPoint(step0.pos[step0.ball]);
    return out;
  }
  t = Math.min(Math.max(t, 0), segs);
  const i = Math.min(Math.floor(t), segs - 1);
  const frac = Math.min(Math.max(t - i, 0), 1);
  const from = play.steps[Math.min(i, play.steps.length - 1)];
  const target = segmentTargetPos(play, i);
  const { phases, receivers, delayed, owner } = segmentPhases(from);
  const n = Math.max(phases.length, 1);
  const localU = (name) => {
    const k = phases.indexOf(name);
    if (k < 0) return 1;
    return Math.min(Math.max(frac * n - k, 0), 1);
  };

  for (const id of PLAYER_IDS) {
    const a = from.pos[id];
    const b = target[id];
    const m = from.moves[id];
    let u;
    if (m && delayed && id === owner) u = easeInOutCubic(localU("ownermove"));
    else if (m) u = easeInOutCubic(localU(receivers.has(id) ? "recv" : "main"));
    else u = easeInOutCubic(frac);
    out[id] = m && m.via
      ? bezierPoint(a, m.via, b, u)
      : { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
  }

  // Ball: attached to its owner unless a pass is in flight.
  if (!from.pass) {
    out.BALL = ballPoint(out[from.ball]);
  } else {
    const u = easeInOutCubic(localU("pass"));
    if (u <= 0) out.BALL = ballPoint(out[from.ball]);
    else if (u >= 1) out.BALL = ballPoint(out[from.pass.to]);
    else {
      const A = ballPoint(from.pos[from.ball]);
      const B = ballPoint(delayed ? target[from.pass.to] : from.pos[from.pass.to]);
      out.BALL = from.pass.via
        ? bezierPoint(A, from.pass.via, B, u)
        : { x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u) };
    }
  }
  return out;
}

/* ================= Undo / redo =================
Snapshot history of the open play (steps + name + cursor). Instant actions
call pushUndo() before mutating; drags use beginAction()/endAction() so a
drag that changes nothing leaves no history entry.
*/

const HISTORY_LIMIT = 100;
let undoStack = [];
let redoStack = [];
let pendingSnapshot = null;

function snapshotState() {
  const p = currentPlay();
  return JSON.stringify({ name: p.name, steps: p.steps, currentStep });
}

function pushUndo() {
  undoStack.push(snapshotState());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}

function beginAction() {
  pendingSnapshot = snapshotState();
}

function endAction() {
  if (pendingSnapshot !== null && pendingSnapshot !== snapshotState()) {
    undoStack.push(pendingSnapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }
  pendingSnapshot = null;
  updateUndoButtons();
}

function restoreState(json) {
  const snap = JSON.parse(json);
  const p = currentPlay();
  p.name = snap.name;
  p.steps = snap.steps;
  currentStep = Math.min(snap.currentStep, p.steps.length - 1);
  playhead = currentStep;
  save();
  renderAll();
}

function doUndo() {
  if (!undoStack.length) return;
  stopPlayback();
  redoStack.push(snapshotState());
  restoreState(undoStack.pop());
  updateUndoButtons();
}

function doRedo() {
  if (!redoStack.length) return;
  stopPlayback();
  undoStack.push(snapshotState());
  restoreState(redoStack.pop());
  updateUndoButtons();
}

function updateUndoButtons() {
  $("undoBtn").disabled = undoStack.length === 0;
  $("redoBtn").disabled = redoStack.length === 0;
}

function clearHistory() {
  undoStack = [];
  redoStack = [];
  pendingSnapshot = null;
  updateUndoButtons();
}

$("undoBtn").addEventListener("click", doUndo);
$("redoBtn").addEventListener("click", doRedo);

/* ================= Move editing (keeps invariant) ================= */

function setMove(tokenId, move) {
  const steps = currentPlay().steps;
  steps[currentStep].moves[tokenId] = move;
  if (currentStep + 1 < steps.length) {
    steps[currentStep + 1].pos[tokenId] = { ...move.to };
  }
}

function deleteMove(tokenId) {
  const steps = currentPlay().steps;
  if (!steps[currentStep].moves[tokenId]) return false;
  delete steps[currentStep].moves[tokenId];
  if (currentStep + 1 < steps.length) {
    steps[currentStep + 1].pos[tokenId] = { ...steps[currentStep].pos[tokenId] };
  }
  return true;
}

function moveToken(tokenId, p) {
  const steps = currentPlay().steps;
  steps[currentStep].pos[tokenId] = p;
  // An arrow arriving from the previous step must follow its target.
  if (currentStep > 0 && steps[currentStep - 1].moves[tokenId]) {
    steps[currentStep - 1].moves[tokenId].to = { ...p };
  }
}

// Nearest pass target for a point: a teammate where they stand now
// ("before"), or the end of a teammate's cut ("after" — cut first, then pass).
function nearestPassTarget(step, p) {
  let best = null, bd = Infinity;
  for (const id of PLAYER_IDS) {
    if (id === step.ball) continue;
    const d1 = Math.hypot(step.pos[id].x - p.x, step.pos[id].y - p.y);
    if (d1 < bd) { bd = d1; best = { to: id, timing: "before" }; }
    const m = step.moves[id];
    if (m) {
      const d2 = Math.hypot(m.to.x - p.x, m.to.y - p.y);
      if (d2 < bd) { bd = d2; best = { to: id, timing: "after" }; }
    }
  }
  return best;
}

// Ball ownership flows through the steps: each step starts with whoever
// ended the previous one with the ball. Passes to oneself are dropped.
function syncBallChain() {
  const steps = currentPlay().steps;
  for (let i = 0; i < steps.length; i++) {
    if (i > 0) steps[i].ball = steps[i - 1].pass ? steps[i - 1].pass.to : steps[i - 1].ball;
    if (steps[i].pass && steps[i].pass.to === steps[i].ball) steps[i].pass = null;
  }
}

/* ================= Rendering ================= */

function renderAll() {
  playNameEl.value = currentPlay().name;
  sizeNameInput();
  renderStepChips();
  buildTokens();
  renderPositions(positionsAt(playhead));
  renderArrows();
  renderHandles();
  renderScrubber();
  updateToolAvailability();
}

function renderStepChips() {
  const steps = currentPlay().steps;
  stepChipsEl.innerHTML = "";
  steps.forEach((_, i) => {
    const chip = document.createElement("div");
    chip.className = "step-chip" + (i === currentStep && !playing ? " active" : "");
    const word = document.createElement("span");
    word.className = "chip-word";
    word.textContent = t("step") + " ";
    const num = document.createElement("span");
    num.textContent = i + 1;
    chip.append(word, num);
    chip.addEventListener("click", () => {
      stopPlayback();
      currentStep = i;
      playhead = i;
      renderAll();
    });
    // Deletable: the last step, or any step with no drawn actions (an empty
    // step's positions equal the next step's, so removing it keeps every
    // surrounding arrow valid).
    const deletable = steps.length > 1 &&
      (i === steps.length - 1 || !hasMoves(steps[i]));
    if (deletable) {
      const del = document.createElement("span");
      del.className = "chip-del";
      del.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 7 H20 M10 4 H14 M6.5 7 L7.5 20 H16.5 L17.5 7 M10 11 V16 M14 11 V16"/></svg>';
      del.title = t("ttDeleteStep");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteStepAt(i);
      });
      chip.appendChild(del);
    }
    stepChipsEl.appendChild(chip);
  });

  updateAddStepState();

  // keep the active chip visible in the carousel
  const active = stepChipsEl.querySelector(".step-chip.active");
  if (active) {
    const margin = 24;
    if (active.offsetLeft < stepChipsEl.scrollLeft + margin) {
      stepChipsEl.scrollLeft = active.offsetLeft - margin;
    } else if (active.offsetLeft + active.offsetWidth > stepChipsEl.scrollLeft + stepChipsEl.clientWidth - margin) {
      stepChipsEl.scrollLeft = active.offsetLeft + active.offsetWidth - stepChipsEl.clientWidth + margin;
    }
  }
  updateChipsFade();
}

// left-edge fade: scrolled-away chips fade in from the left
function updateChipsFade() {
  stepChipsEl.classList.toggle("faded-left", stepChipsEl.scrollLeft > 2);
}

stepChipsEl.addEventListener("scroll", updateChipsFade);
$("addStepBtn").addEventListener("click", addStep);
$("resetAllBtn").addEventListener("click", resetAllPlay);

/* ---- step carousel: drag left/right to scroll ---- */

let suppressChipClick = false;

// No pointer capture here: capturing retargets the follow-up click to the
// container, which silently killed clicks on chips and their delete badges.
// Window-level listeners track the drag instead.
stepChipsEl.addEventListener("pointerdown", (e) => {
  const startX = e.clientX;
  const startScroll = stepChipsEl.scrollLeft;
  let moved = false;

  const move = (ev) => {
    const dx = ev.clientX - startX;
    if (!moved && Math.abs(dx) > 6) {
      moved = true;
      stepChipsEl.classList.add("dragging");
    }
    if (moved) {
      stepChipsEl.scrollLeft = startScroll - dx;
      updateChipsFade();
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    stepChipsEl.classList.remove("dragging");
    if (moved) suppressChipClick = true; // swallow the click that follows a drag
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
});

stepChipsEl.addEventListener("click", (e) => {
  if (suppressChipClick) {
    suppressChipClick = false;
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

function buildTokens() {
  tokensEl.innerHTML = "";
  for (const def of TOKEN_DEFS) {
    const el = document.createElement("div");
    el.className = "token " + def.type;
    el.dataset.id = def.id;
    el.textContent = def.label;
    attachTokenPointer(el, def.id);
    tokensEl.appendChild(el);
  }
}

function renderPositions(posMap) {
  for (const el of tokensEl.children) {
    const pos = posMap[el.dataset.id];
    const pct = toPercent(pos);
    el.style.left = pct.left + "%";
    el.style.top = pct.top + "%";
  }
}

function arrowPathD(a, via, b) {
  return via
    ? `M ${a.x} ${a.y} Q ${via.x} ${via.y} ${b.x} ${b.y}`
    : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

// Direction of the path as it arrives at its destination.
function endTangent(a, via, b) {
  const src = via || a;
  const dx = b.x - src.x;
  const dy = b.y - src.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// Direction of the screen bar: an explicit angle if the user rotated it,
// otherwise perpendicular to the path's arrival direction.
function screenBarDir(a, m) {
  if (m.angle != null) return { x: Math.cos(m.angle), y: Math.sin(m.angle) };
  const t = endTangent(a, m.via, m.to);
  return { x: -t.y, y: t.x };
}

function makeArrowEls(tokenId, a, move, ghost) {
  const els = [];
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", arrowPathD(a, move.via, move.to));
  let cls = "arrow-path " + move.type;
  if (tokenId === "BALL") cls += " ball-path";
  if (ghost) cls += " ghost";
  path.setAttribute("class", cls);
  if (move.type === "move") path.setAttribute("marker-end", "url(#arrowHead)");
  path.dataset.token = tokenId;
  els.push(path);

  if (move.type === "screen") {
    const bd = screenBarDir(a, move);
    const bar = document.createElementNS(SVG_NS, "line");
    bar.setAttribute("x1", move.to.x - bd.x * 1.6);
    bar.setAttribute("y1", move.to.y - bd.y * 1.6);
    bar.setAttribute("x2", move.to.x + bd.x * 1.6);
    bar.setAttribute("y2", move.to.y + bd.y * 1.6);
    bar.setAttribute("class", "screen-cap" + (ghost ? " ghost" : ""));
    bar.dataset.token = tokenId;
    els.push(bar);
  }
  return els;
}

// Draw the arrows of the step the playhead is in.
function renderArrows() {
  arrowsGroup.innerHTML = "";
  const play = currentPlay();
  const segs = segmentCount(play);
  const stepIdx = playing || playhead !== currentStep
    ? Math.min(Math.floor(playhead), Math.max(segs - 1, 0), play.steps.length - 1)
    : currentStep;
  const step = play.steps[stepIdx];
  const ghost = playing || playhead !== stepIdx;
  const addEls = (els) => {
    for (const el of els) {
      el.addEventListener("pointerdown", (e) => {
        if (tool !== "eraser" || playing) return;
        e.preventDefault();
        e.stopPropagation();
        eraseMove(el.dataset.token);
      });
      arrowsGroup.appendChild(el);
    }
  };
  for (const id of PLAYER_IDS) {
    const m = step.moves[id];
    if (m) addEls(makeArrowEls(id, step.pos[id], m, ghost));
  }
  if (step.pass) {
    const { a, b } = passEndpoints(step);
    addEls(makeArrowEls("BALL", a, { to: b, via: step.pass.via, type: "move" }, ghost));
  }
}

function handlePoint(step, tokenId, kind) {
  let a, to, via;
  if (tokenId === "BALL") {
    const ends = passEndpoints(step);
    a = ends.a;
    to = ends.b;
    via = step.pass.via;
  } else {
    const m = step.moves[tokenId];
    a = step.pos[tokenId];
    to = m.to;
    via = m.via;
  }
  if (kind === "rot") {
    const bd = screenBarDir(a, step.moves[tokenId]);
    return { x: to.x + bd.x * 2.8, y: to.y + bd.y * 2.8 };
  }
  if (kind === "end") return to;
  return via
    ? bezierPoint(a, via, to, 0.5)
    : { x: (a.x + to.x) / 2, y: (a.y + to.y) / 2 };
}

function hasArrow(step, tokenId) {
  return tokenId === "BALL" ? !!step.pass : !!step.moves[tokenId];
}

// Handles for curving / retargeting arrows. Available with any tool while
// paused on a step (the eraser deletes the arrow instead).
function renderHandles() {
  handlesEl.innerHTML = "";
  if (playing || playhead !== currentStep) return;
  const step = currentPlay().steps[currentStep];
  for (const d of TOKEN_DEFS) {
    if (!hasArrow(step, d.id)) continue;
    const kinds = ["end", "mid"];
    const m = step.moves[d.id];
    if (m && m.type === "screen") kinds.push("rot");
    for (const kind of kinds) {
      const h = document.createElement("div");
      h.className = "handle " + kind;
      h.title = kind === "end" ? t("handleEnd") : kind === "mid" ? t("handleMid") : t("handleRot");
      h.dataset.token = d.id;
      h.dataset.kind = kind;
      placeHandle(h, handlePoint(step, d.id, kind));
      attachHandleDrag(h, d.id, kind);
      handlesEl.appendChild(h);
    }
  }
}

// Reposition existing handles without rebuilding them — used during drags,
// where destroying the captured element would abort the drag.
function updateHandles() {
  const step = currentPlay().steps[currentStep];
  for (const el of handlesEl.children) {
    if (!hasArrow(step, el.dataset.token)) continue;
    placeHandle(el, handlePoint(step, el.dataset.token, el.dataset.kind));
  }
}

function placeHandle(el, p) {
  const pct = toPercent(p);
  el.style.left = pct.left + "%";
  el.style.top = pct.top + "%";
}

function renderScrubber() {
  const play = currentPlay();
  const segs = segmentCount(play);
  scrubber.max = Math.max(segs * 1000, 1);
  scrubber.value = Math.round(playhead * 1000);
  scrubber.disabled = segs === 0;

  const shownStep = Math.min(
    (playing ? Math.floor(playhead) : currentStep) + 1,
    play.steps.length
  );
  stepIndicator.textContent = `${t("step")} ${shownStep} / ${play.steps.length}`;

  timelineTicks.innerHTML = "";
  if (segs > 0) {
    for (let i = 0; i <= segs; i++) {
      const tick = document.createElement("div");
      tick.className = "timeline-tick" + (playhead >= i ? " passed" : "");
      tick.style.left = (i / segs) * 100 + "%";
      timelineTicks.appendChild(tick);
    }
  }
}

// + only makes sense when the last step has drawn actions — otherwise a
// new step would create two consecutive steps where nothing happens.
function updateAddStepState() {
  const steps = currentPlay().steps;
  $("addStepBtn").disabled = !hasMoves(steps[steps.length - 1]);
}

// Re-render everything that changes while editing the current step.
function refreshEdit() {
  renderPositions(positionsAt(playhead));
  renderArrows();
  renderHandles();
  renderScrubber();
  updateAddStepState();
}

/* ================= Tools ================= */

function setTool(next) {
  tool = next;
  document.body.dataset.tool = tool;
  for (const btn of toolbar.querySelectorAll(".tool")) {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  }
}

// Manual placement is only for the first step; afterwards players move
// exclusively via drawn arrows.
function updateToolAvailability() {
  const selectBtn = toolbar.querySelector('[data-tool="select"]');
  const disabled = currentStep > 0;
  selectBtn.disabled = disabled;
  if (disabled && tool === "select") setTool("arrow");
}

toolbar.addEventListener("click", (e) => {
  const btn = e.target.closest(".tool");
  if (btn && btn.dataset.tool && !btn.disabled) setTool(btn.dataset.tool);
});

/* ---- court zoom & pan ---- */

const ZOOM_MAX = 4;
let zoom = 1, panX = 0, panY = 0;
const zoomLabelEl = $("zoomLabel");

function applyZoomTransform() {
  const maxX = ((zoom - 1) * stageEl.offsetWidth) / 2;
  const maxY = ((zoom - 1) * stageEl.offsetHeight) / 2;
  panX = Math.min(Math.max(panX, -maxX), maxX);
  panY = Math.min(Math.max(panY, -maxY), maxY);
  stageEl.style.transform = zoom === 1 ? "" : `translate(${panX}px, ${panY}px) scale(${zoom})`;
  zoomLabelEl.textContent = Math.round(zoom * 100) + "%";
}

// Zoom keeping the screen point (cx, cy) fixed.
function setZoom(nz, cx, cy) {
  nz = Math.min(Math.max(nz, 1), ZOOM_MAX);
  if (nz === zoom) return;
  const r = stageEl.getBoundingClientRect();
  const rcx = r.left + r.width / 2;
  const rcy = r.top + r.height / 2;
  const c0x = rcx - panX, c0y = rcy - panY; // untransformed layout centre
  if (cx === undefined) { cx = rcx; cy = rcy; }
  const k = nz / zoom;
  panX = cx - c0x - (cx - c0x - panX) * k;
  panY = cy - c0y - (cy - c0y - panY) * k;
  zoom = nz;
  applyZoomTransform();
}

function resetZoom() {
  zoom = 1;
  panX = 0;
  panY = 0;
  applyZoomTransform();
}

stageWrapEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  setZoom(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
}, { passive: false });

$("zoomIn").addEventListener("click", () => setZoom(zoom * 1.3));
$("zoomOut").addEventListener("click", () => setZoom(zoom / 1.3));
zoomLabelEl.addEventListener("click", resetZoom);

// Pan (one pointer, zoomed in) and pinch-zoom (two pointers) on the court
// background — tokens, handles and arrows keep their own interactions.
const stagePointers = new Map();

stageEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".token, .handle")) return;
  stagePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { stageEl.setPointerCapture(e.pointerId); } catch (_) {}
});

stageEl.addEventListener("pointermove", (e) => {
  if (!stagePointers.has(e.pointerId)) return;
  const prev = stagePointers.get(e.pointerId);
  const cur = { x: e.clientX, y: e.clientY };
  if (stagePointers.size === 2) {
    const [idA, idB] = [...stagePointers.keys()];
    const otherId = idA === e.pointerId ? idB : idA;
    const other = stagePointers.get(otherId);
    const dPrev = Math.hypot(prev.x - other.x, prev.y - other.y);
    const dCur = Math.hypot(cur.x - other.x, cur.y - other.y);
    const midX = (cur.x + other.x) / 2, midY = (cur.y + other.y) / 2;
    if (dPrev > 0) setZoom(zoom * (dCur / dPrev), midX, midY);
    panX += (cur.x - prev.x) / 2;
    panY += (cur.y - prev.y) / 2;
    applyZoomTransform();
  } else if (zoom > 1) {
    panX += cur.x - prev.x;
    panY += cur.y - prev.y;
    applyZoomTransform();
  }
  stagePointers.set(e.pointerId, cur);
});

const stagePointerEnd = (e) => stagePointers.delete(e.pointerId);
stageEl.addEventListener("pointerup", stagePointerEnd);
stageEl.addEventListener("pointercancel", stagePointerEnd);

stageEl.addEventListener("dblclick", (e) => {
  if (e.target.closest(".token, .handle")) return;
  resetZoom();
});

/* ---- draggable toolbar ---- */

const TOOLBAR_POS_KEY = "playbook-toolbar-pos";

// The toolbar floats over the whole window: saved position is a viewport
// fraction; the default hovers over the top of the court.
function applyToolbarPos() {
  if (editorEl.hidden) return;
  const tb = toolbar.getBoundingClientRect();
  let x = null, y = null;
  try {
    const p = JSON.parse(localStorage.getItem(TOOLBAR_POS_KEY));
    if (p) { x = p.x * window.innerWidth; y = p.y * window.innerHeight; }
  } catch (_) { /* ignore bad stored value */ }
  if (x === null) {
    const wr = stageWrapEl.getBoundingClientRect();
    x = wr.left + 12;
    y = wr.top + wr.height / 2 - tb.height / 2;
  }
  toolbar.style.left = Math.min(Math.max(x, 0), window.innerWidth - tb.width) + "px";
  toolbar.style.top = Math.min(Math.max(y, 0), window.innerHeight - tb.height) + "px";
}

toolbar.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".tool")) return; // buttons keep their clicks
  e.preventDefault();
  try { toolbar.setPointerCapture(e.pointerId); } catch (_) {}
  const tb = toolbar.getBoundingClientRect();
  const dx = e.clientX - tb.left;
  const dy = e.clientY - tb.top;

  const move = (ev) => {
    const x = Math.min(Math.max(ev.clientX - dx, 0), window.innerWidth - tb.width);
    const y = Math.min(Math.max(ev.clientY - dy, 0), window.innerHeight - tb.height);
    toolbar.style.left = x + "px";
    toolbar.style.top = y + "px";
  };
  const up = () => {
    toolbar.removeEventListener("pointermove", move);
    toolbar.removeEventListener("pointerup", up);
    toolbar.removeEventListener("pointercancel", up);
    const now = toolbar.getBoundingClientRect();
    localStorage.setItem(TOOLBAR_POS_KEY, JSON.stringify({
      x: now.left / window.innerWidth,
      y: now.top / window.innerHeight,
    }));
  };
  toolbar.addEventListener("pointermove", move);
  toolbar.addEventListener("pointerup", up);
  toolbar.addEventListener("pointercancel", up);
});

// double-click the grip (or empty toolbar space) to snap back to default
toolbar.addEventListener("dblclick", (e) => {
  if (e.target.closest(".tool")) return;
  localStorage.removeItem(TOOLBAR_POS_KEY);
  applyToolbarPos();
});

window.addEventListener("resize", applyToolbarPos);

// Eraser helper: removes a token's arrow (or the pass) with a history entry.
function eraseMove(tokenId) {
  const step = currentPlay().steps[currentStep];
  if (tokenId === "BALL") {
    if (!step.pass) return;
    pushUndo();
    step.pass = null;
    syncBallChain();
    save();
    refreshEdit();
    return;
  }
  if (!step.moves[tokenId]) return;
  pushUndo();
  deleteMove(tokenId);
  save();
  refreshEdit();
}

/* ================= Pointer interactions ================= */

function attachTokenPointer(el, tokenId) {
  el.addEventListener("pointerdown", (e) => {
    if (playing) return;
    // Editing always happens on an exact step.
    playhead = currentStep;
    e.preventDefault();

    if (tool === "eraser") {
      eraseMove(tokenId);
      return;
    }

    if (tool === "arrow" || tool === "screen") {
      startArrowDraw(el, tokenId, e);
      return;
    }

    // select tool: drag the token (initial placement only)
    if (currentStep > 0) return;
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    beginAction();
    const move = (ev) => {
      const p = pointerToCourt(ev);
      if (tokenId === "BALL") {
        // The ball lives with a player: dragging it hands it to the nearest one.
        const step = currentPlay().steps[currentStep];
        const owner = nearestPlayerIn(step.pos, p, null);
        if (owner !== step.ball) {
          step.ball = owner;
          syncBallChain();
        }
      } else {
        moveToken(tokenId, p);
      }
      renderPositions(positionsAt(playhead));
      renderArrows();
      updateHandles();
    };
    const up = () => {
      el.classList.remove("dragging");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      endAction();
      save();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
}

function startArrowDraw(el, tokenId, e) {
  const step = currentPlay().steps[currentStep];
  // Any arrow drawn from the ball is a pass; screens belong to players.
  const isPass = tokenId === "BALL";
  const type = tool === "screen" && !isPass ? "screen" : "move";
  const start = isPass ? ballPoint(step.pos[step.ball]) : step.pos[tokenId];
  el.setPointerCapture(e.pointerId);

  let dest = null;
  const drawPreview = () => {
    previewGroup.innerHTML = "";
    if (!dest) return;
    for (const p of makeArrowEls(tokenId, start, { to: dest, via: null, type }, false)) {
      p.classList.add("preview");
      previewGroup.appendChild(p);
    }
  };

  const move = (ev) => {
    dest = pointerToCourt(ev);
    drawPreview();
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    previewGroup.innerHTML = "";
    if (dest && Math.hypot(dest.x - start.x, dest.y - start.y) > 1.2) {
      if (isPass) {
        // A pass snaps to the closest teammate — or to the end of a
        // teammate's cut, making the cut happen before the pass.
        const tgt = nearestPassTarget(step, dest);
        if (tgt) {
          pushUndo();
          step.pass = { to: tgt.to, via: null, timing: tgt.timing };
          syncBallChain();
          save();
        }
      } else {
        pushUndo();
        setMove(tokenId, { to: dest, via: null, type });
        save();
      }
    }
    refreshEdit();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

function attachHandleDrag(handle, tokenId, kind) {
  handle.addEventListener("pointerdown", (e) => {
    if (playing) return;
    e.preventDefault();
    e.stopPropagation();

    if (tool === "eraser") {
      eraseMove(tokenId);
      return;
    }

    handle.setPointerCapture(e.pointerId);
    beginAction();
    const step = currentPlay().steps[currentStep];

    // The mid handle sits on the curve's midpoint M; solve for the
    // quadratic control point: C = 2M - (A+B)/2. Snap straight when
    // dropped near the direct line.
    const solveVia = (a, b, p) => {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (Math.hypot(p.x - mid.x, p.y - mid.y) < 0.8) return null;
      return { x: 2 * p.x - mid.x, y: 2 * p.y - mid.y };
    };

    const move = (ev) => {
      const p = pointerToCourt(ev);
      if (tokenId === "BALL") {
        const pass = step.pass;
        if (!pass) return;
        if (kind === "end") {
          // Retarget the pass: a teammate, or the end of a teammate's cut.
          const tgt = nearestPassTarget(step, p);
          if (tgt && (tgt.to !== pass.to || tgt.timing !== pass.timing)) {
            pass.to = tgt.to;
            pass.timing = tgt.timing;
            syncBallChain();
          }
        } else {
          const ends = passEndpoints(step);
          pass.via = solveVia(ends.a, ends.b, p);
        }
      } else {
        const m = step.moves[tokenId];
        if (!m) return;
        if (kind === "end") {
          setMove(tokenId, { ...m, to: p });
        } else if (kind === "rot") {
          // Rotate the screen bar around its center; snap back to the
          // automatic perpendicular when dragged close to it.
          const ang = Math.atan2(p.y - m.to.y, p.x - m.to.x);
          const bd = screenBarDir(step.pos[tokenId], { ...m, angle: null });
          const def = Math.atan2(bd.y, bd.x);
          const diff = Math.abs(Math.atan2(Math.sin(ang - def), Math.cos(ang - def)));
          m.angle = diff < 0.12 || Math.abs(diff - Math.PI) < 0.12 ? null : ang;
        } else {
          m.via = solveVia(step.pos[tokenId], m.to, p);
        }
      }
      renderArrows();
      updateHandles();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      endAction();
      save();
      refreshEdit();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

/* ================= Playback ================= */

function startPlayback() {
  const segs = segmentCount(currentPlay());
  if (segs === 0) return;
  if (playhead >= segs) playhead = 0;
  playing = true;
  lastFrameTime = null;
  document.body.classList.add("playing");
  playBtn.textContent = "❚❚";
  renderStepChips();
  renderArrows();
  renderHandles();
  requestAnimationFrame(tick);
}

function stopPlayback() {
  if (!playing) return;
  playing = false;
  document.body.classList.remove("playing");
  playBtn.textContent = "▶";
  currentStep = Math.min(Math.round(playhead), currentPlay().steps.length - 1);
  playhead = Math.min(playhead, segmentCount(currentPlay()));
  renderAll();
}

function tick(now) {
  if (!playing) return;
  if (lastFrameTime === null) lastFrameTime = now;
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  const speed = parseFloat(speedSelect.value);
  const play = currentPlay();
  const maxT = segmentCount(play);
  const prevSeg = Math.floor(playhead);
  const segDur = segmentDuration(play, Math.min(prevSeg, maxT - 1));
  playhead = Math.min(playhead + (dt * speed) / segDur, maxT);

  renderPositions(positionsAt(playhead));
  if (Math.floor(playhead) !== prevSeg) renderArrows();
  renderScrubber();

  if (playhead >= maxT) {
    playing = false;
    document.body.classList.remove("playing");
    playBtn.textContent = "▶";
    currentStep = currentPlay().steps.length - 1;
    renderAll();
    return;
  }
  requestAnimationFrame(tick);
}

/* ================= Wiring ================= */

$("createNewBtn").addEventListener("click", () => {
  const base = t("playDefault") + " " + (plays.length + 1);
  const name = uniquePlayName(base);
  const play = createPlay(name);
  openPlay(play.id);
  if (name !== base) showToast(t("renamedToast", name));
});

$("backBtn").addEventListener("click", showHome);

/* ---- inline rename ---- */

function sizeNameInput() {
  playNameEl.style.width = Math.min(Math.max(playNameEl.value.length + 2, 5), 26) + "ch";
}

function commitRename() {
  const p = currentPlay();
  if (!p) return;
  const desired = playNameEl.value.trim() || p.name;
  const newName = uniquePlayName(desired, p.id);
  if (newName !== p.name) {
    pushUndo();
    p.name = newName;
    save();
  }
  if (newName !== desired) showToast(t("renamedToast", newName));
  playNameEl.value = p.name;
  sizeNameInput();
}

playNameEl.addEventListener("input", sizeNameInput);
playNameEl.addEventListener("blur", commitRename);
playNameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") playNameEl.blur();
  else if (e.key === "Escape") {
    playNameEl.value = currentPlay().name;
    playNameEl.blur();
  }
});

$("renamePencil").addEventListener("click", () => {
  playNameEl.focus();
  playNameEl.select();
});

$("deletePlayBtn").addEventListener("click", async () => {
  const ok = await openModal({
    title: t("deleteTitle"),
    message: t("deleteMsg", currentPlay().name),
    confirmLabel: t("deleteConfirm"),
    danger: true,
  });
  if (!ok) return;
  plays = plays.filter((p) => p.id !== currentPlayId);
  currentPlayId = null;
  save();
  showHome();
});

async function resetAllPlay() {
  const ok = await openModal({
    title: t("resetTitle"),
    message: t("resetMsg"),
    confirmLabel: t("resetConfirm"),
    danger: true,
  });
  if (!ok) return;
  stopPlayback();
  pushUndo();
  const play = currentPlay();
  play.steps = [{
    pos: JSON.parse(JSON.stringify(play.steps[0].pos)),
    moves: {},
    ball: play.steps[0].ball,
    pass: null,
  }];
  currentStep = 0;
  playhead = 0;
  save();
  renderAll();
}

playBtn.addEventListener("click", () => {
  if (playing) stopPlayback();
  else startPlayback();
});

$("prevBtn").addEventListener("click", () => {
  stopPlayback();
  currentStep = Math.max(currentStep - 1, 0);
  playhead = currentStep;
  renderAll();
});

$("nextBtn").addEventListener("click", () => {
  stopPlayback();
  currentStep = Math.min(currentStep + 1, currentPlay().steps.length - 1);
  playhead = currentStep;
  renderAll();
});

scrubber.addEventListener("input", () => {
  if (playing) {
    playing = false;
    document.body.classList.remove("playing");
    playBtn.textContent = "▶";
  }
  playhead = parseInt(scrubber.value, 10) / 1000;
  currentStep = Math.min(Math.round(playhead), currentPlay().steps.length - 1);
  renderPositions(positionsAt(playhead));
  renderArrows();
  renderHandles();
  renderScrubber();
  renderStepChips();
  updateToolAvailability();
});

// Appends a new step at the end, committing the last step's arrows.
// A new step requires the last one to have actions — otherwise the play
// would contain two consecutive steps where nothing happens.
function addStep() {
  stopPlayback();
  const steps0 = currentPlay().steps;
  if (!hasMoves(steps0[steps0.length - 1])) return;
  pushUndo();
  const steps = currentPlay().steps;
  const last = steps[steps.length - 1];
  steps.push({
    pos: derivedNextPos(last),
    moves: {},
    ball: last.pass ? last.pass.to : last.ball,
    pass: null,
  });
  syncBallChain();
  currentStep = steps.length - 1;
  playhead = currentStep;
  save();
  renderAll();
}

function deleteStepAt(i) {
  stopPlayback();
  const steps = currentPlay().steps;
  if (steps.length <= 1) return;
  const isLast = i === steps.length - 1;
  if (!isLast && hasMoves(steps[i])) return; // middle steps only when empty
  pushUndo();
  steps.splice(i, 1);
  if (isLast) {
    // The arrows that led into the removed step no longer make sense.
    steps[steps.length - 1].moves = {};
    steps[steps.length - 1].pass = null;
  }
  syncBallChain();
  if (currentStep > i) currentStep -= 1;
  currentStep = Math.min(currentStep, steps.length - 1);
  playhead = currentStep;
  save();
  renderAll();
}

speedSelect.addEventListener("change", () => speedSelect.blur());

document.addEventListener("keydown", (e) => {
  if (!modalEl.hidden || !$("exportModal").hidden) return;
  if (editorEl.hidden) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
    e.preventDefault();
    e.shiftKey ? doRedo() : doUndo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
    e.preventDefault();
    doRedo();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    playing ? stopPlayback() : startPlayback();
  } else if (e.code === "Escape") {
    if (currentStep === 0) setTool("select");
  } else if (e.code === "ArrowLeft") {
    $("prevBtn").click();
  } else if (e.code === "ArrowRight") {
    $("nextBtn").click();
  } else if (e.code === "Digit1") {
    if (currentStep === 0) setTool("select");
  } else if (e.code === "Digit2") {
    setTool("arrow");
  } else if (e.code === "Digit3") {
    setTool("screen");
  } else if (e.code === "Digit4") {
    setTool("eraser");
  }
});

/* ================= Share via link =================
The play travels inside the URL fragment: compressed JSON, base64url.
Prefix "c" = deflate-compressed, "j" = plain (no CompressionStream).
*/

async function encodeSharePlay(play) {
  const json = JSON.stringify(play);
  if (typeof CompressionStream === "undefined") {
    return "j" + btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return "c" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function decodeSharePlay(s) {
  const kind = s[0];
  const b64 = s.slice(1).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  if (kind === "j") {
    return JSON.parse(decodeURIComponent(escape(bin)));
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(stream).text());
}

$("shareBtn").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#p=" + await encodeSharePlay(currentPlay());
  if (navigator.share) {
    try { await navigator.share({ title: currentPlay().name, url }); } catch (_) { /* cancelled */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    openModal({ title: t("shareCopiedTitle"), message: t("shareCopiedMsg"), confirmLabel: "OK", noCancel: true });
  } catch (_) {
    // clipboard unavailable — show the link for manual copy
    openModal({ title: t("shareLinkTitle"), input: true, value: url, confirmLabel: "OK", noCancel: true });
  }
});

// Opening a share link: offer to add the play to this device.
async function importFromLink() {
  const m = location.hash.match(/^#p=(.+)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const raw = await decodeSharePlay(m[1]);
    if (!raw || !raw.name || !Array.isArray(raw.steps) || !raw.steps.length) throw new Error("bad");
    const p = migrateBall(migratePlay(raw));
    p.id = "play-" + Math.random().toString(36).slice(2, 10); // always a fresh copy
    const desired = p.name;
    p.name = uniquePlayName(desired);
    plays.push(p);
    save();
    openPlay(p.id);
    showToast(p.name !== desired ? t("renamedToast", p.name) : t("sharedAddedToast", p.name));
  } catch (_) {
    openModal({ title: t("importErrTitle"), message: t("sharedErrMsg"), confirmLabel: "OK", noCancel: true });
  }
}

/* ================= Boot ================= */

// Team logo: inline as a data URI so the SVG serialization used by the
// exports keeps it (external hrefs don't load inside rasterized SVGs).
(async function loadTeamLogo() {
  const el = $("teamLogo");
  try {
    const resp = await fetch("assets/logo.png");
    if (!resp.ok) throw new Error("missing");
    const blob = await resp.blob();
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    el.setAttribute("href", dataUrl);
  } catch (_) {
    el.remove(); // no logo asset — plain court
  }
})();

load();
applyLang();
showHome();
importFromLink();
