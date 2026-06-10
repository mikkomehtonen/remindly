---
name: reflect
description: Runs post-task reflection to extract learnings from the completed session. Use after finishing any non-trivial task to update docs/learnings.md or AGENTS.md with concrete takeaways.
---

# Post-Task Reflection

## Step 1: Reflect

Review the conversation history in your current context window. Ask yourself:

1. **What slowed me down?** Where did I spend the most time or tokens? What required multiple attempts?
2. **What was I missing?** What context, docs, or knowledge would have let me do this faster or better?
3. **What would I do differently?** If I had to redo this task from scratch, what would I change about my approach?
4. **What did the user have to correct?** Where did the user step in to redirect me — and what should I have known upfront?
5. **What worked well?** Any pattern, shortcut, or approach worth remembering for next time?
6. **What should future work in this repository know up front?** Did this task reveal any workflow caveat, architecture constraint, command behavior, generated artifact issue, or convention that belongs in the repo's standing guidance?

Then look through the conversation for concrete instances of:

- **Friction** — something was difficult, slow, token-heavy, or required many iterations
- **Knowledge gap** — had to guess, docs were missing or wrong, library API didn't match expectations, external service behaved unexpectedly
- **Correction** — user corrected your approach ("use X instead of Y", "we have a component for that", "don't build that from scratch")
- **Error** — a tool or command failed and required debugging
- **Discovery** — found a useful pattern, shortcut, or approach worth remembering
- **Guidance candidate** — something that should probably live in the repo's main docs because future work should follow it by default

## Step 2: Filter

For each candidate:

- **Durable?** Will this still be true next time?
- **Reusable?** Does knowing this save time or prevent a mistake?
- **Specific?** Is there a concrete action or fact — not a vague observation?

Start from the assumption that **nothing is worth logging**. Each candidate must earn its place — if you can't articulate why a future agent would benefit from reading it, discard it. For each survivor, argue why the takeaway might be wrong or not worth keeping. If you can't defend it, drop it.

Everything captured here is repository-specific. If an issue affected a standard workflow in this repository (build/test/lint/check commands or common editing/debugging flows), treat it as worth documenting by default unless already covered.

Before deciding "nothing worth logging," explicitly ask: **What would a future agent need to know to work effectively in this repository?** If you found anything concrete, either update the main repo docs or write it to the learnings log.

Log at most 5 items per session. If you have more, keep only the most impactful.

## Step 3: Classify

There are only two destinations. Use this decision rule:

- **Does this describe a rule or pattern that applies to future work in this repo?** → Update `AGENTS.md` (or other main repo docs) directly.
- **Does this describe a specific incident that might recur but isn't generalizable yet?** → Append to `docs/learnings.md`.
- **Has it already happened twice?** → It's a pattern now. Promote to `AGENTS.md` and remove from learnings.

Use `docs/learnings.md` as the sole learnings file — do not create additional files.

## Step 4: Check for duplicates and prune

Read `docs/learnings.md` and any main repo docs you plan to update. Note the current entry count before writing.

- If an equivalent item already exists, skip it.
- If an existing learning has been promoted to `AGENTS.md`, remove it from learnings.
- If an existing learning is no longer true (code changed, approach abandoned), remove it.
- Keep total entries in `docs/learnings.md` under 15 — beyond that, the log becomes hard to scan and the most important entries lose signal. If over the cap, promote the most general entries to `AGENTS.md` or delete the least useful ones.

## Step 5: Write

Format for `docs/learnings.md`:

```
## Title
**Date**: YYYY-MM-DD
**Area**: [area relevant to this repo, e.g. testing | workflow | architecture | build]
**What happened**: 1-2 sentences — what went wrong or what was discovered
**Takeaway**: concrete lesson — what to do differently

---
```

The file header is `# Learnings`. Create the file with this header if it doesn't exist.

If an item belongs in `AGENTS.md` instead, make the minimal update there and mention it in your summary.

## Step 6: Commit

Tell the user what was written and where. Commit the changes immediately.

If the only changes are to documentation files (e.g. `docs/learnings.md`, `AGENTS.md`), skip running any code reviewers — they are not needed for docs-only updates.
