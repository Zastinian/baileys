/** biome-ignore-all lint/suspicious/noExplicitAny: off */
/** biome-ignore-all lint/correctness/noUndeclaredVariables: off */
import { mkdirSync } from "fs";
import { join } from "path";
import { proto } from "../../WAProto";
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataSet,
  SignalDataTypeMap,
} from "../Types";
import { initAuthCreds } from "./auth-utils";

class ReadWriteMutex {
  private writeLocked = false;
  private readCount = 0;
  private waitingWriters: Array<() => void> = [];
  private waitingReaders: Array<() => void> = [];

  async acquireRead(): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.writeLocked && this.waitingWriters.length === 0) {
        this.readCount++;
        resolve(() => this.releaseRead());
      } else {
        this.waitingReaders.push(() => {
          this.readCount++;
          resolve(() => this.releaseRead());
        });
      }
    });
  }

  async acquireWrite(): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.writeLocked && this.readCount === 0) {
        this.writeLocked = true;
        resolve(() => this.releaseWrite());
      } else {
        this.waitingWriters.push(() => {
          this.writeLocked = true;
          resolve(() => this.releaseWrite());
        });
      }
    });
  }

  async runExclusiveRead<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquireRead();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async runExclusiveWrite<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquireWrite();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private releaseRead(): void {
    this.readCount--;
    if (this.readCount === 0 && this.waitingWriters.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: off
      const nextWriter = this.waitingWriters.shift()!;
      nextWriter();
    }
  }

  private releaseWrite(): void {
    this.writeLocked = false;

    // Priority to writers to avoid writer starvation
    if (this.waitingWriters.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: off
      const nextWriter = this.waitingWriters.shift()!;
      nextWriter();
    } else {
      // Wake up all waiting readers
      const readers = this.waitingReaders.splice(0);
      readers.forEach((reader) => reader());
    }
  }
}

const getDatabaseClass = async () => {
  const isBun = typeof Bun !== "undefined";

  if (isBun) {
    const { Database } = await import("bun:sqlite");
    return Database;
  }
  const { DatabaseSync } = await import("node:sqlite");
  return DatabaseSync;
};

class DatabasePool {
  private writeDb: any;
  private readDbs: any[] = [];
  private readDbIndex = 0;
  private maxReadConnections = 10;

  constructor(dbPath: string, Database: any) {
    // Write connection with WAL mode
    this.writeDb = new Database(dbPath);
    this.setupDatabase(this.writeDb, true);

    // Read-only connections
    for (let i = 0; i < this.maxReadConnections; i++) {
      const readDb = new Database(dbPath, { readonly: true });
      this.setupDatabase(readDb, false);
      this.readDbs.push(readDb);
    }
  }

  private setupDatabase(db: any, isWrite: boolean) {
    const isBun = typeof Bun !== "undefined";

    if (isBun) {
      if (isWrite) {
        // Enable WAL mode for better concurrent performance
        db.run("PRAGMA journal_mode = WAL;");
        db.run("PRAGMA synchronous = NORMAL;");
        db.run("PRAGMA cache_size = -32000;"); // 32MB cache
        db.run("PRAGMA temp_store = MEMORY;");
        db.run("PRAGMA mmap_size = 268435456;"); // 256MB mmap
      } else {
        // Read-only optimizations
        db.run("PRAGMA cache_size = -16000;"); // 16MB cache for reads
        db.run("PRAGMA temp_store = MEMORY;");
        db.run("PRAGMA mmap_size = 268435456;");
      }
    } else {
      if (isWrite) {
        db.exec("PRAGMA journal_mode = WAL;");
        db.exec("PRAGMA synchronous = NORMAL;");
        db.exec("PRAGMA cache_size = -32000;");
        db.exec("PRAGMA temp_store = MEMORY;");
        db.exec("PRAGMA mmap_size = 268435456;");
      } else {
        db.exec("PRAGMA cache_size = -16000;");
        db.exec("PRAGMA temp_store = MEMORY;");
        db.exec("PRAGMA mmap_size = 268435456;");
      }
    }
  }

  getReadDb() {
    const db = this.readDbs[this.readDbIndex];
    this.readDbIndex = (this.readDbIndex + 1) % this.readDbs.length;
    return db;
  }

  getWriteDb() {
    return this.writeDb;
  }

  close() {
    this.writeDb.close();
    this.readDbs.forEach((db) => db.close());
  }
}

const dbMutex = new ReadWriteMutex();

const serializeJSON = (data: any): string => {
  return JSON.stringify(data, (_, value) => {
    if (value && typeof value === "object" && value.type === "Buffer") {
      return { type: "Buffer", data: value.data };
    }
    return value;
  });
};

const deserializeJSON = (jsonString: string): any => {
  return JSON.parse(jsonString, (_, value) => {
    if (value && typeof value === "object" && value.type === "Buffer") {
      return Buffer.from(value.data);
    }
    return value;
  });
};

export const useSQLAuthState = async (
  folder: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
  mkdirSync(folder, { recursive: true });

  const Database = await getDatabaseClass();
  const dbPool = new DatabasePool(join(folder, "auth.sqlite"), Database);

  // Initialize schema with write connection
  const writeDb = dbPool.getWriteDb();
  const isBun = typeof Bun !== "undefined";

  if (isBun) {
    writeDb.run(`
      CREATE TABLE IF NOT EXISTS auth_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  } else {
    writeDb.exec(`
      CREATE TABLE IF NOT EXISTS auth_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  const writeData = async (key: string, value: any) => {
    return dbMutex.runExclusiveWrite(() => {
      const serializedValue = serializeJSON(value);
      const writeDb = dbPool.getWriteDb();
      writeDb
        .prepare("INSERT OR REPLACE INTO auth_store (key, value) VALUES (?, ?)")
        .run(key, serializedValue);
    });
  };

  const readData = async (key: string): Promise<any | null> => {
    return dbMutex.runExclusiveRead(() => {
      const readDb = dbPool.getReadDb();
      const result = readDb.prepare("SELECT value FROM auth_store WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      if (result?.value) {
        return deserializeJSON(result.value);
      }
      return null;
    });
  };

  const fixKeyName = (key?: string) => key?.replace(/\//g, "__")?.replace(/:/g, "-");

  const creds: AuthenticationCreds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};

          // Batch read operations for better performance
          const keys = ids.map((id) => fixKeyName(`${type}-${id}`));
          const values = await Promise.all(keys.map((key) => (key ? readData(key) : null)));

          ids.forEach((id, index) => {
            let value = values[index];
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          });

          return data;
        },
        set: async (data) => {
          // Batch write operations
          const writeOperations: Array<{ key: string; value: any }> = [];
          const deleteOperations: string[] = [];

          for (const category in data) {
            const categoryData = data[category as keyof SignalDataSet];
            if (!categoryData) {
              continue;
            }

            for (const id in categoryData) {
              const value = categoryData[id];
              const key = `${category}-${id}`;
              const fixedKey = fixKeyName(key);

              if (!fixedKey) {
                continue;
              }

              if (value) {
                writeOperations.push({ key: fixedKey, value });
              } else {
                deleteOperations.push(fixedKey);
              }
            }
          }

          await dbMutex.runExclusiveWrite(() => {
            const writeDb = dbPool.getWriteDb();

            // Begin transaction for batch operations
            writeDb.run("BEGIN TRANSACTION");

            try {
              // Batch writes
              const insertStmt = writeDb.prepare(
                "INSERT OR REPLACE INTO auth_store (key, value) VALUES (?, ?)",
              );
              for (const { key, value } of writeOperations) {
                insertStmt.run(key, serializeJSON(value));
              }

              // Batch deletes
              const deleteStmt = writeDb.prepare("DELETE FROM auth_store WHERE key = ?");
              for (const key of deleteOperations) {
                deleteStmt.run(key);
              }

              writeDb.run("COMMIT");
            } catch (error) {
              writeDb.run("ROLLBACK");
              throw error;
            }
          });
        },
      },
    },
    saveCreds: async () => {
      await writeData("creds", creds);
    },
  };
};
