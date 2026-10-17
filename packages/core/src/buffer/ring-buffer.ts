import { Breadcrumb, BreadcrumbInput } from '../types';

/**
 * Thread-safe / asynchronous safe FIFO circular ring buffer for breadcrumb tracking.
 * Maintains a strict maximum item capacity (default 50) and monotonically increasing sequence order.
 */
export class BreadcrumbRingBuffer {
  private readonly _capacity: number;
  private _items: Breadcrumb[] = [];
  private _sequenceCounter = 0;

  constructor(capacity = 50) {
    this._capacity = capacity > 0 ? capacity : 50;
  }

  /**
   * Adds a new breadcrumb to the buffer.
   * Auto-assigns monotonic sequence_order and ISO-8601 timestamp if omitted.
   * Evicts the oldest breadcrumbs FIFO when capacity is reached.
   */
  public add(input: BreadcrumbInput): Breadcrumb {
    let seq: number;
    if (typeof input.sequence_order === 'number' && !Number.isNaN(input.sequence_order)) {
      seq = input.sequence_order;
      if (seq > this._sequenceCounter) {
        this._sequenceCounter = seq;
      }
    } else {
      this._sequenceCounter += 1;
      seq = this._sequenceCounter;
    }

    const breadcrumb: Breadcrumb = {
      sequence_order: seq,
      timestamp: input.timestamp || new Date().toISOString(),
      category: input.category,
      action: input.action,
      target: input.target,
      ...(input.data !== undefined ? { data: input.data } : {}),
    };

    if (this._items.length >= this._capacity) {
      this._items.shift();
    }

    this._items.push(breadcrumb);
    return breadcrumb;
  }

  /**
   * Returns a snapshot array of all breadcrumbs currently in the buffer in chronological order.
   */
  public getItems(): Breadcrumb[] {
    return [...this._items];
  }

  /**
   * Alias for getItems().
   */
  public toArray(): Breadcrumb[] {
    return this.getItems();
  }

  /**
   * Clears all breadcrumbs currently in the buffer.
   */
  public clear(): void {
    this._items = [];
  }

  /**
   * Current number of breadcrumbs stored in the buffer.
   */
  public get size(): number {
    return this._items.length;
  }

  /**
   * Maximum capacity of the ring buffer.
   */
  public get capacity(): number {
    return this._capacity;
  }
}
