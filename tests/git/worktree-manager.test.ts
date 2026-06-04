import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../../src/core/logger.js";
import {
  addWorktree,
  attachWorktree,
  branchExists,
  deriveRepoKey,
  ensureBaseClone,
  isWorktreeClean,
  listWorktrees,
  removeWorktree,
  syncBaseClone,
  type WorktreeContext,
} from "../../src/git/worktree-manager.js";
import { InvalidRepoUrlError } from "../../src/git/git-validation.js";
import type { GitRunner } from "../../src/git/manager.js";

const mkdirMock = vi.fn();
const mkdtempMock = vi.fn();
const renameMock = vi.fn();
const rmMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  mkdtemp: (...args: unknown[]) => mkdtempMock(...args),
  rename: (...args: unknown[]) => renameMock(...args),
  rm: (...args: unknown[]) => rmMock(...args),
}));

beforeEach(() => {
  mkdirMock.mockReset().mockResolvedValue(undefined);
  mkdtempMock.mockReset().mockImplementation((prefix: string) => Promise.resolve(`${prefix}tmp`));
  renameMock.mockReset().mockResolvedValue(undefined);
  rmMock.mockReset().mockResolvedValue(undefined);
});

function createContext(runGit: GitRunner): WorktreeContext {
  return {
    runGit,
    env: {},
    logger: createLogger(),
  };
}

describe("worktree-manager", () => {
  it.each([
    ["https://github.com/acme/backend.git", "https-github.com-acme-backend"],
    ["git@github.com:acme/backend.git", "git-github.com-acme-backend"],
    [" ssh://git@example.com/team/platform repo.git ", "ssh-git-example.com-team-platform-repo"],
    ["!!!", "repo"],
  ])("derives a repo key for %s", (repoUrl, expected) => {
    expect(deriveRepoKey(repoUrl)).toBe(expected);
  });

  it("clones a base repo into a temp dir then atomically renames it", async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === "rev-parse") {
        throw new Error("missing git dir");
      }
      return { stdout: "", stderr: "" };
    };

    await ensureBaseClone(createContext(runGit), "https://github.com/acme/backend.git", "/tmp/base/backend.git");

    expect(calls).toEqual([
      ["rev-parse", "--git-dir"],
      ["clone", "--bare", "--", "https://github.com/acme/backend.git", "/tmp/base/.clone-tmp"],
    ]);
    expect(renameMock).toHaveBeenCalledWith("/tmp/base/.clone-tmp", "/tmp/base/backend.git");
  });

  it("serializes concurrent base clones of the same dir via a per-repo lock", async () => {
    let active = 0;
    let maxActive = 0;
    const runGit: GitRunner = async (args) => {
      if (args[0] === "rev-parse") {
        throw new Error("missing git dir");
      }
      if (args[0] === "clone") {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      }
      return { stdout: "", stderr: "" };
    };
    const ctx = createContext(runGit);

    await Promise.all([
      ensureBaseClone(ctx, "https://github.com/acme/backend.git", "/tmp/base/concurrent.git"),
      ensureBaseClone(ctx, "https://github.com/acme/backend.git", "/tmp/base/concurrent.git"),
    ]);

    expect(maxActive).toBe(1);
  });

  it.each(["-x", "ext::sh -c id"])("refuses to clone a base repo from a dangerous URL (%s)", async (repoUrl) => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === "rev-parse") {
        throw new Error("missing git dir");
      }
      return { stdout: "", stderr: "" };
    };

    await expect(ensureBaseClone(createContext(runGit), repoUrl, "/tmp/base/backend.git")).rejects.toThrow(
      InvalidRepoUrlError,
    );
    expect(calls.some((args) => args[0] === "clone")).toBe(false);
  });

  it("fetches an existing base repo instead of cloning", async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === "rev-parse") {
        return { stdout: ".git\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    await ensureBaseClone(createContext(runGit), "https://github.com/acme/backend.git", "/tmp/base/backend.git");

    expect(calls).toEqual([
      ["rev-parse", "--git-dir"],
      ["fetch", "origin", "--prune"],
    ]);
  });

  it("syncs the base clone with prune", async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    };

    await syncBaseClone(createContext(runGit), "/tmp/base/backend.git");

    expect(calls).toEqual([["fetch", "origin", "--prune"]]);
  });

  it("adds a new worktree from a start point", async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    };

    await addWorktree(
      createContext(runGit),
      "/tmp/base/backend.git",
      "/tmp/worktrees/RIS-42",
      "risoluto/ris-42",
      "main",
    );

    expect(calls).toEqual([["worktree", "add", "-b", "risoluto/ris-42", "/tmp/worktrees/RIS-42", "main"]]);
  });

  it("attaches an existing branch as a worktree", async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    };

    await attachWorktree(createContext(runGit), "/tmp/base/backend.git", "/tmp/worktrees/RIS-42", "risoluto/ris-42");

    expect(calls).toEqual([["worktree", "add", "/tmp/worktrees/RIS-42", "risoluto/ris-42"]]);
  });

  it("removes a worktree and prunes metadata", async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    };

    await removeWorktree(createContext(runGit), "/tmp/base/backend.git", "/tmp/worktrees/RIS-42");

    expect(calls).toEqual([
      ["worktree", "remove", "/tmp/worktrees/RIS-42"],
      ["worktree", "prune"],
    ]);
  });

  it("force removes a worktree and prunes metadata", async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    };

    await removeWorktree(createContext(runGit), "/tmp/base/backend.git", "/tmp/worktrees/RIS-42", true);

    expect(calls).toEqual([
      ["worktree", "remove", "--force", "/tmp/worktrees/RIS-42"],
      ["worktree", "prune"],
    ]);
  });

  it("parses porcelain worktree listings", async () => {
    const runGit: GitRunner = async () => ({
      stdout: [
        "worktree /tmp/base/backend.git",
        "bare",
        "",
        "worktree /tmp/worktrees/main",
        "HEAD abcdef123",
        "branch refs/heads/main",
        "",
        "worktree /tmp/worktrees/detached",
        "HEAD deadbeef",
        "detached",
        "",
      ].join("\n"),
      stderr: "",
    });

    await expect(listWorktrees(createContext(runGit), "/tmp/base/backend.git")).resolves.toEqual([
      { path: "/tmp/base/backend.git", branch: null, bare: true },
      { path: "/tmp/worktrees/main", branch: "refs/heads/main", bare: false },
      { path: "/tmp/worktrees/detached", branch: null, bare: false },
    ]);
  });

  it.each([
    ["", true],
    [" M src/file.ts\n", false],
  ])("reports worktree cleanliness from porcelain status %j", async (stdout, expected) => {
    const runGit: GitRunner = async () => ({ stdout, stderr: "" });

    await expect(isWorktreeClean(createContext(runGit), "/tmp/worktrees/RIS-42")).resolves.toBe(expected);
  });

  it("detects when a branch exists", async () => {
    const runGit = vi.fn<GitRunner>(async () => ({ stdout: "refs/heads/risoluto/ris-42\n", stderr: "" }));

    await expect(branchExists(createContext(runGit), "/tmp/base/backend.git", "risoluto/ris-42")).resolves.toBe(true);
  });

  it("detects when a branch is missing", async () => {
    const runGit = vi.fn<GitRunner>(async () => {
      throw new Error("missing branch");
    });

    await expect(branchExists(createContext(runGit), "/tmp/base/backend.git", "risoluto/ris-42")).resolves.toBe(false);
  });

  it("detects a branch that exists only as a remote-tracking ref", async () => {
    const calls: string[][] = [];
    const runGit: GitRunner = async (args) => {
      calls.push(args);
      if (args[2] === "refs/heads/risoluto/ris-42") {
        throw new Error("no local branch");
      }
      return { stdout: "refs/remotes/origin/risoluto/ris-42\n", stderr: "" };
    };

    await expect(branchExists(createContext(runGit), "/tmp/base/backend.git", "risoluto/ris-42")).resolves.toBe(true);
    expect(calls).toEqual([
      ["rev-parse", "--verify", "refs/heads/risoluto/ris-42"],
      ["rev-parse", "--verify", "refs/remotes/origin/risoluto/ris-42"],
    ]);
  });
});
