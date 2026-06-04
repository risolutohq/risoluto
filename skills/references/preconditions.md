# Hard preconditions (shared)

The repo- and environment-level checks every Risoluto pipeline skill runs before it touches git or
Linear. A skill links to the rows it needs instead of restating them. **Stop and report on the first
failure — do not retry Linear auth from inside a skill.**

| Check                   | Command / verification                                                   | If it fails                                                                |
| ----------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Run from repo root      | `test -f package.json`                                                    | Tell Omer to `cd` into the `risoluto` checkout root.                       |
| `research/` initialised | `git submodule status research` starts with a space (not `-`)            | Tell Omer to `git submodule update --init research` or `/init-research`.   |
| Linear API responding   | `LINEAR_API_KEY` set and the [connectivity probe](./linear-access.md#connectivity-probe-precondition-check) returns a non-empty `viewer` | Surface the Linear error verbatim; do not retry auth. |
| Working tree clean      | `git status --porcelain -- <paths the skill writes>` is empty            | Tell Omer to commit or stash the listed paths before running.              |

Skill-specific preconditions (a roadmap row exists, a PRD exists, an issue's blockers are `Done`,
required model ids are set, …) stay in the owning skill — only the four rows above are shared.
