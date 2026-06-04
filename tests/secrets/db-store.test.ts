import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

import { openDatabase, closeDatabase, type RisolutoDatabase } from "../../src/persistence/sqlite/database.js";
import { encryptedSecrets } from "../../src/persistence/sqlite/schema.js";
import { DbSecretsStore } from "../../src/secrets/db-store.js";
import { createMockLogger } from "../helpers.js";
import type { RisolutoLogger } from "../../src/core/types.js";

const TEST_MASTER_KEY = "test-master-key-for-unit-tests";

let db: RisolutoDatabase;
let store: DbSecretsStore;
let logger: RisolutoLogger;

beforeEach(async () => {
  db = openDatabase(":memory:");
  logger = createMockLogger();
  store = new DbSecretsStore(db, logger, { masterKey: TEST_MASTER_KEY });
  await store.start();

  return () => closeDatabase(db);
});

describe("DbSecretsStore", () => {
  it("set and get a secret", async () => {
    await store.set("API_KEY", "sk-12345");
    expect(store.get("API_KEY")).toBe("sk-12345");
  });

  it("returns null for nonexistent key", () => {
    expect(store.get("MISSING")).toBeNull();
  });

  it("overwrites an existing secret", async () => {
    await store.set("API_KEY", "old");
    await store.set("API_KEY", "new");
    expect(store.get("API_KEY")).toBe("new");
  });

  it("deletes a secret and returns true", async () => {
    await store.set("API_KEY", "value");
    const deleted = await store.delete("API_KEY");
    expect(deleted).toBe(true);
    expect(store.get("API_KEY")).toBeNull();
  });

  it("delete returns false for nonexistent key", async () => {
    const deleted = await store.delete("NOPE");
    expect(deleted).toBe(false);
  });

  it("list returns sorted key names", async () => {
    await store.set("ZEBRA", "z");
    await store.set("ALPHA", "a");
    await store.set("MIDDLE", "m");
    expect(store.list()).toEqual(["ALPHA", "MIDDLE", "ZEBRA"]);
  });

  it("list returns empty array when no secrets", () => {
    expect(store.list()).toEqual([]);
  });

  it("isInitialized returns true after start", () => {
    expect(store.isInitialized()).toBe(true);
  });

  it("isInitialized returns false before start", () => {
    const uninit = new DbSecretsStore(db, createMockLogger());
    expect(uninit.isInitialized()).toBe(false);
  });

  it("reset clears the encryption key", () => {
    store.reset();
    expect(store.isInitialized()).toBe(false);
  });

  it("initializeWithKey sets encryption key", async () => {
    const fresh = new DbSecretsStore(db, createMockLogger());
    await fresh.initializeWithKey(TEST_MASTER_KEY);
    expect(fresh.isInitialized()).toBe(true);
    // Can read secrets written by the other store
    await store.set("SHARED", "value");
    expect(fresh.get("SHARED")).toBe("value");
  });

  it("subscribe notifies on set", async () => {
    let notified = false;
    store.subscribe(() => {
      notified = true;
    });
    await store.set("KEY", "val");
    expect(notified).toBe(true);
  });

  it("subscribe notifies on delete", async () => {
    await store.set("KEY", "val");
    let notified = false;
    store.subscribe(() => {
      notified = true;
    });
    await store.delete("KEY");
    expect(notified).toBe(true);
  });

  it("unsubscribe stops notifications", async () => {
    let count = 0;
    const unsub = store.subscribe(() => count++);
    await store.set("A", "1");
    expect(count).toBe(1);
    unsub();
    await store.set("B", "2");
    expect(count).toBe(1);
  });

  it("rejects empty key", async () => {
    await expect(store.set("", "value")).rejects.toThrow("secret key must not be empty");
    await expect(store.set("  ", "value")).rejects.toThrow("secret key must not be empty");
  });

  it("data persists across store instances", async () => {
    await store.set("PERSIST_TEST", "survives");

    const store2 = new DbSecretsStore(db, createMockLogger(), { masterKey: TEST_MASTER_KEY });
    await store2.start();
    expect(store2.get("PERSIST_TEST")).toBe("survives");
  });

  it("rejects start when the master key cannot decrypt existing rows (NIN-251)", async () => {
    await store.set("SECRET", "hidden");

    const store2 = new DbSecretsStore(db, createMockLogger(), { masterKey: "wrong-key" });
    // A wrong key must fail loudly on start, not masquerade as an empty/"missing" store.
    await expect(store2.start()).rejects.toThrow(/master key does not match/i);
    expect(store2.isInitialized()).toBe(false);

    // The correct key still decrypts the untouched row.
    const store3 = new DbSecretsStore(db, createMockLogger(), { masterKey: TEST_MASTER_KEY });
    await store3.start();
    expect(store3.get("SECRET")).toBe("hidden");
  });

  it("starts with the correct key even when one row is corrupt, skipping the bad row (NIN-251)", async () => {
    await store.set("GOOD", "readable");
    // Inject a row whose ciphertext is corrupt — it can never decrypt with any key. migrateV1Rows skips
    // V1 corruption; verifyRowsDecrypt must not treat this V2 corruption as a wrong-key mismatch.
    db.insert(encryptedSecrets)
      .values({
        key: "CORRUPT",
        ciphertext: Buffer.from("not-real-ciphertext").toString("base64"),
        iv: randomBytes(12).toString("base64"),
        authTag: randomBytes(16).toString("base64"),
        updatedAt: new Date().toISOString(),
        kdfVersion: 2,
        kdfSalt: randomBytes(16).toString("base64"),
      })
      .run();

    const store2 = new DbSecretsStore(db, createMockLogger(), { masterKey: TEST_MASTER_KEY });
    // The correct key decrypts GOOD, so a single undecryptable row must not brick startup.
    await store2.start();
    expect(store2.isInitialized()).toBe(true);
    expect(store2.get("GOOD")).toBe("readable");
    expect(store2.get("CORRUPT")).toBeNull();
  });

  it("rejects initializeWithKey when the key cannot decrypt existing rows (NIN-251)", async () => {
    await store.set("SECRET", "hidden");

    const deferred = new DbSecretsStore(db, createMockLogger());
    await expect(deferred.initializeWithKey("wrong-key")).rejects.toThrow(/master key does not match/i);
    expect(deferred.isInitialized()).toBe(false);
  });

  it("handles special characters in values", async () => {
    const special = 'value with "quotes", newlines\n, unicode: , and JSON: {"key": "val"}';
    await store.set("SPECIAL", special);
    expect(store.get("SPECIAL")).toBe(special);
  });

  it("throws the startup error when neither options.masterKey nor MASTER_KEY is provided", async () => {
    delete process.env.MASTER_KEY;
    const unstarted = new DbSecretsStore(db, createMockLogger());

    await expect(unstarted.start()).rejects.toThrow("MASTER_KEY is required to initialize DbSecretsStore");
    expect(unstarted.isInitialized()).toBe(false);
  });

  it("uses process.env.MASTER_KEY when options.masterKey is absent", async () => {
    process.env.MASTER_KEY = TEST_MASTER_KEY;
    const envBacked = new DbSecretsStore(db, createMockLogger());

    await envBacked.start();
    await store.set("ENV_SHARED", "value");
    expect(envBacked.get("ENV_SHARED")).toBe("value");
  });

  it("throws the required-key error when set is called before start", async () => {
    const unstarted = new DbSecretsStore(db, createMockLogger(), { masterKey: TEST_MASTER_KEY });

    await expect(unstarted.set("API_KEY", "value")).rejects.toThrow("DbSecretsStore has not been started");
  });

  it("list returns only sorted string keys even after updates", async () => {
    await store.set("BETA", "1");
    await store.set("ALPHA", "2");
    await store.set("BETA", "3");

    const keys = store.list();
    expect(keys).toEqual(["ALPHA", "BETA"]);
    expect(keys.every((key) => typeof key === "string")).toBe(true);
  });

  it("sorts key names even when the database returns them out of order", () => {
    const fakeDb = {
      select: () => ({
        from: () => ({
          all: () => [{ key: "ZEBRA" }, { key: "ALPHA" }, { key: "MIDDLE" }],
        }),
      }),
    } as unknown as RisolutoDatabase;
    const fakeStore = new DbSecretsStore(fakeDb, createMockLogger(), { masterKey: TEST_MASTER_KEY });

    expect(fakeStore.list()).toEqual(["ALPHA", "MIDDLE", "ZEBRA"]);
  });

  it("migrates V1 SHA-256 rows to V2 scrypt on start — regression for fnd_sig-feat-library-6005595fef-6964", async () => {
    const v1Key = createHash("sha256").update(TEST_MASTER_KEY, "utf8").digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", v1Key, iv);
    const cipherBuf = Buffer.concat([cipher.update("legacy-value", "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    db.insert(encryptedSecrets)
      .values({
        key: "LEGACY_KEY",
        ciphertext: cipherBuf.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        updatedAt: new Date().toISOString(),
        kdfVersion: 1,
        kdfSalt: null,
      })
      .run();

    const freshStore = new DbSecretsStore(db, createMockLogger(), { masterKey: TEST_MASTER_KEY });
    await freshStore.start();

    expect(freshStore.get("LEGACY_KEY")).toBe("legacy-value");

    const row = db.select().from(encryptedSecrets).where(eq(encryptedSecrets.key, "LEGACY_KEY")).get();
    expect(row?.kdfVersion).toBe(2);
    expect(typeof row?.kdfSalt).toBe("string");
  });
});
