# The reachability invariant (shared)

The pipeline's most-violated invariant, stated once. Every skill and the afk-orchestrator daemon's
coder/reviewer prompts reference this file instead of restating it.

## The rule

**A capability is not done until a non-test caller can reach it.** Exporting a function, adding a
handler, or passing a unit test is *not* proof the operator can reach the behaviour. A green gate
(build / lint / test / typecheck / coverage) is a quality floor, **not** reachability.

## What counts as proof

Tick an acceptance criterion or call a slice done only when you can point at one of:

- A **production entry point** that calls the code on a real path — a CLI command, an HTTP route, a
  wired-up module export with a non-test importer, a scheduled job.
- A **cited test that exercises the real seam** (integration / e2e), not a unit test that imports the
  symbol in isolation.

## The probe

Before claiming reachability, grep for a non-test caller:

```bash
# Is src/handler.ts's export wired into a real entry point, or only reached by tests?
rg -n 'createHandler' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' src/
```

If the only callers are tests, the capability is **exported-but-unwired** — `NOT_MET`. Name the gap
(`src/handler.ts exported but no route calls it`) rather than ticking the box.
