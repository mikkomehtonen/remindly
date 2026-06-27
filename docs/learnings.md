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

## Integration tests bind to a fixed port — 3099 is occupied in this environment
**Date**: 2026-06-20
**Area**: testing
**What happened**: The API integration tests in `tests/api.test.js` start a real server on a fixed port. The original port `3099` was already occupied by a system service in this environment, causing the `before` hook to hang silently because `server.on('listening', done)` never fired.
**Takeaway**: When working in this environment, set the integration test port to a free high port (e.g., `9999`) in both `BASE` and `process.env.PORT`. If tests hang before running any API cases, check `ss -tln` for port conflicts before debugging the test logic.

---

## Code-reviewer catches crash-safety gaps like missing transactions
**Date**: 2026-06-15
**Area**: workflow
**What happened**: The SQLite migration in `initDb()` used raw `db.exec()` calls — a crash between `DROP TABLE` and `ALTER TABLE … RENAME` would orphan data. The code-reviewer flagged this at score 7.
**Takeaway**: Any multi-step DDL sequence in `better-sqlite3` must be wrapped in `db.transaction(() => { … })()` for atomicity. Run this pattern proactively when writing schema migrations to avoid review loops.

---

## better-sqlite3 native module may need rebuild after Node version changes
**Date**: 2026-06-27
**Area**: build
**What happened**: `npm test` failed immediately with `ERR_DLOPEN_FAILED` because `better_sqlite3.node` was compiled against Node module version 137 while the runtime required version 147. `npm install` reported "up to date" and did not rebuild the native binding; only `npm rebuild better-sqlite3` fixed it.
**Takeaway**: If tests fail with a native module version mismatch for `better-sqlite3`, run `npm rebuild better-sqlite3` (or `npm rebuild`) before debugging test logic. This environment can switch Node versions between sessions, so the binding may be stale even when `node_modules` exists.

---