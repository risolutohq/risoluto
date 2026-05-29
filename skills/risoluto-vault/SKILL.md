---
name: risoluto-vault
description: Configure the `research/` submodule as a scoped Obsidian vault for the Risoluto planning pipeline — writes `.obsidian/{app,appearance,core-plugins,community-plugins}.json`, installs `templates/{source,target-readme}.md` and pre-canned Dataview view notes (untagged sources, targets stale 90d+), pins the Web Clipper / Dataview / Templater plugin set, and forces relative-markdown-links so the vault and the Risoluto skill pipeline see the same link shape. Use this skill whenever Omer says `/risoluto-vault`, "set up the research vault", "configure obsidian on research", "repair vault config", "reinstall vault templates", "vault is drifting", "pin vault plugins", "scope my research as an obsidian vault", or any variation that implies seeding or repairing the Obsidian config inside `research/`. Idempotent — re-runs detect drift, restore canonical files, and surface missing community plugins with install instructions without clobbering operator-owned preferences. Companion to Phase 1.2 of `docs/research-to-shipping-pipeline.md`.
---

# risoluto-vault

Scope-aware Obsidian vault configurator for the `research/` submodule. Phase 1.2 of the planning-pipeline roadmap.

## What this skill produces

Files written inside the `research/` submodule (a separate git repo — every commit lands there, not in `risolutohq/risoluto`):

```
research/
├── .obsidian/
│   ├── app.json                 # link discipline (relative markdown, no wikilinks)
│   ├── appearance.json          # operator preference — written only if missing
│   ├── core-plugins.json        # opinionated core plugin set
│   └── community-plugins.json   # pinned: web-clipper, dataview, templater
├── templates/
│   ├── source.md
│   └── target-readme.md
├── views/
│   ├── untagged-sources.md
│   └── targets-stale.md
└── wiki/                        # built by /risoluto-ingest — not managed by this skill
```

These files are the _contract_ the rest of the pipeline relies on:

- **Frontmatter templates** match `research/.schemas/{source,target}.schema.json` exactly. If you change a schema, change the matching template in this skill's `assets/templates/` and re-apply.
- **Dataview view notes** (`research/views/*`) are the operator's at-a-glance dashboards — they read frontmatter the schemas define, so they only work if the templates are honored.
- **Relative markdown links** (`app.json`) are non-negotiable. The risoluto-researcher and risoluto-ingest skills both emit and parse relative paths; wikilinks would break path resolution outside Obsidian (CI, `git grep`, plain-text agents).
- **`research/wiki/`** is a connected wiki built by `/risoluto-ingest` from all targets. This skill does not write into it — it is listed here so operators know where to look.

## Two vaults, two homes

| Vault                   | Lives at                | Configured by                 |
| ----------------------- | ----------------------- | ----------------------------- |
| Personal vault          | `~/Documents/my-vault/` | `save-to-obsidian` (separate) |
| Risoluto research vault | `research/` (submodule) | **this skill**                |

These never share config. Don't symlink `.obsidian/` between them.

## Hard preconditions

Stop and report if any fail. Don't try to recover.

| Check                          | Command                                             | If it fails                                                              |
| ------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------ |
| Run from repo root             | `test -f package.json && test -f .gitmodules`       | Tell Omer to `cd` into the `risoluto` checkout root.                     |
| `research/` initialised        | `git submodule status research` starts with a space | Tell Omer to `git submodule update --init research` or `/init-research`. |
| `research/` working tree clean | `git -C research status --porcelain` empty          | List what's dirty; refuse and ask to commit/stash before applying.       |

## The pipeline

### Step 1 — Dry-run the apply

```bash
node skills/risoluto-vault/scripts/apply.mjs --dry-run
```

The applier walks the canonical asset tree under `skills/risoluto-vault/assets/` and reports, per file:

- `WRITE` — file missing, will be created
- `REPAIR` — file exists but differs from canonical; will be overwritten (only for files the skill owns canonically)
- `KEEP` — file exists and either matches canonical or is operator-owned (e.g. `appearance.json`)
- `PLUGIN-MISSING` — `community-plugins.json` lists a plugin whose `.obsidian/plugins/<id>/` is not installed; the applier prints the install hint and continues

Show the plan to Omer before applying. Surprise overwrites are the failure mode this guards against.

### Step 2 — Apply for real

```bash
node skills/risoluto-vault/scripts/apply.mjs
```

The applier is idempotent. Same script, same canonical assets, same result every run. The exit code is non-zero only when the preconditions fail or a write errors — `PLUGIN-MISSING` is a warning, not a failure (community plugins aren't installable from JSON alone; that step is manual on first run, see below).

### Step 3 — First-run plugin seed (manual, one-time)

The applier writes `community-plugins.json` listing the pinned set (`obsidian-web-clipper`, `dataview`, `templater-obsidian`), but Obsidian itself has to fetch them. On a fresh vault, expect three `PLUGIN-MISSING` warnings. To resolve:

1. Open `research/` as a vault in Obsidian (`File → Open vault → research/`).
2. Settings → Community plugins → Browse → install each of:
   - **Web Clipper** (Obsidian's first-party clipper)
   - **Dataview**
   - **Templater**
3. Enable each one. Restart Obsidian once.
4. Re-run `node skills/risoluto-vault/scripts/apply.mjs` — warnings clear.

After this seed, future operators clone the submodule and the `.obsidian/plugins/` directories travel with the repo, so the warnings only fire on truly green checkouts.

### Step 4 — Commit inside `research/`

The `research/` submodule has its own git history. Commit there, not in the parent.

```bash
cd research
git add .obsidian templates views
git commit -m "chore(vault): apply risoluto-vault config"
git push
cd ..
git add research
git commit -m "chore: bump research submodule for vault config"
```

The two commits are the only way to land submodule changes — the parent repo records the submodule SHA, the submodule records the actual files.

## Smoke test

Given a fresh `research/` submodule (no `.obsidian/`, no `templates/`, no `views/`):

```bash
node skills/risoluto-vault/scripts/apply.mjs
```

Expected output:

```
risoluto-vault: applying canonical config to research/
  WRITE  research/.obsidian/app.json
  WRITE  research/.obsidian/appearance.json
  WRITE  research/.obsidian/core-plugins.json
  WRITE  research/.obsidian/community-plugins.json
  WRITE  research/templates/source.md
  WRITE  research/templates/target-readme.md
  WRITE  research/views/untagged-sources.md
  WRITE  research/views/targets-stale.md
risoluto-vault: 8 file(s) written, 0 repaired, 0 kept.
risoluto-vault: 3 community plugin(s) not yet installed — open the vault in Obsidian and install:
  - obsidian-web-clipper
  - dataview
  - templater-obsidian
```

Re-running immediately:

```
risoluto-vault: applying canonical config to research/
  KEEP   research/.obsidian/app.json
  KEEP   research/.obsidian/appearance.json
  KEEP   research/.obsidian/core-plugins.json
  KEEP   research/.obsidian/community-plugins.json
  KEEP   research/templates/source.md
  KEEP   research/templates/target-readme.md
  KEEP   research/views/untagged-sources.md
  KEEP   research/views/targets-stale.md
risoluto-vault: 0 file(s) written, 0 repaired, 8 kept.
```

Drift repair — touch `research/.obsidian/app.json` to break it, re-run:

```
  REPAIR research/.obsidian/app.json
  KEEP   ...
risoluto-vault: 0 file(s) written, 1 repaired, 7 kept.
```

`appearance.json` is operator-owned — once it exists, the applier never overwrites it. Edit it in Obsidian's settings UI and the change sticks.

## File ownership (what the applier does and doesn't touch)

| File                               | Behaviour                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `.obsidian/app.json`               | Canonical — repaired every run. Forces relative-markdown-links.                    |
| `.obsidian/appearance.json`        | Seeded on first run, then operator-owned. Never overwritten.                       |
| `.obsidian/core-plugins.json`      | Canonical — repaired every run.                                                    |
| `.obsidian/community-plugins.json` | Canonical — repaired every run. The pinned set is the contract.                    |
| `.obsidian/plugins/*`              | Untouched. Plugin binaries are operator-installed via Obsidian's UI.               |
| `.obsidian/workspace*.json`        | Untouched. Pane layout is operator preference.                                     |
| `templates/*.md`                   | Canonical — repaired every run. Operator edits go in `assets/templates/` upstream. |
| `views/*.md`                       | Canonical — repaired every run. Dataview queries are part of the contract.         |
| `wiki/`                            | Untouched. Built and owned by `/risoluto-ingest`.                                  |
| Anything else under `research/`    | Untouched. Targets, sources, RISOLUTO_FEATURES — none of it is the vault's.        |

## Anatomy of the canonical assets

The applier copies bytes from `skills/risoluto-vault/assets/` into `research/`. Editing the skill means editing those assets — never edit the deployed copy in `research/` and expect it to stick, the next apply restores canonical.

```
skills/risoluto-vault/assets/
├── obsidian-config/
│   ├── app.json
│   ├── appearance.json
│   ├── core-plugins.json
│   └── community-plugins.json
├── templates/
│   ├── source.md
│   └── target-readme.md
└── dataview/
    ├── untagged-sources.md
    └── targets-stale.md
```

The `dataview/*` files land in `research/views/` (renamed conceptually, byte-identical) so the operator-visible folder name reads naturally.

## Why this skill exists separate from `risoluto-researcher`

The researcher (Phase 1.3) emits files conformant to these templates. If the researcher and the vault config diverge — schema change here, no template bump there — every captured source breaks `pnpm validate:research`. Putting the templates in one skill, owned by the same contract that owns `app.json`'s link discipline, keeps that surface narrow. Bump templates here; the researcher reads the same `research/templates/` folder at runtime.

## Updating the canonical set

When you intentionally change the contract (new template field, new Dataview view, new pinned plugin):

1. Edit the file under `skills/risoluto-vault/assets/`.
2. Bump the matching schema under `research/.schemas/` if frontmatter changed.
3. `pnpm validate:research` to confirm the schema still accepts existing files.
4. `node skills/risoluto-vault/scripts/apply.mjs` to push the new bytes into `research/`.
5. Commit in both repos (submodule first, then parent — see Step 4).

Do not edit `research/templates/*` or `research/views/*` directly. The applier will restore canonical on the next run and your edit will be lost.
