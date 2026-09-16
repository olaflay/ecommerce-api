# RULES.md — Task 1 E-Commerce API: Standing Operational Rules

These are the concrete, checkable rules behind `AGENTS.md`'s Constitution. The Constitution states the principle; this file states what following it actually looks like in a commit, a response, or a terminal. Every role in `AGENTS.md`'s roster is bound by all of these, not just the ones relevant to its own phase.

---

## 1. Verification Discipline

1.1. Never report a gate as passed without pasting the command and its actual output. "This should work" is not evidence; a terminal result is.

1.2. Every claimed fix gets re-tested against the specific case that exposed the bug — not just re-run against the general happy-path suite.

1.3. Local passing is a checkpoint, not a conclusion. Anything touching the rate limiter, CORS, env vars, or SSL (PRD §13, §20) is only actually verified once it's been run against the **deployed** URL — say so explicitly when a "pass" is local-only, and don't let that get conflated with a real pass later.

1.4. When a test is skipped (time, flakiness, environment), that's stated out loud with a reason and an owner to come back to it — never silently dropped from the checklist.

1.5. Before marking Phase 4 (order write path) done, the concurrency test must have actually been fired — two real parallel requests, not a reasoned-through description of what the transaction *should* do under load.

---

## 2. Source Code Handling

2.1. Read before writing. Before editing a file, view the current content of the specific range being touched — don't edit from memory of an earlier version in the same session if the file may have changed.

2.2. Prefer diffs over rewrites. A one-line schema change is a `str_replace`, not a full-file regeneration — full rewrites hide what actually changed and make review harder.

2.3. No dead code, no commented-out attempts left in place. If an approach is abandoned, remove it; `DECISIONS.md` (Rule 4 below) is where the reasoning lives, not a code comment graveyard.

2.4. No speculative abstraction. Don't build a generic filter/query-builder system when the PRD specifies four fixed filters — PRD §16 explicitly asks for abstractions proportional to the project.

2.5. Secrets never touch source control at any point in history — not committed then removed, not committed to a throwaway branch, never. `.env` is gitignored from the very first commit, not added to `.gitignore` after an accidental commit.

2.6. Migrations are additive and reviewed before running against production — no destructive migration (dropping a column, changing a type in place) without it being named explicitly as such before it runs.

---

## 3. Thoroughness

3.1. Every endpoint gets its happy path **and** its documented edge cases tested before the phase is called done — half of that (PRD §19's list) is an incomplete implementation, not a smaller scope.

3.2. When a PRD section describes a behavior "at minimum," treat the listed items as a floor, not a target — check whether the actual implementation covers cases the PRD's prose implies but doesn't enumerate line by line (e.g., PRD §6's order state machine implies idempotent same-status PATCH even though it's called out once, not repeated at every mention).

3.3. Before closing a phase, re-read the corresponding row in `AGENTS.md`'s phase table and confirm every listed item in "Work" was actually touched — not just the first two or three.

3.4. Documentation (Phase 8) is written by re-deriving the request/response from the actual running API, not copied from the PRD's illustrative examples — the PRD's JSON samples are a design spec, not guaranteed to be byte-identical to what ships.

---

## 4. Conflict Surfacing & Decision Logging

4.1. Any place where this file, `AGENTS.md`, `SKILLS.md`, or the PRD appear to disagree gets named explicitly, not silently resolved in whichever direction is easiest to code.

4.2. Every non-trivial judgment call gets one line in `DECISIONS.md`: what was decided, what the alternative was, and why — following the PRD's own Decision Log format (PRD, final section). This is not optional documentation; it's how the defence conversation (PRD §27) stays answerable months later.

4.3. If a role (e.g., Security in Phase 5) finds something that should block the next phase, it blocks — it does not get downgraded to a "note for later" to keep the build moving. Constitution Rule 6 is absolute for money, identity, and order-state logic; everything else is a judgment call that still needs to be named, not just waved through.

4.4. When PRD guidance and a genuinely better/simpler pattern conflict, the PRD is not treated as untouchable — but changing it requires stating the tradeoff and getting it logged, not a quiet substitution.

---

## 5. Single-Question Turn Discipline

5.1. When something is genuinely ambiguous and not resolvable by "pick the simplest conventional solution and log it" (Constitution Rule 1), ask exactly **one** question and stop — don't bundle three uncertainties into one message hoping to resolve them all at once.

5.2. A question is only asked when the ambiguity is real and material — not as a way to defer a decision that Rule 1 already covers, and not for anything reversible/low-stakes that a documented default handles fine.

5.3. If the answer to a pending question doesn't arrive, the build does not stall indefinitely on it unless it touches money, identity, or data loss (Constitution Rule 5) — otherwise proceed on the logged default and flag the assumption in `DECISIONS.md` for later correction if needed.

---

## 6. Git & Commit Discipline

6.1. Commits are incremental and scoped to one phase or one logical change — never a single commit containing the entire build. PRD §25 explicitly checks for this; a squashed history fails Definition of Done even if the code is correct.

6.2. Commit messages state what changed and, where it's a non-obvious decision, why — "fix" and "wip" are not acceptable commit messages for this project.

6.3. `DECISIONS.md` and `README.md` updates land in the same commit as the code they document, not as a separate catch-up pass at the end.

---

## 7. Scope Discipline

7.1. Before adding any new file, dependency, endpoint, or config option, check it against PRD §2's non-goals list by name — if it's arguably adjacent to a non-goal (e.g., "just a simple auth check" adjacent to "no authentication"), that's a stop, not a judgment call.

7.2. Gold-plating is scope creep too. Don't add caching, GraphQL, or a nicer admin-style query language "since it's easy" — PRD §26.3 and §2 both treat this as a violation, not a bonus.

7.3. If a stretch feature genuinely seems worth adding (e.g., the PRD's optional `Idempotency-Key` header in §6), it's flagged explicitly as a documented addition beyond the brief — never silently folded in as if it were always required.

---

## 8. Money & Identity Handling (non-negotiable, no exceptions)

8.1. Every money field, in every layer (schema, business logic, API response, consumer display), is an integer in minor units. A single float slipping in anywhere in this path is treated as a Security-gate-blocking defect, not a style nitpick.

8.2. `totalAmount` and `unitPrice` are never client-supplied or re-derived from a live product join after order creation — server-computed at creation, snapshotted, done.

8.3. Every generated identifier is a UUID. No sequential integer ID is introduced anywhere, including internal/debug tooling that might otherwise default to auto-increment.

---

## How this file relates to the others

- **`AGENTS.md`** — the Constitution (principles) and the phased plan (sequencing, gates, roles).
- **`RULES.md`** (this file) — what the Constitution's principles actually require, concretely, checkable in a code review.
- **`SKILLS.md`** — domain-specific checklists loaded per phase (what to build correctly).
- **`task1-ecommerce-api-prd.md`** — what gets built, in full technical detail.

Drop this alongside `AGENTS.md` at the repo root, or under `.agents/rules/` if the runtime supports a dedicated rules directory.
