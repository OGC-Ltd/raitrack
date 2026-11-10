import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIFE_MS, MAX_VISIBLE, addToast, dismissToast, pauseToasts, resetToasts, toastsSnapshot } from './toasts';

const t = (id) => ({ id, kind: 'push', level: 'info', title: id, body: '' });
const ids = () => toastsSnapshot().shown.map((x) => x.id);

describe('toast queue', () => {
  beforeEach(() => { vi.useFakeTimers(); resetToasts(); });
  afterEach(() => { resetToasts(); vi.useRealTimers(); });

  it('shows the oldest first and takes each away after 8 seconds', () => {
    addToast(t('a'));
    vi.advanceTimersByTime(3_000);
    addToast(t('b'));
    expect(ids()).toEqual(['a', 'b']);
    vi.advanceTimersByTime(LIFE_MS - 3_000);
    expect(ids()).toEqual(['b']);
    vi.advanceTimersByTime(3_000);
    expect(ids()).toEqual([]);
  });

  it('holds the rest back until a place frees, then gives each its full 8 seconds', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) addToast(t(id));
    expect(ids()).toHaveLength(MAX_VISIBLE);
    expect(toastsSnapshot().waiting).toBe(1);
    vi.advanceTimersByTime(2_000);
    dismissToast('a');
    expect(ids()).toEqual(['b', 'c', 'd', 'e']);
    vi.advanceTimersByTime(LIFE_MS - 2_000);
    expect(ids()).toEqual(['e']);            // e came into view 2 s later
    vi.advanceTimersByTime(2_000);
    expect(ids()).toEqual([]);
  });

  it('shows a toast once, however often it arrives', () => {
    expect(addToast(t('a'))).toBe(true);
    expect(addToast(t('a'))).toBe(false);
    expect(ids()).toEqual(['a']);
  });

  it('stands still while paused', () => {
    addToast(t('a'));
    vi.advanceTimersByTime(5_000);
    pauseToasts(true);
    vi.advanceTimersByTime(60_000);
    expect(ids()).toEqual(['a']);
    pauseToasts(false);
    vi.advanceTimersByTime(2_999);
    expect(ids()).toEqual(['a']);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual([]);
  });
});
