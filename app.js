"use strict";

/* ================= Constants ================= */

// Court coordinate system = SVG viewBox units (feet).
const VB_HALF = { minX: -3.5, minY: -6, w: 57, h: 62 };
const VB_FULL = { minX: -3.5, minY: -6, w: 57, h: 106 };
const CLAMP_HALF = { minX: -3, maxX: 53, minY: -5.5, maxY: 55 };
const CLAMP_FULL = { minX: -3, maxX: 53, minY: -5.5, maxY: 99.5 };
let VB = VB_HALF;
let CLAMP = CLAMP_HALF;
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
const DEFENDER_IDS = ["D1", "D2", "D3", "D4", "D5"];
// soft, distinct hue per defender's area of action
// possible passes: the first drawn is the MAIN option
const MAYBE_MAIN = "#27a35a";
const MAYBE_ALT = "#2f86d4";
const ZONE_COLORS = {
  D1: "#ffd400", D2: "#26a5ff", D3: "#2fe08a", D4: "#c678ff", D5: "#ff5470",
};
const DEFENDER_DEFS = DEFENDER_IDS.map((id, i) => ({ id, label: String(i + 1), type: "defense" }));

function playKind(p) { return p && p.kind === "defense" ? "defense" : "offense"; }
function playCourt(p) { return p && p.court === "full" ? "full" : "half"; }

// In an offensive play the defenders are the optional, silent team; in a
// defensive play the roles swap: defenders draw real arrows and the
// offence (always present, it carries the ball) becomes the silent team.
function contextIds(play) {
  if (playKind(play) === "defense") return PLAYER_IDS;
  return play && play.defense ? DEFENDER_IDS : [];
}
function isSilentMover(play, id) {
  return contextIds(play).includes(id);
}
function hasBothTeams(play) {
  return playKind(play) === "defense" || !!(play && play.defense);
}
function idsFor(play) {
  return hasBothTeams(play) ? [...PLAYER_IDS, ...DEFENDER_IDS] : PLAYER_IDS;
}
function defsFor(play) {
  return hasBothTeams(play) ? [...TOKEN_DEFS, ...DEFENDER_DEFS] : TOKEN_DEFS;
}

// Court mode: geometry, clamp region, svg viewBoxes and markings.
function applyCourtMode(play) {
  // defensive plays dim the attacking team — they are context, not focus
  document.body.classList.toggle("kind-defense", playKind(play) === "defense");
  const full = playCourt(play) === "full";
  VB = full ? VB_FULL : VB_HALF;
  CLAMP = full ? CLAMP_FULL : CLAMP_HALF;
  const vb = `${VB.minX} ${VB.minY} ${VB.w} ${VB.h}`;
  $("courtSvg").setAttribute("viewBox", vb);
  $("arrowsSvg").setAttribute("viewBox", vb);
  $("oobRect1").setAttribute("height", VB.h);
  $("oobRect2").setAttribute("height", VB.h);
  $("floorRect1").setAttribute("height", full ? 94 : 54);
  $("floorRect2").setAttribute("height", full ? 94 : 54);
  $("halfExtras").style.display = full ? "none" : "";
  $("fullMarks").style.display = full ? "" : "none";
  // on the full court the logo reads as a subtle parquet inlay (bigger,
  // faded, no centre circle) so it never fights the pieces at midcourt
  const logo = $("teamLogo");
  logo.setAttribute("opacity", full ? "0.32" : "0.92");
  logo.setAttribute("x", full ? "14.5" : "18.25");
  logo.setAttribute("y", full ? "35.3" : "39.5");
  logo.setAttribute("width", full ? "21" : "13.5");
  logo.setAttribute("height", full ? "23.4" : "15");
  stageEl.style.aspectRatio = `${VB.w} / ${VB.h}`;
  stageEl.style.width = `min(100cqw, calc(100cqh * ${VB.w} / ${VB.h}))`;
  // token numbers scale with the stage, not the viewport — otherwise a
  // narrow full-court stage gets text taller than the token is wide and
  // the circles stretch into ovals
  stageEl.style.fontSize = `calc(min(100cqw, 100cqh * ${VB.w} / ${VB.h}) * 0.034)`;
}
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
let viewPlay = null;   // standalone play shown in the read-only viewer

/* ================= i18n ================= */

const I18N = {
  en: {
    appTitle: "Cejudo's Playbook",
    createNew: "＋ CREATE PLAY",
    stepSingular: "step", stepPlural: "steps",
    back: "← Plays", rename: "✎ Rename", deletePlay: "Delete",
    nextStep: "Next step ＋", deleteStep: "Delete step", resetAll: "Reset all",
    step: "Step", stepLower: "step",
    cancel: "Cancel", create: "Create", renameConfirm: "Rename",
    deleteConfirm: "Delete", resetConfirm: "Reset",
    newPlayTitle: "New play", renameTitle: "Rename play",
    kindLabel: "Type", kindOffense: "Offense", kindDefense: "Defense",
    filterAll: "All",
    courtLabel: "Court", courtHalf: "Half court", courtFull: "Full court",
    deleteTitle: "Delete play?",
    deleteMsg: (n) => `"${n}" will be deleted permanently.`,
    deleteSelected: (n) => `Delete selected (${n})`,
    selectAll: "Select all",
    searchPlays: "Search plays…",
    sortCustom: "Custom order",
    sortModified: "Last modified",
    sortCreated: "Date created",
    sortAlpha: "Alphabetical",
    createdLabel: "Created",
    modifiedLabel: "Modified",
    noResults: "No plays match your search.",
    deleteSelTitle: "Delete selected plays?",
    deleteAllBtn: "Delete all plays",
    deleteAllTitle: "Delete ALL plays?",
    ttLock: "Lock the play (prevent edits)",
    ttUnlock: "Unlock the play",
    unlockTitle: "Unlock play?",
    unlockMsg: "The play will be editable again.",
    bulkUnlockMsg: (n) => n === 1 ? "The selected play will be editable again." : `The ${n} selected plays will be editable again.`,
    unlockConfirm: "Unlock",
    ttBulkLock: "Lock selected plays",
    ttBulkUnlock: "Unlock selected plays",
    ttBulkSave: "Export selected as GIF, video or PDF",
    ttBulkZip: "Download selected as a .zip backup",
    ttDuplicate: "Duplicate play",
    duplicatedToast: (n) => `Copy created: "${n}".`,
    deleteAllMsg: (n) => `All ${n} plays will be deleted permanently. This cannot be undone.`,
    deleteSelMsg: (n) => n === 1 ? "The selected play will be deleted permanently." : `The ${n} selected plays will be deleted permanently.`,
    undoDeleteMsg: (n) => n === 1 ? "Play deleted — tap here to undo." : `${n} plays deleted — tap here to undo.`,
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
    ttPass: "Pass — drag anywhere on the court; the line starts at the ball (4)",
    ttMaybePass: "Possible pass — the first drawn is the main option (green), the rest blue (5)",
    ttMaybeToggle: "Animate possible passes",
    ttTokenSize: "Player size",
    ttMaybeShow: "Show possible passes",
    legCut: "Movement", legDribble: "Dribble", legScreen: "Screen", legPass: "Pass",
    legMain: "Main pass option", legOption: "Pass option", legDefender: "Defender movement", legZone: "Zone of action",
    ttZone: "Zone — drag from a defender to mark their area of action (3)",
    ttDefense: "Show / hide defenders",
    ttEraser: "Eraser — click an arrow or a player to remove its arrow (6)",
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
    shareTitle: "Share play",
    shareModalMsg: "The link opens a view-only player of this play.",
    shareAllowEdit: "Allow editing (they can add it to their plays)",
    shareGo: "Share",
    viewEdit: "Edit",
    shareCopiedTitle: "Link copied",
    shareCopiedMsg: "The share link is in your clipboard — send it to anyone.",
    shareLinkTitle: "Share link",
    copyLink: "Copy link",
    linkCopied: "Link copied to clipboard.",
    qrCopied: "QR code copied to clipboard.",
    ttCopyQr: "Click to copy the QR code",
    sharedTitle: "Shared play",
    sharedMsg: (n) => `Add "${n}" to your plays?`,
    sharedAdd: "Add",
    sharedErrMsg: "This share link is not valid.",
    renamedToast: (n) => `That name was already in use — this play is now called "${n}".`,
    helpTitle: "How Cejudo's Playbook works",
    helpTourTitle: "Guided tour",
    helpTourBody: "New here, or want a refresher? Replay the interactive tour that walks you through creating and animating a play, step by step.",
    helpTourBtn: "Restart the tour",
    tourSkip: "Skip tour", tourNext: "Next", tourDone: "Done!",
    tourTexts: [
      "Welcome! Let's build your first play — click the highlighted button.",
      "Pick what kind of play this is — offense or defense — and whether it uses half or the full court, then hit Create.",
      "This is your court. Drag the players and the ball to their starting spots (out of bounds works too).",
      "Your toolbar: movement arrows, screens, passes and the eraser. Drag from a player to draw their cut, or use the pass tool to throw from anywhere. Drag the grip to move it.",
      "In defensive plays this tool shades each defender\u2019s area of action — drag anywhere on the court to draw one, and drag the area to move it.",
      "Once you've drawn arrows, the green + turns them into the next step of the play.",
      "Need defense? This button adds five X defenders you can place and move just like your players.",
      "Press play to watch the whole play animate, step by step.",
      "Done? The save button exports the play as an animated GIF, a video, or a printable step-by-step PDF.",
      "Share any play as a link — view-only by default.",
      "Any questions later? The full guide lives behind this ? button. Enjoy!",
    ],
    helpSections: [
      { h: "Plays", b: "The home screen lists your plays: tap one to open it, drag the dots to reorder, use the bin to delete. Rename a play by clicking its name in the editor." },
      { h: "Players and the ball", b: "On step 1, drag players anywhere (out of bounds too). The ball always belongs to a player — drag it to hand it to someone else." },
      { h: "Drawing tools", b: "Toolbar (drag its grip to move it anywhere): 1 select, 2 movement arrow, 3 screen, 4 pass, 5 possible pass, 6 eraser. Drag from a player to draw their cut or screen. With the pass tool, drag anywhere — the line always starts at the ball. The carrier\u2019s dribble draws as a wavy line. Keyboard 1–6 switches tools." },
      { h: "Editing arrows", b: "Round handle bends a cut, square handle moves its end, and a screen's red bar rotates with its gold handle. The eraser removes an arrow by clicking it or its player." },
      { h: "Passes", b: "Passes snap to a teammate and are always straight. If the receiver has a movement, the ball is delivered at the END of that movement. Screeners can never receive, and the ball carrier can never screen." },
      { h: "Two actions, one player", b: "When the carrier has a pass and a movement, the lighter line happens second. Double-click (or long-press) a line to make it go first — moving first means dribbling there before passing." },
      { h: "Steps", b: "The green + commits the drawn arrows into a new step; steps without actions (and the last step) can be deleted from their bin bubble. A step lasts as long as its number of sequential actions." },
      { h: "Playback and zoom", b: "Use the bottom player: play/pause (Space), previous/next (arrow keys), scrubber and speed. Zoom with the wheel, a pinch or the corner control; drag the court to pan; double-click to reset." },
      { h: "Sharing", b: "The share button (in the editor or on each card) creates a link with the play inside it. By default it opens a view-only player with an Edit button; tick the checkbox to share an editable copy. The link modal shows a QR code — click it to copy it as an image, or use the button to copy the link." },
      { h: "Defenders", b: "The shield button beside the step controls adds five defenders \u2014 red X markers placed and moved exactly like your players. Defenders never draw arrows: drag them with the select tool to reposition them in any step, or use the arrow tool to set where they move during the step \u2014 a faint X marks the destination while you edit (drag it to adjust), and in playback they simply glide there. Defenders can\u2019t set screens or receive passes. Toggle again to remove them (undo brings everything back). In defensive plays the zone tool (3) shades each defender\u2019s area of action in a soft colour." },
      { h: "Offense, defense & courts", b: "When creating a play you pick its type and court size. Defensive plays flip the roles: the defenders draw the visible red arrows, the dimmed attack repositions silently, and playback runs the attack first with the defense reacting after. Full-court plays double the floor for presses and transition. The home list tags every play (A/D) and the filter above it shows one type at a time." },
      { h: "Locking & organizing", b: "The padlock in the editor makes a play read-only until you unlock it. On the home screen every card has duplicate, share and delete buttons and the checkboxes select several plays at once to export, download as .zip, lock or delete together." },
      { h: "Exporting and backups", b: "The save button exports the play as a GIF, a video or a step-by-step PDF. On the home screen, Export all downloads every play as a .zip you can import on another device." },
      { h: "Undo", b: "Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes any edit: drags, arrows, steps, renames." },
    ],
    orderHelp: "This player has two actions — the lighter line happens second. Double-click (or long-press) a line to make it go first.",
    sharedAddedToast: (n) => `Shared play "${n}" added to your plays.`,
    sharedExistsMsg: (n) => `You already have this play — it's called "${n}". Add it anyway?`,
    sharedAddAnyway: "Add anyway",
    exportAll: "⤓ Export all (.zip)", importAll: "⤒ Import (.zip)",
    ttExportAll: "Download every play as a .zip backup",
    ttImportAll: "Import plays from a .zip backup",
    importDoneTitle: "Import complete",
    importDoneMsg: (a) => `${a} plays imported.`,
    importedBadge: "imported",
    importErrTitle: "Import failed",
    importErrMsg: "That file doesn't look like a Playbook backup (.zip).",
  },
  es: {
    appTitle: "Cejudo's Playbook",
    createNew: "＋ CREAR JUGADA",
    stepSingular: "paso", stepPlural: "pasos",
    back: "← Jugadas", rename: "✎ Renombrar", deletePlay: "Eliminar",
    nextStep: "Siguiente paso ＋", deleteStep: "Eliminar paso", resetAll: "Reiniciar todo",
    step: "Paso", stepLower: "paso",
    cancel: "Cancelar", create: "Crear", renameConfirm: "Renombrar",
    deleteConfirm: "Eliminar", resetConfirm: "Reiniciar",
    newPlayTitle: "Nueva jugada", renameTitle: "Renombrar jugada",
    kindLabel: "Tipo", kindOffense: "Ataque", kindDefense: "Defensa",
    filterAll: "Todas",
    courtLabel: "Pista", courtHalf: "Media pista", courtFull: "Pista completa",
    deleteTitle: "¿Eliminar jugada?",
    deleteMsg: (n) => `"${n}" se eliminará permanentemente.`,
    deleteSelected: (n) => `Eliminar seleccionadas (${n})`,
    selectAll: "Seleccionar todas",
    searchPlays: "Buscar jugadas…",
    sortCustom: "Orden personalizado",
    sortModified: "Última modificación",
    sortCreated: "Fecha de creación",
    sortAlpha: "Alfabético",
    createdLabel: "Creada",
    modifiedLabel: "Modificada",
    noResults: "Ninguna jugada coincide con tu búsqueda.",
    deleteSelTitle: "¿Eliminar las jugadas seleccionadas?",
    deleteAllBtn: "Eliminar todas las jugadas",
    deleteAllTitle: "¿Eliminar TODAS las jugadas?",
    ttLock: "Bloquear la jugada (impide editarla)",
    ttUnlock: "Desbloquear la jugada",
    unlockTitle: "¿Desbloquear la jugada?",
    unlockMsg: "La jugada volverá a ser editable.",
    bulkUnlockMsg: (n) => n === 1 ? "La jugada seleccionada volverá a ser editable." : `Las ${n} jugadas seleccionadas volverán a ser editables.`,
    unlockConfirm: "Desbloquear",
    ttBulkLock: "Bloquear las jugadas seleccionadas",
    ttBulkUnlock: "Desbloquear las jugadas seleccionadas",
    ttBulkSave: "Exportar seleccionadas como GIF, vídeo o PDF",
    ttBulkZip: "Descargar seleccionadas como copia .zip",
    ttDuplicate: "Duplicar jugada",
    duplicatedToast: (n) => `Copia creada: "${n}".`,
    deleteAllMsg: (n) => `Se eliminarán permanentemente las ${n} jugadas. Esto no se puede deshacer.`,
    deleteSelMsg: (n) => n === 1 ? "La jugada seleccionada se eliminará permanentemente." : `Las ${n} jugadas seleccionadas se eliminarán permanentemente.`,
    undoDeleteMsg: (n) => n === 1 ? "Jugada eliminada — toca aquí para deshacer." : `${n} jugadas eliminadas — toca aquí para deshacer.`,
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
    ttPass: "Pase — arrastra en cualquier punto de la pista; la línea sale del balón (4)",
    ttMaybePass: "Pase posible — el primero dibujado es la opción principal (verde), el resto en azul (5)",
    ttMaybeToggle: "Animar pases posibles",
    ttTokenSize: "Tamaño de los jugadores",
    ttMaybeShow: "Mostrar pases posibles",
    legCut: "Movimiento", legDribble: "Bote", legScreen: "Bloqueo", legPass: "Pase",
    legMain: "Pase posible principal", legOption: "Pase posible", legDefender: "Movimiento defensivo", legZone: "Zona de acción",
    ttZone: "Zona — arrastra desde un defensor para marcar su área de acción (3)",
    ttDefense: "Mostrar / ocultar defensores",
    ttEraser: "Borrador — pulsa una flecha o un jugador para quitar su flecha (6)",
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
    shareTitle: "Compartir jugada",
    shareModalMsg: "El enlace abre un visor de solo lectura de esta jugada.",
    shareAllowEdit: "Permitir edición (podrán añadirla a sus jugadas)",
    shareGo: "Compartir",
    viewEdit: "Editar",
    shareCopiedTitle: "Enlace copiado",
    shareCopiedMsg: "El enlace está en tu portapapeles — envíaselo a quien quieras.",
    shareLinkTitle: "Enlace para compartir",
    copyLink: "Copiar enlace",
    linkCopied: "Enlace copiado al portapapeles.",
    qrCopied: "Código QR copiado al portapapeles.",
    ttCopyQr: "Pulsa para copiar el código QR",
    sharedTitle: "Jugada compartida",
    sharedMsg: (n) => `¿Añadir "${n}" a tus jugadas?`,
    sharedAdd: "Añadir",
    sharedErrMsg: "El enlace no es válido.",
    renamedToast: (n) => `Ese nombre ya existía — la jugada ahora se llama "${n}".`,
    helpTitle: "Cómo funciona Cejudo's Playbook",
    helpTourTitle: "Tour guiado",
    helpTourBody: "¿Nuevo por aquí o quieres un repaso? Vuelve a ver el tour interactivo que te guía al crear y animar una jugada, paso a paso.",
    helpTourBtn: "Reiniciar el tour",
    tourSkip: "Saltar tour", tourNext: "Siguiente", tourDone: "¡Listo!",
    tourTexts: [
      "¡Bienvenido! Vamos a crear tu primera jugada — pulsa el botón resaltado.",
      "Elige qué tipo de jugada es — ataque o defensa — y si usa media pista o la pista completa; después pulsa Crear.",
      "Esta es tu pista. Arrastra a los jugadores y el balón a sus posiciones iniciales (también vale fuera de la pista).",
      "Tu barra de herramientas: flechas de movimiento, bloqueos, pases y el borrador. Arrastra desde un jugador para dibujar su corte, o usa la herramienta de pase desde cualquier punto. Muévela arrastrando su agarre.",
      "En las jugadas defensivas esta herramienta sombrea el área de acción de cada defensor — arrastra en cualquier punto para dibujarla y arrástrala para moverla.",
      "Cuando hayas dibujado flechas, el + verde las convierte en el siguiente paso de la jugada.",
      "¿Necesitas defensa? Este botón añade cinco defensores (X) que puedes colocar y mover como a tus jugadores.",
      "Pulsa play para ver la jugada completa animada, paso a paso.",
      "¿Terminada? El botón de guardar exporta la jugada como GIF animado, vídeo o un PDF paso a paso listo para imprimir.",
      "Comparte cualquier jugada con un enlace — solo lectura por defecto.",
      "¿Dudas más adelante? La guía completa está tras este botón ?. ¡A disfrutar!",
    ],
    helpSections: [
      { h: "Jugadas", b: "La pantalla de inicio lista tus jugadas: toca una para abrirla, arrastra los puntos para reordenar y usa la papelera para borrar. Renombra una jugada pulsando su nombre en el editor." },
      { h: "Jugadores y balón", b: "En el paso 1 arrastra a los jugadores a cualquier sitio (también fuera de la pista). El balón siempre pertenece a un jugador — arrástralo para dárselo a otro." },
      { h: "Herramientas de dibujo", b: "Barra de herramientas (muévela arrastrando su agarre): 1 seleccionar, 2 flecha de movimiento, 3 bloqueo, 4 pase, 5 pase posible, 6 borrador. Arrastra desde un jugador para dibujar su corte o bloqueo. Con la herramienta de pase, arrastra en cualquier punto: la línea siempre sale del balón. El bote del jugador con balón se dibuja como línea ondulada. Teclas 1–6 cambian de herramienta." },
      { h: "Editar flechas", b: "El tirador redondo curva un corte, el cuadrado mueve su destino, y la barra roja del bloqueo gira con su tirador dorado. El borrador elimina una flecha pulsándola o pulsando a su jugador." },
      { h: "Pases", b: "Los pases se ajustan a un compañero y siempre son rectos. Si el receptor tiene un movimiento, el balón le llega al FINAL de ese movimiento. Un bloqueador nunca puede recibir, y el que lleva el balón nunca puede bloquear." },
      { h: "Dos acciones, un jugador", b: "Cuando el portador tiene pase y movimiento, la línea más tenue ocurre después. Doble clic (o mantener pulsado) sobre una línea hace que vaya primero — moverse primero significa botar hasta allí antes de pasar." },
      { h: "Pasos", b: "El + verde convierte las flechas dibujadas en un nuevo paso; los pasos sin acciones (y el último) se borran desde su burbuja de papelera. Un paso dura según su número de acciones secuenciales." },
      { h: "Reproducción y zoom", b: "Usa el reproductor inferior: play/pausa (Espacio), anterior/siguiente (flechas), barra de progreso y velocidad. Zoom con la rueda, pellizco o el control de la esquina; arrastra la pista para desplazarte; doble clic para restablecer." },
      { h: "Compartir", b: "El botón de compartir (en el editor o en cada tarjeta) crea un enlace con la jugada dentro. Por defecto abre un visor de solo lectura con botón Editar; marca la casilla para compartir una copia editable. El diálogo del enlace muestra un código QR: púlsalo para copiarlo como imagen, o usa el botón para copiar el enlace." },
      { h: "Defensores", b: "El botón del escudo junto a los controles de paso añade cinco defensores: marcas X rojas que se colocan y mueven igual que tus jugadores. Los defensores nunca dibujan flechas: arrástralos con la herramienta de selección para recolocarlos en cualquier paso, o usa la flecha de movimiento para marcar a dónde se desplazan durante el paso — una X tenue señala el destino mientras editas (arrástrala para ajustarla) y en la reproducción simplemente se deslizan hasta allí. No pueden bloquear ni recibir pases. Vuelve a pulsarlo para quitarlos (deshacer lo recupera todo). En las jugadas defensivas, la herramienta de zona (3) sombrea con un color suave el área de acción de cada defensor." },
      { h: "Ataque, defensa y pistas", b: "Al crear una jugada eliges su tipo y el tamaño de pista. Las jugadas defensivas invierten los papeles: los defensores dibujan las flechas rojas visibles, el ataque (atenuado) se recoloca en silencio y en la reproducción primero actúa el ataque y después reacciona la defensa. Las jugadas a pista completa doblan el campo para presiones y transiciones. La lista de inicio etiqueta cada jugada (A/D) y el filtro superior muestra un tipo a la vez." },
      { h: "Bloqueo y organización", b: "El candado del editor hace la jugada de solo lectura hasta que la desbloquees. En la pantalla de inicio cada tarjeta tiene botones de duplicar, compartir y eliminar, y las casillas seleccionan varias jugadas a la vez para exportarlas, descargarlas en .zip, bloquearlas o eliminarlas juntas." },
      { h: "Exportar y copias", b: "El botón de guardar exporta la jugada como GIF, vídeo o PDF paso a paso. En el inicio, Exportar todo descarga todas tus jugadas en un .zip que puedes importar en otro dispositivo." },
      { h: "Deshacer", b: "Ctrl+Z deshace y Ctrl+Mayús+Z (o Ctrl+Y) rehace cualquier edición: arrastres, flechas, pasos, renombrados." },
    ],
    orderHelp: "Este jugador tiene dos acciones — la línea más tenue ocurre después. Doble clic (o mantén pulsado) sobre una línea para que vaya primero.",
    sharedAddedToast: (n) => `Jugada compartida "${n}" añadida a tus jugadas.`,
    sharedExistsMsg: (n) => `Ya tienes esta jugada — se llama "${n}". ¿Añadirla igualmente?`,
    sharedAddAnyway: "Añadir igualmente",
    exportAll: "⤓ Exportar todo (.zip)", importAll: "⤒ Importar (.zip)",
    ttExportAll: "Descargar todas las jugadas como copia de seguridad .zip",
    ttImportAll: "Importar jugadas desde una copia de seguridad .zip",
    importDoneTitle: "Importación completada",
    importDoneMsg: (a) => `${a} jugadas importadas.`,
    importedBadge: "importada",
    importErrTitle: "Error al importar",
    importErrMsg: "El archivo no parece una copia de seguridad de Playbook (.zip).",
  },
  it: {
    appTitle: "Cejudo's Playbook",
    createNew: "＋ CREA GIOCATA",
    stepSingular: "passo", stepPlural: "passi",
    back: "← Giocate", rename: "✎ Rinomina", deletePlay: "Elimina",
    nextStep: "Passo successivo ＋", deleteStep: "Elimina passo", resetAll: "Azzera tutto",
    step: "Passo", stepLower: "passo",
    cancel: "Annulla", create: "Crea", renameConfirm: "Rinomina",
    deleteConfirm: "Elimina", resetConfirm: "Azzera",
    newPlayTitle: "Nuova giocata", renameTitle: "Rinomina giocata",
    kindLabel: "Tipo", kindOffense: "Attacco", kindDefense: "Difesa",
    filterAll: "Tutte",
    courtLabel: "Campo", courtHalf: "Metà campo", courtFull: "Campo intero",
    deleteTitle: "Eliminare la giocata?",
    deleteMsg: (n) => `"${n}" verrà eliminata definitivamente.`,
    deleteSelected: (n) => `Elimina selezionate (${n})`,
    selectAll: "Seleziona tutte",
    searchPlays: "Cerca giocate…",
    sortCustom: "Ordine personalizzato",
    sortModified: "Ultima modifica",
    sortCreated: "Data di creazione",
    sortAlpha: "Alfabetico",
    createdLabel: "Creata",
    modifiedLabel: "Modificata",
    noResults: "Nessuna giocata corrisponde alla ricerca.",
    deleteSelTitle: "Eliminare le giocate selezionate?",
    deleteAllBtn: "Elimina tutte le giocate",
    deleteAllTitle: "Eliminare TUTTE le giocate?",
    ttLock: "Blocca la giocata (impedisce le modifiche)",
    ttUnlock: "Sblocca la giocata",
    unlockTitle: "Sbloccare la giocata?",
    unlockMsg: "La giocata tornerà modificabile.",
    bulkUnlockMsg: (n) => n === 1 ? "La giocata selezionata tornerà modificabile." : `Le ${n} giocate selezionate torneranno modificabili.`,
    unlockConfirm: "Sblocca",
    ttBulkLock: "Blocca le giocate selezionate",
    ttBulkUnlock: "Sblocca le giocate selezionate",
    ttBulkSave: "Esporta le selezionate come GIF, video o PDF",
    ttBulkZip: "Scarica le selezionate come backup .zip",
    ttDuplicate: "Duplica giocata",
    duplicatedToast: (n) => `Copia creata: "${n}".`,
    deleteAllMsg: (n) => `Tutte le ${n} giocate verranno eliminate definitivamente. Non si può annullare.`,
    deleteSelMsg: (n) => n === 1 ? "La giocata selezionata verrà eliminata definitivamente." : `Le ${n} giocate selezionate verranno eliminate definitivamente.`,
    undoDeleteMsg: (n) => n === 1 ? "Giocata eliminata — tocca qui per annullare." : `${n} giocate eliminate — tocca qui per annullare.`,
    resetTitle: "Azzerare la giocata?",
    resetMsg: "Tutti i passi e le frecce verranno rimossi. Le posizioni iniziali del passo 1 vengono mantenute.",
    untitled: "Giocata senza nome", playDefault: "Giocata",
    exportTitle: "Esporta giocata", formatLabel: "Formato",
    fmtGif: "Animazione GIF", fmtVideo: "Video (MP4 / WebM)", fmtPdf: "PDF — tutti i passi",
    moveDur: "Durata del movimento (secondi)", pauseDur: "Pausa tra i passi (secondi)",
    exportGo: "Esporta",
    renderingFrames: (a, b) => `Generazione fotogrammi… ${a}/${b}`,
    encodingGif: (p) => `Codifica GIF… ${p}%`,
    recording: (a, b) => `Registrazione… ${a}s / ${b}s (tempo reale)`,
    renderingPage: (a, b) => `Generazione pagina ${a}/${b}…`,
    exportDone: "Fatto — file scaricato.",
    exportFailed: "Esportazione non riuscita: ",
    noVideo: "Questo browser non supporta la registrazione video.",
    noVideoFormat: "Nessun formato video supportato.",
    pdfStepLabel: (i, n) => `Passo ${i} di ${n}`,
    handleEnd: "Trascina per cambiare la destinazione",
    handleMid: "Trascina per curvare la freccia",
    handleRot: "Trascina per ruotare il blocco",
    ttSelect: "Seleziona / muovi i giocatori (1) — solo nel passo 1",
    ttArrow: "Freccia di movimento — trascina da un giocatore (2)",
    ttScreen: "Blocco — trascina dal bloccante (3)",
    ttPass: "Passaggio — trascina ovunque sul campo; la linea parte dal pallone (4)",
    ttMaybePass: "Passaggio possibile — il primo disegnato è l\u2019opzione principale (verde), gli altri in blu (5)",
    ttMaybeToggle: "Anima i passaggi possibili",
    ttTokenSize: "Dimensione dei giocatori",
    ttMaybeShow: "Mostra i passaggi possibili",
    legCut: "Movimento", legDribble: "Palleggio", legScreen: "Blocco", legPass: "Passaggio",
    legMain: "Opzione principale", legOption: "Altra opzione", legDefender: "Movimento difensivo", legZone: "Area di azione",
    ttZone: "Zona — trascina da un difensore per segnare la sua area di azione (3)",
    ttDefense: "Mostra / nascondi difensori",
    ttEraser: "Gomma — clicca una freccia o un giocatore (6)",
    ttBack: "Torna alle giocate", ttRename: "Rinomina la giocata",
    ttExport: "Esporta come GIF, video o PDF", ttDelete: "Elimina la giocata",
    ttDeleteStep: "Elimina il passo", ttResetAll: "Cancella tutti i passi",
    ttPrev: "Passo precedente", ttNext: "Passo successivo", ttPlay: "Riproduci / Pausa",
    ttSpeed: "Velocità di riproduzione",
    ttUndo: "Annulla (Ctrl+Z)", ttRedo: "Ripristina (Ctrl+Y / Ctrl+Maiusc+Z)",
    ttGrip: "Trascina per spostare la barra (doppio clic per ripristinare)",
    ttZoomIn: "Ingrandisci", ttZoomOut: "Riduci",
    ttZoomReset: "Ripristina lo zoom (o doppio clic sul campo)",
    ttReorder: "Trascina per riordinare",
    ttShare: "Condividi la giocata con un link",
    shareTitle: "Condividi giocata",
    shareModalMsg: "Il link apre un visualizzatore in sola lettura.",
    shareAllowEdit: "Consenti la modifica (potranno aggiungerla alle loro giocate)",
    shareGo: "Condividi", viewEdit: "Modifica",
    shareCopiedTitle: "Link copiato",
    shareCopiedMsg: "Il link è negli appunti — invialo a chi vuoi.",
    shareLinkTitle: "Link di condivisione",
    copyLink: "Copia link",
    linkCopied: "Link copiato negli appunti.",
    qrCopied: "Codice QR copiato negli appunti.",
    ttCopyQr: "Clicca per copiare il codice QR",
    sharedTitle: "Giocata condivisa",
    sharedMsg: (n) => `Aggiungere "${n}" alle tue giocate?`,
    sharedAdd: "Aggiungi",
    sharedErrMsg: "Il link non è valido.",
    sharedAddedToast: (n) => `Giocata condivisa "${n}" aggiunta alle tue giocate.`,
    sharedExistsMsg: (n) => `Hai già questa giocata — si chiama "${n}". Aggiungerla comunque?`,
    sharedAddAnyway: "Aggiungi comunque",
    exportAll: "⤓ Esporta tutto (.zip)", importAll: "⤒ Importa (.zip)",
    ttExportAll: "Scarica tutte le giocate come backup .zip",
    ttImportAll: "Importa giocate da un backup .zip",
    importDoneTitle: "Importazione completata",
    importDoneMsg: (a) => `${a} giocate importate.`,
    importedBadge: "importata",
    importErrTitle: "Importazione non riuscita",
    importErrMsg: "Il file non sembra un backup di Playbook (.zip).",
    renamedToast: (n) => `Nome già in uso — la giocata ora si chiama "${n}".`,
    orderHelp: "Questo giocatore ha due azioni — la linea più chiara avviene dopo. Doppio clic (o pressione prolungata) su una linea per farla andare prima.",
    helpTitle: "Come funziona Cejudo's Playbook",
    helpTourTitle: "Tour guidato",
    helpTourBody: "Nuovo qui o vuoi un ripasso? Rivedi il tour interattivo che ti guida nella creazione e animazione di una giocata, passo dopo passo.",
    helpTourBtn: "Riavvia il tour",
    tourSkip: "Salta il tour", tourNext: "Avanti", tourDone: "Fatto!",
    tourTexts: [
      "Benvenuto! Creiamo la tua prima giocata — clicca il pulsante evidenziato.",
      "Scegli il tipo di giocata — attacco o difesa — e se usa metà campo o il campo intero, poi premi Crea.",
      "Questo è il tuo campo. Trascina i giocatori e il pallone nelle posizioni iniziali (anche fuori dal campo).",
      "La barra degli strumenti: frecce di movimento, blocchi, passaggi e gomma. Trascina da un giocatore per il suo taglio, o usa lo strumento passaggio da qualsiasi punto. Spostala trascinando la presa.",
      "Nelle giocate difensive questo strumento evidenzia l\u2019area di azione di ogni difensore — trascina ovunque per disegnarla e trascina l\u2019area per spostarla.",
      "Quando hai disegnato le frecce, il + verde le trasforma nel passo successivo della giocata.",
      "Serve la difesa? Questo pulsante aggiunge cinque difensori (X) da posizionare e muovere come i tuoi giocatori.",
      "Premi play per vedere l'intera giocata animata, passo dopo passo.",
      "Finita? Il pulsante di salvataggio esporta la giocata come GIF animata, video o PDF passo-passo pronto da stampare.",
      "Condividi qualsiasi giocata con un link — in sola lettura per impostazione predefinita.",
      "Domande in seguito? La guida completa è dietro questo pulsante ?. Buon divertimento!",
    ],
    helpSections: [
      { h: "Giocate", b: "La schermata iniziale elenca le tue giocate: toccane una per aprirla, trascina i puntini per riordinare, usa il cestino per eliminare. Rinomina una giocata cliccando il suo nome nell'editor." },
      { h: "Giocatori e pallone", b: "Nel passo 1 trascina i giocatori ovunque (anche fuori dal campo). Il pallone appartiene sempre a un giocatore — trascinalo per darlo a un altro." },
      { h: "Strumenti di disegno", b: "Barra degli strumenti (spostala trascinando la presa): 1 seleziona, 2 freccia di movimento, 3 blocco, 4 passaggio, 5 passaggio possibile, 6 gomma. Trascina da un giocatore per il suo taglio o blocco. Con lo strumento passaggio trascina ovunque: la linea parte sempre dal pallone. Il palleggio del portatore si disegna come linea ondulata. Tasti 1–6 per cambiare strumento." },
      { h: "Modificare le frecce", b: "La maniglia rotonda curva un taglio, quella quadrata sposta la destinazione, e la barra rossa del blocco ruota con la maniglia dorata. La gomma elimina una freccia cliccandola o cliccando il suo giocatore." },
      { h: "Passaggi", b: "I passaggi si agganciano a un compagno e sono sempre rettilinei. Se il ricevitore ha un movimento, il pallone arriva alla FINE di quel movimento. Chi blocca non può mai ricevere e chi ha il pallone non può mai bloccare." },
      { h: "Due azioni, un giocatore", b: "Quando il portatore ha passaggio e movimento, la linea più chiara avviene dopo. Doppio clic (o pressione prolungata) su una linea la fa andare per prima — muoversi prima significa palleggiare fin lì prima di passare." },
      { h: "Passi", b: "Il + verde trasforma le frecce disegnate in un nuovo passo; i passi senza azioni (e l'ultimo) si eliminano dalla loro bolla-cestino. Un passo dura in base al numero di azioni sequenziali." },
      { h: "Riproduzione e zoom", b: "Usa il lettore in basso: play/pausa (Spazio), precedente/successivo (frecce), barra di avanzamento e velocità. Zoom con la rotellina, il pizzico o il controllo nell'angolo; trascina il campo per spostarti; doppio clic per ripristinare." },
      { h: "Condivisione", b: "Il pulsante di condivisione (nell\u2019editor o su ogni scheda) crea un link con la giocata dentro. Per impostazione predefinita apre un visualizzatore in sola lettura con pulsante Modifica; spunta la casella per condividere una copia modificabile. La finestra del link mostra un codice QR: cliccalo per copiarlo come immagine, o usa il pulsante per copiare il link." },
      { h: "Difensori", b: "Il pulsante con lo scudo accanto ai controlli dei passi aggiunge cinque difensori: X rosse che si posizionano e muovono come i tuoi giocatori. I difensori non disegnano mai frecce: trascinali con lo strumento di selezione per riposizionarli in qualsiasi passo, oppure usa la freccia di movimento per indicare dove si spostano durante il passo — una X tenue segna la destinazione mentre modifichi (trascinala per regolarla) e nella riproduzione scivolano semplicemente lì. Non possono fare blocchi né ricevere passaggi. Premilo di nuovo per toglierli (annulla ripristina tutto). Nelle giocate difensive lo strumento zona (3) evidenzia con un colore tenue l\u2019area di azione di ogni difensore." },
      { h: "Attacco, difesa e campi", b: "Creando una giocata scegli tipo e dimensione del campo. Le giocate difensive invertono i ruoli: i difensori disegnano le frecce rosse visibili, l\u2019attacco (attenuato) si riposiziona in silenzio e nella riproduzione prima agisce l\u2019attacco, poi reagisce la difesa. Le giocate a campo intero raddoppiano il parquet per pressing e transizione. La lista iniziale etichetta ogni giocata (A/D) e il filtro in alto mostra un tipo alla volta." },
      { h: "Blocco e organizzazione", b: "Il lucchetto nell\u2019editor rende la giocata di sola lettura finché non la sblocchi. Nella schermata iniziale ogni scheda ha pulsanti per duplicare, condividere ed eliminare, e le caselle selezionano più giocate insieme per esportarle, scaricarle in .zip, bloccarle o eliminarle." },
      { h: "Esportazione e backup", b: "Il pulsante di salvataggio esporta la giocata come GIF, video o PDF passo-passo. Nella schermata iniziale, Esporta tutto scarica ogni giocata in un .zip importabile su un altro dispositivo." },
      { h: "Annulla", b: "Ctrl+Z annulla e Ctrl+Maiusc+Z (o Ctrl+Y) ripristina qualsiasi modifica: trascinamenti, frecce, passi, rinominazioni." },
    ],
  },
  ru: {
    appTitle: "Cejudo's Playbook",
    createNew: "＋ СОЗДАТЬ КОМБИНАЦИЮ",
    stepSingular: "шаг", stepPlural: "шаг(ов)",
    back: "← Комбинации", rename: "✎ Переименовать", deletePlay: "Удалить",
    nextStep: "Следующий шаг ＋", deleteStep: "Удалить шаг", resetAll: "Сбросить всё",
    step: "Шаг", stepLower: "шаг",
    cancel: "Отмена", create: "Создать", renameConfirm: "Переименовать",
    deleteConfirm: "Удалить", resetConfirm: "Сбросить",
    newPlayTitle: "Новая комбинация", renameTitle: "Переименовать комбинацию",
    kindLabel: "Тип", kindOffense: "Нападение", kindDefense: "Защита",
    filterAll: "Все",
    courtLabel: "Площадка", courtHalf: "Половина площадки", courtFull: "Вся площадка",
    deleteTitle: "Удалить комбинацию?",
    deleteMsg: (n) => `«${n}» будет удалена навсегда.`,
    deleteSelected: (n) => `Удалить выбранные (${n})`,
    selectAll: "Выбрать все",
    searchPlays: "Поиск комбинаций…",
    sortCustom: "Свой порядок",
    sortModified: "Последнее изменение",
    sortCreated: "Дата создания",
    sortAlpha: "По алфавиту",
    createdLabel: "Создана",
    modifiedLabel: "Изменена",
    noResults: "По вашему запросу ничего не найдено.",
    deleteSelTitle: "Удалить выбранные комбинации?",
    deleteAllBtn: "Удалить все комбинации",
    deleteAllTitle: "Удалить ВСЕ комбинации?",
    ttLock: "Заблокировать комбинацию (запретить изменения)",
    ttUnlock: "Разблокировать комбинацию",
    unlockTitle: "Разблокировать комбинацию?",
    unlockMsg: "Комбинацию снова можно будет редактировать.",
    bulkUnlockMsg: (n) => n === 1 ? "Выбранную комбинацию снова можно будет редактировать." : `Выбранные комбинации (${n}) снова можно будет редактировать.`,
    unlockConfirm: "Разблокировать",
    ttBulkLock: "Заблокировать выбранные комбинации",
    ttBulkUnlock: "Разблокировать выбранные комбинации",
    ttBulkSave: "Экспортировать выбранные как GIF, видео или PDF",
    ttBulkZip: "Скачать выбранные как резервную копию .zip",
    ttDuplicate: "Дублировать комбинацию",
    duplicatedToast: (n) => `Создана копия: «${n}».`,
    deleteAllMsg: (n) => `Все комбинации (${n}) будут удалены навсегда. Это нельзя отменить.`,
    deleteSelMsg: (n) => n === 1 ? "Выбранная комбинация будет удалена навсегда." : `Выбранные комбинации (${n}) будут удалены навсегда.`,
    undoDeleteMsg: (n) => n === 1 ? "Комбинация удалена — нажмите здесь, чтобы отменить." : `Удалено комбинаций: ${n} — нажмите здесь, чтобы отменить.`,
    resetTitle: "Сбросить комбинацию?",
    resetMsg: "Все шаги и стрелки будут удалены. Начальные позиции шага 1 сохранятся.",
    untitled: "Без названия", playDefault: "Комбинация",
    exportTitle: "Экспорт комбинации", formatLabel: "Формат",
    fmtGif: "GIF-анимация", fmtVideo: "Видео (MP4 / WebM)", fmtPdf: "PDF — все шаги",
    moveDur: "Длительность движения (секунды)", pauseDur: "Пауза между шагами (секунды)",
    exportGo: "Экспорт",
    renderingFrames: (a, b) => `Отрисовка кадров… ${a}/${b}`,
    encodingGif: (p) => `Кодирование GIF… ${p}%`,
    recording: (a, b) => `Запись… ${a}с / ${b}с (реальное время)`,
    renderingPage: (a, b) => `Отрисовка страницы ${a}/${b}…`,
    exportDone: "Готово — файл скачан.",
    exportFailed: "Ошибка экспорта: ",
    noVideo: "Этот браузер не поддерживает запись видео.",
    noVideoFormat: "Поддерживаемый формат видео не найден.",
    pdfStepLabel: (i, n) => `Шаг ${i} из ${n}`,
    handleEnd: "Перетащите, чтобы изменить точку назначения",
    handleMid: "Перетащите, чтобы изогнуть стрелку",
    handleRot: "Перетащите, чтобы повернуть заслон",
    ttSelect: "Выбор / перемещение игроков (1) — только на шаге 1",
    ttArrow: "Стрелка движения — тяните от игрока (2)",
    ttScreen: "Заслон — тяните от ставящего заслон (3)",
    ttPass: "Передача — тяните в любом месте площадки; линия идёт от мяча (4)",
    ttMaybePass: "Возможная передача — первая нарисованная — главный вариант (зелёная), остальные синие (5)",
    ttMaybeToggle: "Анимировать возможные передачи",
    ttTokenSize: "Размер игроков",
    ttMaybeShow: "Показывать возможные передачи",
    legCut: "Движение", legDribble: "Ведение", legScreen: "Заслон", legPass: "Передача",
    legMain: "Основной вариант", legOption: "Другой вариант", legDefender: "Движение защитника", legZone: "Зона действий",
    ttZone: "Зона — тяните от защитника, чтобы обозначить его зону действий (3)",
    ttDefense: "Показать / скрыть защитников",
    ttEraser: "Ластик — нажмите на стрелку или игрока (6)",
    ttBack: "Ко всем комбинациям", ttRename: "Переименовать комбинацию",
    ttExport: "Экспорт в GIF, видео или PDF", ttDelete: "Удалить комбинацию",
    ttDeleteStep: "Удалить шаг", ttResetAll: "Очистить все шаги",
    ttPrev: "Предыдущий шаг", ttNext: "Следующий шаг", ttPlay: "Пуск / Пауза",
    ttSpeed: "Скорость воспроизведения",
    ttUndo: "Отменить (Ctrl+Z)", ttRedo: "Повторить (Ctrl+Y / Ctrl+Shift+Z)",
    ttGrip: "Перетащите, чтобы переместить панель (двойной щелчок — сброс)",
    ttZoomIn: "Приблизить", ttZoomOut: "Отдалить",
    ttZoomReset: "Сбросить масштаб (или двойной щелчок по площадке)",
    ttReorder: "Перетащите, чтобы изменить порядок",
    ttShare: "Поделиться комбинацией по ссылке",
    shareTitle: "Поделиться комбинацией",
    shareModalMsg: "Ссылка открывает просмотр без возможности редактирования.",
    shareAllowEdit: "Разрешить редактирование (смогут добавить к своим комбинациям)",
    shareGo: "Поделиться", viewEdit: "Редактировать",
    shareCopiedTitle: "Ссылка скопирована",
    shareCopiedMsg: "Ссылка в буфере обмена — отправьте её кому угодно.",
    shareLinkTitle: "Ссылка для отправки",
    copyLink: "Копировать ссылку",
    linkCopied: "Ссылка скопирована в буфер обмена.",
    qrCopied: "QR-код скопирован в буфер обмена.",
    ttCopyQr: "Нажмите, чтобы скопировать QR-код",
    sharedTitle: "Комбинация из ссылки",
    sharedMsg: (n) => `Добавить «${n}» к вашим комбинациям?`,
    sharedAdd: "Добавить",
    sharedErrMsg: "Ссылка недействительна.",
    sharedAddedToast: (n) => `Комбинация «${n}» добавлена.`,
    sharedExistsMsg: (n) => `У вас уже есть эта комбинация — «${n}». Всё равно добавить?`,
    sharedAddAnyway: "Всё равно добавить",
    exportAll: "⤓ Экспорт всего (.zip)", importAll: "⤒ Импорт (.zip)",
    ttExportAll: "Скачать все комбинации как резервную копию .zip",
    ttImportAll: "Импортировать комбинации из .zip",
    importDoneTitle: "Импорт завершён",
    importDoneMsg: (a) => `Импортировано комбинаций: ${a}.`,
    importedBadge: "импорт",
    importErrTitle: "Ошибка импорта",
    importErrMsg: "Файл не похож на резервную копию Playbook (.zip).",
    renamedToast: (n) => `Имя уже занято — комбинация теперь называется «${n}».`,
    orderHelp: "У этого игрока два действия — более бледная линия происходит второй. Двойной щелчок (или долгое нажатие) по линии делает её первой.",
    helpTitle: "Как работает Cejudo's Playbook",
    helpTourTitle: "Интерактивный тур",
    helpTourBody: "Впервые здесь или хотите освежить память? Пройдите тур ещё раз — он показывает, как создать и оживить комбинацию.",
    helpTourBtn: "Запустить тур заново",
    tourSkip: "Пропустить тур", tourNext: "Далее", tourDone: "Готово!",
    tourTexts: [
      "Добро пожаловать! Создадим вашу первую комбинацию — нажмите подсвеченную кнопку.",
      "Выберите тип комбинации — нападение или защита — и половину или всю площадку, затем нажмите «Создать».",
      "Это ваша площадка. Перетащите игроков и мяч на начальные позиции (можно и за пределы площадки).",
      "Панель инструментов: стрелки движения, заслоны, передачи и ластик. Тяните от игрока, чтобы нарисовать рывок, или используйте инструмент передачи из любой точки. Панель можно перетащить за захват.",
      "В защитных комбинациях этот инструмент выделяет зону ответственности каждого защитника — тяните в любом месте площадки, чтобы нарисовать её, и перетаскивайте зону, чтобы сдвинуть.",
      "Когда стрелки нарисованы, зелёный + превращает их в следующий шаг комбинации.",
      "Нужна защита? Эта кнопка добавляет пятерых защитников (X), которых можно расставлять и двигать, как своих игроков.",
      "Нажмите play — вся комбинация оживёт, шаг за шагом.",
      "Готово? Кнопка сохранения экспортирует комбинацию как анимированный GIF, видео или пошаговый PDF для печати.",
      "Делитесь комбинацией по ссылке — по умолчанию только для просмотра.",
      "Появятся вопросы? Полное руководство — за этой кнопкой ?. Удачной игры!",
    ],
    helpSections: [
      { h: "Комбинации", b: "На главном экране — список ваших комбинаций: нажмите, чтобы открыть, перетащите за точки для изменения порядка, корзина удаляет. Переименовать можно, щёлкнув по названию в редакторе." },
      { h: "Игроки и мяч", b: "На шаге 1 перетаскивайте игроков куда угодно (в том числе за пределы площадки). Мяч всегда принадлежит игроку — перетащите его, чтобы передать другому." },
      { h: "Инструменты", b: "Панель (перемещается за захват): 1 выбор, 2 стрелка движения, 3 заслон, 4 передача, 5 возможная передача, 6 ластик. Тяните от игрока для рывка или заслона. С инструментом передачи тяните где угодно — линия всегда идёт от мяча. Ведение мяча рисуется волнистой линией. Клавиши 1–6 переключают инструменты." },
      { h: "Редактирование стрелок", b: "Круглая ручка изгибает рывок, квадратная переносит его конец, а красная планка заслона поворачивается золотой ручкой. Ластик удаляет стрелку щелчком по ней или по игроку." },
      { h: "Передачи", b: "Передачи «прилипают» к партнёру и всегда прямые. Если у получателя есть движение, мяч приходит в КОНЕЦ этого движения. Ставящий заслон не может получать мяч, а владеющий мячом — ставить заслон." },
      { h: "Два действия у игрока", b: "Если у владеющего мячом есть передача и движение, бледная линия происходит второй. Двойной щелчок (или долгое нажатие) делает линию первой — сначала двигаться значит вести мяч туда перед передачей." },
      { h: "Шаги", b: "Зелёный + превращает нарисованные стрелки в новый шаг; шаги без действий (и последний) удаляются через пузырёк-корзину. Длительность шага зависит от числа последовательных действий." },
      { h: "Воспроизведение и масштаб", b: "Нижний плеер: пуск/пауза (Пробел), предыдущий/следующий (стрелки), прокрутка и скорость. Масштаб — колесо, щипок или элемент в углу; перетаскивайте площадку для перемещения; двойной щелчок — сброс." },
      { h: "Обмен", b: "Кнопка «поделиться» (в редакторе или на карточке) создаёт ссылку, содержащую комбинацию. По умолчанию она открывает просмотр с кнопкой «Редактировать»; отметьте флажок, чтобы поделиться редактируемой копией. В окне ссылки есть QR-код — нажмите на него, чтобы скопировать как картинку, или скопируйте ссылку кнопкой." },
      { h: "Защитники", b: "Кнопка со щитом рядом с управлением шагами добавляет пятерых защитников — красные метки X, которые расставляются и двигаются так же, как ваши игроки. Защитники никогда не рисуют стрелок: перетаскивайте их инструментом выбора на любом шаге либо инструментом стрелки укажите, куда они смещаются в течение шага — при редактировании цель отмечает бледный X (его можно перетащить), а при воспроизведении они просто плавно скользят туда. Они не ставят заслоны и не получают передачи. Нажмите ещё раз, чтобы убрать их (отмена всё вернёт). В защитных комбинациях инструмент зоны (3) мягким цветом выделяет зону ответственности каждого защитника." },
      { h: "Нападение, защита и площадки", b: "При создании комбинации вы выбираете её тип и размер площадки. В защитных комбинациях роли меняются: защитники рисуют видимые красные стрелки, приглушённое нападение переставляется без стрелок, а при воспроизведении сначала действует нападение и лишь затем реагирует защита. Комбинации на всю площадку удваивают паркет — для прессинга и перехода. Список на главном экране помечает каждую комбинацию (Н/З), а фильтр сверху показывает один тип за раз." },
      { h: "Блокировка и порядок", b: "Замок в редакторе делает комбинацию доступной только для чтения, пока вы её не разблокируете. На главном экране у каждой карточки есть кнопки дублирования, отправки и удаления, а флажки выбирают несколько комбинаций сразу — их можно вместе экспортировать, скачать в .zip, заблокировать или удалить." },
      { h: "Экспорт и резервные копии", b: "Кнопка сохранения экспортирует комбинацию в GIF, видео или пошаговый PDF. На главном экране «Экспорт всего» скачивает все комбинации в .zip для переноса на другое устройство." },
      { h: "Отмена", b: "Ctrl+Z отменяет, Ctrl+Shift+Z (или Ctrl+Y) повторяет любое действие: перетаскивания, стрелки, шаги, переименования." },
    ],
  },
  zh: {
    appTitle: "Cejudo's Playbook",
    createNew: "＋ 创建战术",
    stepSingular: "步", stepPlural: "步",
    back: "← 战术列表", rename: "✎ 重命名", deletePlay: "删除",
    nextStep: "下一步 ＋", deleteStep: "删除此步", resetAll: "全部重置",
    step: "第", stepLower: "步骤",
    cancel: "取消", create: "创建", renameConfirm: "重命名",
    deleteConfirm: "删除", resetConfirm: "重置",
    newPlayTitle: "新战术", renameTitle: "重命名战术",
    kindLabel: "类型", kindOffense: "进攻", kindDefense: "防守",
    filterAll: "全部",
    courtLabel: "场地", courtHalf: "半场", courtFull: "全场",
    deleteTitle: "删除战术？",
    deleteMsg: (n) => `“${n}”将被永久删除。`,
    deleteSelected: (n) => `删除所选（${n}）`,
    selectAll: "全选",
    searchPlays: "搜索战术…",
    sortCustom: "自定义顺序",
    sortModified: "最近修改",
    sortCreated: "创建时间",
    sortAlpha: "按名称",
    createdLabel: "创建",
    modifiedLabel: "修改",
    noResults: "没有符合搜索的战术。",
    deleteSelTitle: "删除所选战术？",
    deleteAllBtn: "删除全部战术",
    deleteAllTitle: "删除全部战术？",
    ttLock: "锁定战术（禁止编辑）",
    ttUnlock: "解锁战术",
    unlockTitle: "解锁战术？",
    unlockMsg: "该战术将恢复可编辑状态。",
    bulkUnlockMsg: (n) => `选中的 ${n} 套战术将恢复可编辑状态。`,
    unlockConfirm: "解锁",
    ttBulkLock: "锁定所选战术",
    ttBulkUnlock: "解锁所选战术",
    ttBulkSave: "将所选导出为 GIF、视频或 PDF",
    ttBulkZip: "将所选下载为 .zip 备份",
    ttDuplicate: "复制战术",
    duplicatedToast: (n) => `已创建副本："${n}"。`,
    deleteAllMsg: (n) => `全部 ${n} 套战术将被永久删除，且无法撤销。`,
    deleteSelMsg: (n) => `选中的 ${n} 套战术将被永久删除。`,
    undoDeleteMsg: (n) => n === 1 ? "战术已删除 — 点击此处撤销。" : `已删除 ${n} 套战术 — 点击此处撤销。`,
    resetTitle: "重置战术？",
    resetMsg: "所有步骤和箭头将被删除，仅保留第 1 步的初始位置。",
    untitled: "未命名战术", playDefault: "战术",
    exportTitle: "导出战术", formatLabel: "格式",
    fmtGif: "GIF 动画", fmtVideo: "视频（MP4 / WebM）", fmtPdf: "PDF — 全部步骤",
    moveDur: "移动时长（秒）", pauseDur: "步骤间停顿（秒）",
    exportGo: "导出",
    renderingFrames: (a, b) => `正在渲染帧… ${a}/${b}`,
    encodingGif: (p) => `正在编码 GIF… ${p}%`,
    recording: (a, b) => `录制中… ${a}秒 / ${b}秒（实时）`,
    renderingPage: (a, b) => `正在渲染第 ${a}/${b} 页…`,
    exportDone: "完成 — 文件已下载。",
    exportFailed: "导出失败：",
    noVideo: "此浏览器不支持视频录制。",
    noVideoFormat: "未找到支持的视频格式。",
    pdfStepLabel: (i, n) => `第 ${i} 步，共 ${n} 步`,
    handleEnd: "拖动以更改终点",
    handleMid: "拖动以弯曲箭头",
    handleRot: "拖动以旋转掩护",
    ttSelect: "选择 / 移动球员（1）— 仅限第 1 步",
    ttArrow: "移动箭头 — 从球员拖出（2）",
    ttScreen: "掩护 — 从掩护者拖出（3）",
    ttPass: "传球 — 在球场任意位置拖动；虚线自动从球出发（4）",
    ttMaybePass: "潜在传球 — 最先画的是主要选项（绿色），其余为蓝色（5）",
    ttMaybeToggle: "播放潜在传球动画",
    ttTokenSize: "球员大小",
    ttMaybeShow: "显示潜在传球",
    legCut: "移动", legDribble: "运球", legScreen: "掩护", legPass: "传球",
    legMain: "主要传球选项", legOption: "其他选项", legDefender: "防守移动", legZone: "负责区域",
    ttZone: "区域 — 从防守球员拖出以标记其负责区域（3）",
    ttDefense: "显示 / 隐藏防守球员",
    ttEraser: "橡皮擦 — 点击箭头或球员（6）",
    ttBack: "返回全部战术", ttRename: "重命名战术",
    ttExport: "导出为 GIF、视频或 PDF", ttDelete: "删除战术",
    ttDeleteStep: "删除此步", ttResetAll: "清除所有步骤",
    ttPrev: "上一步", ttNext: "下一步", ttPlay: "播放 / 暂停",
    ttSpeed: "播放速度",
    ttUndo: "撤销（Ctrl+Z）", ttRedo: "重做（Ctrl+Y / Ctrl+Shift+Z）",
    ttGrip: "拖动以移动工具栏（双击复位）",
    ttZoomIn: "放大", ttZoomOut: "缩小",
    ttZoomReset: "重置缩放（或双击球场）",
    ttReorder: "拖动以排序",
    ttShare: "通过链接分享战术",
    shareTitle: "分享战术",
    shareModalMsg: "链接会打开只读播放器。",
    shareAllowEdit: "允许编辑（对方可将其加入自己的战术）",
    shareGo: "分享", viewEdit: "编辑",
    shareCopiedTitle: "链接已复制",
    shareCopiedMsg: "分享链接已复制到剪贴板 — 发给任何人吧。",
    shareLinkTitle: "分享链接",
    copyLink: "复制链接",
    linkCopied: "链接已复制到剪贴板。",
    qrCopied: "二维码已复制到剪贴板。",
    ttCopyQr: "点击复制二维码",
    sharedTitle: "收到的战术",
    sharedMsg: (n) => `将“${n}”加入你的战术？`,
    sharedAdd: "添加",
    sharedErrMsg: "此链接无效。",
    sharedAddedToast: (n) => `已添加战术“${n}”。`,
    sharedExistsMsg: (n) => `你已拥有这套战术 — 名为“${n}”。仍要添加吗？`,
    sharedAddAnyway: "仍然添加",
    exportAll: "⤓ 导出全部（.zip）", importAll: "⤒ 导入（.zip）",
    ttExportAll: "将所有战术下载为 .zip 备份",
    ttImportAll: "从 .zip 备份导入战术",
    importDoneTitle: "导入完成",
    importDoneMsg: (a) => `已导入 ${a} 套战术。`,
    importedBadge: "已导入",
    importErrTitle: "导入失败",
    importErrMsg: "该文件不是有效的 Playbook 备份（.zip）。",
    renamedToast: (n) => `名称已被占用 — 此战术现名为“${n}”。`,
    orderHelp: "该球员有两个动作 — 较浅的线后发生。双击（或长按）某条线可让它先执行。",
    helpTitle: "Cejudo's Playbook 使用说明",
    helpTourTitle: "引导教程",
    helpTourBody: "初来乍到或想复习一下？重新播放交互式教程，学习如何创建并演示战术。",
    helpTourBtn: "重新开始教程",
    tourSkip: "跳过教程", tourNext: "下一步", tourDone: "完成！",
    tourTexts: [
      "欢迎！让我们创建你的第一套战术 — 点击高亮按钮。",
      "选择战术类型——进攻或防守——以及使用半场还是全场，然后点击创建。",
      "这是你的球场。将球员和球拖到初始位置（也可以放在场外）。",
      "工具栏：移动箭头、掩护、传球和橡皮擦。从球员拖出画切入路线，或用传球工具在任意位置传球。拖动手柄可移动工具栏。",
      "在防守战术中，此工具会标出每名防守球员的负责区域——在球场任意位置拖动即可绘制，拖动区域可移动它。",
      "画好箭头后，绿色 + 会把它们变成战术的下一步。",
      "需要防守？此按钮会添加五名防守球员（X），可以像己方球员一样放置和移动。",
      "按播放键，整套战术将逐步动起来。",
      "完成了？保存按钮可将战术导出为 GIF 动画、视频或可打印的分步 PDF。",
      "任何战术都能以链接分享 — 默认只读。",
      "以后有疑问？完整指南就在这个 ? 按钮里。祝使用愉快！",
    ],
    helpSections: [
      { h: "战术", b: "主屏幕列出你的战术：点按打开，拖动圆点排序，垃圾桶删除。在编辑器中点击名称即可重命名。" },
      { h: "球员与球", b: "在第 1 步可将球员拖到任意位置（包括场外）。球始终属于某位球员 — 拖动球即可交给他人。" },
      { h: "绘图工具", b: "工具栏（拖动手柄可移动）：1 选择，2 移动箭头，3 掩护，4 传球，5 潜在传球，6 橡皮擦。从球员拖出画切入或掩护。使用传球工具时在任意位置拖动，虚线自动从球出发。持球人的运球以波浪线表示。按键 1–6 切换工具。" },
      { h: "编辑箭头", b: "圆形手柄弯曲路线，方形手柄移动终点，掩护的红色横杆用金色手柄旋转。橡皮擦点击箭头或球员即可删除。" },
      { h: "传球", b: "传球会吸附到队友且始终为直线。若接球者有移动，球会送到该移动的终点。掩护者不能接球，持球者不能掩护。" },
      { h: "一名球员两个动作", b: "当持球者既传球又移动时，较浅的线后发生。双击（或长按）某条线让它先执行 — 先移动即运球到位后再传。" },
      { h: "步骤", b: "绿色 + 将画好的箭头变成新步骤；无动作的步骤（及最后一步）可通过垃圾桶气泡删除。步骤时长取决于其顺序动作数量。" },
      { h: "播放与缩放", b: "底部播放器：播放/暂停（空格）、上一步/下一步（方向键）、进度条和速度。滚轮、捏合或角落控件缩放；拖动球场平移；双击复位。" },
      { h: "分享", b: "分享按钮（编辑器中或每张卡片上）生成包含战术的链接。默认打开带“编辑”按钮的只读播放器；勾选复选框则直接分享可编辑副本。链接窗口会显示二维码——点击可将其复制为图片，或用按钮复制链接。" },
      { h: "防守球员", b: "步骤控制旁的盾牌按钮会添加五名防守球员——红色 X 标记，可像己方球员一样放置和移动。防守球员从不画箭头：用选择工具在任意步骤拖动它们重新定位，或用移动箭头工具指定他们在该步骤中的移动目标——编辑时淡淡的 X 标出目的地（可拖动调整），回放时他们会平滑滑过去。防守球员不能掩护也不能接球。再次点击可移除（撤销可恢复全部）。在防守战术中，区域工具（3）会用柔和的颜色标出每名防守球员的负责区域。" },
      { h: "进攻、防守与场地", b: "创建战术时可选择类型和场地大小。防守战术会互换角色：防守球员绘制可见的红色箭头，进攻方（淡化显示）静默重新定位，回放时先进攻后防守依次进行。全场战术将场地加倍，适合紧逼和攻防转换。主屏幕列表为每套战术加上标签（进/防），上方的筛选器可按类型查看。" },
      { h: "锁定与整理", b: "编辑器中的挂锁可将战术设为只读，直到再次解锁。主屏幕上每张卡片都有复制、分享和删除按钮，勾选复选框可同时选择多套战术，一起导出、打包下载 .zip、锁定或删除。" },
      { h: "导出与备份", b: "保存按钮可将战术导出为 GIF、视频或分步 PDF。主屏幕的“导出全部”会把所有战术打包成 .zip，可在其他设备导入。" },
      { h: "撤销", b: "Ctrl+Z 撤销，Ctrl+Shift+Z（或 Ctrl+Y）重做任何编辑：拖动、箭头、步骤、重命名。" },
    ],
  },
  sr: {
    appTitle: "Cejudo's Playbook",
    createNew: "＋ NAPRAVI AKCIJU",
    stepSingular: "korak", stepPlural: "koraka",
    back: "← Akcije", rename: "✎ Preimenuj", deletePlay: "Obriši",
    nextStep: "Sledeći korak ＋", deleteStep: "Obriši korak", resetAll: "Resetuj sve",
    step: "Korak", stepLower: "korak",
    cancel: "Otkaži", create: "Napravi", renameConfirm: "Preimenuj",
    deleteConfirm: "Obriši", resetConfirm: "Resetuj",
    newPlayTitle: "Nova akcija", renameTitle: "Preimenuj akciju",
    kindLabel: "Tip", kindOffense: "Napad", kindDefense: "Odbrana",
    filterAll: "Sve",
    courtLabel: "Teren", courtHalf: "Pola terena", courtFull: "Ceo teren",
    deleteTitle: "Obrisati akciju?",
    deleteMsg: (n) => `„${n}" će biti trajno obrisana.`,
    deleteSelected: (n) => `Obriši izabrane (${n})`,
    selectAll: "Izaberi sve",
    searchPlays: "Pretraži akcije…",
    sortCustom: "Prilagođeni redosled",
    sortModified: "Poslednja izmena",
    sortCreated: "Datum kreiranja",
    sortAlpha: "Abecedno",
    createdLabel: "Kreirana",
    modifiedLabel: "Izmenjena",
    noResults: "Nijedna akcija ne odgovara pretrazi.",
    deleteSelTitle: "Obrisati izabrane akcije?",
    deleteAllBtn: "Obriši sve akcije",
    deleteAllTitle: "Obrisati SVE akcije?",
    ttLock: "Zaključaj akciju (sprečava izmene)",
    ttUnlock: "Otključaj akciju",
    unlockTitle: "Otključati akciju?",
    unlockMsg: "Akcija će ponovo moći da se menja.",
    bulkUnlockMsg: (n) => n === 1 ? "Izabrana akcija će ponovo moći da se menja." : `Izabrane akcije (${n}) će ponovo moći da se menjaju.`,
    unlockConfirm: "Otključaj",
    ttBulkLock: "Zaključaj izabrane akcije",
    ttBulkUnlock: "Otključaj izabrane akcije",
    ttBulkSave: "Izvezi izabrane kao GIF, video ili PDF",
    ttBulkZip: "Preuzmi izabrane kao .zip rezervnu kopiju",
    ttDuplicate: "Dupliraj akciju",
    duplicatedToast: (n) => `Kopija napravljena: „${n}".`,
    deleteAllMsg: (n) => `Svih ${n} akcija biće trajno obrisano. Ovo se ne može poništiti.`,
    deleteSelMsg: (n) => n === 1 ? "Izabrana akcija biće trajno obrisana." : `Izabrane akcije (${n}) biće trajno obrisane.`,
    undoDeleteMsg: (n) => n === 1 ? "Akcija obrisana — dodirni ovde da poništiš." : `Obrisano akcija: ${n} — dodirni ovde da poništiš.`,
    resetTitle: "Resetovati akciju?",
    resetMsg: "Svi koraci i strelice biće uklonjeni. Početne pozicije koraka 1 se zadržavaju.",
    untitled: "Akcija bez imena", playDefault: "Akcija",
    exportTitle: "Izvezi akciju", formatLabel: "Format",
    fmtGif: "GIF animacija", fmtVideo: "Video (MP4 / WebM)", fmtPdf: "PDF — svi koraci",
    moveDur: "Trajanje kretanja (sekunde)", pauseDur: "Pauza između koraka (sekunde)",
    exportGo: "Izvezi",
    renderingFrames: (a, b) => `Renderovanje kadrova… ${a}/${b}`,
    encodingGif: (p) => `Kodiranje GIF-a… ${p}%`,
    recording: (a, b) => `Snimanje… ${a}s / ${b}s (realno vreme)`,
    renderingPage: (a, b) => `Renderovanje strane ${a}/${b}…`,
    exportDone: "Gotovo — fajl je preuzet.",
    exportFailed: "Izvoz nije uspeo: ",
    noVideo: "Ovaj pregledač ne podržava snimanje videa.",
    noVideoFormat: "Nije pronađen podržan video format.",
    pdfStepLabel: (i, n) => `Korak ${i} od ${n}`,
    handleEnd: "Prevuci da promeniš odredište",
    handleMid: "Prevuci da zakriviš strelicu",
    handleRot: "Prevuci da rotiraš blok",
    ttSelect: "Izaberi / pomeri igrače (1) — samo u koraku 1",
    ttArrow: "Strelica kretanja — prevuci od igrača (2)",
    ttScreen: "Blok — prevuci od igrača koji blokira (3)",
    ttPass: "Dodavanje — prevuci bilo gde na terenu; linija kreće od lopte (4)",
    ttMaybePass: "Mogući pas — prvi nacrtani je glavna opcija (zelena), ostali su plavi (5)",
    ttMaybeToggle: "Animiraj moguće pasove",
    ttTokenSize: "Veličina igrača",
    ttMaybeShow: "Prikaži moguće pasove",
    legCut: "Kretanje", legDribble: "Dribling", legScreen: "Blok", legPass: "Pas",
    legMain: "Glavna opcija pasa", legOption: "Druga opcija", legDefender: "Kretanje odbrane", legZone: "Zona delovanja",
    ttZone: "Zona — prevuci od odbrambenog igrača da označiš njegovu zonu (3)",
    ttDefense: "Prikaži / sakrij odbranu",
    ttEraser: "Gumica — klikni strelicu ili igrača (6)",
    ttBack: "Nazad na akcije", ttRename: "Preimenuj akciju",
    ttExport: "Izvezi kao GIF, video ili PDF", ttDelete: "Obriši akciju",
    ttDeleteStep: "Obriši korak", ttResetAll: "Obriši sve korake",
    ttPrev: "Prethodni korak", ttNext: "Sledeći korak", ttPlay: "Pusti / Pauza",
    ttSpeed: "Brzina reprodukcije",
    ttUndo: "Poništi (Ctrl+Z)", ttRedo: "Ponovi (Ctrl+Y / Ctrl+Shift+Z)",
    ttGrip: "Prevuci da pomeriš traku (dupli klik za reset)",
    ttZoomIn: "Uvećaj", ttZoomOut: "Umanji",
    ttZoomReset: "Resetuj zum (ili dupli klik na teren)",
    ttReorder: "Prevuci da promeniš redosled",
    ttShare: "Podeli akciju linkom",
    shareTitle: "Podeli akciju",
    shareModalMsg: "Link otvara plejer samo za gledanje.",
    shareAllowEdit: "Dozvoli izmene (moći će da je dodaju u svoje akcije)",
    shareGo: "Podeli", viewEdit: "Izmeni",
    shareCopiedTitle: "Link kopiran",
    shareCopiedMsg: "Link je u ostavi — pošalji ga kome želiš.",
    shareLinkTitle: "Link za deljenje",
    copyLink: "Kopiraj link",
    linkCopied: "Link je kopiran u ostavu.",
    qrCopied: "QR kod je kopiran u ostavu.",
    ttCopyQr: "Klikni da kopiraš QR kod",
    sharedTitle: "Podeljena akcija",
    sharedMsg: (n) => `Dodati „${n}" u tvoje akcije?`,
    sharedAdd: "Dodaj",
    sharedErrMsg: "Ovaj link nije važeći.",
    sharedAddedToast: (n) => `Podeljena akcija „${n}" je dodata.`,
    sharedExistsMsg: (n) => `Već imaš ovu akciju — zove se „${n}". Ipak dodati?`,
    sharedAddAnyway: "Ipak dodaj",
    exportAll: "⤓ Izvezi sve (.zip)", importAll: "⤒ Uvezi (.zip)",
    ttExportAll: "Preuzmi sve akcije kao .zip rezervnu kopiju",
    ttImportAll: "Uvezi akcije iz .zip rezervne kopije",
    importDoneTitle: "Uvoz završen",
    importDoneMsg: (a) => `Uvezeno akcija: ${a}.`,
    importedBadge: "uvezena",
    importErrTitle: "Uvoz nije uspeo",
    importErrMsg: "Fajl ne izgleda kao Playbook rezervna kopija (.zip).",
    renamedToast: (n) => `To ime je zauzeto — akcija se sada zove „${n}".`,
    orderHelp: "Ovaj igrač ima dve radnje — svetlija linija se dešava druga. Dupli klik (ili duži pritisak) na liniju stavlja je na prvo mesto.",
    helpTitle: "Kako radi Cejudo's Playbook",
    helpTourTitle: "Vodič kroz aplikaciju",
    helpTourBody: "Nov si ovde ili želiš podsetnik? Ponovo pusti interaktivni vodič koji te vodi kroz pravljenje i animiranje akcije.",
    helpTourBtn: "Ponovo pokreni vodič",
    tourSkip: "Preskoči vodič", tourNext: "Dalje", tourDone: "Gotovo!",
    tourTexts: [
      "Dobro došao! Napravimo tvoju prvu akciju — klikni istaknuto dugme.",
      "Izaberi kakva je akcija — napad ili odbrana — i da li koristi pola ili ceo teren, pa pritisni Napravi.",
      "Ovo je tvoj teren. Prevuci igrače i loptu na početne pozicije (može i van terena).",
      "Traka sa alatima: strelice kretanja, blokovi, dodavanja i gumica. Prevuci od igrača da nacrtaš utrčavanje, ili koristi alat za dodavanje sa bilo kog mesta. Pomeri traku prevlačenjem držača.",
      "U odbrambenim akcijama ovaj alat boji zonu delovanja svakog odbrambenog igrača — prevuci bilo gde da je nacrtaš i prevuci zonu da je pomeriš.",
      "Kada nacrtaš strelice, zeleni + ih pretvara u sledeći korak akcije.",
      "Treba ti odbrana? Ovo dugme dodaje pet odbrambenih igrača (X) koje postavljaš i pomeraš kao svoje igrače.",
      "Pritisni plej i cela akcija oživi, korak po korak.",
      "Gotovo? Dugme za čuvanje izvozi akciju kao animirani GIF, video ili PDF korak-po-korak spreman za štampu.",
      "Podeli bilo koju akciju linkom — podrazumevano samo za gledanje.",
      "Pitanja kasnije? Kompletan vodič je iza ovog ? dugmeta. Uživaj!",
    ],
    helpSections: [
      { h: "Akcije", b: "Početni ekran prikazuje tvoje akcije: dodirni jednu da je otvoriš, prevuci tačkice za redosled, kanta briše. Preimenuj klikom na ime u editoru." },
      { h: "Igrači i lopta", b: "U koraku 1 prevlači igrače bilo gde (i van terena). Lopta uvek pripada igraču — prevuci je da je daš drugom." },
      { h: "Alati za crtanje", b: "Traka (pomeraš je za držač): 1 izbor, 2 strelica kretanja, 3 blok, 4 dodavanje, 5 mogući pas, 6 gumica. Prevuci od igrača za utrčavanje ili blok. Sa alatom za dodavanje prevuci bilo gde — linija uvek kreće od lopte. Dribling igrača s loptom crta se talasastom linijom. Tasteri 1–6 menjaju alate." },
      { h: "Izmena strelica", b: "Okrugla ručica krivi liniju, kvadratna pomera cilj, a crvena prečka bloka rotira se zlatnom ručicom. Gumica briše strelicu klikom na nju ili na igrača." },
      { h: "Dodavanja", b: "Dodavanja se lepe za saigrača i uvek su prava. Ako primalac ima kretanje, lopta stiže na KRAJ tog kretanja. Bloker nikad ne prima loptu, a igrač s loptom nikad ne blokira." },
      { h: "Dve radnje, jedan igrač", b: "Kad igrač s loptom ima i dodavanje i kretanje, svetlija linija se dešava druga. Dupli klik (ili duži pritisak) stavlja liniju na prvo mesto — prvo kretanje znači driblanje do tamo pre dodavanja." },
      { h: "Koraci", b: "Zeleni + pretvara nacrtane strelice u novi korak; koraci bez radnji (i poslednji) brišu se preko svoje kantice. Korak traje prema broju uzastopnih radnji." },
      { h: "Reprodukcija i zum", b: "Donji plejer: plej/pauza (Space), prethodni/sledeći (strelice), traka i brzina. Zum točkićem, štipanjem ili kontrolom u uglu; prevuci teren za pomeranje; dupli klik za reset." },
      { h: "Deljenje", b: "Dugme za deljenje (u editoru ili na svakoj kartici) pravi link koji sadrži akciju. Podrazumevano otvara plejer samo za gledanje sa dugmetom Izmeni; štikliraj kućicu za deljenje kopije koja se može menjati. Prozor sa linkom prikazuje QR kod — klikni ga da ga kopiraš kao sliku, ili kopiraj link dugmetom." },
      { h: "Odbrana", b: "Dugme sa štitom pored kontrola koraka dodaje pet odbrambenih igrača — crvene X oznake koje se postavljaju i pomeraju kao tvoji igrači. Odbrana nikada ne crta strelice: prevlači ih alatom za izbor u bilo kom koraku, ili alatom za strelicu odredi kuda se pomeraju tokom koraka — bledi X označava odredište dok uređuješ (prevuci ga da ga podesiš), a pri reprodukciji jednostavno klize tamo. Ne mogu da blokiraju niti primaju dodavanja. Pritisni ponovo da ih ukloniš (poništavanje sve vraća). U odbrambenim akcijama alat za zonu (3) blago boji zonu delovanja svakog odbrambenog igrača." },
      { h: "Napad, odbrana i tereni", b: "Pri pravljenju akcije biraš njen tip i veličinu terena. Odbrambene akcije menjaju uloge: odbrana crta vidljive crvene strelice, prigušeni napad se premešta bez strelica, a pri reprodukciji prvo deluje napad pa reaguje odbrana. Akcije na celom terenu udvostručuju parket za presing i tranziciju. Početna lista označava svaku akciju (N/O), a filter iznad prikazuje jedan tip odjednom." },
      { h: "Zaključavanje i organizacija", b: "Katanac u editoru čini akciju samo za čitanje dok je ne otključaš. Na početnom ekranu svaka kartica ima dugmad za dupliranje, deljenje i brisanje, a kućice biraju više akcija odjednom za zajednički izvoz, preuzimanje u .zip, zaključavanje ili brisanje." },
      { h: "Izvoz i rezervne kopije", b: "Dugme za čuvanje izvozi akciju kao GIF, video ili PDF korak-po-korak. Na početnom ekranu, Izvezi sve preuzima sve akcije u .zip koji se uvozi na drugom uređaju." },
      { h: "Poništavanje", b: "Ctrl+Z poništava, a Ctrl+Shift+Z (ili Ctrl+Y) ponavlja svaku izmenu: prevlačenja, strelice, korake, imena." },
    ],
  },
  sl: {
    appTitle: "Cejudo's Playbook",
    createNew: "＋ USTVARI AKCIJO",
    stepSingular: "korak", stepPlural: "korakov",
    back: "← Akcije", rename: "✎ Preimenuj", deletePlay: "Izbriši",
    nextStep: "Naslednji korak ＋", deleteStep: "Izbriši korak", resetAll: "Ponastavi vse",
    step: "Korak", stepLower: "korak",
    cancel: "Prekliči", create: "Ustvari", renameConfirm: "Preimenuj",
    deleteConfirm: "Izbriši", resetConfirm: "Ponastavi",
    newPlayTitle: "Nova akcija", renameTitle: "Preimenuj akcijo",
    kindLabel: "Vrsta", kindOffense: "Napad", kindDefense: "Obramba",
    filterAll: "Vse",
    courtLabel: "Igrišče", courtHalf: "Polovica igrišča", courtFull: "Celo igrišče",
    deleteTitle: "Izbrišem akcijo?",
    deleteMsg: (n) => `»${n}« bo trajno izbrisana.`,
    deleteSelected: (n) => `Izbriši izbrane (${n})`,
    selectAll: "Izberi vse",
    searchPlays: "Išči akcije…",
    sortCustom: "Poljubni vrstni red",
    sortModified: "Zadnja sprememba",
    sortCreated: "Datum nastanka",
    sortAlpha: "Abecedno",
    createdLabel: "Ustvarjena",
    modifiedLabel: "Spremenjena",
    noResults: "Nobena akcija ne ustreza iskanju.",
    deleteSelTitle: "Izbrišem izbrane akcije?",
    deleteAllBtn: "Izbriši vse akcije",
    deleteAllTitle: "Izbrišem VSE akcije?",
    ttLock: "Zakleni akcijo (prepreči urejanje)",
    ttUnlock: "Odkleni akcijo",
    unlockTitle: "Odklenem akcijo?",
    unlockMsg: "Akcijo bo spet mogoče urejati.",
    bulkUnlockMsg: (n) => n === 1 ? "Izbrano akcijo bo spet mogoče urejati." : `Izbrane akcije (${n}) bo spet mogoče urejati.`,
    unlockConfirm: "Odkleni",
    ttBulkLock: "Zakleni izbrane akcije",
    ttBulkUnlock: "Odkleni izbrane akcije",
    ttBulkSave: "Izvozi izbrane kot GIF, video ali PDF",
    ttBulkZip: "Prenesi izbrane kot varnostno kopijo .zip",
    ttDuplicate: "Podvoji akcijo",
    duplicatedToast: (n) => `Kopija ustvarjena: »${n}«.`,
    deleteAllMsg: (n) => `Vseh ${n} akcij bo trajno izbrisanih. Tega ni mogoče razveljaviti.`,
    deleteSelMsg: (n) => n === 1 ? "Izbrana akcija bo trajno izbrisana." : `Izbrane akcije (${n}) bodo trajno izbrisane.`,
    undoDeleteMsg: (n) => n === 1 ? "Akcija izbrisana — tapni tukaj za razveljavitev." : `Izbrisanih akcij: ${n} — tapni tukaj za razveljavitev.`,
    resetTitle: "Ponastavim akcijo?",
    resetMsg: "Vsi koraki in puščice bodo odstranjeni. Začetni položaji koraka 1 se ohranijo.",
    untitled: "Akcija brez imena", playDefault: "Akcija",
    exportTitle: "Izvozi akcijo", formatLabel: "Format",
    fmtGif: "Animacija GIF", fmtVideo: "Video (MP4 / WebM)", fmtPdf: "PDF — vsi koraki",
    moveDur: "Trajanje gibanja (sekunde)", pauseDur: "Premor med koraki (sekunde)",
    exportGo: "Izvozi",
    renderingFrames: (a, b) => `Izrisovanje sličic… ${a}/${b}`,
    encodingGif: (p) => `Kodiranje GIF… ${p}%`,
    recording: (a, b) => `Snemanje… ${a}s / ${b}s (realni čas)`,
    renderingPage: (a, b) => `Izrisovanje strani ${a}/${b}…`,
    exportDone: "Končano — datoteka prenesena.",
    exportFailed: "Izvoz ni uspel: ",
    noVideo: "Ta brskalnik ne podpira snemanja videa.",
    noVideoFormat: "Ni podprtega video formata.",
    pdfStepLabel: (i, n) => `Korak ${i} od ${n}`,
    handleEnd: "Povleci za spremembo cilja",
    handleMid: "Povleci za ukrivljanje puščice",
    handleRot: "Povleci za vrtenje blokade",
    ttSelect: "Izberi / premakni igralce (1) — samo v koraku 1",
    ttArrow: "Puščica gibanja — povleci od igralca (2)",
    ttScreen: "Blokada — povleci od blokerja (3)",
    ttPass: "Podaja — povleci kjerkoli na igrišču; črta se začne pri žogi (4)",
    ttMaybePass: "Možna podaja — prva narisana je glavna možnost (zelena), ostale so modre (5)",
    ttMaybeToggle: "Animiraj možne podaje",
    ttTokenSize: "Velikost igralcev",
    ttMaybeShow: "Prikaži možne podaje",
    legCut: "Gibanje", legDribble: "Vodenje", legScreen: "Blokada", legPass: "Podaja",
    legMain: "Glavna možna podaja", legOption: "Možna podaja", legDefender: "Gibanje obrambe", legZone: "Območje delovanja",
    ttZone: "Cona — povleci od obrambnega igralca za njegovo območje delovanja (3)",
    ttDefense: "Prikaži / skrij obrambo",
    ttEraser: "Radirka — klikni puščico ali igralca (6)",
    ttBack: "Nazaj na akcije", ttRename: "Preimenuj akcijo",
    ttExport: "Izvozi kot GIF, video ali PDF", ttDelete: "Izbriši akcijo",
    ttDeleteStep: "Izbriši korak", ttResetAll: "Počisti vse korake",
    ttPrev: "Prejšnji korak", ttNext: "Naslednji korak", ttPlay: "Predvajaj / Premor",
    ttSpeed: "Hitrost predvajanja",
    ttUndo: "Razveljavi (Ctrl+Z)", ttRedo: "Ponovi (Ctrl+Y / Ctrl+Shift+Z)",
    ttGrip: "Povleci za premik vrstice (dvojni klik za ponastavitev)",
    ttZoomIn: "Približaj", ttZoomOut: "Oddalji",
    ttZoomReset: "Ponastavi povečavo (ali dvojni klik na igrišče)",
    ttReorder: "Povleci za razvrščanje",
    ttShare: "Deli akcijo s povezavo",
    shareTitle: "Deli akcijo",
    shareModalMsg: "Povezava odpre predvajalnik samo za ogled.",
    shareAllowEdit: "Dovoli urejanje (akcijo bodo lahko dodali med svoje)",
    shareGo: "Deli", viewEdit: "Uredi",
    shareCopiedTitle: "Povezava kopirana",
    shareCopiedMsg: "Povezava je v odložišču — pošlji jo komurkoli.",
    shareLinkTitle: "Povezava za deljenje",
    copyLink: "Kopiraj povezavo",
    linkCopied: "Povezava je kopirana v odložišče.",
    qrCopied: "Koda QR je kopirana v odložišče.",
    ttCopyQr: "Klikni za kopiranje kode QR",
    sharedTitle: "Deljena akcija",
    sharedMsg: (n) => `Dodam »${n}« med tvoje akcije?`,
    sharedAdd: "Dodaj",
    sharedErrMsg: "Povezava ni veljavna.",
    sharedAddedToast: (n) => `Deljena akcija »${n}« je dodana.`,
    sharedExistsMsg: (n) => `To akcijo že imaš — imenuje se »${n}«. Vseeno dodam?`,
    sharedAddAnyway: "Vseeno dodaj",
    exportAll: "⤓ Izvozi vse (.zip)", importAll: "⤒ Uvozi (.zip)",
    ttExportAll: "Prenesi vse akcije kot varnostno kopijo .zip",
    ttImportAll: "Uvozi akcije iz varnostne kopije .zip",
    importDoneTitle: "Uvoz končan",
    importDoneMsg: (a) => `Uvoženih akcij: ${a}.`,
    importedBadge: "uvožena",
    importErrTitle: "Uvoz ni uspel",
    importErrMsg: "Datoteka ni videti kot varnostna kopija Playbooka (.zip).",
    renamedToast: (n) => `Ime je že v uporabi — akcija se zdaj imenuje »${n}«.`,
    orderHelp: "Ta igralec ima dve akciji — svetlejša črta se zgodi druga. Dvojni klik (ali dolg pritisk) na črto jo postavi na prvo mesto.",
    helpTitle: "Kako deluje Cejudo's Playbook",
    helpTourTitle: "Vodeni ogled",
    helpTourBody: "Si nov ali želiš osvežitev? Ponovno zaženi interaktivni vodič, ki te popelje skozi ustvarjanje in animiranje akcije.",
    helpTourBtn: "Ponovno zaženi vodič",
    tourSkip: "Preskoči vodič", tourNext: "Naprej", tourDone: "Končano!",
    tourTexts: [
      "Dobrodošel! Ustvarimo tvojo prvo akcijo — klikni označeni gumb.",
      "Izberi vrsto akcije — napad ali obramba — in ali uporablja polovico ali celo igrišče, nato pritisni Ustvari.",
      "To je tvoje igrišče. Povleci igralce in žogo na začetne položaje (lahko tudi izven igrišča).",
      "Orodna vrstica: puščice gibanja, blokade, podaje in radirka. Povleci od igralca za vtekanje ali uporabi orodje za podajo od koderkoli. Vrstico premakneš z vlečenjem ročaja.",
      "Pri obrambnih akcijah to orodje obarva območje delovanja vsakega obrambnega igralca — povleci kjerkoli, da ga narišeš, in povleci območje, da ga premakneš.",
      "Ko narišeš puščice, jih zeleni + spremeni v naslednji korak akcije.",
      "Potrebuješ obrambo? Ta gumb doda pet obrambnih igralcev (X), ki jih postavljaš in premikaš kot svoje igralce.",
      "Pritisni predvajanje in celotna akcija oživi, korak za korakom.",
      "Končano? Gumb za shranjevanje izvozi akcijo kot animirani GIF, video ali PDF po korakih, pripravljen za tisk.",
      "Deli katerokoli akcijo s povezavo — privzeto samo za ogled.",
      "Vprašanja kasneje? Celoten vodnik je za tem gumbom ?. Uživaj!",
    ],
    helpSections: [
      { h: "Akcije", b: "Začetni zaslon prikazuje tvoje akcije: tapni za odpiranje, povleci pikice za razvrščanje, koš izbriše. Preimenuješ s klikom na ime v urejevalniku." },
      { h: "Igralci in žoga", b: "V koraku 1 povleci igralce kamorkoli (tudi izven igrišča). Žoga vedno pripada igralcu — povleci jo, da jo predaš drugemu." },
      { h: "Orodja za risanje", b: "Vrstica (premikaš jo za ročaj): 1 izbira, 2 puščica gibanja, 3 blokada, 4 podaja, 5 možna podaja, 6 radirka. Povleci od igralca za vtekanje ali blokado. Z orodjem za podajo povleci kjerkoli — črta se vedno začne pri žogi. Vodenje žoge se riše z valovito črto. Tipke 1–6 preklapljajo orodja." },
      { h: "Urejanje puščic", b: "Okrogla ročica ukrivi pot, kvadratna premakne cilj, rdečo prečko blokade pa vrtiš z zlato ročico. Radirka odstrani puščico s klikom nanjo ali na igralca." },
      { h: "Podaje", b: "Podaje se pripnejo soigralcu in so vedno ravne. Če ima prejemnik gibanje, žoga prispe na KONEC tega gibanja. Bloker nikoli ne more prejeti žoge, igralec z žogo pa nikoli blokirati." },
      { h: "Dve akciji, en igralec", b: "Ko ima igralec z žogo podajo in gibanje, se svetlejša črta zgodi druga. Dvojni klik (ali dolg pritisk) postavi črto na prvo mesto — najprej gibanje pomeni vodenje žoge do tja pred podajo." },
      { h: "Koraki", b: "Zeleni + spremeni narisane puščice v nov korak; koraki brez akcij (in zadnji) se izbrišejo prek svojega koška. Korak traja glede na število zaporednih akcij." },
      { h: "Predvajanje in povečava", b: "Spodnji predvajalnik: predvajaj/premor (preslednica), prejšnji/naslednji (puščici), drsnik in hitrost. Povečava s koleščkom, ščipom ali kontrolo v kotu; povleci igrišče za premik; dvojni klik za ponastavitev." },
      { h: "Deljenje", b: "Gumb za deljenje (v urejevalniku ali na vsaki kartici) ustvari povezavo z akcijo. Privzeto odpre predvajalnik samo za ogled z gumbom Uredi; označi potrditveno polje za deljenje kopije, ki jo je mogoče urejati. Okno s povezavo prikaže kodo QR — klikni jo, da jo kopiraš kot sliko, ali kopiraj povezavo z gumbom." },
      { h: "Obramba", b: "Gumb s ščitom ob kontrolah korakov doda pet obrambnih igralcev — rdeče oznake X, ki jih postavljaš in premikaš enako kot svoje igralce. Obramba nikoli ne riše puščic: povleci jih z orodjem za izbiro v kateremkoli koraku ali z orodjem za puščico določi, kam se premaknejo med korakom — bled X označuje cilj med urejanjem (povleci ga za prilagoditev), med predvajanjem pa preprosto zdrsnejo tja. Ne morejo postavljati blokad niti prejemati podaj. Pritisni znova, da jih odstraniš (razveljavitev vse povrne). Pri obrambnih akcijah orodje za cono (3) nežno obarva območje delovanja vsakega obrambnega igralca." },
      { h: "Napad, obramba in igrišča", b: "Ob ustvarjanju akcije izbereš njeno vrsto in velikost igrišča. Obrambne akcije zamenjajo vlogi: obramba riše vidne rdeče puščice, zatemnjen napad se premešča brez puščic, pri predvajanju pa najprej deluje napad in nato reagira obramba. Akcije na celem igrišču podvojijo parket za presing in tranzicijo. Začetni seznam označi vsako akcijo (N/O), filter zgoraj pa prikaže eno vrsto naenkrat." },
      { h: "Zaklepanje in urejanje", b: "Ključavnica v urejevalniku naredi akcijo samo za branje, dokler je ne odkleneš. Na začetnem zaslonu ima vsaka kartica gumbe za podvajanje, deljenje in brisanje potrditvena polja pa izberejo več akcij hkrati za skupni izvoz, prenos v .zip, zaklepanje ali brisanje." },
      { h: "Izvoz in varnostne kopije", b: "Gumb za shranjevanje izvozi akcijo kot GIF, video ali PDF po korakih. Na začetnem zaslonu Izvozi vse prenese vse akcije v .zip, ki ga uvoziš na drugi napravi." },
      { h: "Razveljavitev", b: "Ctrl+Z razveljavi, Ctrl+Shift+Z (ali Ctrl+Y) ponovi vsako urejanje: vlečenja, puščice, korake, preimenovanja." },
    ],
  },
  el: {
    appTitle: "Cejudo's Playbook",
    createNew: "＋ ΝΕΟ ΣΥΣΤΗΜΑ",
    stepSingular: "βήμα", stepPlural: "βήματα",
    back: "← Συστήματα", rename: "✎ Μετονομασία", deletePlay: "Διαγραφή",
    nextStep: "Επόμενο βήμα ＋", deleteStep: "Διαγραφή βήματος", resetAll: "Επαναφορά όλων",
    step: "Βήμα", stepLower: "βήμα",
    cancel: "Άκυρο", create: "Δημιουργία", renameConfirm: "Μετονομασία",
    deleteConfirm: "Διαγραφή", resetConfirm: "Επαναφορά",
    newPlayTitle: "Νέο σύστημα", renameTitle: "Μετονομασία συστήματος",
    kindLabel: "Τύπος", kindOffense: "Επίθεση", kindDefense: "Άμυνα",
    filterAll: "Όλα",
    courtLabel: "Γήπεδο", courtHalf: "Μισό γήπεδο", courtFull: "Ολόκληρο γήπεδο",
    deleteTitle: "Διαγραφή συστήματος;",
    deleteMsg: (n) => `Το «${n}» θα διαγραφεί οριστικά.`,
    deleteSelected: (n) => `Διαγραφή επιλεγμένων (${n})`,
    selectAll: "Επιλογή όλων",
    searchPlays: "Αναζήτηση συστημάτων…",
    sortCustom: "Προσαρμοσμένη σειρά",
    sortModified: "Τελευταία τροποποίηση",
    sortCreated: "Ημερομηνία δημιουργίας",
    sortAlpha: "Αλφαβητικά",
    createdLabel: "Δημιουργήθηκε",
    modifiedLabel: "Τροποποιήθηκε",
    noResults: "Κανένα σύστημα δεν ταιριάζει με την αναζήτηση.",
    deleteSelTitle: "Διαγραφή επιλεγμένων συστημάτων;",
    deleteAllBtn: "Διαγραφή όλων των συστημάτων",
    deleteAllTitle: "Διαγραφή ΟΛΩΝ των συστημάτων;",
    ttLock: "Κλείδωμα συστήματος (αποτρέπει αλλαγές)",
    ttUnlock: "Ξεκλείδωμα συστήματος",
    unlockTitle: "Ξεκλείδωμα συστήματος;",
    unlockMsg: "Το σύστημα θα είναι ξανά επεξεργάσιμο.",
    bulkUnlockMsg: (n) => n === 1 ? "Το επιλεγμένο σύστημα θα είναι ξανά επεξεργάσιμο." : `Τα ${n} επιλεγμένα συστήματα θα είναι ξανά επεξεργάσιμα.`,
    unlockConfirm: "Ξεκλείδωμα",
    ttBulkLock: "Κλείδωμα επιλεγμένων συστημάτων",
    ttBulkUnlock: "Ξεκλείδωμα επιλεγμένων συστημάτων",
    ttBulkSave: "Εξαγωγή επιλεγμένων ως GIF, βίντεο ή PDF",
    ttBulkZip: "Λήψη επιλεγμένων ως αντίγραφο .zip",
    ttDuplicate: "Αντιγραφή συστήματος",
    duplicatedToast: (n) => `Δημιουργήθηκε αντίγραφο: «${n}».`,
    deleteAllMsg: (n) => `Και τα ${n} συστήματα θα διαγραφούν οριστικά. Δεν μπορεί να αναιρεθεί.`,
    deleteSelMsg: (n) => n === 1 ? "Το επιλεγμένο σύστημα θα διαγραφεί οριστικά." : `Τα ${n} επιλεγμένα συστήματα θα διαγραφούν οριστικά.`,
    undoDeleteMsg: (n) => n === 1 ? "Το σύστημα διαγράφηκε — πάτησε εδώ για αναίρεση." : `Διαγράφηκαν ${n} συστήματα — πάτησε εδώ για αναίρεση.`,
    resetTitle: "Επαναφορά συστήματος;",
    resetMsg: "Όλα τα βήματα και τα βέλη θα αφαιρεθούν. Οι αρχικές θέσεις του βήματος 1 διατηρούνται.",
    untitled: "Σύστημα χωρίς όνομα", playDefault: "Σύστημα",
    exportTitle: "Εξαγωγή συστήματος", formatLabel: "Μορφή",
    fmtGif: "Κινούμενο GIF", fmtVideo: "Βίντεο (MP4 / WebM)", fmtPdf: "PDF — όλα τα βήματα",
    moveDur: "Διάρκεια κίνησης (δευτερόλεπτα)", pauseDur: "Παύση μεταξύ βημάτων (δευτερόλεπτα)",
    exportGo: "Εξαγωγή",
    renderingFrames: (a, b) => `Απόδοση καρέ… ${a}/${b}`,
    encodingGif: (p) => `Κωδικοποίηση GIF… ${p}%`,
    recording: (a, b) => `Εγγραφή… ${a}δ / ${b}δ (πραγματικός χρόνος)`,
    renderingPage: (a, b) => `Απόδοση σελίδας ${a}/${b}…`,
    exportDone: "Έτοιμο — το αρχείο κατέβηκε.",
    exportFailed: "Η εξαγωγή απέτυχε: ",
    noVideo: "Αυτό το πρόγραμμα περιήγησης δεν υποστηρίζει εγγραφή βίντεο.",
    noVideoFormat: "Δεν βρέθηκε υποστηριζόμενη μορφή βίντεο.",
    pdfStepLabel: (i, n) => `Βήμα ${i} από ${n}`,
    handleEnd: "Σύρε για αλλαγή προορισμού",
    handleMid: "Σύρε για καμπύλωση του βέλους",
    handleRot: "Σύρε για περιστροφή του σκριν",
    ttSelect: "Επιλογή / μετακίνηση παικτών (1) — μόνο στο βήμα 1",
    ttArrow: "Βέλος κίνησης — σύρε από έναν παίκτη (2)",
    ttScreen: "Σκριν — σύρε από αυτόν που το βάζει (3)",
    ttPass: "Πάσα — σύρε οπουδήποτε στο γήπεδο· η γραμμή ξεκινά από την μπάλα (4)",
    ttMaybePass: "Πιθανή πάσα — η πρώτη που σχεδιάζεις είναι η κύρια επιλογή (πράσινη), οι υπόλοιπες μπλε (5)",
    ttMaybeToggle: "Κίνηση πιθανών πασών",
    ttTokenSize: "Μέγεθος παικτών",
    ttMaybeShow: "Εμφάνιση πιθανών πασών",
    legCut: "Κίνηση", legDribble: "Ντρίμπλα", legScreen: "Σκριν", legPass: "Πάσα",
    legMain: "Κύρια πιθανή πάσα", legOption: "Πιθανή πάσα", legDefender: "Κίνηση αμυντικού", legZone: "Περιοχή ευθύνης",
    ttZone: "Ζώνη — σύρε από έναν αμυντικό για την περιοχή ευθύνης του (3)",
    ttDefense: "Εμφάνιση / απόκρυψη αμυντικών",
    ttEraser: "Γόμα — κλικ σε βέλος ή παίκτη (6)",
    ttBack: "Πίσω στα συστήματα", ttRename: "Μετονομασία συστήματος",
    ttExport: "Εξαγωγή ως GIF, βίντεο ή PDF", ttDelete: "Διαγραφή συστήματος",
    ttDeleteStep: "Διαγραφή βήματος", ttResetAll: "Καθαρισμός όλων των βημάτων",
    ttPrev: "Προηγούμενο βήμα", ttNext: "Επόμενο βήμα", ttPlay: "Αναπαραγωγή / Παύση",
    ttSpeed: "Ταχύτητα αναπαραγωγής",
    ttUndo: "Αναίρεση (Ctrl+Z)", ttRedo: "Επανάληψη (Ctrl+Y / Ctrl+Shift+Z)",
    ttGrip: "Σύρε για μετακίνηση της μπάρας (διπλό κλικ για επαναφορά)",
    ttZoomIn: "Μεγέθυνση", ttZoomOut: "Σμίκρυνση",
    ttZoomReset: "Επαναφορά ζουμ (ή διπλό κλικ στο γήπεδο)",
    ttReorder: "Σύρε για αναδιάταξη",
    ttShare: "Κοινοποίηση συστήματος με σύνδεσμο",
    shareTitle: "Κοινοποίηση συστήματος",
    shareModalMsg: "Ο σύνδεσμος ανοίγει πρόγραμμα προβολής μόνο για ανάγνωση.",
    shareAllowEdit: "Να επιτρέπεται η επεξεργασία (θα μπορούν να το προσθέσουν στα δικά τους)",
    shareGo: "Κοινοποίηση", viewEdit: "Επεξεργασία",
    shareCopiedTitle: "Ο σύνδεσμος αντιγράφηκε",
    shareCopiedMsg: "Ο σύνδεσμος είναι στο πρόχειρο — στείλ' τον σε όποιον θες.",
    shareLinkTitle: "Σύνδεσμος κοινοποίησης",
    copyLink: "Αντιγραφή συνδέσμου",
    linkCopied: "Ο σύνδεσμος αντιγράφηκε στο πρόχειρο.",
    qrCopied: "Ο κωδικός QR αντιγράφηκε στο πρόχειρο.",
    ttCopyQr: "Κλικ για αντιγραφή του κωδικού QR",
    sharedTitle: "Κοινοποιημένο σύστημα",
    sharedMsg: (n) => `Προσθήκη του «${n}» στα συστήματά σου;`,
    sharedAdd: "Προσθήκη",
    sharedErrMsg: "Ο σύνδεσμος δεν είναι έγκυρος.",
    sharedAddedToast: (n) => `Το σύστημα «${n}» προστέθηκε.`,
    sharedExistsMsg: (n) => `Έχεις ήδη αυτό το σύστημα — λέγεται «${n}». Να προστεθεί ούτως ή άλλως;`,
    sharedAddAnyway: "Προσθήκη ούτως ή άλλως",
    exportAll: "⤓ Εξαγωγή όλων (.zip)", importAll: "⤒ Εισαγωγή (.zip)",
    ttExportAll: "Κατέβασε όλα τα συστήματα ως αντίγραφο ασφαλείας .zip",
    ttImportAll: "Εισαγωγή συστημάτων από .zip",
    importDoneTitle: "Η εισαγωγή ολοκληρώθηκε",
    importDoneMsg: (a) => `Εισήχθησαν ${a} συστήματα.`,
    importedBadge: "εισηγμένο",
    importErrTitle: "Η εισαγωγή απέτυχε",
    importErrMsg: "Το αρχείο δεν μοιάζει με αντίγραφο ασφαλείας του Playbook (.zip).",
    renamedToast: (n) => `Το όνομα υπήρχε ήδη — το σύστημα λέγεται τώρα «${n}».`,
    orderHelp: "Αυτός ο παίκτης έχει δύο ενέργειες — η πιο αχνή γραμμή γίνεται δεύτερη. Διπλό κλικ (ή παρατεταμένο πάτημα) σε μια γραμμή τη βάζει πρώτη.",
    helpTitle: "Πώς λειτουργεί το Cejudo's Playbook",
    helpTourTitle: "Διαδραστική ξενάγηση",
    helpTourBody: "Νέος εδώ ή θες μια υπενθύμιση; Ξαναδές τη διαδραστική ξενάγηση που σε καθοδηγεί στη δημιουργία και κίνηση ενός συστήματος.",
    helpTourBtn: "Επανεκκίνηση ξενάγησης",
    tourSkip: "Παράλειψη", tourNext: "Επόμενο", tourDone: "Έτοιμο!",
    tourTexts: [
      "Καλώς ήρθες! Ας φτιάξουμε το πρώτο σου σύστημα — πάτησε το φωτισμένο κουμπί.",
      "Διάλεξε τι είδους σύστημα είναι — επίθεση ή άμυνα — και αν χρησιμοποιεί μισό ή ολόκληρο γήπεδο, μετά πάτησε Δημιουργία.",
      "Αυτό είναι το γήπεδό σου. Σύρε τους παίκτες και την μπάλα στις αρχικές θέσεις (και εκτός γηπέδου).",
      "Η εργαλειοθήκη: βέλη κίνησης, σκριν, πάσες και γόμα. Σύρε από παίκτη για κόψιμο ή χρησιμοποίησε το εργαλείο πάσας από οπουδήποτε. Μετακίνησέ τη σέρνοντας τη λαβή της.",
      "Στα αμυντικά συστήματα αυτό το εργαλείο χρωματίζει την περιοχή ευθύνης κάθε αμυντικού — σύρε οπουδήποτε για να τη σχεδιάσεις και σύρε την περιοχή για να τη μετακινήσεις.",
      "Όταν σχεδιάσεις βέλη, το πράσινο + τα κάνει το επόμενο βήμα του συστήματος.",
      "Χρειάζεσαι άμυνα; Αυτό το κουμπί προσθέτει πέντε αμυντικούς (X) που τοποθετείς και κινείς όπως τους παίκτες σου.",
      "Πάτησε αναπαραγωγή και όλο το σύστημα ζωντανεύει, βήμα-βήμα.",
      "Τελείωσες; Το κουμπί αποθήκευσης εξάγει το σύστημα ως κινούμενο GIF, βίντεο ή εκτυπώσιμο PDF βήμα-βήμα.",
      "Κοινοποίησε οποιοδήποτε σύστημα με σύνδεσμο — μόνο για ανάγνωση από προεπιλογή.",
      "Απορίες αργότερα; Ο πλήρης οδηγός είναι πίσω από το κουμπί ?. Καλή διασκέδαση!",
    ],
    helpSections: [
      { h: "Συστήματα", b: "Η αρχική οθόνη δείχνει τα συστήματά σου: πάτησε ένα για άνοιγμα, σύρε τις κουκκίδες για αναδιάταξη, ο κάδος διαγράφει. Μετονόμασε πατώντας το όνομα στον επεξεργαστή." },
      { h: "Παίκτες και μπάλα", b: "Στο βήμα 1 σύρε τους παίκτες οπουδήποτε (και εκτός γηπέδου). Η μπάλα ανήκει πάντα σε έναν παίκτη — σύρε τη για να τη δώσεις σε άλλον." },
      { h: "Εργαλεία σχεδίασης", b: "Εργαλειοθήκη (μετακινείται από τη λαβή): 1 επιλογή, 2 βέλος κίνησης, 3 σκριν, 4 πάσα, 5 πιθανή πάσα, 6 γόμα. Σύρε από παίκτη για κόψιμο ή σκριν. Με το εργαλείο πάσας σύρε οπουδήποτε — η γραμμή ξεκινά πάντα από την μπάλα. Η ντρίμπλα του κατόχου σχεδιάζεται ως κυματιστή γραμμή. Πλήκτρα 1–6 αλλάζουν εργαλείο." },
      { h: "Επεξεργασία βελών", b: "Η στρογγυλή λαβή καμπυλώνει τη διαδρομή, η τετράγωνη μετακινεί τον προορισμό, και η κόκκινη μπάρα του σκριν περιστρέφεται με τη χρυσή λαβή. Η γόμα σβήνει βέλος με κλικ σε αυτό ή στον παίκτη του." },
      { h: "Πάσες", b: "Οι πάσες κουμπώνουν σε συμπαίκτη και είναι πάντα ευθείες. Αν ο παραλήπτης κινείται, η μπάλα φτάνει στο ΤΕΛΟΣ της κίνησης. Όποιος βάζει σκριν δεν παίρνει ποτέ πάσα, κι ο κάτοχος της μπάλας δεν βάζει ποτέ σκριν." },
      { h: "Δύο ενέργειες, ένας παίκτης", b: "Όταν ο κάτοχος έχει πάσα και κίνηση, η πιο αχνή γραμμή γίνεται δεύτερη. Διπλό κλικ (ή παρατεταμένο πάτημα) βάζει τη γραμμή πρώτη — κίνηση πρώτα σημαίνει ντρίμπλα ως εκεί πριν την πάσα." },
      { h: "Βήματα", b: "Το πράσινο + μετατρέπει τα σχεδιασμένα βέλη σε νέο βήμα· βήματα χωρίς ενέργειες (και το τελευταίο) σβήνονται από τη φυσαλίδα-κάδο τους. Η διάρκεια βήματος εξαρτάται από τις διαδοχικές ενέργειες." },
      { h: "Αναπαραγωγή και ζουμ", b: "Κάτω πρόγραμμα αναπαραγωγής: play/παύση (Space), προηγούμενο/επόμενο (βέλη), μπάρα και ταχύτητα. Ζουμ με ροδέλα, τσίμπημα ή το χειριστήριο στη γωνία· σύρε το γήπεδο για μετατόπιση· διπλό κλικ για επαναφορά." },
      { h: "Κοινοποίηση", b: "Το κουμπί κοινοποίησης (στον επεξεργαστή ή σε κάθε κάρτα) φτιάχνει σύνδεσμο που περιέχει το σύστημα. Από προεπιλογή ανοίγει προβολή μόνο για ανάγνωση με κουμπί Επεξεργασίας· τσέκαρε το κουτάκι για επεξεργάσιμο αντίγραφο. Το παράθυρο του συνδέσμου δείχνει κωδικό QR — κλικ πάνω του για αντιγραφή ως εικόνα, ή αντέγραψε τον σύνδεσμο με το κουμπί." },
      { h: "Αμυντικοί", b: "Το κουμπί με την ασπίδα δίπλα στα χειριστήρια βημάτων προσθέτει πέντε αμυντικούς — κόκκινα X που τοποθετούνται και κινούνται όπως οι παίκτες σου. Οι αμυντικοί δεν σχεδιάζουν ποτέ βέλη: σύρε τους με το εργαλείο επιλογής σε οποιοδήποτε βήμα, ή με το βέλος κίνησης όρισε πού μετακινούνται στη διάρκεια του βήματος — ένα αχνό X σημειώνει τον προορισμό όσο επεξεργάζεσαι (σύρε το για προσαρμογή), και στην αναπαραγωγή απλώς γλιστρούν εκεί. Δεν βάζουν σκριν ούτε δέχονται πάσες. Πάτησέ το ξανά για να τους αφαιρέσεις (η αναίρεση τα επαναφέρει όλα). Στα αμυντικά συστήματα το εργαλείο ζώνης (3) χρωματίζει απαλά την περιοχή ευθύνης κάθε αμυντικού." },
      { h: "Επίθεση, άμυνα και γήπεδα", b: "Δημιουργώντας ένα σύστημα διαλέγεις τον τύπο και το μέγεθος γηπέδου. Τα αμυντικά συστήματα αντιστρέφουν τους ρόλους: οι αμυντικοί σχεδιάζουν τα ορατά κόκκινα βέλη, η (αχνή) επίθεση επανατοποθετείται σιωπηλά και στην αναπαραγωγή πρώτα ενεργεί η επίθεση και μετά αντιδρά η άμυνα. Τα συστήματα ολόκληρου γηπέδου διπλασιάζουν το παρκέ για πρέσινγκ και μετάβαση. Η αρχική λίστα μαρκάρει κάθε σύστημα (Ε/Α) και το φίλτρο από πάνω δείχνει έναν τύπο τη φορά." },
      { h: "Κλείδωμα και οργάνωση", b: "Το λουκέτο στον επεξεργαστή κάνει το σύστημα μόνο για ανάγνωση μέχρι να το ξεκλειδώσεις. Στην αρχική οθόνη κάθε κάρτα έχει κουμπιά αντιγραφής, κοινοποίησης και διαγραφής, και τα πλαίσια επιλογής επιλέγουν πολλά συστήματα μαζί για εξαγωγή, λήψη σε .zip, κλείδωμα ή διαγραφή." },
      { h: "Εξαγωγή και αντίγραφα", b: "Το κουμπί αποθήκευσης εξάγει το σύστημα ως GIF, βίντεο ή PDF βήμα-βήμα. Στην αρχική, η Εξαγωγή όλων κατεβάζει όλα τα συστήματα σε .zip για εισαγωγή σε άλλη συσκευή." },
      { h: "Αναίρεση", b: "Ctrl+Z αναιρεί και Ctrl+Shift+Z (ή Ctrl+Y) επαναλαμβάνει κάθε αλλαγή: μετακινήσεις, βέλη, βήματα, μετονομασίες." },
    ],
  },
};

let lang = localStorage.getItem("playbook-lang") || "es";

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
    viewEditLabel: "viewEdit",
    modalCancel: "cancel", exportCancel: "cancel", exportGo: "exportGo",
    exportTitle: "exportTitle", exportFormatLabel: "formatLabel",
    exportMoveLabel: "moveDur", exportPauseLabel: "pauseDur",
    exportAllBtn: "exportAll", importAllBtn: "importAll",
  };
  for (const [id, key] of Object.entries(texts)) $(id).textContent = t(key);

  const titles = {
    backBtn: "ttBack", exportBtn: "ttExport",
    shareBtn: "ttShare",
    deletePlayBtn: "ttDelete",
    prevBtn: "ttPrev", nextBtn: "ttNext",
    playBtn: "ttPlay", speedSelect: "ttSpeed",
    undoBtn: "ttUndo", redoBtn: "ttRedo", toolGrip: "ttGrip",
    exportAllBtn: "ttExportAll", importAllBtn: "ttImportAll",
    addStepBtn: "nextStep", resetAllBtn: "ttResetAll", defenseBtn: "ttDefense",
    zoomIn: "ttZoomIn", zoomOut: "ttZoomOut", zoomLabel: "ttZoomReset",
    maybeTogWrap: "ttMaybeToggle", maybeShowWrap: "ttMaybeShow", tokenSizeWrap: "ttTokenSize",
  };
  for (const [id, key] of Object.entries(titles)) $(id).title = t(key);

  const toolTitles = { select: "ttSelect", arrow: "ttArrow", screen: "ttScreen", zone: "ttZone", pass: "ttPass", mpass: "ttMaybePass", eraser: "ttEraser" };
  for (const [toolName, key] of Object.entries(toolTitles)) {
    toolbar.querySelector(`[data-tool="${toolName}"]`).title = t(key);
  }

  const fmtOpts = $("exportFormat").options;
  fmtOpts[0].text = t("fmtGif");
  fmtOpts[1].text = t("fmtVideo");
  fmtOpts[2].text = t("fmtPdf");

  if (!editorEl.hidden && currentPlay()) {
    if (!viewPlay) applyLockState();
    renderAll();
  } else {
    renderHome();
  }
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
function openModal({ title, message = "", input = false, value = "", confirmLabel = "OK", danger = false, noCancel = false, checkboxLabel = null, qr = null, copyLink = null, xClose = false }) {
  return new Promise((resolve) => {
    $("modalTitle").textContent = title;
    $("modalMsg").textContent = message;
    $("modalMsg").hidden = !message;
    const qrEl = $("modalQr");
    qrEl.hidden = true;
    qrEl.innerHTML = "";
    if (qr) renderQrInto(qrEl, qr);
    const copyBtn = $("modalCopyLink");
    $("modalCopyWrap").hidden = !copyLink;
    if (copyLink) {
      $("modalCopyLabel").textContent = t("copyLink");
      $("modalCopyMsg").textContent = "";
      $("modalCopyMsg").classList.remove("show");
      copyBtn.classList.remove("copied");
    }
    const onCopy = async () => {
      try {
        await navigator.clipboard.writeText(copyLink);
        copyBtn.classList.add("copied");
        const msg = $("modalCopyMsg");
        msg.textContent = t("linkCopied");
        msg.classList.add("show");
      } catch (_) { /* clipboard unavailable */ }
    };
    if (copyLink) copyBtn.addEventListener("click", onCopy);
    $("modalCancel").hidden = noCancel;
    $("modalCheckWrap").hidden = !checkboxLabel;
    if (checkboxLabel) {
      $("modalCheckLabel").textContent = checkboxLabel;
      $("modalCheck").checked = false;
    }
    const inputEl = $("modalInput");
    inputEl.hidden = !input;
    inputEl.value = value;
    const okBtn = $("modalOk");
    okBtn.hidden = !!xClose;
    okBtn.textContent = confirmLabel;
    okBtn.classList.toggle("btn-danger-solid", danger);
    okBtn.classList.toggle("btn-primary", !danger);
    const xBtn = $("modalX");
    xBtn.hidden = !xClose;
    modalEl.hidden = false;
    if (input) inputEl.focus(), inputEl.select();
    else if (!okBtn.hidden) okBtn.focus();
    else xBtn.focus();

    const onX = () => close(true);
    const onBackdrop = (e) => { if (e.target === modalEl) close(true); };
    if (xClose) {
      xBtn.addEventListener("click", onX);
      modalEl.addEventListener("click", onBackdrop);
    }

    const close = (result) => {
      modalEl.hidden = true;
      okBtn.removeEventListener("click", onOk);
      copyBtn.removeEventListener("click", onCopy);
      xBtn.removeEventListener("click", onX);
      modalEl.removeEventListener("click", onBackdrop);
      $("modalCancel").removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    };
    const onOk = () => close(
      input ? inputEl.value
      : checkboxLabel ? { ok: true, checked: $("modalCheck").checked }
      : true
    );
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
  if (!p.createdAt) p.createdAt = Date.now();
  if (!p.updatedAt) p.updatedAt = p.createdAt;
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
  return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, steps };
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

// A moving receiver is always reached at the end of their movement.
function normalizePassTimings(p) {
  for (const s of p.steps) {
    if (s.pass) s.pass.timing = s.moves[s.pass.to] ? "after" : "before";
  }
  return p;
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.plays)) {
      plays = data.plays.map((p) => normalizePassTimings(migrateBall(migratePlay(p))));
    }
  } catch (_) { plays = []; }
}

/* ================= Navigation ================= */

// Each opened play gets its own history entry (#play=<id>) so the
// browser back button returns to the list instead of leaving the site.
const BASE_URL = location.pathname + location.search;

function markHomeUrl() {
  history.replaceState({ view: "home" }, "", BASE_URL);
}

window.addEventListener("popstate", (e) => {
  const st = e.state;
  if (st && st.view === "play" && plays.some((p) => p.id === st.id)) {
    openPlay(st.id, true);
  } else {
    showHome(true);
  }
});

function showHome(fromHistory) {
  playing = false;
  viewPlay = null;
  document.body.classList.remove("playing", "view-only", "play-locked");
  document.body.classList.add("home-view");
  playNameEl.readOnly = false;
  editorEl.hidden = true;
  homeEl.hidden = false;
  renderHome();
  // reached without the back button (delete, help…) — retarget the URL
  if (!fromHistory && history.state && history.state.view === "play") markHomeUrl();
}

function openPlay(id, fromHistory) {
  currentPlayId = id;
  viewPlay = null;
  document.body.classList.remove("view-only", "home-view");
  playNameEl.readOnly = false;
  applyCourtMode(currentPlay());
  applyLockState();
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
  if (!fromHistory) {
    const entry = { view: "play", id };
    const url = "#play=" + encodeURIComponent(id);
    if (history.state && history.state.view === "play") history.replaceState(entry, "", url);
    else history.pushState(entry, "", url);
  }
}

// Read-only viewer for a shared play: court, name and playback only.
function openViewer(play) {
  viewPlay = play;
  applyCourtMode(play);
  document.body.classList.remove("play-locked", "home-view");
  document.body.classList.add("view-only");
  playNameEl.readOnly = true;
  currentStep = 0;
  playhead = 0;
  playing = false;
  clearHistory();
  homeEl.hidden = true;
  editorEl.hidden = false;
  setTool("select");
  renderAll();
  resetZoom();
}

let cardDragJustEnded = false;
const selectedPlayIds = new Set();
const PAGE_SIZE = 10;
let playKindFilter = "all";
// custom keeps the user's dragged order (the array); a list that was
// never hand-ordered defaults to most recently modified first
let playSort = localStorage.getItem("playbook-sort") ||
  (localStorage.getItem("playbook-reordered") ? "custom" : "modified");
let playSearch = "";
let playPage = 0;
let pageOffset = 0; // index in `plays` of the first visible card (for drag reorder)

function filteredPlays() {
  const q = playSearch.trim().toLowerCase();
  let list = plays;
  if (playKindFilter !== "all") list = list.filter((p) => playKind(p) === playKindFilter);
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
  if (playSort === "alpha") {
    list = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  } else if (playSort === "created") {
    list = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (playSort === "modified") {
    list = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return list;
}

function visiblePlays() {
  return filteredPlays().slice(pageOffset, pageOffset + PAGE_SIZE);
}

function updateDeleteSelected() {
  const ids = new Set(plays.map((p) => p.id));
  for (const id of [...selectedPlayIds]) if (!ids.has(id)) selectedPlayIds.delete(id);
  const btn = $("deleteSelectedBtn");
  btn.hidden = selectedPlayIds.size === 0;
  btn.textContent = t("deleteSelected", selectedPlayIds.size);
  const topBtn = $("deleteSelectedTop");
  topBtn.hidden = selectedPlayIds.size === 0;
  topBtn.title = t("deleteSelected", selectedPlayIds.size);
  const none = selectedPlayIds.size === 0;
  $("saveSelectedBtn").hidden = none;
  $("saveSelectedBtn").title = t("ttBulkSave");
  $("zipSelectedBtn").hidden = none;
  $("zipSelectedBtn").title = t("ttBulkZip");
  const lockBulk = $("lockSelectedBtn");
  lockBulk.hidden = none;
  const sel = plays.filter((p) => selectedPlayIds.has(p.id));
  const allLocked = sel.length > 0 && sel.every((p) => p.locked);
  lockBulk.title = t(allLocked ? "ttBulkUnlock" : "ttBulkLock");
  lockBulk.querySelector(".ic-locked").style.display = allLocked ? "none" : "";
  lockBulk.querySelector(".ic-open").style.display = allLocked ? "" : "none";
  $("selectAllRow").hidden = filteredPlays().length < 2;
  $("selectAllLabel").textContent = t("selectAll");
  const visible = visiblePlays();
  const all = $("selectAllCheck");
  all.checked = visible.length > 0 && visible.every((p) => selectedPlayIds.has(p.id));
  all.indeterminate = !all.checked && visible.some((p) => selectedPlayIds.has(p.id));
  $("deleteAllBtn").hidden = plays.length === 0;
  $("deleteAllBtn").textContent = t("deleteAllBtn");
}

function renderHome() {
  playListEl.innerHTML = "";
  $("exportAllBtn").hidden = plays.length === 0;

  const search = $("playSearch");
  search.hidden = plays.length < 2;
  search.placeholder = t("searchPlays");

  const kf = $("kindFilter");
  kf.hidden = plays.length < 2;
  $("filterAll").textContent = t("filterAll");
  $("filterOffense").textContent = t("kindOffense");
  $("filterDefense").textContent = t("kindDefense");
  for (const b of kf.querySelectorAll(".seg-btn")) {
    b.classList.toggle("active", b.dataset.v === playKindFilter);
  }

  const ss = $("sortSelect");
  ss.hidden = plays.length < 2;
  ss.innerHTML = "";
  for (const [v, k] of [["custom", "sortCustom"], ["modified", "sortModified"],
                        ["created", "sortCreated"], ["alpha", "sortAlpha"]]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t(k);
    ss.append(o);
  }
  ss.value = playSort;

  const filtered = filteredPlays();
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  playPage = Math.min(Math.max(playPage, 0), pages - 1);
  pageOffset = playPage * PAGE_SIZE;
  const visible = filtered.slice(pageOffset, pageOffset + PAGE_SIZE);
  const reorderable = !playSearch.trim() && playKindFilter === "all" && playSort === "custom";

  const empty = $("noResults");
  empty.hidden = !(plays.length > 0 && filtered.length === 0);
  empty.textContent = t("noResults");

  $("pageRow").hidden = filtered.length <= PAGE_SIZE;
  $("pageLabel").textContent = (playPage + 1) + " / " + pages;
  $("pagePrev").disabled = playPage === 0;
  $("pageNext").disabled = playPage >= pages - 1;

  for (const p of visible) {
    const card = document.createElement("div");
    card.className = "play-card";
    card.dataset.id = p.id;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "card-check";
    check.checked = selectedPlayIds.has(p.id);
    check.addEventListener("click", (e) => e.stopPropagation());
    check.addEventListener("change", () => {
      if (check.checked) selectedPlayIds.add(p.id);
      else selectedPlayIds.delete(p.id);
      updateDeleteSelected();
    });

    const grip = document.createElement("span");
    grip.className = "card-grip";
    grip.title = t("ttReorder");
    grip.innerHTML =
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">' +
      '<circle cx="9" cy="5" r="1.8"/><circle cx="15" cy="5" r="1.8"/>' +
      '<circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/>' +
      '<circle cx="9" cy="19" r="1.8"/><circle cx="15" cy="19" r="1.8"/></svg>';
    if (reorderable) attachCardReorder(grip, card);
    else grip.classList.add("grip-off");

    const name = document.createElement("span");
    name.className = "card-name";
    name.textContent = p.name;

    // play type shows as the card's colour (border + tinted background)
    card.classList.add("kind-" + playKind(p));
    card.title = t(playKind(p) === "defense" ? "kindDefense" : "kindOffense");

    let badge = null;
    if (p.imported) {
      badge = document.createElement("span");
      badge.className = "card-badge";
      badge.textContent = t("importedBadge").trim().charAt(0);
      badge.title = t("importedBadge");
    }

    const dup = document.createElement("button");
    dup.className = "card-dup";
    dup.title = t("ttDuplicate");
    dup.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15 H4.5 A1.5 1.5 0 0 1 3 13.5 V4.5 A1.5 1.5 0 0 1 4.5 3 H13.5 A1.5 1.5 0 0 1 15 4.5 V5"/></svg>';
    dup.addEventListener("click", (e) => {
      e.stopPropagation();
      const copy = JSON.parse(JSON.stringify(p));
      copy.id = "play-" + Math.random().toString(36).slice(2, 10);
      delete copy.locked;
      delete copy.imported;
      copy.name = uniquePlayName(p.name);
      copy.createdAt = copy.updatedAt = Date.now();
      const idx = plays.findIndex((x) => x.id === p.id);
      plays.splice(idx + 1, 0, copy);
      save();
      renderHome();
      showToast(t("duplicatedToast", copy.name));
    });

    const shareIc = document.createElement("button");
    shareIc.className = "card-share";
    shareIc.title = t("ttShare");
    shareIc.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/>' +
      '<path d="M8.4 10.9 L15.6 6.3 M8.4 13.1 L15.6 17.7"/></svg>';
    shareIc.addEventListener("click", (e) => {
      e.stopPropagation();
      sharePlayFlow(p);
    });

    let lockIc = null;
    if (p.locked) {
      lockIc = document.createElement("span");
      lockIc.className = "card-lock";
      lockIc.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11 V7 a4 4 0 0 1 8 0 v4"/></svg>';
    }

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
      deletePlaysWithUndo([p.id]);
    });

    const meta = document.createElement("span");
    meta.className = "meta";
    const dateOpts = { day: "2-digit", month: "2-digit", year: "2-digit" };
    meta.textContent = p.steps.length + " " + (p.steps.length === 1 ? t("stepSingular") : t("stepPlural")) +
      (p.updatedAt ? " · " + new Date(p.updatedAt).toLocaleDateString(undefined, dateOpts) : "");
    if (p.createdAt) {
      card.title += "\n" + t("createdLabel") + ": " + new Date(p.createdAt).toLocaleDateString(undefined, dateOpts) +
        "\n" + t("modifiedLabel") + ": " + new Date(p.updatedAt).toLocaleDateString(undefined, dateOpts);
    }

    card.append(check, grip, name);
    if (lockIc) card.append(lockIc);
    if (badge) card.append(badge);
    card.append(meta, dup, shareIc, del);
    card.addEventListener("click", () => {
      if (cardDragJustEnded) return;
      openPlay(p.id);
    });
    playListEl.appendChild(card);
  }
  updateDeleteSelected();
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
      // new index = page offset + how many other cards' centres sit above the drop point
      const others = [...playListEl.querySelectorAll(".play-card")].filter((c) => c !== card);
      const newIdx = pageOffset + others.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.top + r.height / 2 < ev.clientY;
      }).length;
      const oldIdx = plays.findIndex((p) => p.id === card.dataset.id);
      if (oldIdx >= 0 && newIdx !== oldIdx) {
        const [p] = plays.splice(oldIdx, 1);
        plays.splice(newIdx, 0, p);
        localStorage.setItem("playbook-reordered", "1");
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

function defaultStep(kind) {
  // Offensive play: players lined up out of bounds above the baseline.
  // Defensive play: the offence waits in a spread set as context and the
  // defenders (the team being coached) line up out of bounds instead.
  const pos = {};
  PLAYER_IDS.forEach((id, i) => {
    pos[id] = { x: 9 + i * 8, y: -3 };
  });
  if (kind === "defense") {
    const spread = [
      { x: 25, y: 33 }, { x: 7, y: 25 }, { x: 43, y: 25 },
      { x: 18, y: 19 }, { x: 32, y: 19 },
    ];
    PLAYER_IDS.forEach((id, i) => { pos[id] = { ...spread[i] }; });
    DEFENDER_IDS.forEach((id, i) => { pos[id] = { x: 9 + i * 8, y: -3 }; });
  }
  return { pos, moves: {}, ball: "P1", pass: null };
}

function createPlay(name, kind, court) {
  const play = {
    id: "play-" + Math.random().toString(36).slice(2, 10),
    name,
    kind: kind === "defense" ? "defense" : "offense",
    court: court === "full" ? "full" : "half",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps: [defaultStep(kind)],
  };
  if (play.kind === "defense") play.defense = true;
  plays.push(play);
  save();
  return play;
}

function currentPlay() {
  return viewPlay || plays.find((p) => p.id === currentPlayId);
}

// Editing is blocked in the shared viewer and on locked plays.
function editLocked() {
  const p = currentPlay();
  return !!(viewPlay || (p && p.locked));
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
  // the offset grows with the token size (plus a little extra) so the
  // ball always sits beside the carrier's number, never on top of it
  const k = tokenScale() * 1.16;
  return { x: p.x + BALL_OFFSET.x * k, y: p.y + BALL_OFFSET.y * k };
}

function hasMoves(step) {
  return Object.keys(step.moves).length > 0 || !!step.pass ||
    !!(step.maybePasses && step.maybePasses.length);
}

// Positions after applying a step's drawn arrows.
function derivedNextPos(step) {
  const out = {};
  for (const id of idsFor(currentPlay())) {
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

// When the ball carrier has both a pass AND a movement, pass.order decides
// which happens first: 1 = pass first then move (give and go),
// 2 = move first with the ball (dribble) then pass from the movement's end.
function passOrderOf(step) {
  return step.pass && step.moves[step.ball] && step.pass.order === 2 ? 2 : 1;
}

// Start/end points of the pass arrow (court coords, ball-offset applied).
function passEndpoints(step) {
  const ownerMove = step.moves[step.ball];
  const a = ballPoint(passOrderOf(step) === 2 ? ownerMove.to : step.pos[step.ball]);
  const rm = step.moves[step.pass.to];
  const b = ballPoint(rm ? rm.to : step.pos[step.pass.to]);
  return { a, b };
}

// Order of events inside a step:
//   main:      screeners + every cut that doesn't use a screen (and the pass,
//              when the receiver is static and the carrier isn't dribbling first)
//   recv:      cuts that use a screen
//   pass:      a pass that had to wait (moving receiver, or thrown after a dribble)
//   ownermove: the carrier's own cut when it comes after the pass
function segmentPhases(step) {
  const receivers = screenReceivers(step);
  const owner = step.ball;
  const pass = step.pass;
  const ownerMove = step.moves[owner];
  const receiverMoves = !!(pass && step.moves[pass.to]);
  const passOrder = passOrderOf(step);
  const ownerMoveLate = !!(ownerMove && pass && passOrder === 1);
  const hasMaybes = !!(step.maybePasses && step.maybePasses.length) &&
    !currentPlay().probeOff && !currentPlay().maybesHidden;
  const passInMain = !!(pass && !receiverMoves && passOrder === 1) && !hasMaybes;
  const moverIds = Object.keys(step.moves);
  // in defensive plays the attack acts first and the defence reacts in
  // its own closing phase
  const defKind = playKind(currentPlay()) === "defense";
  const attackMovers = defKind
    ? moverIds.filter((id) => !DEFENDER_IDS.includes(id))
    : moverIds;
  const phases = [];
  const hasMain = attackMovers.some((id) => !receivers.has(id) && !(id === owner && ownerMoveLate)) ||
    passInMain;
  if (hasMain) phases.push("main");
  if (attackMovers.some((id) => receivers.has(id) && !(id === owner && ownerMoveLate))) phases.push("recv");
  if (hasMaybes) phases.push("maybe");
  if (pass && !passInMain) phases.push("pass");
  if (ownerMoveLate) phases.push("ownermove");
  if (defKind && moverIds.some((id) => DEFENDER_IDS.includes(id))) phases.push("defense");
  return { phases, receivers, owner, ownerMoveLate, passInMain };
}

// Arrows on the last step play as a pending segment even before
// "Next step" commits them, so drawing is immediately watchable.
function segmentCount(play) {
  const n = play.steps.length;
  // the pending segment only exists if the last step will actually play
  return n - 1 + (segmentPhases(play.steps[n - 1]).phases.length > 0 ? 1 : 0);
}

// Playback duration of a segment at 1x: one slot per sequential phase.
function segmentDuration(play, i) {
  const step = play.steps[Math.min(i, play.steps.length - 1)];
  const ph = segmentPhases(step).phases.length;
  // a step with nothing visible to play (e.g. only hidden possible
  // passes) is skipped almost instantly
  if (ph === 0) return 0.05;
  return ph * SECONDS_PER_PHASE;
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
    for (const id of idsFor(play)) out[id] = { ...step0.pos[id] };
    out.BALL = ballPoint(step0.pos[step0.ball]);
    return out;
  }
  t = Math.min(Math.max(t, 0), segs);
  const i = Math.min(Math.floor(t), segs - 1);
  const frac = Math.min(Math.max(t - i, 0), 1);
  const from = play.steps[Math.min(i, play.steps.length - 1)];
  const target = segmentTargetPos(play, i);
  const { phases, receivers, owner, ownerMoveLate, passInMain } = segmentPhases(from);
  const n = Math.max(phases.length, 1);
  const localU = (name) => {
    const k = phases.indexOf(name);
    if (k < 0) return 1;
    return Math.min(Math.max(frac * n - k, 0), 1);
  };

  for (const id of idsFor(play)) {
    const a = from.pos[id];
    const b = target[id];
    const m = from.moves[id];
    let u;
    if (m && id === owner && ownerMoveLate) u = easeInOutCubic(localU("ownermove"));
    else if (m && DEFENDER_IDS.includes(id) && phases.includes("defense")) u = easeInOutCubic(localU("defense"));
    else if (m) u = easeInOutCubic(localU(receivers.has(id) ? "recv" : "main"));
    else u = easeInOutCubic(frac);
    out[id] = m && m.via
      ? bezierPoint(a, m.via, b, u)
      : { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
  }

  // Possible passes: the ball zips to each optional receiver and back,
  // in the order they were drawn, inside its own quick phase.
  const maybes = (play.probeOff || play.maybesHidden ? null : from.maybePasses) || [];
  const mu = maybes.length ? localU("maybe") : 1;
  if (maybes.length && mu > 0 && mu < 1) {
    const N = maybes.length;
    const slice = Math.min(Math.floor(mu * N), N - 1);
    const local = mu * N - slice;
    const tri = local < 0.5 ? local * 2 : 2 - local * 2;
    const u2 = easeInOutCubic(tri);
    const A = ballPoint(out[from.ball]);
    const B = ballPoint(out[maybes[slice].to]);
    out.BALL = { x: lerp(A.x, B.x, u2), y: lerp(A.y, B.y, u2) };
    return out;
  }

  // Ball: attached to its owner unless a pass is in flight (the owner never
  // moves while the ball flies, so the departure point is stable; a dribbling
  // owner carries the ball through their move first).
  if (!from.pass) {
    out.BALL = ballPoint(out[from.ball]);
  } else {
    const u = easeInOutCubic(localU(passInMain ? "main" : "pass"));
    if (u <= 0) out.BALL = ballPoint(out[from.ball]);
    else if (u >= 1) out.BALL = ballPoint(out[from.pass.to]);
    else {
      const A = ballPoint(out[from.ball]);
      const B = ballPoint(out[from.pass.to]);
      out.BALL = { x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u) };
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
  return JSON.stringify({
    name: p.name, steps: p.steps, defense: !!p.defense,
    tokenScale: p.tokenScale != null ? p.tokenScale : null,
    defTokenScale: p.defTokenScale != null ? p.defTokenScale : null,
    currentStep,
  });
}

function pushUndo() {
  undoStack.push(snapshotState());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
  // an edited imported play becomes the user's own
  const p = currentPlay();
  if (p && !viewPlay) {
    if (p.imported) delete p.imported;
    p.updatedAt = Date.now();
  }
}

function beginAction() {
  pendingSnapshot = snapshotState();
}

function endAction() {
  if (pendingSnapshot !== null && pendingSnapshot !== snapshotState()) {
    undoStack.push(pendingSnapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    const p = currentPlay();
    if (p && !viewPlay) {
      if (p.imported) delete p.imported;
      p.updatedAt = Date.now();
    }
  }
  pendingSnapshot = null;
  updateUndoButtons();
}

function restoreState(json) {
  const snap = JSON.parse(json);
  const p = currentPlay();
  p.name = snap.name;
  p.steps = snap.steps;
  p.defense = !!snap.defense;
  if (snap.tokenScale != null) p.tokenScale = snap.tokenScale; else delete p.tokenScale;
  if (snap.defTokenScale != null) p.defTokenScale = snap.defTokenScale; else delete p.defTokenScale;
  currentStep = Math.min(snap.currentStep, p.steps.length - 1);
  playhead = currentStep;
  save();
  renderAll();
}

function doUndo() {
  if (editLocked()) return;
  if (!undoStack.length) return;
  stopPlayback();
  redoStack.push(snapshotState());
  restoreState(undoStack.pop());
  updateUndoButtons();
}

function doRedo() {
  if (editLocked()) return;
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
  syncBallChain(); // the pass timing may depend on this move
}

function deleteMove(tokenId) {
  const steps = currentPlay().steps;
  if (!steps[currentStep].moves[tokenId]) return false;
  delete steps[currentStep].moves[tokenId];
  if (currentStep + 1 < steps.length) {
    steps[currentStep + 1].pos[tokenId] = { ...steps[currentStep].pos[tokenId] };
  }
  syncBallChain();
  return true;
}

function moveToken(tokenId, p) {
  const steps = currentPlay().steps;
  const prevPos = { ...steps[currentStep].pos[tokenId] };
  steps[currentStep].pos[tokenId] = p;
  // An arrow arriving from the previous step must follow its target.
  if (currentStep > 0 && steps[currentStep - 1].moves[tokenId]) {
    steps[currentStep - 1].moves[tokenId].to = { ...p };
  }
  // A silent mover dragged mid-play carries the new spot into the
  // following steps that still sat on the old one — no gliding back.
  if (isSilentMover(currentPlay(), tokenId)) {
    for (let i = currentStep + 1; i < steps.length; i++) {
      const q = steps[i].pos[tokenId];
      if (!q || Math.hypot(q.x - prevPos.x, q.y - prevPos.y) > 0.01) break;
      steps[i].pos[tokenId] = { ...p };
    }
  }
}

// Nearest pass target for a point. A teammate with a movement can ONLY be
// reached at the end of that movement ("after"); a static teammate is
// reached where they stand ("before").
function nearestPassTarget(step, p) {
  let best = null, bd = Infinity;
  for (const id of PLAYER_IDS) {
    if (id === step.ball) continue;
    const m = step.moves[id];
    if (m && m.type === "screen") continue; // screeners can't receive the ball
    const spot = m ? m.to : step.pos[id];
    const d = Math.hypot(spot.x - p.x, spot.y - p.y);
    if (d < bd) { bd = d; best = { to: id, timing: m ? "after" : "before" }; }
  }
  return best;
}

// Ball ownership flows through the steps: each step starts with whoever
// ended the previous one with the ball. Passes to oneself are dropped.
function syncBallChain() {
  const steps = currentPlay().steps;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (i > 0) s.ball = steps[i - 1].pass ? steps[i - 1].pass.to : steps[i - 1].ball;
    if (s.pass && s.pass.to === s.ball) s.pass = null;
    // possible passes never point at the carrier, at a screener, or at
    // the receiver of the actual pass — the real pass overrides the
    // option (and the next lane in line becomes the main one)
    if (s.maybePasses) {
      s.maybePasses = s.maybePasses.filter((mp) => {
        if (mp.to === s.ball || !PLAYER_IDS.includes(mp.to)) return false;
        if (s.pass && s.pass.to === mp.to) return false;
        const rm = s.moves[mp.to];
        return !(rm && rm.type === "screen");
      });
      if (!s.maybePasses.length) delete s.maybePasses;
    }
    // the ball carrier can never be setting a screen
    const om = s.moves[s.ball];
    if (om && om.type === "screen") {
      om.type = "move";
      delete om.angle;
    }
    if (s.pass) {
      const rm = s.moves[s.pass.to];
      // a screener can never receive the ball
      if (rm && rm.type === "screen") {
        s.pass = null;
      } else {
        // a moving receiver is always reached at the END of their movement
        s.pass.timing = rm ? "after" : "before";
        // action order only exists when the carrier also moves
        if (s.moves[s.ball]) s.pass.order = s.pass.order === 2 ? 2 : 1;
        else delete s.pass.order;
      }
    }
  }
}

/* ================= Rendering ================= */

function renderAll() {
  playNameEl.value = currentPlay().name;
  sizeNameInput();
  $("defenseBtn").hidden = playKind(currentPlay()) === "defense";
  $("defenseBtn").classList.toggle("on", !!currentPlay().defense);
  updateMaybeControls();
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
    const deletable = !editLocked() && steps.length > 1 &&
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

// Optional defenders: five X markers that place and move like players.
function toggleDefense() {
  if (editLocked()) return;
  const play = currentPlay();
  if (playKind(play) === "defense") return; // the offence is always there
  pushUndo();
  if (!play.defense) {
    play.defense = true;
    // one sag position per defender (from step 1's offence, toward the
    // hoop), identical across steps so playback has no jumps
    const hoop = { x: 25, y: 5.25 };
    const defaults = {};
    DEFENDER_IDS.forEach((id, i) => {
      const p = play.steps[0].pos[PLAYER_IDS[i]];
      const dx = hoop.x - p.x, dy = hoop.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      defaults[id] = clampPoint({ x: p.x + (dx / d) * 3.5, y: p.y + (dy / d) * 3.5 });
    });
    for (const step of play.steps) {
      for (const id of DEFENDER_IDS) {
        if (!step.pos[id]) step.pos[id] = { ...defaults[id] };
      }
    }
  } else {
    play.defense = false;
    for (const step of play.steps) {
      for (const id of DEFENDER_IDS) {
        delete step.pos[id];
        delete step.moves[id];
      }
    }
  }
  save();
  renderAll();
}

$("defenseBtn").addEventListener("click", toggleDefense);

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
  for (const def of defsFor(currentPlay())) {
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

// The classic dribble squiggle: points along the (possibly curved) path,
// offset perpendicular by a sine wave that tapers at both ends. The tail
// stays on the path so the arrowhead sits clean.
function wavyPoints(a, via, b) {
  const pt = (u) => via
    ? { x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * via.x + u * u * b.x,
        y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * via.y + u * u * b.y }
    : { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  let len = 0, prev = pt(0);
  for (let i = 1; i <= 24; i++) {
    const p = pt(i / 24);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  if (len < 4) return [a, b];
  const waves = Math.max(Math.round(len / 2.1), 2);
  const N = waves * 10;
  const amp = 0.55;
  const pts = [a];
  for (let i = 1; i < N; i++) {
    const u = i / N;
    const p = pt(u);
    const q = pt(Math.min(u + 0.01, 1));
    let tx = q.x - p.x, ty = q.y - p.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const off = Math.sin(u * waves * 2 * Math.PI) * amp * Math.sin(Math.PI * u);
    pts.push({ x: p.x - ty * off, y: p.y + tx * off });
  }
  pts.push(b);
  return pts;
}

function wavyPathD(a, via, b) {
  const pts = wavyPoints(a, via, b);
  return "M " + pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ");
}

// A move by the ball carrier is a dribble unless the pass leaves first.
function isDribbleMove(step, id, m) {
  return m.type === "move" && id === step.ball &&
    (!step.pass || passOrderOf(step) === 2);
}

// Pull a line's endpoint back towards its origin so the tip lands just
// in front of the receiver's circle instead of underneath it.
function tokenScale() {
  const p = currentPlay();
  return (p && p.tokenScale) || 1;
}
function defTokenScale() {
  const p = currentPlay();
  if (!p) return 1;
  return p.defTokenScale != null ? p.defTokenScale : (p.tokenScale || 1);
}
function receiverGap() {
  return 2.9 * tokenScale();
}
function shortenTo(a, b, dist) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= dist + 0.5) return b;
  const k = (len - dist) / len;
  return { x: a.x + dx * k, y: a.y + dy * k };
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

function makeArrowEls(tokenId, a, move, ghost, dribble) {
  const els = [];
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", dribble
    ? wavyPathD(a, move.via, move.to)
    : arrowPathD(a, move.via, move.to));
  let cls = "arrow-path " + move.type;
  if (tokenId === "BALL") cls += " ball-path";
  const isDef = DEFENDER_IDS.includes(tokenId);
  if (isDef) cls += " def";
  if (ghost) cls += " ghost";
  path.setAttribute("class", cls);
  if (move.type === "move") {
    path.setAttribute("marker-end", isDef ? "url(#arrowHeadDef)" : "url(#arrowHead)");
  }
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

// Defender moves are silent: no arrow on the sketch, just a faint X at
// the destination while editing the step. Drag the X to retarget the
// move, click it with the eraser to remove it, or redraw with the
// arrow tool to replace it.
function makeDefGhostEls(tokenId, from, to) {
  const s = 1.3 * (DEFENDER_IDS.includes(tokenId) ? defTokenScale() : tokenScale());
  const xd = (p) =>
    `M ${p.x + s} ${p.y} A ${s} ${s} 0 1 0 ${p.x - s} ${p.y} A ${s} ${s} 0 1 0 ${p.x + s} ${p.y}`;
  // whisper-thin tie back to where the defender starts the step
  const tie = document.createElementNS(SVG_NS, "line");
  tie.setAttribute("x1", from.x);
  tie.setAttribute("y1", from.y);
  tie.setAttribute("x2", to.x);
  tie.setAttribute("y2", to.y);
  tie.setAttribute("class", "def-ghost-tie" + (DEFENDER_IDS.includes(tokenId) ? "" : " off"));
  tie.dataset.token = tokenId;
  const isDefTeam = DEFENDER_IDS.includes(tokenId);
  const x = document.createElementNS(SVG_NS, "path");
  x.setAttribute("d", xd(to));
  x.setAttribute("class", "def-ghost" + (isDefTeam ? "" : " off"));
  x.dataset.token = tokenId;
  const hit = document.createElementNS(SVG_NS, "circle");
  hit.setAttribute("cx", to.x);
  hit.setAttribute("cy", to.y);
  hit.setAttribute("r", 2.3);
  hit.setAttribute("class", "def-ghost-hit");
  hit.setAttribute("pointer-events", "all");
  hit.dataset.token = tokenId;

  const startDrag = (e) => {
    if (playing || editLocked() || tool === "eraser" || playhead !== currentStep) return;
    e.preventDefault();
    e.stopPropagation(); // the stage must not pan (or draw a pass) under it
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    beginAction();
    const step = currentPlay().steps[currentStep];
    const move = (ev) => {
      const p = pointerToCourt(ev);
      step.moves[tokenId].to = p;
      // reposition in place — a rebuild would kill the pointer capture
      x.setAttribute("d", xd(p));
      hit.setAttribute("cx", p.x);
      hit.setAttribute("cy", p.y);
      tie.setAttribute("x2", p.x);
      tie.setAttribute("y2", p.y);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setMove(tokenId, step.moves[tokenId]); // keeps the next step in sync
      endAction();
      save();
      refreshEdit();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  x.addEventListener("pointerdown", startDrag);
  hit.addEventListener("pointerdown", startDrag);
  return [tie, x, hit];
}

// Give one of the ball carrier's two actions preference (make it happen first).
function preferOrder(passFirst) {
  if (editLocked()) return;
  const step = currentPlay().steps[currentStep];
  if (!step.pass || !step.moves[step.ball]) return;
  const want = passFirst ? 1 : 2;
  if (passOrderOf(step) === want) return;
  pushUndo();
  step.pass.order = want;
  save();
  refreshEdit();
}

// Areas of action (defensive plays): a soft rectangle per defender.
function makeZoneEls(tokenId, z, ghost) {
  const color = ZONE_COLORS[tokenId];
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", z.x);
  rect.setAttribute("y", z.y);
  rect.setAttribute("width", z.w);
  rect.setAttribute("height", z.h);
  rect.setAttribute("rx", 0.8);
  rect.setAttribute("fill", color);
  rect.setAttribute("stroke", color);
  rect.setAttribute("class", "zone-rect" + (ghost ? " ghost" : ""));
  rect.dataset.token = tokenId;
  const num = document.createElementNS(SVG_NS, "text");
  num.setAttribute("x", z.x + z.w / 2);
  num.setAttribute("y", z.y + z.h / 2);
  num.setAttribute("fill", color);
  num.setAttribute("class", "zone-num" + (ghost ? " ghost" : ""));
  num.textContent = tokenId.slice(1);
  return [rect, num];
}

function nearestDefenderTo(step, p) {
  let best = null, bd = Infinity;
  for (const id of DEFENDER_IDS) {
    const d = Math.hypot(step.pos[id].x - p.x, step.pos[id].y - p.y);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

function renderZones(step, ghost) {
  if (!step.zones) return;
  for (const id of DEFENDER_IDS) {
    const z = step.zones[id];
    if (!z) continue;
    const els = makeZoneEls(id, z, ghost);
    const [rectEl, numEl] = els;
    rectEl.addEventListener("pointerdown", (e) => {
      if (playing || editLocked()) return;
      if (tool === "eraser") {
        e.preventDefault();
        e.stopPropagation();
        pushUndo();
        delete currentPlay().steps[currentStep].zones[id];
        save();
        refreshEdit();
        return;
      }
      // grab and move the whole area (any tool except the eraser, which
      // deletes, and the pass tool, which draws over it)
      if (tool === "pass" || playhead !== currentStep) return;
      e.preventDefault();
      e.stopPropagation();
      try { rectEl.setPointerCapture(e.pointerId); } catch (_) {}
      beginAction();
      const zz = currentPlay().steps[currentStep].zones[id];
      const startPt = pointerToCourt(e);
      const orig = { x: zz.x, y: zz.y };
      const move = (ev) => {
        const p = pointerToCourt(ev);
        zz.x = Math.min(Math.max(orig.x + p.x - startPt.x, CLAMP.minX), CLAMP.maxX - zz.w);
        zz.y = Math.min(Math.max(orig.y + p.y - startPt.y, CLAMP.minY), CLAMP.maxY - zz.h);
        rectEl.setAttribute("x", zz.x);
        rectEl.setAttribute("y", zz.y);
        numEl.setAttribute("x", zz.x + zz.w / 2);
        numEl.setAttribute("y", zz.y + zz.h / 2);
      };
      const up = () => {
        rectEl.removeEventListener("pointermove", move);
        rectEl.removeEventListener("pointerup", up);
        rectEl.removeEventListener("pointercancel", up);
        endAction();
        save();
        refreshEdit();
      };
      rectEl.addEventListener("pointermove", move);
      rectEl.addEventListener("pointerup", up);
      rectEl.addEventListener("pointercancel", up);
    });
    for (const el of els) arrowsGroup.appendChild(el);
  }
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
  renderZones(step, ghost && !playing); // guides stay visible in playback
  const addEls = (els) => {
    for (const el of els) {
      el.addEventListener("pointerdown", (e) => {
        if (tool !== "eraser" || playing || editLocked()) return;
        e.preventDefault();
        e.stopPropagation();
        eraseMove(el.dataset.token);
      });
      arrowsGroup.appendChild(el);
    }
  };

  // The carrier's two actions (pass + move) are ordered: the later one draws
  // lighter; double-click or long-press a line to make it go first.
  const ownerMove = step.moves[step.ball];
  const dual = !!(step.pass && ownerMove);
  const passOrder = dual ? passOrderOf(step) : 1;
  const addOrderHandlers = (els, passFirst) => {
    const attach = (el) => {
      el.classList.add("order-line");
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        preferOrder(passFirst);
      });
      // long-press on touch (with a jitter threshold), right-click on desktop
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        preferOrder(passFirst);
      });
      el.addEventListener("pointerdown", (e) => {
        if (tool === "eraser" || playing || editLocked()) return;
        const sx = e.clientX, sy = e.clientY;
        const timer = setTimeout(() => preferOrder(passFirst), 450);
        const cancel = () => {
          clearTimeout(timer);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", cancel);
          window.removeEventListener("pointercancel", cancel);
        };
        const onMove = (ev) => {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) cancel();
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", cancel);
        window.addEventListener("pointercancel", cancel);
      });
    };
    for (const el of els) {
      attach(el);
      // a wide invisible twin makes the thin line easy to hit
      if (el.tagName === "path") {
        const hit = document.createElementNS(SVG_NS, "path");
        hit.setAttribute("d", el.getAttribute("d"));
        hit.setAttribute("class", "order-hit");
        hit.dataset.token = el.dataset.token;
        addEls([hit]); // keeps the eraser working on it too
        attach(hit);
      }
    }
  };

  for (const id of idsFor(play)) {
    const m = step.moves[id];
    if (!m) continue;
    if (isSilentMover(play, id)) {
      // silent move — destination hint while paused (extra faint when
      // the playhead sits on another step), never during playback
      if (!playing) {
        const gels = makeDefGhostEls(id, step.pos[id], m.to);
        if (ghost) for (const el of gels) el.classList.add("ghost");
        addEls(gels);
      }
      continue;
    }
    const isDualMove = dual && id === step.ball;
    const els = makeArrowEls(id, step.pos[id], m,
      ghost || (isDualMove && passOrder === 1), isDribbleMove(step, id, m));
    addEls(els);
    if (isDualMove) addOrderHandlers(els, false);
  }
  if (step.pass) {
    const { a } = passEndpoints(step);
    const prm = step.moves[step.pass.to];
    const bCenter = prm ? prm.to : step.pos[step.pass.to];
    const els = makeArrowEls("BALL", a, { to: shortenTo(a, bCenter, receiverGap()), via: null, type: "move" },
      ghost || (dual && passOrder === 2));
    addEls(els);
    if (dual) addOrderHandlers(els, true);
  }

  // possible passes: lighter dashed lanes ending in a star, erasable one
  // by one, probed by the ball in drawn order during playback
  const maybes = (play.maybesHidden ? null : step.maybePasses) || [];
  if (maybes.length) {
    const aM = ballPoint(ownerMove && passOrderOf(step) === 2 ? ownerMove.to : step.pos[step.ball]);
    maybes.forEach((mp, idx) => {
      const rm = step.moves[mp.to];
      const bM = shortenTo(aM, rm ? rm.to : step.pos[mp.to], receiverGap());
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", arrowPathD(aM, null, bM));
      path.setAttribute("class", "arrow-path move ball-path maybe" +
        (idx === 0 ? " main" : "") + (ghost ? " ghost" : ""));
      path.setAttribute("marker-end", "url(#maybeStar)");
      const hit = document.createElementNS(SVG_NS, "path");
      hit.setAttribute("d", path.getAttribute("d"));
      hit.setAttribute("class", "order-hit");
      for (const el of [path, hit]) {
        el.addEventListener("pointerdown", (e) => {
          if (tool !== "eraser" || playing || editLocked()) return;
          e.preventDefault();
          e.stopPropagation();
          pushUndo();
          const list = currentPlay().steps[currentStep].maybePasses;
          list.splice(idx, 1);
          if (!list.length) delete currentPlay().steps[currentStep].maybePasses;
          save();
          refreshEdit();
        });
        arrowsGroup.appendChild(el);
      }
    });
  }

  // one-time hint the first time a player has two ordered actions
  if (dual && !playing && !editLocked() && !localStorage.getItem("playbook-order-help")) {
    localStorage.setItem("playbook-order-help", "1");
    showToast(t("orderHelp"));
  }
}

function handlePoint(step, tokenId, kind) {
  let a, to, via;
  if (tokenId === "BALL") {
    const ends = passEndpoints(step);
    a = ends.a;
    // the pass line stops short of the receiver, and its handle must sit
    // on the visible tip, not on the old full-length endpoint
    const prm = step.moves[step.pass.to];
    to = shortenTo(a, prm ? prm.to : step.pos[step.pass.to], receiverGap());
    via = null; // passes are straight
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
  if (playing || editLocked() || playhead !== currentStep) return;
  const step = currentPlay().steps[currentStep];
  for (const d of defsFor(currentPlay())) {
    if (isSilentMover(currentPlay(), d.id)) continue; // silent moves have no handles
    if (!hasArrow(step, d.id)) continue;
    // passes are straight lines: destination handle only
    const kinds = d.id === "BALL" ? ["end"] : ["end", "mid"];
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
function updateMaybeControls() {
  const p = currentPlay();
  const anyMaybes = p.steps.some((st) => st.maybePasses && st.maybePasses.length);
  $("maybeControls").hidden = playKind(p) !== "offense";
  $("maybeShowTog").checked = !p.maybesHidden;
  $("maybeShowTog").disabled = !anyMaybes;
  $("maybeTog").checked = !p.probeOff;
  $("maybeTog").disabled = !anyMaybes || !!p.maybesHidden;
  $("tokenSizeRange").value = String(sizeTeams.A ? tokenScale() : defTokenScale());
  stageEl.style.setProperty("--tok", String(tokenScale()));
  stageEl.style.setProperty("--tokD", String(defTokenScale()));
}

function refreshEdit() {
  renderPositions(positionsAt(playhead));
  renderArrows();
  renderHandles();
  renderScrubber();
  updateAddStepState();
  updateMaybeControls();
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
  const p = currentPlay();
  const selectBtn = toolbar.querySelector('[data-tool="select"]');
  // the acting team is placed on step 1 only, but the silent team stays
  // draggable on every step — the select tool survives when one exists
  const disabled = currentStep > 0 && contextIds(p).length === 0;
  selectBtn.disabled = disabled;
  if (disabled && tool === "select") setTool("arrow");
  // screens are offensive, zones are defensive — they share the slot;
  // possible passes only exist on offense
  const isDef = playKind(p) === "defense";
  toolbar.querySelector('[data-tool="screen"]').hidden = isDef;
  toolbar.querySelector('[data-tool="zone"]').hidden = !isDef;
  toolbar.querySelector('[data-tool="mpass"]').hidden = isDef;
  if (isDef && (tool === "screen" || tool === "mpass")) setTool("arrow");
  if (!isDef && tool === "zone") setTool("arrow");
}

/* On small screens the toolbar folds down to the active tool; a tap
   opens it vertically, picking a tool (or tapping outside) folds it. */
const SMALL_MQ = window.matchMedia("(max-width: 640px)");
let toolbarFolded = true;

function applyToolbarFold() {
  const small = SMALL_MQ.matches;
  toolbar.classList.toggle("vertical", small);
  toolbar.classList.toggle("folded", small && toolbarFolded);
}

function setToolbarFolded(v) {
  toolbarFolded = v;
  applyToolbarFold();
}

SMALL_MQ.addEventListener("change", applyToolbarFold);

toolbar.addEventListener("click", (e) => {
  const btn = e.target.closest(".tool");
  if (!btn) return;
  if (SMALL_MQ.matches && toolbarFolded) {
    setToolbarFolded(false); // first tap just opens the toolbar
    return;
  }
  if (btn.dataset.tool && !btn.disabled) {
    setTool(btn.dataset.tool);
    if (SMALL_MQ.matches) setToolbarFolded(true);
  }
});

document.addEventListener("pointerdown", (e) => {
  if (!SMALL_MQ.matches || toolbarFolded) return;
  if (!e.target.closest("#toolbar")) setToolbarFolded(true);
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
  // order lines keep their own dblclick/long-press — capturing here would
  // retarget those events to the stage and swallow them
  if (e.target.closest(".token, .handle, .order-line")) return;
  // pass tool: the line always starts at the ball, so any drag on the
  // court draws a pass — no need to hit the ball itself
  if (tool === "pass" && !playing && !editLocked()) {
    playhead = currentStep;
    startArrowDraw(stageEl, "BALL", e);
    return;
  }
  // zone tool: draw an area anywhere; it belongs to the nearest defender
  if (tool === "zone" && !playing && !editLocked() && playKind(currentPlay()) === "defense") {
    playhead = currentStep;
    startZoneDraw(stageEl, null, e);
    return;
  }
  // possible-pass tool: same anywhere-drag as the real pass
  if (tool === "mpass" && !playing && !editLocked() && playKind(currentPlay()) === "offense") {
    playhead = currentStep;
    startMaybeDraw(stageEl, e);
    return;
  }
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
  if (e.target.closest(".token, .handle, .order-line")) return;
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
    if (playing || editLocked()) return;
    // Editing always happens on an exact step.
    playhead = currentStep;
    e.preventDefault();

    if (tool === "eraser") {
      eraseMove(tokenId);
      return;
    }

    if (tool === "pass") {
      startArrowDraw(el, "BALL", e);
      return;
    }

    if (tool === "zone") {
      if (DEFENDER_IDS.includes(tokenId) && playKind(currentPlay()) === "defense") {
        startZoneDraw(el, tokenId, e);
      }
      return;
    }

    if (tool === "mpass") {
      if (playKind(currentPlay()) === "offense") startMaybeDraw(el, e);
      return;
    }

    if (tool === "arrow" || tool === "screen") {
      startArrowDraw(el, tokenId, e);
      return;
    }

    // select tool: the acting team only on step 1; the silent team
    // repositions anywhere (it glides there in playback, no arrow)
    if (currentStep > 0 && !isSilentMover(currentPlay(), tokenId)) return;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
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
  // Any arrow drawn from the ball is a pass; screens belong to players —
  // but never to the ball carrier.
  const isPass = tokenId === "BALL";
  const isDefender = DEFENDER_IDS.includes(tokenId);
  const type = tool === "screen" && !isPass && !isDefender &&
    playKind(currentPlay()) === "offense" && tokenId !== step.ball ? "screen" : "move";
  const start = isPass ? ballPoint(step.pos[step.ball]) : step.pos[tokenId];
  try { el.setPointerCapture(e.pointerId); } catch (_) {}

  let dest = null;
  const drawPreview = () => {
    previewGroup.innerHTML = "";
    if (!dest) return;
    const dribble = !isPass && type === "move" && tokenId === step.ball &&
      (!step.pass || passOrderOf(step) === 2);
    for (const p of makeArrowEls(tokenId, start, { to: dest, via: null, type }, false, dribble)) {
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

// Drag from a defender to mark their area of action: corner to corner,
// stored per step and carried into new steps until redrawn.
function startZoneDraw(el, tokenId, e) {
  const start = pointerToCourt(e);
  const step = currentPlay().steps[currentStep];
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  let dest = null;
  const rectFrom = (a, b) => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
  });
  // drawn from a defender the area is theirs; drawn from open court it
  // goes to whoever is closest to its centre (live in the preview)
  const ownerOf = (z) => tokenId ||
    nearestDefenderTo(step, { x: z.x + z.w / 2, y: z.y + z.h / 2 });
  const drawPreview = () => {
    previewGroup.innerHTML = "";
    if (!dest) return;
    const z = rectFrom(start, dest);
    for (const p of makeZoneEls(ownerOf(z), z, false)) {
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
    if (dest) {
      const z = rectFrom(start, dest);
      if (z.w > 2.5 && z.h > 2.5) {
        pushUndo();
        if (!step.zones) step.zones = {};
        step.zones[ownerOf(z)] = z;
        save();
      }
    }
    refreshEdit();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

// A possible pass: an optional lane the ball probes during playback.
// Drawn like a pass (from wherever the ball is), snapping to a teammate.
function startMaybeDraw(el, e) {
  const step = currentPlay().steps[currentStep];
  const om = step.moves[step.ball];
  const start = ballPoint(om && passOrderOf(step) === 2 ? om.to : step.pos[step.ball]);
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  let dest = null;
  const drawPreview = () => {
    previewGroup.innerHTML = "";
    if (!dest) return;
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", arrowPathD(start, null, dest));
    const willBeMain = !(step.maybePasses && step.maybePasses.length);
    p.setAttribute("class", "arrow-path move ball-path maybe preview" + (willBeMain ? " main" : ""));
    p.setAttribute("marker-end", "url(#maybeStar)");
    previewGroup.appendChild(p);
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
      const tgt = nearestPassTarget(step, dest);
      // the actual pass owns its receiver — no possible pass may overlap it
      if (tgt && tgt.to !== step.ball && !(step.pass && step.pass.to === tgt.to)) {
        const list = step.maybePasses || [];
        if (!list.some((mp) => mp.to === tgt.to)) {
          pushUndo();
          list.push({ to: tgt.to });
          step.maybePasses = list;
          save();
        }
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

    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
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

function applyLockState() {
  const p = viewPlay ? null : currentPlay();
  const locked = !!(p && p.locked);
  document.body.classList.toggle("play-locked", locked);
  if (!viewPlay) playNameEl.readOnly = locked;
  const b = $("lockBtn");
  b.classList.toggle("locked", locked);
  b.querySelector(".ic-locked").style.display = locked ? "" : "none";
  b.querySelector(".ic-open").style.display = locked ? "none" : "";
  b.title = t(locked ? "ttUnlock" : "ttLock");
}

$("lockBtn").addEventListener("click", async () => {
  const p = currentPlay();
  if (!p || viewPlay) return;
  if (!p.locked) {
    p.locked = true;
  } else {
    const ok = await openModal({
      title: t("unlockTitle"),
      message: t("unlockMsg"),
      confirmLabel: t("unlockConfirm"),
    });
    if (!ok) return;
    p.locked = false;
  }
  save();
  applyLockState();
  renderAll();
});

// New plays pick their type (offense / defense) and court (half / full).
function openCreateModal() {
  return new Promise((resolve) => {
    $("createTitle").textContent = t("newPlayTitle");
    $("createKindLabel").textContent = t("kindLabel");
    $("createCourtLabel").textContent = t("courtLabel");
    $("segOffense").textContent = t("kindOffense");
    $("segDefense").textContent = t("kindDefense");
    $("segHalf").textContent = t("courtHalf");
    $("segFull").textContent = t("courtFull");
    $("createCancel").textContent = t("cancel");
    $("createGo").textContent = t("create");
    const modal = $("createModal");
    // defaults on every open
    for (const seg of modal.querySelectorAll(".seg")) {
      const btns = [...seg.querySelectorAll(".seg-btn")];
      btns.forEach((b, i) => b.classList.toggle("active", i === 0));
    }
    modal.hidden = false;
    $("createGo").focus();

    const segClick = (e) => {
      const b = e.target.closest(".seg-btn");
      if (!b) return;
      for (const x of b.parentElement.children) x.classList.toggle("active", x === b);
    };
    const close = (res) => {
      modal.hidden = true;
      modal.removeEventListener("click", segClick);
      $("createGo").removeEventListener("click", onGo);
      $("createCancel").removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey, true);
      resolve(res);
    };
    const onGo = () => close({
      kind: modal.querySelector("#createKindSeg .seg-btn.active").dataset.v,
      court: modal.querySelector("#createCourtSeg .seg-btn.active").dataset.v,
    });
    const onCancel = () => close(null);
    const onKey = (e) => {
      if (e.code === "Escape") { e.stopPropagation(); onCancel(); }
      if (e.code === "Enter") { e.stopPropagation(); onGo(); }
    };
    modal.addEventListener("click", segClick);
    $("createGo").addEventListener("click", onGo);
    $("createCancel").addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey, true);
  });
}

$("createNewBtn").addEventListener("click", async () => {
  // during the tour, the spotlight follows the flow: button -> form -> court
  const touring = () => !$("tour").hidden;
  const modalOpening = touring() && tourIdx === 0;
  if (modalOpening) setTimeout(nextTour, 150); // onto the type/court form
  const opts = await openCreateModal();
  if (!opts) {
    if (touring() && tourIdx === 1) { tourIdx = 0; tourPlace(); }
    return;
  }
  const base = t("playDefault") + " " + (plays.length + 1);
  const name = uniquePlayName(base);
  const play = createPlay(name, opts.kind, opts.court);
  openPlay(play.id);
  if (name !== base) showToast(t("renamedToast", name));
  if (touring() && tourIdx === 1) setTimeout(nextTour, 400);
});

$("selectAllCheck").addEventListener("change", (e) => {
  const visible = visiblePlays();
  if (e.target.checked) visible.forEach((p) => selectedPlayIds.add(p.id));
  else visible.forEach((p) => selectedPlayIds.delete(p.id));
  renderHome();
});

$("deleteAllBtn").addEventListener("click", async () => {
  const n = plays.length;
  if (!n) return;
  const ok = await openModal({
    title: t("deleteAllTitle"),
    message: t("deleteAllMsg", n),
    confirmLabel: t("deleteConfirm"),
    danger: true,
  });
  if (!ok) return;
  playSearch = "";
  $("playSearch").value = "";
  playPage = 0;
  deletePlaysWithUndo(plays.map((p) => p.id));
});

$("playSearch").addEventListener("input", (e) => {
  playSearch = e.target.value;
  playPage = 0;
  renderHome();
});

$("sortSelect").addEventListener("change", (e) => {
  playSort = e.target.value;
  localStorage.setItem("playbook-sort", playSort);
  playPage = 0;
  renderHome();
});

$("kindFilter").addEventListener("click", (e) => {
  const b = e.target.closest(".seg-btn");
  if (!b) return;
  playKindFilter = b.dataset.v;
  playPage = 0;
  renderHome();
});

$("pagePrev").addEventListener("click", () => { playPage--; renderHome(); });
$("pageNext").addEventListener("click", () => { playPage++; renderHome(); });

/* Deleted plays linger for 10 seconds behind an undo notification:
   tap the notification to restore them, swipe it away or hit its X to
   let them go. */
let pendingDelete = null;

function finalizePendingDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  pendingDelete = null;
  $("undoToast").hidden = true;
}

function deletePlaysWithUndo(ids) {
  finalizePendingDelete(); // an older pending delete becomes permanent
  const idSet = new Set(ids);
  const items = [];
  plays.forEach((p, i) => { if (idSet.has(p.id)) items.push({ play: p, index: i }); });
  if (!items.length) return;
  plays = plays.filter((p) => !idSet.has(p.id));
  for (const id of ids) selectedPlayIds.delete(id);
  save();
  renderHome();
  const toast = $("undoToast");
  $("undoToastMsg").textContent = t("undoDeleteMsg", items.length);
  toast.hidden = false;
  toast.style.transform = "";
  toast.style.opacity = "";
  pendingDelete = {
    items,
    timer: setTimeout(finalizePendingDelete, 10000),
  };
}

function undoPendingDelete() {
  if (!pendingDelete) return;
  const items = pendingDelete.items;
  clearTimeout(pendingDelete.timer);
  pendingDelete = null;
  $("undoToast").hidden = true;
  // reinsert at the original spots (ascending keeps indices valid)
  items.sort((a, b) => a.index - b.index);
  for (const it of items) {
    plays.splice(Math.min(it.index, plays.length), 0, it.play);
  }
  save();
  renderHome();
}

// tap = undo; the X or a horizontal swipe = dismiss
$("undoToastClose").addEventListener("click", (e) => {
  e.stopPropagation();
  finalizePendingDelete();
});
$("undoToast").addEventListener("pointerdown", (e) => {
  if (e.target.closest("#undoToastClose")) return;
  const toast = $("undoToast");
  const sx = e.clientX;
  let dx = 0;
  try { toast.setPointerCapture(e.pointerId); } catch (_) {}
  const move = (ev) => {
    dx = ev.clientX - sx;
    toast.style.transform = `translateX(calc(-50% + ${dx}px))`;
    toast.style.opacity = String(Math.max(1 - Math.abs(dx) / 140, 0.15));
  };
  const up = () => {
    toast.removeEventListener("pointermove", move);
    toast.removeEventListener("pointerup", up);
    toast.removeEventListener("pointercancel", up);
    if (Math.abs(dx) > 60) {
      finalizePendingDelete(); // swiped away
    } else if (Math.abs(dx) < 8) {
      undoPendingDelete(); // a plain tap restores
    } else {
      toast.style.transform = "";
      toast.style.opacity = "";
    }
  };
  toast.addEventListener("pointermove", move);
  toast.addEventListener("pointerup", up);
  toast.addEventListener("pointercancel", up);
});

async function deleteSelectedPlays() {
  const n = selectedPlayIds.size;
  if (!n) return;
  const ok = await openModal({
    title: t("deleteSelTitle"),
    message: t("deleteSelMsg", n),
    confirmLabel: t("deleteConfirm"),
    danger: true,
  });
  if (!ok) return;
  deletePlaysWithUndo([...selectedPlayIds]);
}

$("maybeTog").addEventListener("change", (e) => {
  const p = currentPlay();
  if (!p) return;
  if (e.target.checked) delete p.probeOff;
  else p.probeOff = true;
  if (!viewPlay) save();
  stopPlayback();
  renderAll();
});

/* The loupe in the toolbar opens the size bar: a thin row hanging
   under the toolbar on desktop, a bottom card on phones. When both
   teams are on court, the A/D buttons pick which one the bar resizes. */
let sizePanelOpen = false;
// which teams the bar resizes — both by default, so one drag scales all
let sizeTeams = { A: true, D: true };

function updateSizeTeamSeg() {
  const both = hasBothTeams(currentPlay());
  $("sizeTeamSeg").hidden = !both;
  if (!both) sizeTeams = { A: true, D: true };
  $("sizeTeamA").classList.toggle("active", sizeTeams.A);
  $("sizeTeamD").classList.toggle("active", sizeTeams.D);
  $("tokenSizeRange").value = String(sizeTeams.A ? tokenScale() : defTokenScale());
}

function repositionSizePanel() {
  if (SMALL_MQ.matches) {
    $("sizePanel").style.left = "";
    $("sizePanel").style.top = "";
    return;
  }
  const r = toolbar.getBoundingClientRect();
  const panel = $("sizePanel");
  const w = Math.max(r.width, 190);
  panel.style.width = w + "px";
  const left = Math.min(Math.max(r.left, 8), window.innerWidth - w - 8);
  panel.style.left = left + "px";
  panel.style.top = (r.bottom + 6) + "px";
}

function trackSizePanel() {
  if (!sizePanelOpen) return;
  repositionSizePanel();
  requestAnimationFrame(trackSizePanel);
}

function setSizePanel(open) {
  sizePanelOpen = open;
  $("sizePanel").hidden = !open;
  $("sizeBtn").classList.toggle("active", open);
  toolbar.classList.toggle("size-open", open);
  if (open) {
    updateSizeTeamSeg();
    // on phones the toolbar collapses down to just the loupe while the
    // size bar is in use
    if (SMALL_MQ.matches) setToolbarFolded(true);
    repositionSizePanel();
    requestAnimationFrame(trackSizePanel);
  }
}

$("sizeTeamSeg").addEventListener("click", (e) => {
  const b = e.target.closest(".st-btn");
  if (!b) return;
  const key = b.id === "sizeTeamD" ? "D" : "A";
  const next = { ...sizeTeams, [key]: !sizeTeams[key] };
  if (!next.A && !next.D) return; // at least one team stays selected
  sizeTeams = next;
  updateSizeTeamSeg();
});

$("sizeBtn").addEventListener("click", (e) => {
  // handled here exclusively — the toolbar's fold logic must not see it
  e.stopPropagation();
  setSizePanel(!sizePanelOpen);
});
$("sizePanelClose").addEventListener("click", () => setSizePanel(false));
document.addEventListener("pointerdown", (e) => {
  if (!sizePanelOpen || !SMALL_MQ.matches) return;
  if (!e.target.closest("#sizePanel, #sizeBtn")) setSizePanel(false);
});

function applyScaleVars() {
  stageEl.style.setProperty("--tok", String(tokenScale()));
  stageEl.style.setProperty("--tokD", String(defTokenScale()));
}

$("tokenSizeRange").addEventListener("input", (e) => {
  const p = currentPlay();
  if (!p) return;
  const v = Math.min(Math.max(parseFloat(e.target.value) || 1, 0.75), 1.6);
  if (sizeTeams.A && sizeTeams.D) {
    // together: one shared scale for everyone
    if (v === 1) delete p.tokenScale;
    else p.tokenScale = v;
    delete p.defTokenScale;
  } else if (sizeTeams.A) {
    // pin the defence at its current size before the attack moves alone
    if (p.defTokenScale == null) p.defTokenScale = defTokenScale();
    if (v === 1) delete p.tokenScale;
    else p.tokenScale = v;
  } else {
    p.defTokenScale = v;
  }
  applyScaleVars();
  // pass and lane tips stop short of the (now differently sized) circles
  renderArrows();
  renderHandles();
});

$("tokenSizeRange").addEventListener("pointerdown", () => {
  if (!viewPlay) beginAction();
});

$("tokenSizeRange").addEventListener("change", () => {
  if (!viewPlay) {
    endAction();
    save();
  }
});

// double tap / double click on the bar returns to the default size
function resetTokenSize() {
  const p = currentPlay();
  if (!p) return;
  if (!viewPlay) pushUndo();
  if (sizeTeams.A && sizeTeams.D) {
    delete p.tokenScale;
    delete p.defTokenScale;
  } else if (sizeTeams.A) {
    if (p.defTokenScale == null) p.defTokenScale = defTokenScale();
    delete p.tokenScale;
  } else {
    p.defTokenScale = 1;
    if ((p.tokenScale || 1) === 1) delete p.defTokenScale;
  }
  updateSizeTeamSeg();
  applyScaleVars();
  renderArrows();
  renderHandles();
  if (!viewPlay) save();
}
$("tokenSizeWrap").addEventListener("dblclick", (e) => {
  e.preventDefault();
  resetTokenSize();
});
let lastSizeTap = 0;
$("tokenSizeWrap").addEventListener("pointerdown", () => {
  const now = performance.now();
  if (now - lastSizeTap < 320) resetTokenSize();
  lastSizeTap = now;
});

$("maybeShowTog").addEventListener("change", (e) => {
  const p = currentPlay();
  if (!p) return;
  if (e.target.checked) delete p.maybesHidden;
  else p.maybesHidden = true;
  if (!viewPlay) save();
  stopPlayback();
  renderAll();
});

$("deleteSelectedBtn").addEventListener("click", deleteSelectedPlays);
$("deleteSelectedTop").addEventListener("click", deleteSelectedPlays);

$("lockSelectedBtn").addEventListener("click", async () => {
  const sel = plays.filter((p) => selectedPlayIds.has(p.id));
  if (!sel.length) return;
  const allLocked = sel.every((p) => p.locked);
  if (allLocked) {
    const ok = await openModal({
      title: t("unlockTitle"),
      message: t("bulkUnlockMsg", sel.length),
      confirmLabel: t("unlockConfirm"),
    });
    if (!ok) return;
    sel.forEach((p) => { p.locked = false; });
  } else {
    sel.forEach((p) => { p.locked = true; });
  }
  save();
  renderHome();
});

$("zipSelectedBtn").addEventListener("click", () => {
  const sel = plays.filter((p) => selectedPlayIds.has(p.id));
  if (sel.length) exportBackup(sel);
});

$("saveSelectedBtn").addEventListener("click", () => {
  if (selectedPlayIds.size) openExportModalFor([...selectedPlayIds]);
});

$("backBtn").addEventListener("click", () => {
  if (history.state && history.state.view === "play") history.back();
  else showHome();
});

/* ---- inline rename ---- */

function sizeNameInput() {
  playNameEl.style.width = Math.min(Math.max(playNameEl.value.length + 2, 5), 26) + "ch";
}

function commitRename() {
  const p = currentPlay();
  if (!p) return;
  if (editLocked()) {
    playNameEl.value = p.name;
    return;
  }
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

$("deletePlayBtn").addEventListener("click", async () => {
  const ok = await openModal({
    title: t("deleteTitle"),
    message: t("deleteMsg", currentPlay().name),
    confirmLabel: t("deleteConfirm"),
    danger: true,
  });
  if (!ok) return;
  const id = currentPlayId;
  currentPlayId = null;
  showHome();
  deletePlaysWithUndo([id]);
});

async function resetAllPlay() {
  if (editLocked()) return;
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
  if (editLocked()) return;
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
    zones: last.zones ? JSON.parse(JSON.stringify(last.zones)) : undefined,
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
  if (!modalEl.hidden || !$("exportModal").hidden || !$("createModal").hidden || !$("tour").hidden || !$("helpModal").hidden) return;
  if (editorEl.hidden) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  // viewer: playback keys only
  if (viewPlay && !["Space", "ArrowLeft", "ArrowRight"].includes(e.code)) return;
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
    if (currentStep === 0 || contextIds(currentPlay()).length) setTool("select");
  } else if (e.code === "ArrowLeft") {
    $("prevBtn").click();
  } else if (e.code === "ArrowRight") {
    $("nextBtn").click();
  } else if (e.code === "Digit1") {
    if (currentStep === 0 || contextIds(currentPlay()).length) setTool("select");
  } else if (e.code === "Digit2") {
    setTool("arrow");
  } else if (e.code === "Digit3") {
    setTool(playKind(currentPlay()) === "defense" ? "zone" : "screen");
  } else if (e.code === "Digit4") {
    setTool("pass");
  } else if (e.code === "Digit5") {
    if (playKind(currentPlay()) === "offense") setTool("mpass");
  } else if (e.code === "Digit6") {
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

// qr.js (vendored qrcode-generator, MIT) is injected on first use.
let qrLibPromise = null;
function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  if (!qrLibPromise) {
    qrLibPromise = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "qr.js";
      sc.onload = resolve;
      sc.onerror = () => {
        qrLibPromise = null;
        reject(new Error("qr.js failed to load"));
      };
      document.head.appendChild(sc);
    });
  }
  return qrLibPromise;
}

async function renderQrInto(el, text) {
  try {
    await loadQrLib();
    const qr = window.qrcode(0, "L");
    qr.addData(text);
    qr.make();
    const img = document.createElement("img");
    img.src = qr.createDataURL(4, 8);
    img.alt = "QR";
    img.title = t("ttCopyQr");
    const box = document.createElement("div");
    box.className = "qr-box";
    const overlay = document.createElement("div");
    overlay.className = "qr-overlay";
    let overlayTimer = null;
    const flash = (msg) => {
      overlay.textContent = msg;
      overlay.classList.add("show");
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(() => overlay.classList.remove("show"), 1800);
    };
    img.addEventListener("click", async () => {
      try {
        // re-draw the QR on a canvas to get a PNG for the clipboard
        const c = document.createElement("canvas");
        c.width = c.height = 680;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        flash(t("qrCopied"));
      } catch (_) {
        // image clipboard unsupported — fall back to copying the link
        try {
          await navigator.clipboard.writeText(text);
          flash(t("linkCopied"));
        } catch (_) {}
      }
    });
    box.append(img, overlay);
    el.appendChild(box);
    el.hidden = false;
  } catch (_) {
    // link too long for a QR (or the lib failed) — nothing to show
    el.hidden = true;
  }
}

async function sharePlayFlow(play) {
  const res = await openModal({
    title: t("shareTitle"),
    message: t("shareModalMsg"),
    checkboxLabel: t("shareAllowEdit"),
    confirmLabel: t("shareGo"),
  });
  if (!res) return;
  const frag = (res.checked ? "#p=" : "#v=") + await encodeSharePlay(play);
  const url = location.origin + location.pathname + frag;
  if (navigator.share) {
    try { await navigator.share({ title: play.name, url }); } catch (_) { /* cancelled */ }
    return;
  }
  openModal({
    title: t("shareLinkTitle"),
    noCancel: true,
    xClose: true,
    qr: url,
    copyLink: url,
  });
}

$("shareBtn").addEventListener("click", () => sharePlayFlow(currentPlay()));

// Add a shared play to the collection (with a duplicate check).
async function addSharedPlay(p) {
  const incoming = JSON.stringify(p.steps);
  const existing = plays.find((x) => JSON.stringify(x.steps) === incoming);
  if (existing) {
    const ok = await openModal({
      title: t("sharedTitle"),
      message: t("sharedExistsMsg", existing.name),
      confirmLabel: t("sharedAddAnyway"),
    });
    if (!ok) return false;
  }
  const desired = p.name;
  p.name = uniquePlayName(desired);
  plays.push(p);
  save();
  openPlay(p.id);
  showToast(p.name !== desired ? t("renamedToast", p.name) : t("sharedAddedToast", p.name));
  return true;
}

// Opening a share link: #v= opens the read-only viewer, #p= adds directly.
async function importFromLink() {
  const m = location.hash.match(/^#(p|v)=(.+)$/);
  if (!m) return;
  markHomeUrl();
  try {
    const raw = await decodeSharePlay(m[2]);
    if (!raw || !raw.name || !Array.isArray(raw.steps) || !raw.steps.length) throw new Error("bad");
    const p = normalizePassTimings(migrateBall(migratePlay(raw)));
    p.id = "play-" + Math.random().toString(36).slice(2, 10); // always a fresh copy
    delete p.locked; // a received copy is the recipient's to edit
    if (m[1] === "v") openViewer(p);
    else await addSharedPlay(p);
  } catch (_) {
    openModal({ title: t("importErrTitle"), message: t("sharedErrMsg"), confirmLabel: "OK", noCancel: true });
  }
}

// The viewer's Edit button hands the play over to the normal add flow.
$("viewEditBtn").addEventListener("click", async () => {
  if (!viewPlay) return;
  const p = viewPlay;
  const added = await addSharedPlay(p);
  if (!added) return; // cancelled — stay in the viewer
});

/* ================= Interactive tour & help ================= */

const WIZ_FLAG = "playbook-welcomed";

// Each stop highlights a real element; `action` stops advance when the
// user clicks the element itself.
const tourDefs = [
  { sel: "#createNewBtn", action: true },
  { sel: "#createModal .modal", action: true },
  { sel: "#stage" },
  { sel: "#toolbar" },
  { sel: '[data-tool="zone"]' },
  { sel: "#addStepBtn" },
  { sel: "#defenseBtn" },
  { sel: "#playBtn" },
  { sel: "#exportBtn" },
  { sel: "#shareBtn" },
  { sel: "#helpEditor", last: true },
];
let tourIdx = -1;

function tourPlace() {
  const def = tourDefs[tourIdx];
  // toolbar-related stops need the tools visible on small screens
  const toolbarStop = def.sel === "#toolbar" || def.sel.includes("data-tool");
  if (SMALL_MQ.matches) setToolbarFolded(!toolbarStop);
  const el = document.querySelector(def.sel);
  // the modal sits in a fixed overlay (offsetParent is null even when
  // visible), so it gets its own visibility check
  const missing = def.sel.includes("createModal")
    ? $("createModal").hidden
    : !el || (el.offsetParent === null && def.sel !== "#toolbar");
  if (missing) {
    // target missing — move on
    nextTour();
    return;
  }
  const r = el.getBoundingClientRect();
  const pad = 8;
  const hx = Math.max(r.left - pad, 0);
  const hy = Math.max(r.top - pad, 0);
  const hw = Math.min(r.width + pad * 2, window.innerWidth - hx);
  const hh = Math.min(r.height + pad * 2, window.innerHeight - hy);
  const hole = $("tourHole");
  hole.style.left = hx + "px";
  hole.style.top = hy + "px";
  hole.style.width = hw + "px";
  hole.style.height = hh + "px";
  const set = (id, l, tp, w, h) => {
    const d = $(id);
    d.style.left = l + "px"; d.style.top = tp + "px";
    d.style.width = w + "px"; d.style.height = h + "px";
  };
  set("tourShadeT", 0, 0, window.innerWidth, hy);
  set("tourShadeB", 0, hy + hh, window.innerWidth, window.innerHeight - hy - hh);
  set("tourShadeL", 0, hy, hx, hh);
  set("tourShadeR", hx + hw, hy, window.innerWidth - hx - hw, hh);

  $("tourText").textContent = t("tourTexts")[tourIdx];
  $("tourCount").textContent = (tourIdx + 1) + "/" + tourDefs.length;
  $("tourSkip").textContent = t("tourSkip");
  $("tourNext").textContent = def.last ? t("tourDone") : t("tourNext");
  $("tourNext").hidden = !!def.action;

  // tip below the hole when there's room, else above
  const tip = $("tourTip");
  tip.style.visibility = "hidden";
  tip.style.left = "0px"; tip.style.top = "0px";
  requestAnimationFrame(() => {
    const tr = tip.getBoundingClientRect();
    let tx = Math.min(Math.max(hx + hw / 2 - tr.width / 2, 12), window.innerWidth - tr.width - 12);
    let ty = hy + hh + 14;
    if (ty + tr.height > window.innerHeight - 12) ty = Math.max(hy - tr.height - 14, 12);
    tip.style.left = tx + "px";
    tip.style.top = ty + "px";
    tip.style.visibility = "visible";
  });
}

function startTour() {
  tourIdx = 0;
  $("tour").hidden = false;
  tourPlace();
  // the first stop advances from inside the create flow, once the play
  // really exists (the creation modal sits in between)
}

function endTour() {
  $("tour").hidden = true;
  localStorage.setItem(WIZ_FLAG, "1");
}

function nextTour() {
  tourIdx += 1;
  if (tourIdx >= tourDefs.length) endTour();
  else tourPlace();
}

$("tourNext").addEventListener("click", nextTour);
$("tourSkip").addEventListener("click", endTour);
window.addEventListener("resize", () => {
  if (!$("tour").hidden && tourIdx >= 0) tourPlace();
});

function openHelp() {
  $("helpTitle").textContent = t("helpTitle");
  const c = $("helpContent");
  c.innerHTML = "";
  // guided tour section first, with a restart button
  const th = document.createElement("h3");
  th.textContent = t("helpTourTitle");
  const tp = document.createElement("p");
  tp.textContent = t("helpTourBody");
  const tb = document.createElement("button");
  tb.className = "btn btn-primary help-tour-btn";
  tb.textContent = t("helpTourBtn");
  tb.addEventListener("click", () => {
    $("helpModal").hidden = true;
    showHome();
    startTour();
  });
  c.append(th, tp, tb);
  for (const sec of t("helpSections")) {
    const h = document.createElement("h3");
    h.textContent = sec.h;
    const p = document.createElement("p");
    p.textContent = sec.b;
    c.append(h, p);
  }
  $("helpModal").hidden = false;
}

$("helpHome").addEventListener("click", openHelp);
$("helpEditor").addEventListener("click", openHelp);
$("helpClose").addEventListener("click", () => { $("helpModal").hidden = true; });

document.addEventListener("keydown", (e) => {
  if (e.code !== "Escape") return;
  if (!$("helpModal").hidden) $("helpModal").hidden = true;
  else if (!$("tour").hidden) endTour();
});

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
applyToolbarFold();
showHome();
const arrivedViaShareLink = /^#(p|v)=/.test(location.hash);
if (!arrivedViaShareLink) {
  const deepLink = location.hash.match(/^#play=(.+)$/);
  const deepId = deepLink && decodeURIComponent(deepLink[1]);
  markHomeUrl();
  if (deepId && plays.some((p) => p.id === deepId)) openPlay(deepId);
}
importFromLink();
if (!arrivedViaShareLink && !localStorage.getItem(WIZ_FLAG)) startTour();

// Offline support: cache the app shell so the playbook works without a connection.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
