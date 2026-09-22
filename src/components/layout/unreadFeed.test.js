/**
 * The bell's counter.
 *
 * Written against a live bug: the badge filtered the feed down to `warning`
 * and `critical`, and the fleet publishes almost nothing of either kind — so
 * the panel filled with dispatches, arrivals and gate crossings while the
 * number beside the bell stayed at zero. The first test is that bug.
 */

import { describe, it, expect } from 'vitest';
import { summariseUnread } from './AppHeader';

const SEEN = Date.parse('2026-09-22T03:00:00.000Z');
const at = (iso, type = 'info') => ({ id: iso, ts: iso, type });

describe('summariseUnread', () => {
  it('counts the info and success items the fleet actually publishes', () => {
    // A sale sign-out, a gate crossing and an arrival — the three shapes
    // raifactorysuite-events.service emits, none of them warning/critical.
    const feed = [
      at('2026-09-22T03:22:00.000Z', 'info'),
      at('2026-09-22T03:24:00.000Z', 'info'),
      at('2026-09-22T03:31:00.000Z', 'success'),
    ];
    expect(summariseUnread(feed, SEEN)).toEqual({ unreadCount: 3, unreadAlarming: false });
  });

  it('ignores anything at or before the last time the feed was opened', () => {
    const feed = [
      at('2026-09-22T02:59:59.000Z'),
      at('2026-09-22T03:00:00.000Z'), // exactly seen — not new
      at('2026-09-22T03:00:01.000Z'),
    ];
    expect(summariseUnread(feed, SEEN).unreadCount).toBe(1);
  });

  it('flags a warning or a critical among the routine traffic', () => {
    const feed = [
      at('2026-09-22T03:10:00.000Z', 'info'),
      at('2026-09-22T03:12:00.000Z', 'warning'),
    ];
    expect(summariseUnread(feed, SEEN)).toEqual({ unreadCount: 2, unreadAlarming: true });

    const theft = [at('2026-09-22T03:12:00.000Z', 'critical')];
    expect(summariseUnread(theft, SEEN).unreadAlarming).toBe(true);
  });

  it('does not let an unparseable timestamp tick the badge up on every replay', () => {
    const feed = [at('2026-09-22T03:10:00.000Z'), { id: 'x', ts: 'not a date', type: 'info' }, { id: 'y' }];
    expect(summariseUnread(feed, SEEN).unreadCount).toBe(1);
  });

  it('reads an absent feed as nothing new rather than throwing', () => {
    expect(summariseUnread(undefined, SEEN)).toEqual({ unreadCount: 0, unreadAlarming: false });
    expect(summariseUnread([], SEEN)).toEqual({ unreadCount: 0, unreadAlarming: false });
  });
});
