# Learnings

## `layout.ejs` is unused — verify rendering chain before editing
**Date**: 2026-06-10
**Area**: templates
**What happened**: Story 001 directed modification of `views/layout.ejs` to add a favicon link, but no route in the app renders through that layout — all views are standalone full-HTML pages. This caused a test failure and wasted a review cycle.
**Takeaway**: Before modifying any template in this repo, verify it is actually used in the rendering chain (e.g., `grep -rn "render(" src/`). AGENTS.md already documents that views are standalone with no layout engine, but this is easy to overlook when a story explicitly says otherwise. If a story tells you to modify `layout.ejs`, escalate — the file exists on disk but is dead code.

---

## acceptance-reviewer checks AC coverage individually — write one test per AC
**Date**: 2026-06-15
**Area**: testing
**What happened**: Story 003 had all 45 tests passing, but the acceptance-reviewer still failed because individual ACs lacked explicit test coverage (migration scenarios, Swagger spec, view rendering).
**Takeaway**: The acceptance-reviewer evaluates each acceptance criterion independently against test coverage, not just whether the test suite passes as a whole. Write a dedicated test for every AC before submitting for review. This saves multiple review rounds.

---

## Code-reviewer catches crash-safety gaps like missing transactions
**Date**: 2026-06-15
**Area**: workflow
**What happened**: The SQLite migration in `initDb()` used raw `db.exec()` calls — a crash between `DROP TABLE` and `ALTER TABLE … RENAME` would orphan data. The code-reviewer flagged this at score 7.
**Takeaway**: Any multi-step DDL sequence in `better-sqlite3` must be wrapped in `db.transaction(() => { … })()` for atomicity. Run this pattern proactively when writing schema migrations to avoid review loops.

---