type CompareFunction<V> = (a: V, b: V) => number;
interface CacheOptions {
    stdTTL?: number;
    useClones?: boolean;
    deleteOnExpire?: boolean;
    checkperiod?: number;
}
export default class Cache<K, V> {
    private internalMap;
    private options;
    private checkTimer?;
    constructor(options?: CacheOptions);
    private startPeriodicCleanup;
    private cleanupExpired;
    private isExpired;
    private cloneValue;
    private calculateTTL;
    get size(): number;
    set(key: K, value: V, ttl?: number): this;
    get<T = V>(key: K): T | undefined;
    has(key: K): boolean;
    delete(key: K): boolean;
    clear(): void;
    ttl(key: K, ttl: number): boolean;
    getTtl(key: K): number | undefined;
    keys(): IterableIterator<K>;
    values(): IterableIterator<V>;
    entries(): IterableIterator<[K, V]>;
    [Symbol.iterator](): IterableIterator<[K, V]>;
    forEach(callbackfn: (value: V, key: K, map: Cache<K, V>) => void, thisArg?: any): void;
    map<U>(fn: (val: V, key: K, map: Cache<K, V>) => U): U[];
    mapVal<U>(fn: (val: V, key: K, map: Cache<K, V>) => U): U[];
    first(): V | undefined;
    find(fn: (val: V, key: K, map: Cache<K, V>) => boolean): V | undefined;
    filter(fn: (val: V, key: K, map: Cache<K, V>) => boolean): Cache<K, V>;
    filterKey(fn: (key: K) => boolean): Cache<K, V>;
    last(): V | undefined;
    lastKey(): K | undefined;
    tap(fn: (map: Cache<K, V>) => void): Cache<K, V>;
    array(): V[];
    keyArray(): K[];
    hasAll(...c: K[]): boolean;
    hasAny(...keys: K[]): boolean;
    some(fn: (val: V, key: K, map: Cache<K, V>) => boolean): boolean;
    random(): V | undefined;
    remove(key: K): boolean;
    removeByValue(fn: (val: V, key: K, map: Cache<K, V>) => boolean): void;
    every(fn: (val: V, key: K, map: Cache<K, V>) => boolean): boolean;
    each(fn: (val: V, key: K, map: Cache<K, V>) => void): Cache<K, V>;
    randomKey(): K | undefined;
    equals(cache: Cache<K, V>): boolean;
    difference(cache: Cache<K, V>): K[] | string;
    findKey(fn: (val: V, key: K, map: Cache<K, V>) => boolean): K | undefined;
    sort(compareFn?: CompareFunction<V>): Cache<K, V>;
    at(index?: number): V | undefined;
    mset(keyValuePairs: Array<{
        key: K;
        val: V;
        ttl?: number;
    }>): boolean;
    mget<T = V>(keys: K[]): {
        [key: string]: T;
    };
    del(keys: K | K[]): number;
    flushAll(): void;
    getStats(): {
        keys: number;
        hits: number;
        misses: number;
        ksize: number;
        vsize: number;
    };
    close(): void;
    static defaultCompareFunction<V>(a: V, b: V): number;
}
export {};
