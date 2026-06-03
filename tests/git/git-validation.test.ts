import { describe, expect, it } from "vitest";

import {
  InvalidGitRefError,
  InvalidRepoUrlError,
  assertAllowedRepoUrl,
  assertValidBranchName,
} from "../../src/git/git-validation.js";

describe("assertValidBranchName", () => {
  it.each(["risoluto/nin-42", "feature/custom", "release/1.2.3", "fix-bug"])(
    "accepts a well-formed branch name (%s)",
    (name) => {
      expect(() => assertValidBranchName(name)).not.toThrow();
    },
  );

  it.each([
    "",
    "   ",
    "-x",
    "--force",
    "foo..bar",
    "a b",
    "a:b",
    "a~b",
    "a^b",
    "a?b",
    "a*b",
    "a[b",
    "x.lock",
    "x/",
    "/x",
    "a//b",
    ".hidden/x",
    "@",
    "a@{b",
    "trailing.",
  ])("rejects an invalid branch name (%s)", (name) => {
    expect(() => assertValidBranchName(name)).toThrow(InvalidGitRefError);
  });
});

describe("assertAllowedRepoUrl", () => {
  it.each([
    "https://github.com/acme/backend.git",
    "http://example.com/repo.git",
    "ssh://git@example.com/team/repo.git",
    "git://example.com/repo.git",
    "file:///srv/repos/backend.git",
    "git@github.com:acme/backend.git",
  ])("accepts an allowed repository URL (%s)", (url) => {
    expect(() => assertAllowedRepoUrl(url)).not.toThrow();
  });

  it.each(["", "   ", "-oProxyCommand=evil", "ext::sh -c id", "fd::17/foo", "foo", "/local/path"])(
    "rejects a dangerous or disallowed repository URL (%s)",
    (url) => {
      expect(() => assertAllowedRepoUrl(url)).toThrow(InvalidRepoUrlError);
    },
  );
});
