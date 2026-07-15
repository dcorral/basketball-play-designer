# 🏀 Playbook — Basketball Play Designer

Design basketball plays step by step and watch them animate.

## Run it

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000

No dependencies, no build step — plain HTML/CSS/JS.

## How to use

0. **Home screen** — lists your saved plays; click one to open it, or hit **CREATE NEW**.
1. **New play** — five players (1–5) and the ball start out of bounds on the left sideline.
2. **Select tool (1)** — drag players (and the ball) to their initial positions (step 1 only; after that, players move exclusively via drawn arrows and the tool is disabled). Out-of-bounds placement is allowed.
3. **Arrow tool (2)** — drag from a player to where they cut. **Screen tool (3)** — same, but the arrow ends in the classic perpendicular screen bar. The ball is always attached to a player: drag it to hand it to someone, and drag an arrow from it to throw a pass (dashed; it snaps to the receiving teammate). Within a step things happen in order — pass first, then screeners together with all other cuts, and finally the cuts that use a screen; a ball carrier's ball travels with them.
4. **Curve an arrow** — with the select tool, drag the round handle in the middle of an arrow. Drag the square handle to change the destination. **Eraser (4)** — click an arrow or its player to remove it.
5. **Next step ＋** — commits the drawn arrows: the next step starts where the arrows end. Repeat until the play is finished. **Reset all** clears every step (keeping step 1's starting positions) after a confirmation.
6. **✎ Rename** — rename the current play. **✕ Delete** removes it and returns to the home screen.
7. **Playback** — use the bar at the bottom: play/pause (Space), prev/next step (←/→), scrub the timeline, change speed. Players follow their drawn paths (including curves). Arrows on the last step play immediately — no need to commit them first.

8. **⤓ Export** — three formats:
   - **GIF animation** — the whole play animated, with configurable movement duration and pause between steps.
   - **Video** — same animation as MP4 (Chrome/Safari/Edge) or WebM (Firefox), recorded in real time.
   - **PDF** — one page per step with the step's arrows, ready to print.

9. **Undo / redo** — the ↶ ↷ buttons in the toolbar, or Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z (or Ctrl+Y) to redo. Covers drags, arrows, curves, erases, steps, resets and renames; history is per editing session.

Keyboard: 1–4 select tools, Esc back to select, Space play/pause, ←/→ change step, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo & redo. The interface is available in English and Spanish via the flag dropdown.

`gif.js` / `gif.worker.js` are a vendored copy of [gif.js](https://github.com/jnordberg/gif.js) (MIT) for GIF encoding; everything else is dependency-free.

Plays are saved automatically in your browser (localStorage).
