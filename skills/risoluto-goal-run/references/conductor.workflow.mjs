export const meta = {
  name: "risoluto-goal-run",
  description:
    "Drive a Risoluto goal package as a wave cascade — waves sequential, ready issues within a wave built in parallel in isolated worktrees, merged up to the integration branch. The script orchestrates; agents do all git/impl/merge.",
  phases: [{ title: "Cascade", detail: "per-wave: parallel issue builds -> serial merge -> wave gate -> integration merge" }],
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
  properties: { ok: { type: "boolean" }, waveBranch: { type: "string" }, note: { type: "string" } },
};
const BUILD_SCHEMA = {
  type: "object",
  required: ["issueId", "status"],
  additionalProperties: true,
  properties: {
    issueId: { type: "string" },
    branch: { type: "string" },
    status: { enum: ["green", "failed"] },
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
      `3. Read ${goalDir}/CONTROL.md; if it says paused: true, return ok:false with note "paused".`,
      `Return {ok, waveBranch:"${wave.branch}", note}.`,
    ].join("\n"),
    { schema: SETUP_SCHEMA, label: `setup:w${wave.number}`, phase: "Cascade", agentType: "general-purpose" },
  );
  if (!setup || !setup.ok) {
    results.push({ wave: wave.number, blocked: true, reason: setup ? setup.note : "setup failed" });
    break;
  }

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
      ready.map((iss) => () =>
        agent(
          [
            `You are the issue-build agent for ${iss.id} (${iss.title}) in ${slug} wave ${wave.number}.`,
            gitRules,
            "Steps:",
            `1. Create a worktree: git -C ${repoRoot} worktree add ${repoRoot}/.agent-worktrees/${slug}-${iss.id} -b ${iss.branch} ${wave.branch}. Symlink node_modules in.`,
            `2. Implement ${iss.id} against its Linear acceptance criteria + linked PRD. Use /risoluto-tdd ${iss.id} as the local method if available; otherwise follow the same red -> green -> refactor shape directly. Stay scoped to this issue.`,
            `3. Run the focused acceptance check for the slice; commit on ${iss.branch} with a conventional message (CI=true). Do NOT open a PR. Do NOT mark Linear Done (the merge agent does that after merge).`,
            `Return {issueId:"${iss.id}", branch:"${iss.branch}", status:"green" or "failed", evidence}. If you cannot make the slice pass, return status:"failed" with the failure evidence — do not widen scope.`,
          ].join("\n"),
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
    mergedIds.forEach((id) => doneIds.add(id));
    remaining = remaining.filter((i) => !doneIds.has(i.id));
    if ((merge && merge.blocked) || mergedIds.length === 0) {
      blockedWave = true;
      break;
    }
  }

  if (blockedWave && remaining.length > 0) {
    const unmerged = remaining.map((i) => i.id);
    await agent(
      `Record a blocker in ${goalDir}/PLAN.md: ${slug} wave ${wave.number} stalled with unmerged issues ${unmerged.join(", ")}. Append the exact evidence to ${goalDir}/ATTEMPTS.md. Make no code changes.`,
      { label: `blocker:w${wave.number}`, phase: "Cascade", agentType: "general-purpose" },
    );
    results.push({ wave: wave.number, blocked: true, unmerged });
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
  results.push({ wave: wave.number, green: Boolean(gate && gate.green), merged });
  if (!merged) break;
}

const wavesMerged = results.filter((r) => r.merged).length;
const allWavesMerged = wavesMerged === waves.length;
log(`Cascade finished: ${wavesMerged}/${waves.length} waves merged into ${integrationBranch}.`);

return {
  slug,
  integrationBranch,
  waves: results,
  wavesMerged,
  allWavesMerged,
  readyForReview: allWavesMerged,
};
