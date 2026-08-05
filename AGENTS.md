# Repository instructions

This is a dependency-free static website.

- Do not run `npm install`, add a package manager, or introduce a build step unless the task explicitly requires it.
- Primary files: `index.html`, `style.css`, and `game.js`.
- Validate JavaScript with `node --check game.js`.
- Review only the changed behavior unless the diff exposes a consequential existing defect.
- Treat balance values as early-stage placeholders unless a task specifically concerns balance.

## Project invariants

- This is an incremental/idle nightclub-management game using plain HTML, CSS, and JavaScript.
- Saves use `localStorage`; offline progress and existing saves must remain reliable.
- Preserve the neon-noir visual language unless a task explicitly changes it.
- The stage carries no performer figure. The CSS/DOM dancer and pole were removed in v0.7.0 by
  operator decision; do not reintroduce them. The stage is lighting, haze, crowd silhouettes and
  the stage lip.

## Code review rules

- `VERSION`, the visible build number, and `CHANGELOG` must advance together for behavior changes.
- Bump `SAVE_VER` only when the persisted save shape changes.
- Preserve backward compatibility with existing `localStorage` saves unless the change explicitly requires a reset.
- Preserve offline progression correctness and prevent elapsed-time double counting.
