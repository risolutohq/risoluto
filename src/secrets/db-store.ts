/**
 * DB-backed secret store with per-key AES-256-GCM encryption.
 *
 * Each secret is stored as its own row in the `encrypted_secrets` table
 * with an individual IV + authTag. Key names are plaintext (visible in DB);
 * values are encrypted. See docs/TRUST_AND_AUTH.md for trust model.
 *
 * Implements the same public API as the file-backed SecretsStore so
 * consumers can swap without changes.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

import { eq } from "drizzle-orm";

import type { RisolutoDatabase } from "../persistence/sqlite/database.js";
import { encryptedSecrets } from "../persistence/sqlite/schema.js";
import type { RisolutoLogger } from "../core/types.js";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_BYTE_LENGTH = 12;
const KDF_SALT_BYTE_LENGTH = 16;
const KDF_VERSION_CURRENT = 2;

/** V1 (legacy): single-pass SHA-256, no salt — read-only, migration path only. */
function deriveKeyV1(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey, "utf8").digest();
}

/** V2: scrypt with a per-row random salt — current write path. */
function deriveKeyV2(masterKey: string, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, 32, { N: 16384, r: 8, p: 1 });
}

function encryptValue(plaintext: string, key: Buffer): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptValue(ciphertext: string, iv: string, authTag: string, key: Buffer): string {
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(iv, "base64"), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

export class DbSecretsStore {
  private masterKey: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly db: RisolutoDatabase,
    private readonly logger: RisolutoLogger,
    private readonly options?: { masterKey?: string },
  ) {}

  async start(): Promise<void> {
    const masterKey = this.options?.masterKey ?? process.env.MASTER_KEY ?? "";
    if (!masterKey) {
      throw new Error("MASTER_KEY is required to initialize DbSecretsStore");
    }
    this.adoptMasterKey(masterKey);
  }

  async startDeferred(): Promise<void> {
    /* DB is already open via PersistenceRuntime */
  }

  async initializeWithKey(masterKey: string): Promise<void> {
    this.adoptMasterKey(masterKey);
    this.notify();
  }

  /**
   * Adopt `masterKey` only after the existing rows prove they decrypt with it. A wrong
   * key is rejected here instead of silently returning null from get(), so a mismatch
   * can never masquerade as an empty / "missing secrets" store. masterKey is cleared on
   * any failure path so a bad key never stays active (RIS-251).
   */
  private adoptMasterKey(masterKey: string): void {
    this.masterKey = masterKey;
    try {
      this.migrateV1Rows(masterKey);
      this.verifyRowsDecrypt(masterKey);
    } catch (error) {
      this.masterKey = null;
      throw error;
    }
  }

  private verifyRowsDecrypt(masterKey: string): void {
    const rows = this.db.select().from(encryptedSecrets).all();
    if (rows.length === 0) {
      return;
    }
    let anyDecrypted = false;
    let lastError: unknown = null;
    for (const row of rows) {
      try {
        const decryptKey = this.resolveRowKey(masterKey, row.kdfVersion, row.kdfSalt);
        decryptValue(row.ciphertext, row.iv, row.authTag, decryptKey);
        anyDecrypted = true;
      } catch (error) {
        // A single undecryptable row is corruption, not a wrong key — a wrong key fails the auth tag on
        // every row. Log and continue so one damaged row (e.g. a V1 row migrateV1Rows had to skip) can't
        // brick startup with the correct master key; only a key that decrypts NOTHING is rejected below.
        lastError = error;
        this.logger.warn({ key: row.key, error: String(error) }, "encrypted_secrets row failed to decrypt; skipping");
      }
    }
    if (!anyDecrypted) {
      throw new Error("DbSecretsStore master key does not match the existing encrypted rows", {
        cause: lastError,
      });
    }
  }

  isInitialized(): boolean {
    return this.masterKey !== null;
  }

  reset(): void {
    this.masterKey = null;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): string[] {
    const rows = this.db.select({ key: encryptedSecrets.key }).from(encryptedSecrets).all();
    return rows.map((row) => row.key).sort((left, right) => left.localeCompare(right));
  }

  get(key: string): string | null {
    if (!this.masterKey) return null;
    const row = this.db.select().from(encryptedSecrets).where(eq(encryptedSecrets.key, key)).get();
    if (!row) return null;
    try {
      const decryptKey = this.resolveRowKey(this.masterKey, row.kdfVersion, row.kdfSalt);
      return decryptValue(row.ciphertext, row.iv, row.authTag, decryptKey);
    } catch (error) {
      this.logger.warn({ key, error: String(error) }, "failed to decrypt secret");
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!key.trim()) throw new Error("secret key must not be empty");
    const mk = this.requiredMasterKey();
    const salt = randomBytes(KDF_SALT_BYTE_LENGTH);
    const encKey = deriveKeyV2(mk, salt);
    const { ciphertext, iv, authTag } = encryptValue(value, encKey);
    const now = new Date().toISOString();
    const kdfSalt = salt.toString("base64");

    const existing = this.db.select().from(encryptedSecrets).where(eq(encryptedSecrets.key, key)).get();
    if (existing) {
      this.db
        .update(encryptedSecrets)
        .set({ ciphertext, iv, authTag, updatedAt: now, kdfVersion: KDF_VERSION_CURRENT, kdfSalt })
        .where(eq(encryptedSecrets.key, key))
        .run();
    } else {
      this.db
        .insert(encryptedSecrets)
        .values({ key, ciphertext, iv, authTag, updatedAt: now, kdfVersion: KDF_VERSION_CURRENT, kdfSalt })
        .run();
    }
    this.notify();
  }

  async delete(key: string): Promise<boolean> {
    this.requiredMasterKey();
    const existing = this.db.select().from(encryptedSecrets).where(eq(encryptedSecrets.key, key)).get();
    if (!existing) return false;
    this.db.delete(encryptedSecrets).where(eq(encryptedSecrets.key, key)).run();
    this.notify();
    return true;
  }

  private requiredMasterKey(): string {
    if (!this.masterKey) throw new Error("DbSecretsStore has not been started");
    return this.masterKey;
  }

  /**
   * Derive the AES key for a DB row based on its kdfVersion.
   * V1 rows have no salt (SHA-256 path); V2 rows carry a per-row base64 salt.
   */
  private resolveRowKey(masterKey: string, kdfVersion: number | null, kdfSalt: string | null): Buffer {
    const version = kdfVersion ?? 1;
    if (version === 1) {
      return deriveKeyV1(masterKey);
    }
    if (!kdfSalt) {
      throw new Error(`kdf_version=${version} row is missing kdf_salt`);
    }
    return deriveKeyV2(masterKey, Buffer.from(kdfSalt, "base64"));
  }

  /**
   * Re-encrypt all V1 rows with the V2 scrypt KDF in a single transaction.
   * Rows that fail to decrypt with the V1 key are skipped with a warning.
   */
  private migrateV1Rows(masterKey: string): void {
    const v1Key = deriveKeyV1(masterKey);
    const v1Rows = this.db
      .select()
      .from(encryptedSecrets)
      .all()
      .filter((row) => (row.kdfVersion ?? 1) === 1);

    if (v1Rows.length === 0) return;

    const now = new Date().toISOString();
    let migratedCount = 0;
    this.db.transaction((tx) => {
      for (const row of v1Rows) {
        let plaintext: string;
        try {
          plaintext = decryptValue(row.ciphertext, row.iv, row.authTag, v1Key);
        } catch (error) {
          this.logger.warn(
            { key: row.key, error: String(error) },
            "skipping V1→V2 KDF migration for row: decrypt failed",
          );
          continue;
        }
        const salt = randomBytes(KDF_SALT_BYTE_LENGTH);
        const v2Key = deriveKeyV2(masterKey, salt);
        const { ciphertext, iv, authTag } = encryptValue(plaintext, v2Key);
        tx.update(encryptedSecrets)
          .set({
            ciphertext,
            iv,
            authTag,
            updatedAt: now,
            kdfVersion: KDF_VERSION_CURRENT,
            kdfSalt: salt.toString("base64"),
          })
          .where(eq(encryptedSecrets.key, row.key))
          .run();
        migratedCount++;
      }
    });
    this.logger.info({ count: migratedCount }, "migrated encrypted_secrets rows from KDF V1 to V2");
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
