export const meta = {
  name: "risoluto-goal-run",
  description:
    "Drive a Risoluto goal package as a wave cascade — waves sequential, ready issues within a wave built in parallel in isolated worktrees, merged up to the integration branch. The script orchestrates; agents do all git/impl/merge.",
  phases: [
    { title: "Cascade", detail: "per-wave: parallel issue builds -> serial merge -> wave gate -> integration merge" },
  ],
};

// args (assembled by the /risoluto-goal-run skill from WAVES.md + live Linear):
//   { slug, repoRoot, goalDir, baseBranch, integrationBranch,
//     waves: [{ number, name, branch, issues: [{ id, title, branch, blockedBy: [id...] }] }] }

if (!args || !Array.isArray(args.waves)) {
  throw new Error("conductor: args.waves missing — launch via the /risoluto-goal-run skill, which assembles args");
}

const { slug, repoRoot, goalDir, baseBranch, integrationBranch, waves } = args;

const gitRules = [
  "GIT/ENV RULES (non-negotiable):",
  "- Prefix every pnpm command and every `git commit` with CI=true (the no-TTY context aborts pnpm otherwise).",
  "- If deps look missing in a worktree, run: CI=true pnpm install --frozen-lockfile.",
  `- Operate ONLY inside the worktree path you are given; never edit ${repoRoot} directly or another agent's worktree.`,
  "- Create worktrees with explicit git off the WAVE branch you are given, never off master.",
  `- Symlink deps so tests run: ln -s ${repoRoot}/node_modules <worktree>/node_modules ; do not recurse submodules.`,
  `- Remove a worktree when done: git -C ${repoRoot} worktree remove --force <worktree>.`,
  "- Never open a PR. Never force-push. Preserve unrelated working-tree changes.",
].join("\n");

const SETUP_SCHEMA = {
  type: "object",
  required: ["ok", "waveBranch"],
  additionalProperties: true,
  properties: {
    ok: { type: "boolean" },
    waveBranch: { type: "string" },
    // The require_approval_for list parsed from CONTROL.md, threaded into build agents as a hard gate.
    requireApprovalFor: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
};
const BUILD_SCHEMA = {
  type: "object",
  required: ["issueId", "status"],
  additionalProperties: true,
  properties: {
    issueId: { type: "string" },
    branch: { type: "string" },
    status: { enum: ["green", "failed"] },
    // commitSha is the `git rev-parse HEAD` of the slice commit; required in practice for a green
    // build so the merge-verification agent can prove the commit is reachable from the wave branch.
    commitSha: { type: "string" },
    evidence: { type: "string" },
  },
};
const MERGE_SCHEMA = {
  type: "object",
  required: ["mergedIds", "blocked"],
  additionalProperties: true,
  properties: {
    mergedIds: { type: "array", items: { type: "string" } },
    blocked: { type: "boolean" },
    note: { type: "string" },
  },
};
// Post-merge audit: git is canon (verifiedIds gate doneIds), Linear is a mirror (linearNotDoneIds
// only journals drift). Read-only — the agent makes no merges, commits, or Linear writes.
const VERIFY_MERGE_SCHEMA = {
  type: "object",
  required: ["verifiedIds", "unverifiedIds", "linearDoneIds", "linearNotDoneIds"],
  additionalProperties: true,
  properties: {
    verifiedIds: { type: "array", items: { type: "string" } },
    unverifiedIds: { type: "array", items: { type: "string" } },
    linearDoneIds: { type: "array", items: { type: "string" } },
    linearNotDoneIds: { type: "array", items: { type: "string" } },
  },
};
const GATE_SCHEMA = {
  type: "object",
  required: ["green", "mergedToIntegration"],
  additionalProperties: true,
  properties: { green: { type: "boolean" }, mergedToIntegration: { type: "boolean" }, note: { type: "string" } },
};

// A blocker outside the current wave is satisfied (earlier waves merged before this wave starts).
function readyIn(wave, remaining, doneIds) {
  const inWave = new Set(wave.issues.map((i) => i.id));
  return remaining.filter((i) => i.blockedBy.every((b) => doneIds.has(b) || !inWave.has(b)));
}

// Always journal a wave blocker — best-effort, never throws. A null gate/build agent return
// (budget or context exhaustion) must not swallow the reason the cascade stopped; the returned
// summary still carries blockedReason even if PLAN.md could not be written.
async function recordBlocker(waveNumber, reason) {
  try {
    await agent(
      `Record a blocker in ${goalDir}/PLAN.md: ${slug} wave ${waveNumber} did not complete. Reason: ${reason}. Append the exact evidence to ${goalDir}/ATTEMPTS.md. Make no code changes.`,
      { label: `blocker:w${waveNumber}`, phase: "Cascade", agentType: "general-purpose" },
    );
  } catch (err) {
    log(
      `Wave ${waveNumber} blocker could not be journaled to PLAN.md (${err instanceof Error ? err.message : String(err)}); reason: ${reason}`,
    );
  }
}

const results = [];

for (const wave of waves) {
  phase("Cascade");
  const setup = await agent(
    [
      `You are the wave-setup agent for ${slug}, wave ${wave.number} (${wave.name}).`,
      gitRules,
      "Steps:",
      `1. cd ${repoRoot}; git fetch origin. Ensure ${integrationBranch} exists (create from origin/${baseBranch} if absent).`,
      `2. Create the wave branch ${wave.branch} from the current ${integrationBranch} tip (it already contains every earlier merged wave).`,
      `3. Read ${goalDir}/CONTROL.md; if it says paused: true, return ok:false with note "paused". Also parse its require_approval_for YAML list (the dash items under that key) and return it verbatim as requireApprovalFor (an array of strings; [] if absent).`,
      `Return {ok, waveBranch:"${wave.branch}", requireApprovalFor, note}.`,
    ].join("\n"),
    { schema: SETUP_SCHEMA, label: `setup:w${wave.number}`, phase: "Cascade", agentType: "general-purpose" },
  );
  if (!setup || !setup.ok) {
    results.push({ wave: wave.number, blocked: true, reason: setup ? setup.note : "setup failed" });
    break;
  }

  // CONTROL.md steering: actions the operator gated behind approval. Build agents have no way to ask
  // mid-run, so a gated action must halt that slice (status:failed) rather than proceed unapproved.
  const requireApprovalFor = Array.isArray(setup.requireApprovalFor) ? setup.requireApprovalFor : [];
  const approvalRule =
    requireApprovalFor.length > 0
      ? `APPROVAL GATE (from CONTROL.md): you must NOT perform any of these without operator approval: ${requireApprovalFor.join(", ")}. There is no way to obtain approval in this run, so if the slice would require any of them (e.g. widening scope, a destructive change, or adding/upgrading a dependency), STOP and return status:"failed" with evidence naming the gated action — do not proceed unapproved.`
      : null;

  const doneIds = new Set();
  let remaining = wave.issues.slice();
  let blockedWave = false;

  while (remaining.length > 0) {
    const ready = readyIn(wave, remaining, doneIds);
    if (ready.length === 0) {
      blockedWave = true;
      break;
    }

    const builds = await parallel(
      ready.map(
        (iss) => () =>
          agent(
            [
              `You are the issue-build agent for ${iss.id} (${iss.title}) in ${slug} wave ${wave.number}.`,
              gitRules,
              approvalRule,
              "Steps:",
              `1. Create a worktree: git -C ${repoRoot} worktree add ${repoRoot}/.agent-worktrees/${slug}-${iss.id} -b ${iss.branch} ${wave.branch}. Symlink node_modules in.`,
              `2. Implement ${iss.id} against its Linear acceptance criteria + linked PRD. Use /risoluto-tdd ${iss.id} as the local method if available; otherwise follow the same red -> green -> refactor shape directly. Stay scoped to this issue.`,
              `3. Run the focused acceptance check for the slice; commit on ${iss.branch} with a conventional message (CI=true). On green, capture the commit hash with: git -C ${repoRoot}/.agent-worktrees/${slug}-${iss.id} rev-parse HEAD. Do NOT open a PR. Do NOT mark Linear Done (the merge agent does that after merge).`,
              `Return {issueId:"${iss.id}", branch:"${iss.branch}", status:"green" or "failed", commitSha:"<the rev-parse HEAD on green, omit on failed>", evidence}. If you cannot make the slice pass, return status:"failed" with the failure evidence — do not widen scope.`,
            ]
              .filter(Boolean)
              .join("\n"),
            { schema: BUILD_SCHEMA, label: `build:${iss.id}`, phase: "Cascade", agentType: "general-purpose" },
          ).then((r) => r || { issueId: iss.id, status: "failed", evidence: "agent returned null (skipped)" }),
      ),
    );

    const green = builds.filter((b) => b && b.status === "green");
    const order = green.length > 0 ? green.map((b) => `${b.issueId} (${b.branch})`).join(", ") : "(none)";
    const merge = await agent(
      [
        `You are the merge agent for ${slug} wave ${wave.number}. Merge GREEN issue branches into ${wave.branch}, ONE AT A TIME, in order: ${order}.`,
        gitRules,
        "For each branch: checkout the wave branch, merge the issue branch. If a merge conflict needs product/ownership judgment, STOP and leave it unmerged (do not guess).",
        "After each successful merge: mark that issue Done in Linear, comment the merge result on the issue, and remove its worktree (--force).",
        "Return {mergedIds:[ids merged this round], blocked: true only if a conflict needs judgment, note}.",
      ].join("\n"),
      { schema: MERGE_SCHEMA, label: `merge:w${wave.number}`, phase: "Cascade", agentType: "general-purpose" },
    );

    const mergedIds = merge && Array.isArray(merge.mergedIds) ? merge.mergedIds : [];
    // Do not trust the merge agent's self-report. Git is canon: only commits provably reachable from
    // the wave branch count as Done. Linear is a mirror: a Done mismatch journals drift but does not halt.
    let verifiedIds = [];
    if (mergedIds.length > 0) {
      const shaById = new Map(green.filter((b) => b.commitSha).map((b) => [b.issueId, b.commitSha]));
      const branchById = new Map(green.map((b) => [b.issueId, b.branch]));
      const claims = mergedIds.map((id) => ({
        issueId: id,
        commitSha: shaById.get(id) || null,
        branch: branchById.get(id) || null,
      }));
      const verify = await agent(
        [
          `You are the read-only merge-verification agent for ${slug} wave ${wave.number}. The merge agent claims it merged these issues into ${wave.branch}: ${JSON.stringify(claims)}.`,
          gitRules,
          `1. GIT (canon): for each claim with a commitSha, run: git -C ${repoRoot} merge-base --is-ancestor <commitSha> ${wave.branch} (exit 0 = the commit is reachable from ${wave.branch}). Put issueIds whose commit is reachable in verifiedIds; put every other claimed id — unreachable, or with a null/missing commitSha — in unverifiedIds.`,
          `2. LINEAR (mirror): read each claimed issue's current state; put ids with state.name == "Done" in linearDoneIds, the rest in linearNotDoneIds.`,
          "Make NO merges, NO commits, NO Linear writes — this is a read-only audit.",
          "Return {verifiedIds, unverifiedIds, linearDoneIds, linearNotDoneIds}.",
        ].join("\n"),
        { schema: VERIFY_MERGE_SCHEMA, label: `verify:w${wave.number}`, phase: "Cascade", agentType: "general-purpose" },
      );
      verifiedIds = verify && Array.isArray(verify.verifiedIds) ? verify.verifiedIds : [];
      const unverified = verify && Array.isArray(verify.unverifiedIds) ? verify.unverifiedIds : mergedIds;
      const linearNotDone = verify && Array.isArray(verify.linearNotDoneIds) ? verify.linearNotDoneIds : [];
      if (unverified.length > 0) {
        await recordBlocker(
          wave.number,
          `merge agent reported [${unverified.join(", ")}] merged, but their commits are NOT reachable from ${wave.branch} — not counted Done`,
        );
      }
      if (linearNotDone.length > 0) {
        await recordBlocker(
          wave.number,
          `git-merged issues not yet marked Done in Linear (mirror drift — continuing): [${linearNotDone.join(", ")}]`,
        );
      }
    }
    verifiedIds.forEach((id) => doneIds.add(id));
    remaining = remaining.filter((i) => !doneIds.has(i.id));
    if ((merge && merge.blocked) || verifiedIds.length === 0) {
      blockedWave = true;
      break;
    }
  }

  if (blockedWave && remaining.length > 0) {
    const unmerged = remaining.map((i) => i.id);
    const reason = `wave stalled with unmerged issues ${unmerged.join(", ")}`;
    await recordBlocker(wave.number, reason);
    results.push({ wave: wave.number, blocked: true, unmerged, blockedReason: reason });
    break;
  }

  const gate = await agent(
    [
      `You are the wave-gate agent for ${slug} wave ${wave.number}.`,
      gitRules,
      `1. On ${wave.branch}, run /v1-check (CI=true: build, lint, format:check, test, typecheck, typecheck:coverage). If red, repair ONCE using the exact failure output, then re-run.`,
      `2. If still red: append evidence to ${goalDir}/ATTEMPTS.md, write the blocker to ${goalDir}/PLAN.md, and return green:false, mergedToIntegration:false.`,
      `3. If green: merge ${wave.branch} into ${integrationBranch}; update ${goalDir}/PLAN.md and ${goalDir}/NOTES.md with the wave result.`,
      "Return {green, mergedToIntegration, note}.",
    ].join("\n"),
    { schema: GATE_SCHEMA, label: `gate:w${wave.number}`, phase: "Cascade", agentType: "general-purpose" },
  );

  const merged = Boolean(gate && gate.green && gate.mergedToIntegration);
  if (!merged) {
    const reason = !gate
      ? "wave-gate agent returned null (budget/context exhaustion or skip) — no gate verdict was recorded by the agent"
      : !gate.green
        ? `wave gate red after one repair: ${gate.note || "no note"}`
        : `wave gate green but not merged to ${integrationBranch}: ${gate.note || "no note"}`;
    await recordBlocker(wave.number, reason);
    results.push({ wave: wave.number, green: Boolean(gate && gate.green), merged: false, blockedReason: reason });
    break;
  }
  results.push({ wave: wave.number, green: true, merged: true });
}

const wavesMerged = results.filter((r) => r.merged).length;
const allWavesMerged = wavesMerged === waves.length;
const blocked = results.find((r) => r.blocked || r.blockedReason || r.merged === false);
log(
  allWavesMerged
    ? `Cascade finished: all ${wavesMerged}/${waves.length} waves merged into ${integrationBranch}.`
    : `Cascade halted at wave ${blocked ? blocked.wave : "?"} (${wavesMerged}/${waves.length} merged): ${
        blocked ? blocked.blockedReason || blocked.reason || "see PLAN.md" : "unknown reason"
      }.`,
);

// Append a machine-readable run footer to NOTES.md so AFK completion is jq-queryable. The script has
// no fs access and cannot call Date.now(); a best-effort agent stamps finishedAt and writes the block.
const runFooter = {
  contract: "conductor-run.v1",
  finishedAt: "<FINISHED_AT>",
  slug,
  wavesMerged,
  waveTotal: waves.length,
  allWavesMerged,
  blocked: blocked ? { wave: blocked.wave, reason: blocked.blockedReason || blocked.reason || "see PLAN.md" } : null,
  waves: results,
};
try {
  await agent(
    [
      `You are the run-footer agent for ${slug}. Append a machine-readable footer to ${goalDir}/NOTES.md and make NO other changes (no code, no git, no Linear).`,
      `1. Get the current UTC timestamp: date -u +%Y-%m-%dT%H:%M:%SZ`,
      `2. Append (do not overwrite) the following to the END of ${goalDir}/NOTES.md, replacing the <FINISHED_AT> placeholder with that timestamp:`,
      "",
      "## conductor-run.v1",
      "",
      "```json",
      JSON.stringify(runFooter, null, 2),
      "```",
    ].join("\n"),
    { label: "run-footer", phase: "Cascade", agentType: "general-purpose" },
  );
} catch (err) {
  log(`run footer could not be written to NOTES.md (${err instanceof Error ? err.message : String(err)})`);
}

return {
  slug,
  integrationBranch,
  waves: results,
  wavesMerged,
  allWavesMerged,
  blocked: blocked ? { wave: blocked.wave, reason: blocked.blockedReason || blocked.reason || "see PLAN.md" } : null,
  readyForReview: allWavesMerged,
};
