/** Counts retained encoded data, including batches waiting on asynchronous IPC. */
export class ExportWriteBudget {
  bytes = 0;
  constructor(readonly pauseAt = 8 * 1024 * 1024, readonly resumeAt = 2 * 1024 * 1024, readonly limit = 32 * 1024 * 1024) {}
  reserve(size: number): boolean {
    if (!Number.isSafeInteger(size) || size < 0 || this.bytes + size > this.limit) return false;
    this.bytes += size;
    return true;
  }
  release(size: number): void { this.bytes = Math.max(0, this.bytes - size); }
  get shouldPause(): boolean { return this.bytes >= this.pauseAt; }
  get canResume(): boolean { return this.bytes <= this.resumeAt; }
}
