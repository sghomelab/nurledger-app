# Development & Release Process

How work proceeds on this app. **This is a rule, not a suggestion** — agreed
with Mas 2026-11-18 (see PR #28, the reference example).

## Feature requests → design PR

When a feature request arrives (GitHub issue, chat, tester feedback):

1. **Reply with the three gates** (below), so the requester knows what their
   approvals actually buy.
2. **If it has design decisions** — ambiguity, "I let you decide", new
   capability, anything touching money/identity/data-integrity — push it to a
   **design-doc PR before any code exists**:
   - branch `design/<topic>-<issue#>` off current `main`
   - `docs/<TOPIC>-DESIGN.md` containing:
     - the problem in the requester's own words
     - **decisions log** — a table: question → decision → rationale
     - open items (things still needing the owner's call — non-blocking)
     - release plan (target version, build-credit rule, release gate)
     - verification plan (unit + on-device)
   - PR body = the conversation as a review thread + explicit statement:
     *"No code. No build credits. Nothing releases from this PR."*
3. **PR merge = design approved.** Then an implementation PR (code + tests)
   opens against the merged doc. Design mistakes get caught at
   comment-cost, not build-cost.
4. **No design decisions** (bug fix, small change, hotfix) → work **direct
   on `main`**. No PR ceremony; the Verification section below still applies.

## The three gates

| # | Gate | Owner's action | What it authorizes | Credits |
|---|---|---|---|---|
| 1 | **Design** | Merges the design PR | Start implementation (local code + tests) | 0 |
| 2 | **Build** | Explicit build GO **in the current conversation** (e.g. "build it"), after code is tested and committed | Queue EAS builds — iOS + Android from the **same commit** | EAS credits |
| 3 | **Release** | Owner's word (e.g. "release it") | Submit to TestFlight / Play | 0 |

Hard rules:

- **Merging a PR never triggers a build.** Design approval ≠ build approval.
- "Review and release" / "ship it" / "publish" = **prepare and stop at the
  queue line**, then ask. Only a build-specific GO in the current exchange
  spends credits.
- One hypothesis per build; both platforms from the same commit; verify the
  actual build number from the artifact after the build.
- Hotfixes may fold into the next feature release at the owner's direction
  (precedent: the 1.1.1 "(tabs)" fix folds into 1.2.0 — no standalone 1.1.1).

## Reference example

**PR #28** — `docs/CASHIER-AUTH-DESIGN.md` (issue #26): the first dry-run of
this flow. Design conversation held in chat → decisions logged in the PR →
gate rules recorded in the PR body. Future feature PRs should look like this.
