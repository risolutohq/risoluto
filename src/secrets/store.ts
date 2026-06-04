import { appendFile, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

import { asStringRecord, isRecord, toErrorString } from "../utils/type-guards.js";
import type { RisolutoLogger } from "../core/types.js";
import type { SecretsPort } from "./port.js";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_BYTE_LENGTH = 12;
const KDF_SALT_BYTE_LENGTH = 16;
const KDF_VERSION_CURRENT = 2;

interface SecretsEnvelope {
  version: number;
  algorithm: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  /** KDF version: 1 = SHA-256 (legacy), 2 = scrypt. Absent on old files implies 1. */
  kdfVersion?: number;
  /** Base64-encoded per-file random salt used by KDF V2. */
  kdfSalt?: string;
}

/** V1 (legacy): single-pass SHA-256, no salt — read-only, migration path only. */
function deriveKeyV1(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey, "utf8").digest();
}

/** V2: scrypt with a random salt — current write path. */
function deriveKeyV2(masterKey: string, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, 32, { N: 16384, r: 8, p: 1 });
}

function resolveEnvelopeKey(masterKey: string, envelope: SecretsEnvelope): Buffer {
  const kdfVersion = envelope.kdfVersion ?? 1;
  if (kdfVersion === 1) {
    return deriveKeyV1(masterKey);
  }
  if (!envelope.kdfSalt) {
    throw new Error(`secrets envelope kdfVersion=${kdfVersion} is missing kdfSalt`);
  }
  return deriveKeyV2(masterKey, Buffer.from(envelope.kdfSalt, "base64"));
}

function encodeEnvelope(envelope: SecretsEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function parseEnvelope(source: string): SecretsEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error("secrets envelope is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new Error("secrets envelope must be a JSON object");
  }

  const version = parsed.version;
  const algorithm = parsed.algorithm;
  const iv = parsed.iv;
  const authTag = parsed.authTag;
  const ciphertext = parsed.ciphertext;
  const kdfVersion = parsed.kdfVersion;
  const kdfSalt = parsed.kdfSalt;

  if (version !== 1) {
    throw new Error(`unsupported secrets envelope version: ${String(version)}`);
  }
  if (algorithm !== ENCRYPTION_ALGORITHM) {
    throw new Error(`unsupported secrets algorithm: ${String(algorithm)}`);
  }
  if (typeof iv !== "string" || typeof authTag !== "string" || typeof ciphertext !== "string") {
    throw new TypeError("secrets envelope contains invalid binary fields");
  }
  if (kdfVersion !== undefined && kdfVersion !== 1 && kdfVersion !== 2) {
    throw new Error(`unsupported secrets envelope kdfVersion: ${String(kdfVersion)}`);
  }
  if (kdfSalt !== undefined && typeof kdfSalt !== "string") {
    throw new TypeError("secrets envelope kdfSalt must be a string");
  }

  return {
    version,
    algorithm,
    iv,
    authTag,
    ciphertext,
    kdfVersion: typeof kdfVersion === "number" ? kdfVersion : undefined,
    kdfSalt: typeof kdfSalt === "string" ? kdfSalt : undefined,
  };
}

function encrypt(plaintext: string, masterKey: string): SecretsEnvelope {
  const salt = randomBytes(KDF_SALT_BYTE_LENGTH);
  const key = deriveKeyV2(masterKey, salt);
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: ENCRYPTION_ALGORITHM,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    kdfVersion: KDF_VERSION_CURRENT,
    kdfSalt: salt.toString("base64"),
  };
}

function decrypt(envelope: SecretsEnvelope, key: Buffer): string {
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(envelope.iv, "base64"), {
    authTagLength: 16,
  });
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

export class SecretsStore implements SecretsPort {
  private readonly cache = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private activeMasterKey: string | null = null;

  constructor(
    private readonly baseDir: string,
    private readonly logger: RisolutoLogger,
    private readonly options?: { masterKey?: string },
  ) {}

  async start(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });

    const masterKey = this.options?.masterKey ?? process.env.MASTER_KEY ?? "";
    if (!masterKey) {
      throw new Error("MASTER_KEY is required to initialize SecretsStore");
    }
    await this.adoptMasterKey(masterKey);
  }

  async startDeferred(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  async initializeWithKey(masterKey: string): Promise<void> {
    await this.adoptMasterKey(masterKey);
    this.notify();
  }

  /**
   * Validate `masterKey` against the existing archive (if any) before adopting it.
   * activeMasterKey is assigned only after a clean decrypt and is cleared on every
   * failure path, so a wrong key can never become active and overwrite the real
   * secrets.enc on the next write (NIN-251).
   */
  private async adoptMasterKey(masterKey: string): Promise<void> {
    const source = await this.readEncryptedFile();
    if (source === null) {
      this.activeMasterKey = masterKey;
      try {
        await this.persist();
      } catch (error) {
        this.activeMasterKey = null;
        throw error;
      }
      return;
    }

    // parseEnvelope / resolveEnvelopeKey may throw before any key is adopted — that is
    // fine, activeMasterKey is still null at this point.
    const envelope = parseEnvelope(source);
    const decryptKey = resolveEnvelopeKey(masterKey, envelope);
    let decrypted: string;
    try {
      decrypted = decrypt(envelope, decryptKey);
    } catch (error) {
      this.activeMasterKey = null;
      this.logger.error(
        { error: toErrorString(error), secretsPath: this.secretsPath() },
        "failed to decrypt secrets.enc — refusing to overwrite existing secret store",
      );
      throw new Error("failed to decrypt secrets.enc; MASTER_KEY may not match the existing archive", { cause: error });
    }

    this.activeMasterKey = masterKey;
    this.loadCache(decrypted);
    // If the file used the legacy V1 KDF, re-encrypt in-place with V2.
    if ((envelope.kdfVersion ?? 1) < KDF_VERSION_CURRENT) {
      try {
        await this.persist();
      } catch (error) {
        this.activeMasterKey = null;
        this.cache.clear();
        throw error;
      }
    }
  }

  isInitialized(): boolean {
    return this.activeMasterKey !== null;
  }

  reset(): void {
    this.cache.clear();
    this.activeMasterKey = null;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): string[] {
    return [...this.cache.keys()].sort((left, right) => left.localeCompare(right));
  }

  get(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (!key.trim()) {
      throw new Error("secret key must not be empty");
    }
    return this.enqueueMutation(async () => {
      // Confirm the store is usable before touching the in-memory cache, so a write
      // attempted before start() cannot leave a value cached that never reaches disk.
      this.requiredMasterKey();
      const previousValue = this.cache.get(key);
      this.cache.set(key, value);
      try {
        await this.persist();
      } catch (error) {
        // Roll the cache back to its pre-set state on a failed persist. persist() serializes the whole
        // cache, so leaving the rejected value in place would let the next successful mutation flush it
        // to disk and make get() return a value that never durably committed (NIN-251).
        if (previousValue === undefined) {
          this.cache.delete(key);
        } else {
          this.cache.set(key, previousValue);
        }
        throw error;
      }
      await this.appendAuditEntry("set", key);
      this.notify();
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      this.requiredMasterKey();
      const previousValue = this.cache.get(key);
      const existed = this.cache.delete(key);
      if (!existed) {
        return false;
      }

      try {
        await this.persist();
      } catch (error) {
        // Restore the key on a failed persist so the cache doesn't drop a secret that is still on disk.
        if (previousValue !== undefined) {
          this.cache.set(key, previousValue);
        }
        throw error;
      }
      await this.appendAuditEntry("delete", key);
      this.notify();
      return true;
    });
  }

  // Serializes set()/delete() so the key check, cache mutation, persist, and audit of
  // one mutation complete before the next begins (NIN-251).
  private mutationChain: Promise<unknown> = Promise.resolve();

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationChain.then(operation, operation);
    this.mutationChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private requiredMasterKey(): string {
    if (!this.activeMasterKey) {
      throw new Error("SecretsStore has not been started");
    }
    return this.activeMasterKey;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async appendAuditEntry(operation: "set" | "delete", key: string): Promise<void> {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      operation,
      key,
    });
    await appendFile(this.auditPath(), `${line}\n`, "utf8");
  }

  private async readEncryptedFile(): Promise<string | null> {
    try {
      return await readFile(this.secretsPath(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private loadCache(decrypted: string): void {
    const secrets = asStringRecord(JSON.parse(decrypted) as unknown);
    this.cache.clear();
    for (const [key, value] of Object.entries(secrets)) {
      this.cache.set(key, value);
    }
  }

  // Serializes all disk writes so concurrent set()/delete() calls cannot take
  // overlapping snapshots and clobber each other's envelope on disk.
  private pendingPersist: Promise<void> = Promise.resolve();

  private persist(): Promise<void> {
    // Chain after the previous write regardless of whether it succeeded, so the
    // disk always reflects the latest cache and writes never overlap.
    this.pendingPersist = this.pendingPersist.catch(() => undefined).then(() => this.writeCacheToDisk());
    return this.pendingPersist;
  }

  private async writeCacheToDisk(): Promise<void> {
    const serializedSecrets = JSON.stringify(Object.fromEntries(this.cache), null, 2);
    const envelope = encrypt(serializedSecrets, this.requiredMasterKey());
    const payload = encodeEnvelope(envelope);

    for (let attempt = 0; attempt < 2; attempt++) {
      const temporaryPath = `${this.secretsPath()}.tmp-${process.pid}-${Date.now()}`;
      try {
        await this.writeFileSynced(temporaryPath, payload);
        await rename(temporaryPath, this.secretsPath());
        await this.fsyncDir();
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" && attempt === 0) {
          this.logger.warn({ error: toErrorString(error) }, "secrets persist retrying after ENOENT");
          continue;
        }
        throw error;
      }
    }
  }

  // Write secrets.enc owner-only (0o600) and fsync the bytes before the rename, so a
  // crash cannot leave a world-readable or half-written secret archive (NIN-251).
  private async writeFileSynced(filePath: string, contents: string): Promise<void> {
    const handle = await open(filePath, "w", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  // fsync the containing directory so the atomic rename of secrets.enc is itself durable.
  private async fsyncDir(): Promise<void> {
    const handle = await open(this.baseDir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private secretsPath(): string {
    return path.join(this.baseDir, "secrets.enc");
  }

  private auditPath(): string {
    return path.join(this.baseDir, "secrets.audit.log");
  }
}
