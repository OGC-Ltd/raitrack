/**
 * Live feed read marks. Written against a live bug (operator 2026-10-19):
 * reading one message cleared every other unread message with it.
 */

import { describe, it, expect } from 'vitest';
import { isUnread, withRead, allRead, MAX_READ_IDS } from './feedReads';
import { summariseUnread } from '../components/layout/AppHeader';

const SINCE = Date.parse('2026-10-19T06:00:00.000Z');
const line = (id, iso) => ({ id, ts: iso, type: 'info' });
const a = line('ya-1', '2026-10-19T06:10:00.000Z');
const b = line('zn-2', '2026-10-19T06:20:00.000Z');
const c = line('mg-3', '2026-10-19T06:30:00.000Z');
const fresh = { since: SINCE, ids: new Set() };

describe('feed read marks', () => {
  it('reading one line leaves the others unread', () => {
    const r = withRead(fresh, [b]);
    expect([a, b, c].map((x) => isUnread(x, r))).toEqual([true, false, true]);
    expect(summariseUnread([a, b, c], r).unreadCount).toBe(2);
  });

  it('a line at or before the cut-off is read, and so is one without a time', () => {
    expect(isUnread(line('old', '2026-10-19T06:00:00.000Z'), fresh)).toBe(false);
    expect(isUnread({ id: 'x', ts: 'not a date' }, fresh)).toBe(false);
  });

  it('reading an already-read line changes nothing', () => {
    const r = withRead(fresh, [a]);
    expect(withRead(r, [a])).toBe(r);
    expect(withRead(fresh, [line('old', '2026-10-19T05:00:00.000Z')])).toBe(fresh);
  });

  it('"Mark all read" reads everything so far and drops the single marks', () => {
    const r = allRead(Date.parse('2026-10-19T06:31:00.000Z'));
    expect(summariseUnread([a, b, c], r).unreadCount).toBe(0);
    expect(r.ids.size).toBe(0);
    expect(isUnread(line('next', '2026-10-19T06:40:00.000Z'), r)).toBe(true);
  });

  it('keeps only the newest marks', () => {
    let r = fresh;
    for (let i = 0; i < MAX_READ_IDS + 5; i++) r = withRead(r, [line(`n${i}`, '2026-10-19T07:00:00.000Z')]);
    expect(r.ids.size).toBe(MAX_READ_IDS);
    expect(r.ids.has('n0')).toBe(false);
    expect(r.ids.has(`n${MAX_READ_IDS + 4}`)).toBe(true);
  });
});
