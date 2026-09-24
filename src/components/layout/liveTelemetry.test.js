import { describe, it, expect } from 'vitest';
import { appendLiveFrame } from './VehicleDetailPanel.jsx';

const frame = (t, extra = {}) => ({ capturedAtMs: t, speed: 40, fuelLitres: 150, engine: 'on', ...extra });

describe('appendLiveFrame', () => {
  it('adds a frame newer than the last fetched ping, in ping shape', () => {
    const out = appendLiveFrame([], [{ t: 1000 }], frame(2000, { speed: 95 }));
    expect(out).toEqual([{ t: 2000, speedKmh: 95, fuelLevelMl: 150000, engineOn: true }]);
  });

  it('ignores a frame the fetch already covers', () => {
    const tail = [];
    expect(appendLiveFrame(tail, [{ t: 2000 }], frame(2000))).toBe(tail);
    expect(appendLiveFrame(tail, [{ t: 3000 }], frame(2000))).toBe(tail);
  });

  it('grows the tail frame by frame, never repeating one', () => {
    let tail = appendLiveFrame([], [{ t: 1000 }], frame(2000));
    tail = appendLiveFrame(tail, [{ t: 1000 }], frame(3000));
    tail = appendLiveFrame(tail, [{ t: 1000 }], frame(3000));
    expect(tail.map(p => p.t)).toEqual([2000, 3000]);
  });

  it('keeps unknown readings as null rather than zero', () => {
    const [p] = appendLiveFrame([], [], frame(5000, { fuelLitres: null, speed: undefined, engine: undefined }));
    expect(p).toMatchObject({ fuelLevelMl: null, speedKmh: null, engineOn: null });
  });
});
