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

---## Post-Pass nit refactors can fail the next review round — verify them like features
**Date**: 2026-11-01
**Area**: workflow
**What happened**: Story 007 got a code-review Pass, then a follow-up commit addressing the reviewer's *non-blocking* notes (transcribing DDL into a structured `EVENTS_COLUMNS` list) introduced a real regression — the refactor dropped `INTEGER`/`TEXT` type keywords — which the next round flagged as a score-6 blocker and forced another full verify cycle.
**Takeaway**: Any commit after a Pass invalidates both reviewer verdicts and must pass `lint -> format -> test` plus a self-diff review before re-submitting. Guard generated/derived config (like DDL) with an independent assertion of the *full* expected output (e.g. `PRAGMA table_info` name:type pairs), not just the part you were refactoring.

---

## Story code snippets can contain bugs — the AC tests are the contract
**Date**: 2026-11-01
**Area**: workflow
**What happened**: Story 008 shipped a verbatim `syncPackingItems` snippet whose delete pass built `kept` only from *submitted* ids, so freshly INSERTed rows were deleted in the same transaction. Implementing the snippet as written passed lint but failed the story's own AC tests ("event_packing_items holds exactly 2 rows for the new event").
**Takeaway**: Treat code inside a story as a starting point, not gospel — when it conflicts with an AC, the AC wins. Debug by isolating: if a standalone repro of the same DB ops passes but the route fails, add targeted `console.log` inside the suspect helper (was `syncPackingItems` called? did INSERT report `changes: 1`?) instead of rewriting whole handlers.

---

## Never `git checkout -- <file>` to undo temporary debug edits
**Date**: 2026-11-01
**Area**: workflow
**What happened**: During the packing-list debug loop, `git checkout src/routes/admin.js` was used to revert temporary `console.log` edits — but the file also held the entire uncommitted feature implementation, which was wiped and had to be re-applied from scratch.
**Takeaway**: Before any revert-style command on a file with uncommitted work, snapshot it first (`cp src/routes/x.js /tmp/opencode/x.js.bak`) and restore from the copy, or make debug edits via `node -e` patch scripts that restore from the backup. `git checkout --` reverts to last commit, not last-good state.

---
