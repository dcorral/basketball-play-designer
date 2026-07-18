<p align="center">
  <img src="assets/logo.png" alt="Cejudos Basket — San Lorenzo de El Escorial" width="150">
</p>

<h1 align="center">Cejudo's Playbook</h1>

<p align="center">
  Design basketball plays step by step, animate them, and share them with your team.<br>
  Live at <a href="https://cejudos.com">cejudos.com</a> — built for <strong>Cejudos San Lorenzo de El Escorial</strong>.
</p>

---

## Demo

Creating an offensive play — players, screens, cuts and passes — then a defensive play with zones of action, a rotation and playback:

<p align="center">
  <img src="assets/demo.gif" alt="Demo: an offensive play with screens and passes, then a defensive play with zones" width="420">
</p>

## Features

- **Step-based editor** on an SVG court — place the five players (and the ball) anywhere for step 1, draw what happens, commit it as a step, repeat.
- **Offensive and defensive plays, half or full court** — chosen at creation. Defensive plays flip the roles: the defenders draw the visible red arrows, the dimmed attack repositions silently, and playback runs the attack first with the defense reacting after. Full-court plays double the floor for presses and transition.
- **Zones of action** — in defensive plays, a dedicated tool shades each defender’s area in a soft colour: draw it anywhere (it belongs to the nearest defender), drag it to move it, and it carries into new steps.
- **Three actions**: movement arrows (curvable), screens (rotatable perpendicular bar) and passes (straight, dashed, snapping to the receiver — or to the *end* of the receiver's cut).
- **Real ball logic** — the ball always belongs to a player, travels with the dribbler, and the ownership chain across steps stays consistent automatically. Screeners can't receive; the carrier can't screen.
- **Smart playback** — video-player controls with per-action pacing: passes, cuts and screen-assisted cuts play out in order, so a busy step lasts longer than a simple one.
- **Share by link** — any play becomes a URL: view-only by default (with an *Edit* hand-off button), or editable directly. No server involved; the play is compressed into the link itself.
- **Export** — animated GIF, video (MP4/WebM) or a printable PDF with one 2×2 grid of steps per page.
- **Backup** — export all plays as a `.zip` and import them on another device (imported plays get a badge, never overwrite anything).
- **Defenders in offensive plays** — an optional shield toggle adds five X markers that reposition on any step and move silently in playback (no arrow clutter), with a draggable ghost X marking their destination.
- **Lockable plays** — a padlock button in the editor freezes a play against accidental edits; unlocking asks for confirmation. Locked plays still play back, export and share.
- **Organized home screen** — search, an offense/defense filter, pagination, drag-to-reorder, letter tags (A/D/I), and multi-select with per-page select-all plus bulk actions: export each selected play as GIF/video/PDF, download them as a `.zip`, lock/unlock them, or delete them.
- **8 languages** — English, Spanish, Italian, Russian, Chinese, Serbian, Slovenian and Greek, via the flag selector.
- **Works offline** — a service worker caches the whole app (exports included); installable on a phone as a standalone app.
- **Interactive tour** — a skippable guided walkthrough on first visit, restartable any time from the **?** help menu.

## How to use

1. **Home screen** — lists your saved plays: tap one to open it, drag the dots to reorder, use the checkboxes for bulk actions, or hit **＋ Create play** and pick the play type (offense/defense) and court size (half/full).
2. **New play** — in offensive plays the five players (1–5) and the ball start out of bounds above the baseline; in defensive plays the defenders line up there instead, with the attack waiting in a spread set.
3. **Select tool (1)** — drag players (and the ball) to their initial positions (step 1 only; after that, players move exclusively via drawn arrows). Out-of-bounds placement is allowed.
4. **Arrow tool (2)** — drag from a player to where they cut. **Screen tool (3)** — same, but the arrow ends in the classic perpendicular screen bar (rotate it with the gold handle); in defensive plays this slot becomes the **zone tool** for areas of action. **Pass tool (4)** — drag anywhere on the court; the dashed line always starts at the ball and snaps to the receiver (or to the end of their cut if they're moving). The carrier's dribble draws as a wavy line.
5. **Curve an arrow** — drag the round handle in the middle of an arrow; drag the square handle to change the destination. **Eraser (5)** — click an arrow or its player to remove it.
6. **Two actions, one player** — when the carrier both passes and moves, the lighter line happens second; double-click (or long-press) a line to make it go first.
7. **Next step ＋** — commits the drawn arrows: the next step starts where the arrows end. Steps without actions (and the last one) can be deleted from their bin bubble. **↺ Reset all** clears every step after a confirmation.
8. **Playback** — play/pause (Space), prev/next step (←/→), scrub the timeline, change speed. Players follow their drawn paths, curves included; arrows on the last step play immediately without committing.
9. **Rename** — click the play's name in the top bar and type.
10. **Lock** — the padlock in the top bar makes the play read-only (no drawing, dragging, renaming or step changes); click it again and confirm to unlock.
11. **Undo / redo** — ↶ ↷ in the toolbar, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y). Covers drags, arrows, curves, erases, steps, resets and renames.

Keyboard: **1–5** select tools (3 is the screen or zone tool depending on the play type), **Esc** back to select, **Space** play/pause, **←/→** change step, **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y** undo & redo.

Plays are saved automatically in your browser (localStorage) — nothing ever leaves your device unless you share or export it.

## Run it locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000

No dependencies, no build step — plain HTML/CSS/JS. `gif.js` / `gif.worker.js` are a vendored copy of [gif.js](https://github.com/jnordberg/gif.js) (MIT) for GIF encoding, loaded on demand at export time; everything else is dependency-free.

## Deployment

Pushing to `main` deploys automatically to GitHub Pages under the custom domain [cejudos.com](https://cejudos.com). The service worker uses a network-first strategy, so online visitors always get the latest deploy while offline visitors get the last version they saw.
