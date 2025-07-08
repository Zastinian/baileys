/** biome-ignore-all lint/suspicious/noExplicitAny: off */
import type Database from "bun:sqlite";
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

class Mutex {
  private locked = false;
  private waitingQueue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve(() => this.release());
      } else {
        this.waitingQueue.push(() => {
          this.locked = true;
          resolve(() => this.release());
        });
      }
    });
  }

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private release(): void {
    if (this.waitingQueue.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: off
      const next = this.waitingQueue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

const getDatabaseClass = async () => {
  // biome-ignore lint/correctness/noUndeclaredVariables: off
  const isBun = typeof Bun !== "undefined";

  if (isBun) {
    const { Database } = await import("bun:sqlite");
    return Database;
  }
  const { DatabaseSync } = await import("node:sqlite");
  return DatabaseSync;
};

const dbMutex = new Mutex();

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
  const db = new Database(join(folder, "auth.sqlite"));

  // biome-ignore lint/correctness/noUndeclaredVariables: off
  const isBun = typeof Bun !== "undefined";

  if (isBun) {
    (db as Database).run(`
            CREATE TABLE IF NOT EXISTS auth_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
  } else {
    db.exec(`
            CREATE TABLE IF NOT EXISTS auth_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
  }

  const writeData = (key: string, value: any) => {
    const serializedValue = serializeJSON(value);
    db.prepare("INSERT OR REPLACE INTO auth_store (key, value) VALUES (?, ?)").run(
      key,
      serializedValue,
    );
  };

  const readData = (key: string): any | null => {
    const result = db.prepare("SELECT value FROM auth_store WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    if (result?.value) {
      return deserializeJSON(result.value);
    }
    return null;
  };

  const removeData = (key: string) => {
    db.prepare("DELETE FROM auth_store WHERE key = ?").run(key);
  };

  const fixKeyName = (key?: string) => key?.replace(/\//g, "__")?.replace(/:/g, "-");

  const creds: AuthenticationCreds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};
          for (const id of ids) {
            const key = `${type}-${id}`;
            // biome-ignore lint/style/noNonNullAssertion: off
            let value = await readData(fixKeyName(key)!);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          await dbMutex.runExclusive(async () => {
            for (const category in data) {
              const categoryData = data[category as keyof SignalDataSet];
              if (!categoryData) {
                continue;
              }
              for (const id in categoryData) {
                const value = categoryData[id];
                const key = `${category}-${id}`;
                // biome-ignore lint/style/noNonNullAssertion: off
                const fixedKey = fixKeyName(key)!;
                if (value) {
                  writeData(fixedKey, value);
                } else {
                  removeData(fixedKey);
                }
              }
            }
          });
        },
      },
    },
    saveCreds: async () => {
      await dbMutex.runExclusive(() => {
        writeData("creds", creds);
      });
    },
  };
};
