"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
            const next = this.waitingQueue.shift();
            next();
        }
        else {
            this.locked = false;
        }
    }
}
exports.default = Mutex;
