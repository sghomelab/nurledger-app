# Claude <-> OpenCode handoff (via GitHub)

Rule (Mas, 2026-11-08): everything between Claude and OpenCode goes through GitHub, not copy-paste.

- Claude writes the task as `docs/handoff/NNNN-short-title.md` on a `claude/*` branch (with the code, if any). Mas pushes the branch (Claude never pushes).
- OpenCode: `git fetch`, read the newest unmerged `docs/handoff/NNNN-*.md` on `origin/claude/*` (or main), do the task, and write the result to `docs/handoff/reports/NNNN-report.md` (what passed/failed, evidence, commit hashes, emulator state), then push to main/branch as the task allows.
- Claude reads the report from the repo (Mas pulls), reviews, and replies with the next numbered file.
- Each task file states: base commit, what NOT to do (no EAS builds/store actions without Mas's GO), steps, and the report format.
- Shared secrets never go in these files (use <PLACEHOLDERS>).
- Cross-repo work (e.g. website `nurlogic-ai`) is described in a task file here and the report says which repo was touched.
