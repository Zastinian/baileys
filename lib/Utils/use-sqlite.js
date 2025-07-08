"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.useSQLAuthState = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const WAProto_1 = require("../../WAProto");
const auth_utils_1 = require("./auth-utils");
class Mutex {
    constructor() {
        this.locked = false;
        this.waitingQueue = [];
    }
    async acquire() {
        return new Promise((resolve) => {
            if (!this.locked) {
                this.locked = true;
                resolve(() => this.release());
            }
            else {
                this.waitingQueue.push(() => {
                    this.locked = true;
                    resolve(() => this.release());
                });
            }
        });
    }
    async runExclusive(fn) {
        const release = await this.acquire();
        try {
            return await fn();
        }
        finally {
            release();
        }
    }
    release() {
        if (this.waitingQueue.length > 0) {
            // biome-ignore lint/style/noNonNullAssertion: off
            const next = this.waitingQueue.shift();
            next();
        }
        else {
            this.locked = false;
        }
    }
}
const getDatabaseClass = async () => {
    // biome-ignore lint/correctness/noUndeclaredVariables: off
    const isBun = typeof Bun !== "undefined";
    if (isBun) {
        const { Database } = await Promise.resolve().then(() => __importStar(require("bun:sqlite")));
        return Database;
    }
    const { DatabaseSync } = await Promise.resolve().then(() => __importStar(require("node:sqlite")));
    return DatabaseSync;
};
const dbMutex = new Mutex();
const serializeJSON = (data) => {
    return JSON.stringify(data, (_, value) => {
        if (value && typeof value === "object" && value.type === "Buffer") {
            return { type: "Buffer", data: value.data };
        }
        return value;
    });
};
const deserializeJSON = (jsonString) => {
    return JSON.parse(jsonString, (_, value) => {
        if (value && typeof value === "object" && value.type === "Buffer") {
            return Buffer.from(value.data);
        }
        return value;
    });
};
const useSQLAuthState = async (folder) => {
    (0, fs_1.mkdirSync)(folder, { recursive: true });
    const Database = await getDatabaseClass();
    const db = new Database((0, path_1.join)(folder, "auth.sqlite"));
    // biome-ignore lint/correctness/noUndeclaredVariables: off
    const isBun = typeof Bun !== "undefined";
    if (isBun) {
        db.run(`
            CREATE TABLE IF NOT EXISTS auth_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    }
    else {
        db.exec(`
            CREATE TABLE IF NOT EXISTS auth_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    }
    const writeData = (key, value) => {
        const serializedValue = serializeJSON(value);
        db.prepare("INSERT OR REPLACE INTO auth_store (key, value) VALUES (?, ?)").run(key, serializedValue);
    };
    const readData = (key) => {
        const result = db.prepare("SELECT value FROM auth_store WHERE key = ?").get(key);
        if (result === null || result === void 0 ? void 0 : result.value) {
            return deserializeJSON(result.value);
        }
        return null;
    };
    const removeData = (key) => {
        db.prepare("DELETE FROM auth_store WHERE key = ?").run(key);
    };
    const fixKeyName = (key) => { var _a; return (_a = key === null || key === void 0 ? void 0 : key.replace(/\//g, "__")) === null || _a === void 0 ? void 0 : _a.replace(/:/g, "-"); };
    const creds = (await readData("creds")) || (0, auth_utils_1.initAuthCreds)();
    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        const key = `${type}-${id}`;
                        // biome-ignore lint/style/noNonNullAssertion: off
                        let value = await readData(fixKeyName(key));
                        if (type === "app-state-sync-key" && value) {
                            value = WAProto_1.proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                set: async (data) => {
                    await dbMutex.runExclusive(async () => {
                        for (const category in data) {
                            const categoryData = data[category];
                            if (!categoryData) {
                                continue;
                            }
                            for (const id in categoryData) {
                                const value = categoryData[id];
                                const key = `${category}-${id}`;
                                // biome-ignore lint/style/noNonNullAssertion: off
                                const fixedKey = fixKeyName(key);
                                if (value) {
                                    writeData(fixedKey, value);
                                }
                                else {
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
exports.useSQLAuthState = useSQLAuthState;
