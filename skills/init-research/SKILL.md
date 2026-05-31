---
name: init-research
description: Initialize or refresh the private `research/` submodule (risolutohq/risoluto-research). Use when the user says "/init-research", when starting work in a fresh clone, when `research/` is empty or missing, or before invoking the risoluto-features spine skill. Safe to run repeatedly — idempotent.
---

# /init-research

The `research/` submodule (`risolutohq/risoluto-research`, private) is a hard prerequisite for any work in this repo per `AGENTS.md` (which `CLAUDE.md` imports). This skill verifies it and initializes it if missing.

## Steps

```bash
# 1. Check current submodule state
git submodule status research

# 2. If the leading character is "-" (not initialized) or "+" (out of sync), init/update:
git submodule update --init --recursive research

# 3. Confirm the working copy is non-empty and at the expected commit:
ls research/ | head
git -C research rev-parse --short HEAD
```

## Reading the `git submodule status` output

- **`-<sha> research`** → not initialized. Run `git submodule update --init research`.
- **` <sha> research`** (leading space) → initialized and clean. No action needed.
- **`+<sha> research`** → initialized but at a different commit than what the superproject pins. Run `git submodule update research` to sync.
- **`U<sha> research`** → merge conflict in the submodule. Stop and surface to the user.

## Auth troubleshooting

`risoluto-research` is private. If the init fails with `Permission denied (publickey)` or `Repository not found`:

1. Confirm the user has access to `github.com/risolutohq/risoluto-research`.
2. Confirm SSH keys are loaded (`ssh -T git@github.com` should greet the user by name).
3. If using HTTPS, confirm `gh auth status` shows an authenticated user with `repo` scope.

Do not attempt to bypass auth or alter the submodule URL.

## What this skill is NOT

- Not a sync-on-every-pull command — `git pull --recurse-submodules` handles that.
- Not a way to advance the pinned commit. To bump the pin, work inside `research/` directly, then commit the new SHA in the superproject (see recent `chore: bump research/ to ...` commits for the pattern).
