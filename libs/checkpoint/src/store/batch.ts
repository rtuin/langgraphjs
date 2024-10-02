/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  BaseStore,
  type Item,
  type SearchOperation,
  type PutOperation,
  type GetOperation,
  type Operation,
  OperationResults,
} from "./base.js";

export class AsyncBatchedStore extends BaseStore {
  private store: BaseStore;

  private queue: Map<
    number,
    {
      operation: Operation;
      resolve: (value: any) => void;
      reject: (reason?: any) => void;
    }
  > = new Map();

  private nextKey: number = 0;

  private running = false;

  private processingTask: Promise<void> | null = null;

  constructor(store: BaseStore) {
    super();
    this.store = store;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * @ignore
   * Batch is not implemented here as we're only extending `BaseStore`
   * to allow it to be passed where `BaseStore` is expected, and implement
   * the convenience methods (get, search, put, delete).
   */
  async batch<Op extends Operation[]>(
    _operations: Op
  ): Promise<OperationResults<Op>> {
    throw new Error(
      "The `batch` method is not implemented on `AsyncBatchedStore`." +
        "\n Instead, it calls the `batch` method on the wrapped store." +
        "\n If you are seeing this error, something is wrong."
    );
  }

  async get(namespace: string[], key: string): Promise<Item | null> {
    return this.enqueueOperation({ namespace, key } as GetOperation);
  }

  async search(
    namespacePrefix: string[],
    options?: {
      filter?: Record<string, any>;
      limit?: number;
      offset?: number;
    }
  ): Promise<Item[]> {
    const { filter, limit = 10, offset = 0 } = options || {};
    return this.enqueueOperation({
      namespacePrefix,
      filter,
      limit,
      offset,
    } as SearchOperation);
  }

  async put(
    namespace: string[],
    key: string,
    value: Record<string, any>
  ): Promise<void> {
    return this.enqueueOperation({ namespace, key, value } as PutOperation);
  }

  async delete(namespace: string[], key: string): Promise<void> {
    return this.enqueueOperation({
      namespace,
      key,
      value: null,
    } as PutOperation);
  }

  start(): void {
    if (!this.running) {
      this.running = true;
      this.processingTask = this.processBatchQueue();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.processingTask) {
      await this.processingTask;
    }
  }

  private enqueueOperation<T>(operation: Operation): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const key = this.nextKey;
      this.nextKey += 1;
      this.queue.set(key, { operation, resolve, reject });
    });
  }

  private async processBatchQueue(): Promise<void> {
    while (this.running) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      if (this.queue.size === 0) continue;

      const batch = new Map(this.queue);
      this.queue.clear();

      try {
        const operations = Array.from(batch.values()).map(
          ({ operation }) => operation
        );
        const results = await this.store.batch(operations);

        batch.forEach(({ resolve }, key) => {
          const index = Array.from(batch.keys()).indexOf(key);
          resolve(results[index]);
        });
      } catch (e) {
        batch.forEach(({ reject }) => {
          reject(e);
        });
      }
    }
  }
}