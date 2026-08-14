# Source Bridge agent workflow

Permanent operating procedure for Cursor work on this repo. Rules: `.cursor/rules/`. Checkpoint: `docs/DEV_CHECKPOINT.md`.

## Standard sequence

1. Understand the requested behaviour (and only that).
2. Identify affected architecture (payments / tickets / chat / unrelated).
3. Inspect existing code before editing.
4. Use **read-only** parallel investigation when it helps (trace, search, git compare, schema, tests, security, diff).
5. Choose **one implementation owner** for the final edit — especially payment logic.
6. Make the smallest correct change.
7. Run `npm run test:payments:fast` (or targeted tests if the change is clearly non-payment).
8. Run targeted tests for the touched area.
9. Payment-sensitive: `npm run test:payments:full` before completion.
10. Inspect the full `git diff`; categorize files; report UNRELATED changes.
11. `npm run typecheck` and `npm run build` when required for release/payment completion.
12. Deploy TEST only if requested or required for user-facing payment QA.
13. Live browser QA for user-facing payment/chat changes.
14. Report statuses separately (Implementation / Tests / Regression / Deployment / Live QA / Production Ready TEST). Update `docs/DEV_CHECKPOINT.md` only when finishing a meaningful workstream.

## Parallelism

**Good:** read-only subagents for investigation/review.

**Bad:** several agents writing the same payment engine, checkout, tickets, or fulfilment.

**Worktrees:** only for independent workstreams (e.g. docs vs an unrelated module). Do not worktree-split one payment bug.

## Two-tier verification

- **Level 1 — Fast:** seconds-to-low-minutes. `npm run test:payments:fast` (+ targeted tests). Use during iteration.
- **Level 2 — Release / payment:** full payment regression, typecheck, production build, diff review, TEST deploy, live browser QA. Required before payment-sensitive work is complete.

Do not run Level 2 after every keystroke. Do not skip Level 2 at completion.

## Hypothetical dry-run (do not implement)

Task: “Change the wording of the sourcing Payment Ticket shipping label.”

The framework should: treat it as payment-sensitive UI (rules 02, 04, 06); change copy only; run `test:payments:fast`; inspect diff for fee/lifecycle leakage; require live TEST QA before Production Ready TEST if the label is user-facing. It must **not** alter Destination Charges, ticket acceptance, or `LIVE_PAYMENTS_ENABLED`.
