import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "../../src/core/logger.js";
import { SecretsStore } from "../../src/secrets/store.js";

const tempDirs: string[] = [];
const originalMasterKey = process.env.MASTER_KEY;

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-secrets-store-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  process.env.MASTER_KEY = originalMasterKey;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SecretsStore", () => {
  it("encrypts values at rest and reloads them on restart with the same key", async () => {
    const dir = await createTempDir();
    process.env.MASTER_KEY = "test-master-key";

    const store = new SecretsStore(dir, createLogger());
    await store.start();
    await store.set("LINEAR_API_KEY", "lin_api_secret");
    await store.set("OPENAI_API_KEY", "sk-secret");

    expect(store.list()).toEqual(["LINEAR_API_KEY", "OPENAI_API_KEY"]);
    expect(store.get("LINEAR_API_KEY")).toBe("lin_api_secret");

    const encryptedFile = await readFile(path.join(dir, "secrets.enc"), "utf8");
    expect(encryptedFile).not.toContain("lin_api_secret");
    expect(encryptedFile).not.toContain("sk-secret");
    expect(encryptedFile).toContain('"ciphertext"');

    const restartedStore = new SecretsStore(dir, createLogger());
    await restartedStore.start();
    expect(restartedStore.get("LINEAR_API_KEY")).toBe("lin_api_secret");
    expect(restartedStore.get("OPENAI_API_KEY")).toBe("sk-secret");
  });

  it("records append-only audit events for set/delete without logging secret values", async () => {
    const dir = await createTempDir();
    process.env.MASTER_KEY = "audit-master-key";

    const store = new SecretsStore(dir, createLogger());
    await store.start();
    await store.set("TOKEN", "value-1");
    await store.delete("TOKEN");

    const audit = await readFile(path.join(dir, "secrets.audit.log"), "utf8");
    expect(audit).toContain('"operation":"set"');
    expect(audit).toContain('"operation":"delete"');
    expect(audit).toContain('"key":"TOKEN"');
    expect(audit).not.toContain("value-1");
  });

  it("requires MASTER_KEY at startup", async () => {
    const dir = await createTempDir();
    delete process.env.MASTER_KEY;

    const store = new SecretsStore(dir, createLogger());
    await expect(store.start()).rejects.toThrow("MASTER_KEY");
  });

  it("refuses to overwrite existing secrets when started with the wrong key", async () => {
    const dir = await createTempDir();
    process.env.MASTER_KEY = "key-a";

    const store = new SecretsStore(dir, createLogger());
    await store.start();
    await store.set("TOKEN", "value-1");
    const originalEncryptedFile = await readFile(path.join(dir, "secrets.enc"), "utf8");

    process.env.MASTER_KEY = "key-b";
    const wrongKeyStore = new SecretsStore(dir, createLogger());
    await expect(wrongKeyStore.start()).rejects.toThrow("MASTER_KEY may not match");

    const encryptedFileAfterFailure = await readFile(path.join(dir, "secrets.enc"), "utf8");
    expect(encryptedFileAfterFailure).toBe(originalEncryptedFile);

    process.env.MASTER_KEY = "key-a";
    const restartedStore = new SecretsStore(dir, createLogger());
    await restartedStore.start();
    expect(restartedStore.get("TOKEN")).toBe("value-1");
  });

  it("initializeWithKey refuses to overwrite existing secrets on wrong key — regression for fnd_sig-feat-library-6005595fef-3636", async () => {
    const dir = await createTempDir();
    process.env.MASTER_KEY = "key-a";

    const store = new SecretsStore(dir, createLogger());
    await store.start();
    await store.set("TOKEN", "safe-value");
    const originalEncryptedFile = await readFile(path.join(dir, "secrets.enc"), "utf8");

    const deferredStore = new SecretsStore(dir, createLogger());
    await deferredStore.startDeferred();
    await expect(deferredStore.initializeWithKey("wrong-key")).rejects.toThrow("MASTER_KEY may not match");

    const encryptedFileAfterFailure = await readFile(path.join(dir, "secrets.enc"), "utf8");
    expect(encryptedFileAfterFailure).toBe(originalEncryptedFile);

    process.env.MASTER_KEY = "key-a";
    const verifyStore = new SecretsStore(dir, createLogger());
    await verifyStore.start();
    expect(verifyStore.get("TOKEN")).toBe("safe-value");
  });

  it("clears activeMasterKey on a failed start so the store is left uninitialized (NIN-251)", async () => {
    const dir = await createTempDir();
    process.env.MASTER_KEY = "key-a";

    const store = new SecretsStore(dir, createLogger());
    await store.start();
    await store.set("TOKEN", "value-1");

    process.env.MASTER_KEY = "key-b";
    const wrongKeyStore = new SecretsStore(dir, createLogger());
    await expect(wrongKeyStore.start()).rejects.toThrow("MASTER_KEY may not match");

    // Failed start must not leave the wrong key active — the store is unusable, and a
    // later write throws instead of clobbering secrets.enc with the wrong key.
    expect(wrongKeyStore.isInitialized()).toBe(false);
    await expect(wrongKeyStore.set("TOKEN", "poison")).rejects.toThrow("has not been started");
  });

  it("checks the master key before mutating the cache when set() runs before start (NIN-251)", async () => {
    const dir = await createTempDir();

    const store = new SecretsStore(dir, createLogger());
    await store.startDeferred();

    await expect(store.set("TOKEN", "value")).rejects.toThrow("has not been started");
    // The plaintext cache must stay untouched — no value cached that never reached disk.
    expect(store.get("TOKEN")).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it("writes secrets.enc with owner-only 0o600 permissions (NIN-251)", async () => {
    const dir = await createTempDir();
    process.env.MASTER_KEY = "perm-master-key";

    const store = new SecretsStore(dir, createLogger());
    await store.start();
    await store.set("TOKEN", "value");

    const mode = (await stat(path.join(dir, "secrets.enc"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("writes V2 scrypt envelope and survives restart — regression for fnd_sig-feat-library-6005595fef-6964", async () => {
    const dir = await createTempDir();
    process.env.MASTER_KEY = "migration-key";

    const store = new SecretsStore(dir, createLogger());
    await store.start();
    await store.set("API_KEY", "migrate-me");

    const encryptedFile = await readFile(path.join(dir, "secrets.enc"), "utf8");
    const envelope = JSON.parse(encryptedFile) as { kdfVersion?: number; kdfSalt?: string };
    expect(envelope.kdfVersion).toBe(2);
    expect(typeof envelope.kdfSalt).toBe("string");

    const store2 = new SecretsStore(dir, createLogger());
    await store2.start();
    expect(store2.get("API_KEY")).toBe("migrate-me");
  });
});
