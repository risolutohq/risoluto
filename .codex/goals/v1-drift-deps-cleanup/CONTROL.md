# CONTROL

## Status Contract

status_file: PLAN.md
attempt_log: ATTEMPTS.md
durable_notes: NOTES.md
update_memory_after: every_experiment
check_control_before: phase_change, strategic_pivot, expensive_step, dependency_defer, pr_publication

## Human Priorities

primary_priority: evidence_quality
secondary_priority: stability

## Scope Knobs

dependency_update_mode: safe_latest
package_manager_update_mode: latest_corepack_pnpm
docs_cleanup_mode: remove_or_rewrite_stale
push_mode: branch_and_pr
allow_frontend_reintroduction: false
allow_docs_site_reintroduction: false
allow_large_architecture_rewrites: false

protected_files:

- /home/oruc/Desktop/risoluto-v1-step1-github-org-repo-prompt.md
- /home/oruc/Desktop/risoluto-v1-step2-legacy-repo-transition-prompt.md
- /home/oruc/Desktop/risoluto-v1-step3-foundation-docs-completion-log.md
- /home/oruc/Desktop/risoluto-v1-step4-curated-snapshot-import-completion-log.md
- /home/oruc/Desktop/risoluto-v1-transition-agent-handoff.md

max_blast_radius: repo_drift_cleanup_plus_dependency_updates_only

## Resource Knobs

max_runtime_per_step: none
max_parallel_jobs: reasonable_local_default
network_allowed: true
external_api_allowed: gh_only_if_authenticated

## Decision Gates

require_approval_for:

- strategic_pivot
- destructive_change
- schema_or_migration_change
- public_api_change
- scope_expansion
- large_architecture_rewrite
- frontend_or_docs_site_reintroduction

## Sidecar Inputs

sidecar_apply_cadence: before_phase_change
nudge_file: none
human_overlay_file: none
review_queue_file: none

## Latest Human Nudge

None.
