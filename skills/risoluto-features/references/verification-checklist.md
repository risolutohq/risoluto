# Per-entry verification checklist

Run this checklist on every existing entry, every run. Step 4 of the pipeline.

Verification is the most expensive step but also the most valuable — it's what keeps the spine from rotting silently into authoritative-looking fiction. **Don't shortcut it.** If you're tempted to "trust" an entry because nothing obvious changed in the file, you're about to introduce drift.

## Checks, in order

For each entry, walk these in order. Mark the entry's status as you go. The first check that fails determines the outcome.

### 1. Files in citations still exist
```bash
for cit in entry.citations:
  test -f research/$cit.path
```
**If any fails:** the entry is a candidate for *removed* (or *modified* if the symbol moved to a new file). Search for the symbol across the tree:
```bash
git -C research grep -l "$cit.symbol" -- 'src/**'
```
If found, update the citation's `path` and re-derive line range. If not found, mark for removal.

### 2. Symbols still defined at the cited path
```bash
grep -nE '(class|function|const|interface|type|enum)\b.*\b'"$cit.symbol"'\b' research/$cit.path
```
**If symbol not found:** try `git -C research log -p --follow research/$cit.path | grep -B2 "$cit.symbol"` to see if the symbol was renamed. If renamed, update `symbol` and note in commit message.

### 3. Line ranges still bracket the symbol
The symbol may be at a different line than the spine claims. Re-derive:
```bash
start_line = grep -n "definition of $symbol" file | first match
end_line   = walk forward to closing brace / next top-level export
```
**If lines moved but symbol/file unchanged:** silently update `start_line` and `end_line` in the JSON. No need to call this out — drift in line numbers without a name/file change isn't a feature change.

### 4. Quoted constants still match
For each `observable_behavior` that quotes a literal constant (numeric, string, enum value), grep the cited file:
```bash
grep -E 'CONSTANT_NAME\s*=' research/$cit.path
```
**If the literal differs:** this IS a feature change. Update the behavior text and record the delta in the entry's `changed_since_previous.diff.observable_behaviors.changed[]` field. Surface in the diff section.

Examples that count:
- `DEFAULT_TIMEOUT_MS = 10_000` → `DEFAULT_TIMEOUT_MS = 15_000` (numeric default changed)
- Severity enum added/removed a value
- Default polling interval changed from 15 s to 30 s

Examples that don't count (cosmetic, not a feature change):
- Variable was renamed but value is identical
- Code reformatted (whitespace, line breaks) without semantic change

### 5. Issue references still in the same state
For each issue number in `issues[]`:
```bash
gh api repos/risolutohq/risoluto-research/issues/<N> --jq '{state, title, closed_at, reopened: (.state_reason == "reopened")}'
```
**If an issue was reopened:** add a `needs_followup[]` entry with a question about whether the spine claim still holds.
**If an issue title changed materially:** silently update the spine if the change clarifies what the feature actually is.

### 6. `shipped` date is still defensible
The `shipped.date` was set when the entry was created. Don't update it on every run — that would erase the historical claim. Only update if you discover the claim was wrong (e.g., issue ref points to a different ship date than the spine records).

## Outcome states per entry

After running the checks above, every existing entry ends in one of:

- **Unchanged** — every check passed cleanly. Update `verified_at` to the current run timestamp. Don't mark in the diff section.
- **Drifted (auto-corrected)** — citation lines moved silently, or a renamed symbol was relocated. Update fields. Don't mark in the diff section unless behavior changed too.
- **Modified** — observable behaviors / constants / citations changed in a way that affects the feature's contract. Set `changed_since_previous.kind = "modified"` and populate the diff payload. Surface in "Modified" section.
- **Removed** — citation files all gone AND symbols can't be relocated. Move entry to `removed_features[]` with `reason` populated. Surface in "Removed" section.

## Anti-patterns to avoid

- ❌ "The file exists, I'll trust the rest." → Verification must walk all 6 checks. The file existing tells you nothing about whether the symbol or constants are intact.
- ❌ "Updating a behavior bullet but not flagging it as modified." → If a quoted constant changed, that's a feature change. Always surface in the diff.
- ❌ "The symbol moved to a different file, so the feature is removed." → Usually the symbol was just refactored. Relocate via `git grep` before marking removed.
- ❌ "Skipping verification of recently-added entries." → New entries can rot between their creation run and their next run, especially if the feature was changed in the same window.
- ❌ "Bulk-updating `verified_at` without re-running checks." → That timestamp is a claim. Only set it when verification actually ran.
