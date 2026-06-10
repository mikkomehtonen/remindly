# Learnings

## `layout.ejs` is unused — verify rendering chain before editing
**Date**: 2026-06-10
**Area**: templates
**What happened**: Story 001 directed modification of `views/layout.ejs` to add a favicon link, but no route in the app renders through that layout — all views are standalone full-HTML pages. This caused a test failure and wasted a review cycle.
**Takeaway**: Before modifying any template in this repo, verify it is actually used in the rendering chain (e.g., `grep -rn "render(" src/`). AGENTS.md already documents that views are standalone with no layout engine, but this is easy to overlook when a story explicitly says otherwise. If a story tells you to modify `layout.ejs`, escalate — the file exists on disk but is dead code.

---
