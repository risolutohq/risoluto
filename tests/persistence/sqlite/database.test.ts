import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { closeDatabase, openDatabase } from "../../../src/persistence/sqlite/database.js";
import { attemptEvents, attempts, issueIndex, notifications } from "../../../src/persistence/sqlite/schema.js";
import type { RisolutoDatabase } from "../../../src/persistence/sqlite/database.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-sqlite-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

describe("openDatabase", () => {
  it("creates tables on first open", async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "test.db");
    const db = openDatabase(dbPath);

    try {
      const result = db.select().from(attempts).all();
      expect(result).toEqual([]);

      const events = db.select().from(attemptEvents).all();
      expect(events).toEqual([]);

      const index = db.select().from(issueIndex).all();
      expect(index).toEqual([]);

      const notificationRows = db.select().from(notifications).all();
      expect(notificationRows).toEqual([]);
    } finally {
      closeDatabase(db);
    }
  });

  it("enables WAL journal mode", async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "wal-test.db");
    const db = openDatabase(dbPath);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = (db as any).session;
      const journalMode = session.client.pragma("journal_mode", { simple: true });
      expect(journalMode).toBe("wal");
    } finally {
      closeDatabase(db);
    }
  });

  it("enables foreign keys", async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "fk-test.db");
    const db = openDatabase(dbPath);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = (db as any).session;
      const fkEnabled = session.client.pragma("foreign_keys", { simple: true });
      expect(fkEnabled).toBe(1);
    } finally {
      closeDatabase(db);
    }
  });

  it("works with in-memory databases", () => {
    const db = openDatabase(":memory:");

    try {
      const result = db.select().from(attempts).all();
      expect(result).toEqual([]);
    } finally {
      closeDatabase(db);
    }
  });

  it("reopens an existing database without data loss", async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "reopen.db");

    const db1 = openDatabase(dbPath);
    db1
      .insert(attempts)
      .values({
        attemptId: "reopen-1",
        issueId: "issue-1",
        issueIdentifier: "MT-1",
        title: "Survives reopen",
        status: "completed",
        startedAt: "2026-03-20T00:00:00.000Z",
        model: "gpt-5",
        modelSource: "default",
        turnCount: 1,
      })
      .run();
    closeDatabase(db1);

    const db2 = openDatabase(dbPath);
    try {
      const rows = db2.select().from(attempts).where(eq(attempts.attemptId, "reopen-1")).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("Survives reopen");
    } finally {
      closeDatabase(db2);
    }
  });
});

describe("attempts table", () => {
  let db: RisolutoDatabase;
  let dir: string;

  afterEach(() => {
    closeDatabase(db);
  });

  it("inserts and selects an attempt record", async () => {
    dir = await createTempDir();
    db = openDatabase(path.join(dir, "attempts.db"));

    db.insert(attempts)
      .values({
        attemptId: "att-001",
        issueId: "issue-42",
        issueIdentifier: "MT-42",
        title: "Implement persistence",
        workspaceKey: "MT-42",
        workspacePath: "/tmp/risoluto/MT-42",
        status: "running",
        attemptNumber: 1,
        startedAt: "2026-03-20T10:00:00.000Z",
        model: "gpt-5.4",
        reasoningEffort: "high",
        modelSource: "default",
        turnCount: 0,
      })
      .run();

    const rows = db.select().from(attempts).where(eq(attempts.attemptId, "att-001")).all();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attemptId: "att-001",
      issueId: "issue-42",
      issueIdentifier: "MT-42",
      title: "Implement persistence",
      status: "running",
      model: "gpt-5.4",
      reasoningEffort: "high",
      modelSource: "default",
    });
  });

  it("stores nullable fields as null", async () => {
    dir = await createTempDir();
    db = openDatabase(path.join(dir, "nulls.db"));

    db.insert(attempts)
      .values({
        attemptId: "att-null",
        issueId: "issue-1",
        issueIdentifier: "MT-1",
        title: "Nullable test",
        status: "failed",
        startedAt: "2026-03-20T10:00:00.000Z",
        model: "gpt-5",
        modelSource: "default",
        turnCount: 0,
      })
      .run();

    const rows = db.select().from(attempts).where(eq(attempts.attemptId, "att-null")).all();
    expect(rows[0].workspaceKey).toBeNull();
    expect(rows[0].endedAt).toBeNull();
    expect(rows[0].errorCode).toBeNull();
    expect(rows[0].inputTokens).toBeNull();
    expect(rows[0].outputTokens).toBeNull();
    expect(rows[0].totalTokens).toBeNull();
  });

  it("filters attempts by status", async () => {
    dir = await createTempDir();
    db = openDatabase(path.join(dir, "filter.db"));

    const base = {
      issueId: "issue-1",
      issueIdentifier: "MT-1",
      title: "Filter test",
      startedAt: "2026-03-20T10:00:00.000Z",
      model: "gpt-5",
      modelSource: "default" as const,
      turnCount: 0,
    };

    db.insert(attempts)
      .values([
        { ...base, attemptId: "a1", status: "running" },
        { ...base, attemptId: "a2", status: "completed" },
        { ...base, attemptId: "a3", status: "failed" },
        { ...base, attemptId: "a4", status: "running" },
      ])
      .run();

    const running = db.select().from(attempts).where(eq(attempts.status, "running")).all();
    expect(running).toHaveLength(2);
    expect(running.map((r) => r.attemptId).sort()).toEqual(["a1", "a4"]);
  });
});

describe("attempt_events table", () => {
  it("inserts and selects events linked to an attempt", async () => {
    const dir = await createTempDir();
    const db = openDatabase(path.join(dir, "events.db"));

    try {
      db.insert(attempts)
        .values({
          attemptId: "att-ev-1",
          issueId: "issue-1",
          issueIdentifier: "MT-1",
          title: "Events test",
          status: "running",
          startedAt: "2026-03-20T10:00:00.000Z",
          model: "gpt-5",
          modelSource: "default",
          turnCount: 0,
        })
        .run();

      db.insert(attemptEvents)
        .values([
          {
            attemptId: "att-ev-1",
            timestamp: "2026-03-20T10:00:01.000Z",
            type: "attempt.started",
            message: "Agent started",
          },
          {
            attemptId: "att-ev-1",
            timestamp: "2026-03-20T10:00:05.000Z",
            type: "attempt.updated",
            message: "Processing turn 1",
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
          {
            attemptId: "att-ev-1",
            timestamp: "2026-03-20T10:00:10.000Z",
            type: "attempt.completed",
            message: "Agent completed",
            metadata: JSON.stringify({ exitCode: 0 }),
          },
        ])
        .run();

      const events = db.select().from(attemptEvents).where(eq(attemptEvents.attemptId, "att-ev-1")).all();

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe("attempt.started");
      expect(events[1].inputTokens).toBe(100);
      expect(events[2].metadata).toBe(JSON.stringify({ exitCode: 0 }));
    } finally {
      closeDatabase(db);
    }
  });

  it("enforces foreign key on attempt_id", async () => {
    const dir = await createTempDir();
    const db = openDatabase(path.join(dir, "fk.db"));

    try {
      expect(() => {
        db.insert(attemptEvents)
          .values({
            attemptId: "nonexistent",
            timestamp: "2026-03-20T10:00:00.000Z",
            type: "test",
            message: "Should fail",
          })
          .run();
      }).toThrow();
    } finally {
      closeDatabase(db);
    }
  });
});

describe("issue_index table", () => {
  it("inserts and queries issue index entries", async () => {
    const dir = await createTempDir();
    const db = openDatabase(path.join(dir, "index.db"));

    try {
      db.insert(attempts)
        .values({
          attemptId: "idx-att-1",
          issueId: "issue-10",
          issueIdentifier: "MT-10",
          title: "Index test",
          status: "completed",
          startedAt: "2026-03-20T10:00:00.000Z",
          model: "gpt-5",
          modelSource: "default",
          turnCount: 3,
        })
        .run();

      db.insert(issueIndex)
        .values({
          issueIdentifier: "MT-10",
          issueId: "issue-10",
          latestAttemptId: "idx-att-1",
          latestStatus: "completed",
          attemptCount: 1,
          updatedAt: "2026-03-20T10:05:00.000Z",
        })
        .run();

      const rows = db.select().from(issueIndex).where(eq(issueIndex.issueIdentifier, "MT-10")).all();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        issueIdentifier: "MT-10",
        issueId: "issue-10",
        latestAttemptId: "idx-att-1",
        latestStatus: "completed",
        attemptCount: 1,
      });
    } finally {
      closeDatabase(db);
    }
  });
});

describe("v4 schema migration — summary column", () => {
  it("fresh-install DB has the summary column on the attempts table", async () => {
    const dir = await createTempDir();
    const db = openDatabase(path.join(dir, "fresh.db"));

    try {
      // Writing a row with a summary value should succeed on a fresh DB
      db.insert(attempts)
        .values({
          attemptId: "v4-fresh-1",
          issueId: "issue-v4",
          issueIdentifier: "V4-1",
          title: "Summary column test",
          status: "completed",
          startedAt: "2026-04-03T00:00:00.000Z",
          model: "gpt-5.4",
          modelSource: "default",
          turnCount: 1,
          summary: "- Did the thing\n- Tested the thing",
        })
        .run();

      const rows = db.select().from(attempts).where(eq(attempts.attemptId, "v4-fresh-1")).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].summary).toBe("- Did the thing\n- Tested the thing");
    } finally {
      closeDatabase(db);
    }
  });

  it("v4 migration is idempotent — running openDatabase twice produces no error", async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "idempotent.db");

    const db1 = openDatabase(dbPath);
    closeDatabase(db1);

    // Second open should not throw even though v4 migration already ran
    expect(() => {
      const db2 = openDatabase(dbPath);
      closeDatabase(db2);
    }).not.toThrow();
  });

  it("summary column accepts null without error", async () => {
    const dir = await createTempDir();
    const db = openDatabase(path.join(dir, "null-summary.db"));

    try {
      db.insert(attempts)
        .values({
          attemptId: "v4-null-1",
          issueId: "issue-v4",
          issueIdentifier: "V4-2",
          title: "No summary attempt",
          status: "running",
          startedAt: "2026-04-03T00:00:00.000Z",
          model: "gpt-5.4",
          modelSource: "default",
          turnCount: 0,
          summary: null,
        })
        .run();

      const rows = db.select().from(attempts).where(eq(attempts.attemptId, "v4-null-1")).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].summary).toBeNull();
    } finally {
      closeDatabase(db);
    }
  });
});

describe("closeDatabase", () => {
  it("closes the database cleanly", async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "close-test.db");
    const db = openDatabase(dbPath);

    closeDatabase(db);

    // Verify the connection is closed by confirming operations throw
    expect(() => {
      db.select().from(attempts).all();
    }).toThrow();
  });
});

describe("v6 schema migration — pull_requests owner/repo split", () => {
  function createLegacyDb(dbPath: string): void {
    const raw = new BetterSqlite3(dbPath);
    try {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version   INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);
      raw.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(5, new Date().toISOString());

      raw.exec(`
        CREATE TABLE pull_requests (
          attempt_id       TEXT,
          issue_id         TEXT NOT NULL,
          owner            TEXT,
          repo             TEXT NOT NULL,
          number           INTEGER NOT NULL,
          url              TEXT NOT NULL,
          branch_name      TEXT NOT NULL,
          status           TEXT NOT NULL DEFAULT 'open',
          merged_at        TEXT,
          merge_commit_sha TEXT,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL
        )
      `);

      raw
        .prepare(`
        INSERT INTO pull_requests (attempt_id, issue_id, owner, repo, number, url, branch_name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          "att-1",
          "issue-1",
          null,
          "acme/widget",
          42,
          "https://github.com/acme/widget/pull/42",
          "main",
          "open",
          new Date().toISOString(),
          new Date().toISOString(),
        );

      raw
        .prepare(`
        INSERT INTO pull_requests (attempt_id, issue_id, owner, repo, number, url, branch_name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          "att-2",
          "issue-2",
          null,
          "alt/foobar",
          7,
          "https://github.com/alt/foobar/pull/7",
          "dev",
          "merged",
          new Date().toISOString(),
          new Date().toISOString(),
        );

      raw
        .prepare(`
        INSERT INTO pull_requests (attempt_id, issue_id, owner, repo, number, url, branch_name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          "att-3",
          "issue-3",
          null,
          "single/norepo",
          1,
          "https://github.com/single/norepo/pull/1",
          "main",
          "open",
          new Date().toISOString(),
          new Date().toISOString(),
        );
    } finally {
      raw.close();
    }
  }

  it("splits repo field into owner and repo columns when repo contains a slash", async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "v6-migration.db");

    createLegacyDb(dbPath);

    const db = openDatabase(dbPath);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (db as any).session.client;
      const rows = raw
        .prepare("SELECT pr_id, owner, repo, pull_number FROM pull_requests ORDER BY issue_id")
        .all() as Array<{
        pr_id: string;
        owner: string;
        repo: string;
        pull_number: number;
      }>;

      expect(rows).toHaveLength(3);

      expect(rows[0].pr_id).toBe("acme/widget#42");
      expect(rows[0].owner).toBe("acme");
      expect(rows[0].repo).toBe("widget");
      expect(rows[0].pull_number).toBe(42);

      expect(rows[1].pr_id).toBe("alt/foobar#7");
      expect(rows[1].owner).toBe("alt");
      expect(rows[1].repo).toBe("foobar");
      expect(rows[1].pull_number).toBe(7);

      expect(rows[2].pr_id).toBe("single/norepo#1");
      expect(rows[2].owner).toBe("single");
      expect(rows[2].repo).toBe("norepo");
      expect(rows[2].pull_number).toBe(1);
    } finally {
      closeDatabase(db);
    }
  });

  it("falls back to old owner column when repo field has no slash", async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "v6-noslash.db");

    const raw = new BetterSqlite3(dbPath);
    try {
      raw.exec(`
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)
      `);
      raw.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(5, new Date().toISOString());

      raw.exec(`
        CREATE TABLE pull_requests (
          attempt_id       TEXT,
          issue_id         TEXT NOT NULL,
          owner            TEXT,
          repo             TEXT NOT NULL,
          number           INTEGER NOT NULL,
          url              TEXT NOT NULL,
          branch_name      TEXT NOT NULL,
          status           TEXT NOT NULL DEFAULT 'open',
          merged_at        TEXT,
          merge_commit_sha TEXT,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL
        )
      `);

      // repo has no slash — the migration should use the old owner column
      raw
        .prepare(`
        INSERT INTO pull_requests (attempt_id, issue_id, owner, repo, number, url, branch_name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          "att-4",
          "issue-4",
          "legacy-owner",
          "single-repo",
          3,
          "https://github.com/legacy-owner/single-repo/pull/3",
          "main",
          "open",
          new Date().toISOString(),
          new Date().toISOString(),
        );
    } finally {
      raw.close();
    }

    const db = openDatabase(dbPath);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (db as any).session.client;
      const row = raw
        .prepare("SELECT pr_id, owner, repo, pull_number FROM pull_requests WHERE issue_id = ?")
        .get("issue-4") as {
        pr_id: string;
        owner: string;
        repo: string;
        pull_number: number;
      };

      // repo has no slash: pr_id uses "unknown/" prefix, owner from old owner column
      expect(row.pr_id).toBe("unknown/single-repo#3");
      expect(row.owner).toBe("legacy-owner");
      expect(row.repo).toBe("single-repo");
      expect(row.pull_number).toBe(3);
    } finally {
      closeDatabase(db);
    }
  });

  it("v6 migration is idempotent — running openDatabase twice produces no error", async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "v6-idempotent.db");

    createLegacyDb(dbPath);

    const db1 = openDatabase(dbPath);
    closeDatabase(db1);

    expect(() => {
      const db2 = openDatabase(dbPath);
      closeDatabase(db2);
    }).not.toThrow();
  });
});
