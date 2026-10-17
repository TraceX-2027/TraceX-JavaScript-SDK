import { describe, expect, it } from 'bun:test';
import { BreadcrumbRingBuffer } from '../src/buffer/ring-buffer';

describe('BreadcrumbRingBuffer', () => {
  it('records breadcrumbs within capacity and increments sequence order monotonically', () => {
    const buffer = new BreadcrumbRingBuffer(50);
    expect(buffer.size).toBe(0);

    const b1 = buffer.add({
      category: 'ui.tap',
      action: 'click',
      target: 'ButtonA',
    });
    const b2 = buffer.add({
      category: 'ui.tap',
      action: 'click',
      target: 'ButtonB',
    });
    const b3 = buffer.add({
      category: 'network.http',
      action: 'GET',
      target: '/api/v1/users',
    });

    expect(buffer.size).toBe(3);
    expect(b1.sequence_order).toBe(1);
    expect(b2.sequence_order).toBe(2);
    expect(b3.sequence_order).toBe(3);

    const items = buffer.getItems();
    expect(items).toHaveLength(3);
    expect(items[0].target).toBe('ButtonA');
    expect(items[1].target).toBe('ButtonB');
    expect(items[2].target).toBe('/api/v1/users');
    expect(items.map((i) => i.sequence_order)).toEqual([1, 2, 3]);
  });

  it('evicts oldest items FIFO on overflow maintaining monotonic sequence numbers', () => {
    const buffer = new BreadcrumbRingBuffer(50);

    for (let i = 1; i <= 60; i++) {
      buffer.add({
        category: 'log',
        action: 'log',
        target: `event_${i}`,
      });
    }

    expect(buffer.size).toBe(50);
    const items = buffer.getItems();
    expect(items).toHaveLength(50);
    expect(items[0].sequence_order).toBe(11);
    expect(items[0].target).toBe('event_11');
    expect(items[49].sequence_order).toBe(60);
    expect(items[49].target).toBe('event_60');
  });

  it('discards oldest 5 when 55 are recorded on capacity 50 (acceptance criteria)', () => {
    const buffer = new BreadcrumbRingBuffer(50);

    for (let i = 1; i <= 55; i++) {
      buffer.add({
        category: 'navigation',
        action: 'route',
        target: `/page/${i}`,
      });
    }

    expect(buffer.size).toBe(50);
    const items = buffer.getItems();
    expect(items[0].sequence_order).toBe(6);
    expect(items[items.length - 1].sequence_order).toBe(55);
  });

  it('respects explicitly provided timestamps and sequence orders', () => {
    const buffer = new BreadcrumbRingBuffer(10);
    const customTime = '2026-09-02T10:15:20.000Z';

    const item = buffer.add({
      category: 'custom',
      action: 'action',
      target: 'target',
      timestamp: customTime,
      sequence_order: 100,
    });

    expect(item.timestamp).toBe(customTime);
    expect(item.sequence_order).toBe(100);

    const nextItem = buffer.add({
      category: 'custom',
      action: 'action2',
      target: 'target2',
    });
    expect(nextItem.sequence_order).toBe(101);
  });

  it('clears items cleanly when clear() is called', () => {
    const buffer = new BreadcrumbRingBuffer(10);
    buffer.add({ category: 'test', action: 'test', target: 'test' });
    expect(buffer.size).toBe(1);

    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.getItems()).toEqual([]);
  });

  it('guards against NaN sequence_order in breadcrumb input', () => {
    const buffer = new BreadcrumbRingBuffer(10);
    const item = buffer.add({
      category: 'test',
      action: 'action',
      target: 'target',
      sequence_order: NaN,
    });
    expect(Number.isNaN(item.sequence_order)).toBe(false);
    expect(item.sequence_order).toBe(1);
  });
});
