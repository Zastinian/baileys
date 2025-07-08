type CompareFunction<V> = (a: V, b: V) => number;

interface CacheOptions {
  stdTTL?: number;
  useClones?: boolean;
  deleteOnExpire?: boolean;
  checkperiod?: number;
}

interface CacheEntry<V> {
  value: V;
  ttl: number;
}

export default class Cache<K, V> {
  private internalMap: Map<K, CacheEntry<V>>;
  private options: Required<CacheOptions>;
  private checkTimer?: NodeJS.Timeout;

  constructor(options: CacheOptions = {}) {
    this.internalMap = new Map();

    this.options = {
      stdTTL: options.stdTTL || 0,
      useClones: options.useClones !== false,
      deleteOnExpire: options.deleteOnExpire !== false,
      checkperiod: options.checkperiod || 600,
    };

    if (this.options.deleteOnExpire && this.options.stdTTL > 0) {
      this.startPeriodicCleanup();
    }
  }

  private startPeriodicCleanup(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }

    this.checkTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.options.checkperiod * 1000);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.internalMap.entries()) {
      if (entry.ttl > 0 && now > entry.ttl) {
        this.internalMap.delete(key);
      }
    }
  }

  private isExpired(entry: CacheEntry<V>): boolean {
    return entry.ttl > 0 && Date.now() > entry.ttl;
  }

  private cloneValue(value: V): V {
    if (!this.options.useClones) {
      return value;
    }

    if (value === null || typeof value !== "object") {
      return value;
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  private calculateTTL(ttl?: number): number {
    const effectiveTTL = ttl !== undefined ? ttl : this.options.stdTTL;
    return effectiveTTL > 0 ? Date.now() + effectiveTTL * 1000 : 0;
  }

  get size(): number {
    this.cleanupExpired();
    return this.internalMap.size;
  }

  set(key: K, value: V, ttl?: number): this {
    const clonedValue = this.cloneValue(value);
    const entry: CacheEntry<V> = {
      value: clonedValue,
      ttl: this.calculateTTL(ttl),
    };
    this.internalMap.set(key, entry);
    return this;
  }

  get<T = V>(key: K): T | undefined {
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

    return this.cloneValue(entry.value) as unknown as T;
  }

  has(key: K): boolean {
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

  delete(key: K): boolean {
    return this.internalMap.delete(key);
  }

  clear(): void {
    this.internalMap.clear();
  }

  ttl(key: K, ttl: number): boolean {
    const entry = this.internalMap.get(key);
    if (!entry || this.isExpired(entry)) {
      return false;
    }

    entry.ttl = this.calculateTTL(ttl);
    return true;
  }

  getTtl(key: K): number | undefined {
    const entry = this.internalMap.get(key);
    if (!entry || this.isExpired(entry)) {
      return undefined;
    }

    if (entry.ttl === 0) {
      return 0;
    }

    return Math.max(0, entry.ttl - Date.now());
  }

  keys(): IterableIterator<K> {
    this.cleanupExpired();
    return this.internalMap.keys();
  }

  values(): IterableIterator<V> {
    this.cleanupExpired();
    const values: V[] = [];
    for (const [, entry] of this.internalMap.entries()) {
      if (!this.isExpired(entry)) {
        values.push(this.cloneValue(entry.value));
      }
    }
    return values[Symbol.iterator]();
  }

  entries(): IterableIterator<[K, V]> {
    this.cleanupExpired();
    const entries: [K, V][] = [];
    for (const [key, entry] of this.internalMap.entries()) {
      if (!this.isExpired(entry)) {
        entries.push([key, this.cloneValue(entry.value)]);
      }
    }
    return entries[Symbol.iterator]();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  forEach(callbackfn: (value: V, key: K, map: Cache<K, V>) => void, thisArg?: any): void {
    for (const [key, value] of this) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  map<U>(fn: (val: V, key: K, map: Cache<K, V>) => U): U[] {
    const array: U[] = [];
    for (const [key, val] of this) {
      array.push(fn(val, key, this));
    }
    return array;
  }

  mapVal<U>(fn: (val: V, key: K, map: Cache<K, V>) => U): U[] {
    const values = Array.from(this.values());
    return values
      .map((value, index) => {
        const keys = Array.from(this.keys());
        return fn(value, keys[index], this);
      })
      .filter((item) => item !== undefined);
  }

  first(): V | undefined {
    if (this.size <= 0) {
      return undefined;
    }
    return this.values().next().value;
  }

  find(fn: (val: V, key: K, map: Cache<K, V>) => boolean): V | undefined {
    for (const [key, val] of this) {
      if (fn(val, key, this)) {
        return val;
      }
    }
    return undefined;
  }

  filter(fn: (val: V, key: K, map: Cache<K, V>) => boolean): Cache<K, V> {
    const result = new Cache<K, V>(this.options);
    for (const [key, val] of this) {
      if (fn(val, key, this)) {
        result.set(key, val);
      }
    }
    return result;
  }

  filterKey(fn: (key: K) => boolean): Cache<K, V> {
    const result = new Cache<K, V>(this.options);
    for (const [key, val] of this) {
      if (fn(key)) {
        result.set(key, val);
      }
    }
    return result;
  }

  last(): V | undefined {
    if (this.size <= 0) {
      return undefined;
    }
    const values = Array.from(this.values());
    return values[values.length - 1];
  }

  lastKey(): K | undefined {
    const keys = Array.from(this.keys());
    return keys[keys.length - 1];
  }

  tap(fn: (map: Cache<K, V>) => void): Cache<K, V> {
    fn(this);
    return this;
  }

  array(): V[] {
    return Array.from(this.values());
  }

  keyArray(): K[] {
    return Array.from(this.keys());
  }

  hasAll(...c: K[]): boolean {
    if (Array.isArray(c[0])) {
      return c[0].every((o) => this.has(o));
    }
    return c.every((o) => this.has(o));
  }

  hasAny(...keys: K[]): boolean {
    if (Array.isArray(keys[0])) {
      return keys[0]?.some((o) => this.has(o));
    }
    return keys?.some((o) => this.has(o));
  }

  some(fn: (val: V, key: K, map: Cache<K, V>) => boolean): boolean {
    for (const [key, val] of this.entries()) {
      if (fn(val, key, this)) {
        return true;
      }
    }
    return false;
  }

  random(): V | undefined {
    const values = Array.from(this.values());
    return values[Math.floor(Math.random() * values.length)];
  }

  remove(key: K): boolean {
    if (this.has(key)) {
      this.delete(key);
      return true;
    }
    return false;
  }

  removeByValue(fn: (val: V, key: K, map: Cache<K, V>) => boolean): void {
    for (const [key, val] of this) {
      if (fn(val, key, this)) {
        this.delete(key);
      }
    }
  }

  every(fn: (val: V, key: K, map: Cache<K, V>) => boolean): boolean {
    for (const [key, val] of this) {
      if (!fn(val, key, this)) {
        return false;
      }
    }
    return true;
  }

  each(fn: (val: V, key: K, map: Cache<K, V>) => void): Cache<K, V> {
    this.forEach((val, key) => fn(val, key, this));
    return this;
  }

  randomKey(): K | undefined {
    const keys = Array.from(this.keys());
    return keys[Math.floor(Math.random() * keys.length)];
  }

  equals(cache: Cache<K, V>): boolean {
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

  difference(cache: Cache<K, V>): K[] | string {
    if (this.size !== cache.size) {
      return `size difference by: ${Math.abs(this.size - cache.size)}`;
    }
    return Array.from(cache.keys()).filter((value) => !this.has(value));
  }

  findKey(fn: (val: V, key: K, map: Cache<K, V>) => boolean): K | undefined {
    for (const [key, val] of this) {
      if (fn(val, key, this)) {
        return key;
      }
    }
    return undefined;
  }

  sort(compareFn: CompareFunction<V> = Cache.defaultCompareFunction): Cache<K, V> {
    const entries = [...this.entries()];
    entries.sort((a, b) => compareFn(a[1], b[1]));
    this.internalMap.clear();
    for (const [key, val] of entries) {
      this.set(key, val);
    }
    return this;
  }

  at(index = 0): V | undefined {
    const cacheArr = this.array();
    return cacheArr[index];
  }

  mset(keyValuePairs: Array<{ key: K; val: V; ttl?: number }>): boolean {
    try {
      keyValuePairs.forEach(({ key, val, ttl }) => {
        this.set(key, val, ttl);
      });
      return true;
    } catch {
      return false;
    }
  }

  mget<T = V>(keys: K[]): { [key: string]: T } {
    const result: { [key: string]: T } = {};
    keys.forEach((key) => {
      const value = this.get<T>(key);
      if (value !== undefined) {
        result[key as string] = value;
      }
    });
    return result;
  }

  del(keys: K | K[]): number {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    let deletedCount = 0;
    keysArray.forEach((key) => {
      if (this.delete(key)) {
        deletedCount++;
      }
    });
    return deletedCount;
  }

  flushAll(): void {
    this.clear();
  }

  getStats(): {
    keys: number;
    hits: number;
    misses: number;
    ksize: number;
    vsize: number;
  } {
    return {
      keys: this.size,
      hits: 0,
      misses: 0,
      ksize: this.size,
      vsize: this.size,
    };
  }

  close(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    this.clear();
  }

  static defaultCompareFunction<V>(a: V, b: V): number {
    if (a === b) {
      return 0;
    }
    return a > b ? 1 : -1;
  }
}
