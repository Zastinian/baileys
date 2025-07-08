"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Cache {
    constructor(options = {}) {
        this.internalMap = new Map();
        this.options = {
            stdTTL: options.stdTTL || 0,
            useClones: options.useClones !== false,
            deleteOnExpire: options.deleteOnExpire !== false,
            checkperiod: options.checkperiod || 600
        };
        if (this.options.deleteOnExpire && this.options.stdTTL > 0) {
            this.startPeriodicCleanup();
        }
    }
    startPeriodicCleanup() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
        }
        this.checkTimer = setInterval(() => {
            this.cleanupExpired();
        }, this.options.checkperiod * 1000);
    }
    cleanupExpired() {
        const now = Date.now();
        for (const [key, entry] of this.internalMap.entries()) {
            if (entry.ttl > 0 && now > entry.ttl) {
                this.internalMap.delete(key);
            }
        }
    }
    isExpired(entry) {
        return entry.ttl > 0 && Date.now() > entry.ttl;
    }
    cloneValue(value) {
        if (!this.options.useClones) {
            return value;
        }
        if (value === null || typeof value !== 'object') {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        }
        catch (_a) {
            return value;
        }
    }
    calculateTTL(ttl) {
        const effectiveTTL = ttl !== undefined ? ttl : this.options.stdTTL;
        return effectiveTTL > 0 ? Date.now() + (effectiveTTL * 1000) : 0;
    }
    get size() {
        this.cleanupExpired();
        return this.internalMap.size;
    }
    set(key, value, ttl) {
        const clonedValue = this.cloneValue(value);
        const entry = {
            value: clonedValue,
            ttl: this.calculateTTL(ttl)
        };
        this.internalMap.set(key, entry);
        return this;
    }
    get(key) {
        const entry = this.internalMap.get(key);
        if (!entry) {
            return undefined;
        }
        if (this.isExpired(entry)) {
            if (this.options.deleteOnExpire) {
                this.internalMap.delete(key);
            }
            return undefined;
        }
        return this.cloneValue(entry.value);
    }
    has(key) {
        const entry = this.internalMap.get(key);
        if (!entry) {
            return false;
        }
        if (this.isExpired(entry)) {
            if (this.options.deleteOnExpire) {
                this.internalMap.delete(key);
            }
            return false;
        }
        return true;
    }
    delete(key) {
        return this.internalMap.delete(key);
    }
    clear() {
        this.internalMap.clear();
    }
    ttl(key, ttl) {
        const entry = this.internalMap.get(key);
        if (!entry || this.isExpired(entry)) {
            return false;
        }
        entry.ttl = this.calculateTTL(ttl);
        return true;
    }
    getTtl(key) {
        const entry = this.internalMap.get(key);
        if (!entry || this.isExpired(entry)) {
            return undefined;
        }
        if (entry.ttl === 0) {
            return 0;
        }
        return Math.max(0, entry.ttl - Date.now());
    }
    keys() {
        this.cleanupExpired();
        return this.internalMap.keys();
    }
    values() {
        this.cleanupExpired();
        const values = [];
        for (const [, entry] of this.internalMap.entries()) {
            if (!this.isExpired(entry)) {
                values.push(this.cloneValue(entry.value));
            }
        }
        return values[Symbol.iterator]();
    }
    entries() {
        this.cleanupExpired();
        const entries = [];
        for (const [key, entry] of this.internalMap.entries()) {
            if (!this.isExpired(entry)) {
                entries.push([key, this.cloneValue(entry.value)]);
            }
        }
        return entries[Symbol.iterator]();
    }
    [Symbol.iterator]() {
        return this.entries();
    }
    forEach(callbackfn, thisArg) {
        for (const [key, value] of this) {
            callbackfn.call(thisArg, value, key, this);
        }
    }
    map(fn) {
        const array = [];
        for (const [key, val] of this) {
            array.push(fn(val, key, this));
        }
        return array;
    }
    mapVal(fn) {
        const values = Array.from(this.values());
        return values.map((value, index) => {
            const keys = Array.from(this.keys());
            return fn(value, keys[index], this);
        }).filter((item) => item !== undefined);
    }
    first() {
        if (this.size <= 0) {
            return undefined;
        }
        return this.values().next().value;
    }
    find(fn) {
        for (const [key, val] of this) {
            if (fn(val, key, this)) {
                return val;
            }
        }
        return undefined;
    }
    filter(fn) {
        const result = new Cache(this.options);
        for (const [key, val] of this) {
            if (fn(val, key, this)) {
                result.set(key, val);
            }
        }
        return result;
    }
    filterKey(fn) {
        const result = new Cache(this.options);
        for (const [key, val] of this) {
            if (fn(key)) {
                result.set(key, val);
            }
        }
        return result;
    }
    last() {
        if (this.size <= 0) {
            return undefined;
        }
        const values = Array.from(this.values());
        return values[values.length - 1];
    }
    lastKey() {
        const keys = Array.from(this.keys());
        return keys[keys.length - 1];
    }
    tap(fn) {
        fn(this);
        return this;
    }
    array() {
        return Array.from(this.values());
    }
    keyArray() {
        return Array.from(this.keys());
    }
    hasAll(...c) {
        if (Array.isArray(c[0])) {
            return c[0].every((o) => this.has(o));
        }
        return c.every((o) => this.has(o));
    }
    hasAny(...keys) {
        var _a;
        if (Array.isArray(keys[0])) {
            return (_a = keys[0]) === null || _a === void 0 ? void 0 : _a.some((o) => this.has(o));
        }
        return keys === null || keys === void 0 ? void 0 : keys.some((o) => this.has(o));
    }
    some(fn) {
        for (const [key, val] of this.entries()) {
            if (fn(val, key, this)) {
                return true;
            }
        }
        return false;
    }
    random() {
        const values = Array.from(this.values());
        return values[Math.floor(Math.random() * values.length)];
    }
    remove(key) {
        if (this.has(key)) {
            this.delete(key);
            return true;
        }
        return false;
    }
    removeByValue(fn) {
        for (const [key, val] of this) {
            if (fn(val, key, this)) {
                this.delete(key);
            }
        }
    }
    every(fn) {
        for (const [key, val] of this) {
            if (!fn(val, key, this)) {
                return false;
            }
        }
        return true;
    }
    each(fn) {
        this.forEach((val, key) => fn(val, key, this));
        return this;
    }
    randomKey() {
        const keys = Array.from(this.keys());
        return keys[Math.floor(Math.random() * keys.length)];
    }
    equals(cache) {
        if (!cache) {
            return false;
        }
        if (this.size !== cache.size) {
            return false;
        }
        if (this === cache) {
            return true;
        }
        for (const [key, val] of this) {
            if (!cache.has(key) || val !== cache.get(key)) {
                return false;
            }
        }
        return true;
    }
    difference(cache) {
        if (this.size !== cache.size) {
            return `size difference by: ${Math.abs(this.size - cache.size)}`;
        }
        return Array.from(cache.keys()).filter((value) => !this.has(value));
    }
    findKey(fn) {
        for (const [key, val] of this) {
            if (fn(val, key, this)) {
                return key;
            }
        }
        return undefined;
    }
    sort(compareFn = Cache.defaultCompareFunction) {
        const entries = [...this.entries()];
        entries.sort((a, b) => compareFn(a[1], b[1]));
        this.internalMap.clear();
        for (const [key, val] of entries) {
            this.set(key, val);
        }
        return this;
    }
    at(index = 0) {
        const cacheArr = this.array();
        return cacheArr[index];
    }
    mset(keyValuePairs) {
        try {
            keyValuePairs.forEach(({ key, val, ttl }) => {
                this.set(key, val, ttl);
            });
            return true;
        }
        catch (_a) {
            return false;
        }
    }
    mget(keys) {
        const result = {};
        keys.forEach(key => {
            const value = this.get(key);
            if (value !== undefined) {
                result[key] = value;
            }
        });
        return result;
    }
    del(keys) {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        let deletedCount = 0;
        keysArray.forEach(key => {
            if (this.delete(key)) {
                deletedCount++;
            }
        });
        return deletedCount;
    }
    flushAll() {
        this.clear();
    }
    getStats() {
        return {
            keys: this.size,
            hits: 0,
            misses: 0,
            ksize: this.size,
            vsize: this.size
        };
    }
    close() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = undefined;
        }
        this.clear();
    }
    static defaultCompareFunction(a, b) {
        if (a === b) {
            return 0;
        }
        return a > b ? 1 : -1;
    }
}
exports.default = Cache;
