"use strict";

/* ================= Export: GIF / Video / PDF =================
Shares the global scope with app.js (VB, TOKEN_DEFS, currentPlay,
positionsAt, segmentCount, $ ...).
*/

const exportModalEl = $("exportModal");
const exportStatusEl = $("exportStatus");
const exportGoBtn = $("exportGo");
const exportFormatEl = $("exportFormat");

let exportRunning = false;
let exportAborted = false;
let exportQueue = null; // play ids for a bulk export from the home screen

/* ---------------- Canvas scene renderer ---------------- */

// Rasterize the inline court SVG once per export.
function exRasterizeCourt(W, H) {
  return new Promise((resolve, reject) => {
    const svg = $("courtSvg").cloneNode(true);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("court raster failed")); };
    img.src = url;
  });
}

function exPoint(p, W, H) {
  return {
    x: ((p.x - VB.minX) / VB.w) * W,
    y: ((p.y - VB.minY) / VB.h) * H,
  };
}

function exDrawArrow(ctx, W, H, a, m, isBall, ghost, dribble, defender) {
  const A = exPoint(a, W, H);
  const B = exPoint(m.to, W, H);
  const C = m.via ? exPoint(m.via, W, H) : null;
  const headLen = W * 0.022;
  const t = endTangent(a, m.via, m.to); // unit vector in court units == canvas units direction

  ctx.save();
  ctx.globalAlpha = ghost ? 0.45 : 0.92;
  ctx.strokeStyle = m.type === "screen" ? "#ffd166" : defender ? "#b32821" : "#1a1a1a";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = W * 0.007;
  ctx.lineCap = "round";
  if (isBall) ctx.setLineDash([W * 0.018, W * 0.014]);

  // stop the line short of the tip so the arrowhead isn't overdrawn
  const shorten = m.type === "move" ? headLen * 0.8 : 0;
  const Bs = { x: B.x - t.x * shorten, y: B.y - t.y * shorten };
  ctx.beginPath();
  if (dribble) {
    // dribble squiggle — same generator the editor uses
    const pts = wavyPoints(a, m.via, m.to).map((p) => exPoint(p, W, H));
    pts[pts.length - 1] = Bs;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  } else {
    ctx.moveTo(A.x, A.y);
    if (C) ctx.quadraticCurveTo(C.x, C.y, Bs.x, Bs.y);
    else ctx.lineTo(Bs.x, Bs.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  if (m.type === "move") {
    ctx.beginPath();
    ctx.moveTo(B.x, B.y);
    ctx.lineTo(B.x - t.x * headLen - t.y * headLen * 0.5, B.y - t.y * headLen + t.x * headLen * 0.5);
    ctx.lineTo(B.x - t.x * headLen + t.y * headLen * 0.5, B.y - t.y * headLen - t.x * headLen * 0.5);
    ctx.closePath();
    ctx.fill();
  } else {
    const bd = screenBarDir(a, m);
    const cap = (1.6 / VB.w) * W;
    ctx.strokeStyle = "#ff5252";
    ctx.lineWidth = W * 0.009;
    ctx.beginPath();
    ctx.moveTo(B.x - bd.x * cap, B.y - bd.y * cap);
    ctx.lineTo(B.x + bd.x * cap, B.y + bd.y * cap);
    ctx.stroke();
  }
  ctx.restore();
}

function exDrawToken(ctx, W, H, def, p) {
  const c = exPoint(p, W, H);
  const r = def.type === "ball" ? W * 0.0195 : W * 0.029;
  ctx.save();
  if (def.type === "ball") {
    const g = ctx.createRadialGradient(c.x - r * 0.3, c.y - r * 0.4, r * 0.2, c.x, c.y, r);
    g.addColorStop(0, "#ff9c50");
    g.addColorStop(1, "#d35f14");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#7a3c0c";
    ctx.lineWidth = r * 0.22;
    ctx.stroke();
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.moveTo(c.x - r, c.y); ctx.lineTo(c.x + r, c.y);
    ctx.moveTo(c.x, c.y - r); ctx.lineTo(c.x, c.y + r);
    ctx.stroke();
  } else if (def.type === "defense") {
    const sX = r * 0.92;
    ctx.strokeStyle = "#b32821";
    ctx.lineWidth = r * 0.42;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(c.x - sX, c.y - sX); ctx.lineTo(c.x + sX, c.y + sX);
    ctx.moveTo(c.x + sX, c.y - sX); ctx.lineTo(c.x - sX, c.y + sX);
    ctx.stroke();
    ctx.font = `700 ${Math.round(r * 0.9)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = r * 0.26;
    ctx.strokeText(def.label, c.x, c.y + r * 0.04);
    ctx.fillStyle = "#fff";
    ctx.fillText(def.label, c.x, c.y + r * 0.04);
  } else {
    const g = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.45, r * 0.2, c.x, c.y, r);
    g.addColorStop(0, "#4d8fe0");
    g.addColorStop(1, "#2b5ea8");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#cfe2ff";
    ctx.lineWidth = r * 0.16;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(r * 1.15)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.label, c.x, c.y + r * 0.06);
  }
  ctx.restore();
}

function exDrawZones(ctx, W, H, step) {
  if (!step.zones) return;
  for (const id of DEFENDER_IDS) {
    const z = step.zones[id];
    if (!z) continue;
    const a = exPoint({ x: z.x, y: z.y }, W, H);
    const w = (z.w / VB.w) * W;
    const h = (z.h / VB.h) * H;
    const color = ZONE_COLORS[id];
    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = color;
    ctx.fillRect(a.x, a.y, w, h);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = W * 0.004;
    ctx.setLineDash([W * 0.014, W * 0.01]);
    ctx.strokeRect(a.x, a.y, w, h);
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.round((4.2 / VB.w) * W)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(id.slice(1), a.x + w / 2, a.y + h / 2);
    ctx.restore();
  }
}

// arrowsStepIdx: which step's arrows to overlay (null = none)
function exDrawScene(ctx, W, H, courtImg, posMap, arrowsStepIdx, ghost, label, stepLabel) {
  ctx.drawImage(courtImg, 0, 0, W, H);
  if (arrowsStepIdx !== null) {
    const step = currentPlay().steps[arrowsStepIdx];
    exDrawZones(ctx, W, H, step);
    const dual = !!(step.pass && step.moves[step.ball]);
    const passOrder = dual ? passOrderOf(step) : 1;
    for (const id of idsFor(currentPlay())) {
      if (isSilentMover(currentPlay(), id)) continue; // silent moves — never drawn
      const m = step.moves[id];
      if (m) exDrawArrow(ctx, W, H, step.pos[id], m, false,
        ghost || (dual && id === step.ball && passOrder === 1),
        isDribbleMove(step, id, m), DEFENDER_IDS.includes(id));
    }
    if (step.pass) {
      const ends = passEndpoints(step);
      const prm = step.moves[step.pass.to];
      const bCenter = prm ? prm.to : step.pos[step.pass.to];
      exDrawArrow(ctx, W, H, ends.a, {
        to: shortenTo(ends.a, bCenter, RECEIVER_GAP),
        via: null,
        type: "move",
      }, true, ghost || (dual && passOrder === 2));
    }
    const maybes = (currentPlay().maybesHidden ? null : step.maybePasses) || [];
    if (maybes.length) {
      const om = step.moves[step.ball];
      const aM = exPoint(ballPoint(om && passOrderOf(step) === 2 ? om.to : step.pos[step.ball]), W, H);
      maybes.forEach((mp, mi) => {
        const rm = step.moves[mp.to];
        const aCourt = ballPoint(om && passOrderOf(step) === 2 ? om.to : step.pos[step.ball]);
        const bM = exPoint(shortenTo(aCourt, rm ? rm.to : step.pos[mp.to], RECEIVER_GAP), W, H);
        ctx.save();
        ctx.globalAlpha = ghost ? 0.25 : 0.55;
        ctx.strokeStyle = mi === 0 ? MAYBE_MAIN : MAYBE_ALT;
        ctx.lineWidth = W * 0.0035;
        ctx.lineCap = "round";
        ctx.setLineDash([W * 0.018, W * 0.014]);
        ctx.beginPath();
        ctx.moveTo(aM.x, aM.y);
        ctx.lineTo(bM.x, bM.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // star tip
        const r = W * 0.011;
        ctx.lineWidth = W * 0.003;
        ctx.beginPath();
        ctx.moveTo(bM.x, bM.y - r); ctx.lineTo(bM.x, bM.y + r);
        ctx.moveTo(bM.x - r * 0.87, bM.y - r * 0.5); ctx.lineTo(bM.x + r * 0.87, bM.y + r * 0.5);
        ctx.moveTo(bM.x + r * 0.87, bM.y - r * 0.5); ctx.lineTo(bM.x - r * 0.87, bM.y + r * 0.5);
        ctx.stroke();
        ctx.restore();
      });
    }
  }
  const dimOffense = playKind(currentPlay()) === "defense";
  for (const d of defsFor(currentPlay())) {
    ctx.save();
    if (dimOffense && d.type === "offense") ctx.globalAlpha = 0.7;
    else if (dimOffense && d.type === "ball") ctx.globalAlpha = 0.9;
    exDrawToken(ctx, W, H, d, posMap[d.id]);
    ctx.restore();
  }

  if (label) {
    // play name, bottom left
    ctx.save();
    ctx.font = `600 ${Math.round(W * 0.026)}px system-ui, sans-serif`;
    const pad = W * 0.012;
    const tw = ctx.measureText(label).width;
    const bx = W * 0.02, by = H - W * 0.055;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.roundRect(bx, by, tw + pad * 2, W * 0.04, W * 0.008);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx + pad, by + W * 0.021);
    ctx.restore();
  }

  if (stepLabel) {
    // step counter, top centre — the first thing the eye should find
    ctx.save();
    ctx.font = `700 ${Math.round(W * 0.034)}px system-ui, sans-serif`;
    const pad = W * 0.018;
    const tw = ctx.measureText(stepLabel).width;
    const bh = W * 0.056;
    const bx = (W - tw) / 2 - pad, by = W * 0.016;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect(bx, by, tw + pad * 2, bh, W * 0.012);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(stepLabel, bx + pad, by + bh / 2 + W * 0.002);
    ctx.restore();
  }
}

/* ---------------- Animation timeline ----------------
Pattern: pause → move → pause → move → ... → pause
Each segment's duration scales with how many sequential actions it has,
so every individual movement/pass/screen plays at the same fixed pace.
*/

function exTimeline(opts, segs) {
  const play = currentPlay();
  const durs = Array.from({ length: segs }, (_, i) => {
    const ph = segmentPhases(play.steps[Math.min(i, play.steps.length - 1)]).phases.length;
    return ph === 0 ? 0 : ph * opts.move; // empty segments are skipped
  });
  const total = Math.max(opts.pause + durs.reduce((a, d) => a + (d > 0 ? d + opts.pause : 0), 0), 1);
  return { segs, durs, pause: opts.pause, total };
}

function exStateAt(t, tl) {
  if (tl.segs === 0 || t <= tl.pause) return { ph: 0, moving: false };
  let t2 = t - tl.pause;
  for (let i = 0; i < tl.segs; i++) {
    if (tl.durs[i] === 0) continue; // skipped segment: no time, no pause
    if (t2 < tl.durs[i]) return { ph: i + t2 / tl.durs[i], moving: true };
    t2 -= tl.durs[i];
    if (t2 < tl.pause) return { ph: i + 1, moving: false };
    t2 -= tl.pause;
  }
  return { ph: tl.segs, moving: false };
}

function exDrawTimelineFrame(ctx, W, H, courtImg, time, tl) {
  const play = currentPlay();
  const segs = tl.segs;
  const { ph, moving } = exStateAt(time, tl);
  const posMap = positionsAt(ph);
  let arrowsStep = null;
  if (ph < segs) {
    arrowsStep = Math.min(Math.floor(ph), play.steps.length - 1);
  }
  const steps = play.steps;
  const rawIdx = Math.min(Math.floor(ph), steps.length - 1);
  const shownTotal = Math.max(steps.filter((st) => !exStepSkipped(play, st)).length, 1);
  const shownNum = Math.min(
    Math.max(steps.slice(0, rawIdx + 1).filter((st) => !exStepSkipped(play, st)).length, 1),
    shownTotal);
  exDrawScene(ctx, W, H, courtImg, posMap, arrowsStep, moving,
    play.name, `${t("stepLower")} ${shownNum}/${shownTotal}`);
}

// A step whose only content is possible passes vanishes from exports
// entirely while those lanes are hidden.
function exStepSkipped(play, step) {
  return Object.keys(step.moves).length === 0 && !step.pass &&
    !!play.maybesHidden && !!(step.maybePasses && step.maybePasses.length);
}

// Legend for the PDF: the full notation set for the play type (the two
// possible-pass entries drop out only when those lanes are hidden).
function exPdfLegend(play) {
  if (playKind(play) === "defense") {
    return [
      { kind: "pass", label: t("legPass") },
      { kind: "defMove", label: t("legDefender") },
      { kind: "zone", label: t("legZone") },
    ];
  }
  const items = [
    { kind: "cut", label: t("legCut") },
    { kind: "dribble", label: t("legDribble") },
    { kind: "screen", label: t("legScreen") },
    { kind: "pass", label: t("legPass") },
  ];
  if (!play.maybesHidden) {
    items.push({ kind: "maybeMain", label: t("legMain") });
    items.push({ kind: "maybeAlt", label: t("legOption") });
  }
  return items;
}

// PDF drawing ops for one legend glyph at (x, y), ~22pt wide.
function exPdfGlyph(kind, x, y) {
  const hexRGB = (hex, op) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} ${op}`;
  };
  const line = (color, dash, extra = "") =>
    `q ${hexRGB(color, "RG")} 1.1 w ${dash} ${x} ${y} m ${x + 22} ${y} l S ${extra} Q`;
  switch (kind) {
    case "cut":
      return line("#1a1a1a", "[] 0 d");
    case "dribble": {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const px = x + (22 * i) / 10;
        const py = y + (i === 0 || i === 10 ? 0 : (i % 2 ? 2.2 : -2.2));
        pts.push(`${px.toFixed(1)} ${py.toFixed(1)} ${i === 0 ? "m" : "l"}`);
      }
      return `q ${hexRGB("#1a1a1a", "RG")} 1.1 w [] 0 d ${pts.join(" ")} S Q`;
    }
    case "screen":
      return `q ${hexRGB("#c99b1e", "RG")} 1.1 w [] 0 d ${x} ${y} m ${x + 18} ${y} l S ` +
        `${hexRGB("#d43c34", "RG")} 1.6 w ${x + 20} ${y - 4} m ${x + 20} ${y + 4} l S Q`;
    case "pass":
      return line("#1a1a1a", "[3 2] 0 d");
    case "maybeMain":
      return line("#27a35a", "[2 2] 0 d", exPdfStar("#27a35a", x + 22, y));
    case "maybeAlt":
      return line("#2f86d4", "[2 2] 0 d", exPdfStar("#2f86d4", x + 22, y));
    case "defMove":
      return line("#b32821", "[] 0 d");
    case "zone":
      return `q ${hexRGB("#f2ca30", "rg")} ${x} ${y - 4.5} 20 9 re f ` +
        `${hexRGB("#b3921a", "RG")} 0.7 w [2 1.4] 0 d ${x} ${y - 4.5} 20 9 re S Q`;
  }
  return "";
}

function exPdfStar(color, x, y) {
  const r = 3.4;
  const h = r * 0.87;
  const v = r * 0.5;
  const c = (n) => n.toFixed(2);
  const col = [1, 3, 5].map((i) => (parseInt(color.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");
  return `q ${col} RG 0.8 w [] 0 d ` +
    `${c(x)} ${c(y - r)} m ${c(x)} ${c(y + r)} l S ` +
    `${c(x - h)} ${c(y - v)} m ${c(x + h)} ${c(y + v)} l S ` +
    `${c(x + h)} ${c(y - v)} m ${c(x - h)} ${c(y + v)} l S Q`;
}

/* ---------------- Download helper ---------------- */

function exDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exFileBase() {
  return currentPlay().name.replace(/[^\wÀ-ɏ-]+/g, "_").replace(/^_+|_+$/g, "") || "play";
}

function exStatus(msg) {
  exportStatusEl.hidden = false;
  exportStatusEl.textContent = msg;
}

/* ---------------- GIF export ---------------- */

// gif.js is only needed here, so it is injected on first use instead of
// loading on every visit.
let gifLibPromise = null;
function loadGifLib() {
  if (window.GIF) return Promise.resolve();
  if (!gifLibPromise) {
    gifLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "gif.js";
      s.onload = resolve;
      s.onerror = () => {
        gifLibPromise = null;
        reject(new Error("gif.js failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return gifLibPromise;
}

async function exportGif(opts) {
  await loadGifLib();
  const W = 720, H = Math.round(W * VB.h / VB.w);
  const tl = exTimeline(opts, segmentCount(currentPlay()));
  const fps = 15;
  const frames = Math.max(Math.round(tl.total * fps), 1);

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const courtImg = await exRasterizeCourt(W, H);

  const gif = new GIF({
    workers: 2,
    quality: 8,
    width: W,
    height: H,
    workerScript: "gif.worker.js",
  });

  for (let f = 0; f < frames; f++) {
    if (exportAborted) { gif.abort(); return; }
    exDrawTimelineFrame(ctx, W, H, courtImg, f / fps, tl);
    gif.addFrame(ctx, { copy: true, delay: 1000 / fps });
    if (f % 10 === 0) {
      exStatus(t("renderingFrames", f + 1, frames));
      await new Promise((r) => setTimeout(r));
    }
  }

  exStatus(t("encodingGif", 0));
  await new Promise((resolve, reject) => {
    gif.on("progress", (p) => exStatus(t("encodingGif", Math.round(p * 100))));
    gif.on("finished", (blob) => {
      exDownload(blob, exFileBase() + ".gif");
      resolve();
    });
    gif.on("abort", resolve);
    try { gif.render(); } catch (err) { reject(err); }
  });
}

/* ---------------- Video export ---------------- */

async function exportVideo(opts) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error(t("noVideo"));
  }
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c));
  if (!mime) throw new Error(t("noVideoFormat"));
  const ext = mime.includes("mp4") ? "mp4" : "webm";

  const W = 960;
  let H = Math.round(W * VB.h / VB.w);
  if (H % 2) H += 1; // even dimensions for h264
  const tl = exTimeline(opts, segmentCount(currentPlay()));
  const total = tl.total;

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const courtImg = await exRasterizeCourt(W, H);

  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(";")[0] }));
  });

  exDrawTimelineFrame(ctx, W, H, courtImg, 0, tl);
  rec.start(200);
  const t0 = performance.now();

  await new Promise((resolve) => {
    const frame = (now) => {
      const elapsed = (now - t0) / 1000;
      if (exportAborted) { resolve(); return; }
      exDrawTimelineFrame(ctx, W, H, courtImg, Math.min(elapsed, total), tl);
      exStatus(t("recording", Math.min(elapsed, total).toFixed(1), total.toFixed(1)));
      if (elapsed < total + 0.3) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });

  rec.stop();
  const blob = await done;
  if (!exportAborted) exDownload(blob, `${exFileBase()}.${ext}`);
}

/* ---------------- PDF export ---------------- */

// Minimal PDF writer: A4 portrait pages, each with a header and a 2x2 grid
// of step images. `pages` = [{header, cells: [{jpeg, w, h, label}, ...max 4]}]
function buildPdf(pages, legend) {
  const enc = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const offsets = [];
  const push = (b) => { chunks.push(b); offset += b.length; };
  const pushStr = (s) => push(enc.encode(s));
  const obj = (n, body) => { offsets[n] = offset; pushStr(`${n} 0 obj\n${body}\nendobj\n`); };
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  // Content streams use WinAnsi (latin-1 + typographic extras), not UTF-8.
  const winAnsi = (s) => {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c === 0x2014) c = 0x97;       // — em dash
      else if (c === 0x2013) c = 0x96;  // – en dash
      else if (c === 0x2018) c = 0x91;
      else if (c === 0x2019) c = 0x92;
      else if (c === 0x201C) c = 0x93;
      else if (c === 0x201D) c = 0x94;
      else if (c > 255) c = 63;         // ?
      out[i] = c;
    }
    return out;
  };

  pushStr("%PDF-1.4\n%µµµµ\n");

  // Assign object numbers: 1 catalog, 2 pages, 3 font, then per page a
  // page object, a content stream, and one image object per cell.
  let nextObj = 4;
  const pageDefs = pages.map((page) => {
    const pageN = nextObj++;
    const contN = nextObj++;
    const imgNs = page.cells.map(() => nextObj++);
    return { page, pageN, contN, imgNs };
  });

  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pageDefs.map((d) => d.pageN + " 0 R").join(" ")}] /Count ${pages.length} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  // A4: 595 x 842 pt. 2x2 grid with a page header.
  const M = 30, GX = 20, GY = 26, LABEL_H = 14;
  const cellW = (595 - M * 2 - GX) / 2;

  for (const { page, pageN, contN, imgNs } of pageDefs) {
    const parts = [`BT /F1 16 Tf ${M} 806 Td (${esc(page.header)}) Tj ET`];
    if (legend && legend.length) {
      let lx = M;
      const ly = 22;
      for (const item of legend) {
        parts.push(exPdfGlyph(item.kind, lx, ly + 2.5));
        parts.push(`BT /F1 8 Tf 0.35 0.35 0.35 rg ${(lx + 27).toFixed(1)} ${ly} Td (${esc(item.label)}) Tj ET 0 0 0 rg`);
        lx += 27 + item.label.length * 4.3 + 14;
      }
    }
    page.cells.forEach((cell, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const imgH = cellW * cell.h / cell.w;
      const x = M + col * (cellW + GX);
      const labelY = 780 - row * (LABEL_H + imgH + GY);
      const imgY = labelY - 6 - imgH;
      parts.push(`BT /F1 11 Tf ${x} ${labelY} Td (${esc(cell.label)}) Tj ET`);
      parts.push(`q ${cellW.toFixed(2)} 0 0 ${imgH.toFixed(2)} ${x} ${imgY.toFixed(2)} cm /Im${i} Do Q`);
    });
    const content = parts.join("\n");
    const xobjs = imgNs.map((n, i) => `/Im${i} ${n} 0 R`).join(" ");

    obj(pageN,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> /XObject << ${xobjs} >> >> ` +
      `/Contents ${contN} 0 R >>`);
    const contBytes = winAnsi(content);
    offsets[contN] = offset;
    pushStr(`${contN} 0 obj\n<< /Length ${contBytes.length} >>\nstream\n`);
    push(contBytes);
    pushStr("\nendstream\nendobj\n");
    page.cells.forEach((cell, i) => {
      offsets[imgNs[i]] = offset;
      pushStr(
        `${imgNs[i]} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${cell.w} /Height ${cell.h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${cell.jpeg.length} >>\nstream\n`);
      push(cell.jpeg);
      pushStr("\nendstream\nendobj\n");
    });
  }

  const totalObjs = nextObj - 1;
  const xrefAt = offset;
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjs; i++) {
    xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pushStr(xref);
  pushStr(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);

  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

function exJpegBytes(canvas) {
  const b64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function exportPdf() {
  const play = currentPlay();
  const W = 1100, H = Math.round(W * VB.h / VB.w);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const courtImg = await exRasterizeCourt(W, H);

  const included = play.steps
    .map((step, i) => ({ step, i }))
    .filter(({ step }) => !exStepSkipped(play, step));
  const cells = [];
  for (let k = 0; k < included.length; k++) {
    if (exportAborted) return;
    exStatus(t("renderingPage", k + 1, included.length));
    const { step, i } = included[k];
    const posMap = { ...step.pos, BALL: ballPoint(step.pos[step.ball]) };
    exDrawScene(ctx, W, H, courtImg, posMap, i, false, null);
    cells.push({
      jpeg: exJpegBytes(canvas),
      w: W,
      h: H,
      label: t("pdfStepLabel", k + 1, included.length),
    });
    await new Promise((r) => setTimeout(r));
  }
  // 2x2 grid (or 2x1 for the taller full-court renders), play name as
  // the page header.
  const per = playCourt(play) === "full" ? 2 : 4;
  const pages = [];
  for (let i = 0; i < cells.length; i += per) {
    pages.push({ header: play.name, cells: cells.slice(i, i + per) });
  }
  const bytes = buildPdf(pages, exPdfLegend(play));
  exDownload(new Blob([bytes], { type: "application/pdf" }), exFileBase() + ".pdf");
}

/* ---------------- Modal wiring ---------------- */

function exUpdateFormatUI() {
  $("exportTiming").hidden = exportFormatEl.value === "pdf";
}

exportFormatEl.addEventListener("change", exUpdateFormatUI);

$("exportBtn").addEventListener("click", () => {
  exportQueue = null;
  stopPlayback();
  exportAborted = false;
  exportStatusEl.hidden = true;
  exportGoBtn.disabled = false;
  exUpdateFormatUI();
  exportModalEl.hidden = false;
});

// Bulk export from the home screen: same modal, then one file per play.
function openExportModalFor(ids) {
  exportQueue = ids;
  exportAborted = false;
  exportStatusEl.hidden = true;
  exportGoBtn.disabled = false;
  exUpdateFormatUI();
  exportModalEl.hidden = false;
}

$("exportCancel").addEventListener("click", () => {
  exportAborted = true;
  exportModalEl.hidden = true;
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && !exportModalEl.hidden) {
    exportAborted = true;
    exportModalEl.hidden = true;
  }
});

exportGoBtn.addEventListener("click", async () => {
  if (exportRunning) return;
  exportRunning = true;
  exportAborted = false;
  exportGoBtn.disabled = true;
  const opts = {
    move: Math.min(Math.max(parseFloat($("exportMove").value) || 1.8, 0.3), 8),
    pause: Math.min(Math.max(parseFloat($("exportPause").value) || 0, 0), 10),
  };
  try {
    const fmt = exportFormatEl.value;
    const runOne = async () => {
      if (fmt === "gif") await exportGif(opts);
      else if (fmt === "video") await exportVideo(opts);
      else await exportPdf();
    };
    if (exportQueue && exportQueue.length) {
      const prevId = currentPlayId;
      for (const id of exportQueue) {
        if (exportAborted) break;
        currentPlayId = id;
        applyCourtMode(currentPlay());
        await runOne();
      }
      currentPlayId = prevId;
      if (currentPlay()) applyCourtMode(currentPlay());
    } else {
      await runOne();
    }
    if (!exportAborted) {
      exStatus(t("exportDone"));
      setTimeout(() => { exportModalEl.hidden = true; }, 900);
    }
  } catch (err) {
    exStatus(t("exportFailed") + err.message);
  } finally {
    exportRunning = false;
    exportGoBtn.disabled = false;
  }
});
