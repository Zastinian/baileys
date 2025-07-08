export default class Mutex {
    private locked;
    private waitingQueue;
    acquire(): Promise<() => void>;
    runExclusive<T>(fn: () => Promise<T> | T): Promise<T>;
    private release;
}
