import { describe, it, expect } from 'vitest';
import { splitDrained } from './fuelTheftSplit';

describe('splitDrained', () => {
  it('takes the suspected theft out of what drained, so each litre is shown once', () => {
    const s = splitDrained({
      litresLost: 5288, lossCost: 948395, thefts: 40,
      litresSuspectedTheft: 312.4, suspectedTheftCost: 56030, suspectedThefts: 3,
    });
    expect(s).toEqual({ lost: 4975.6, lossCost: 892365, drains: 37, theft: 312.4, theftCost: 56030, thefts: 3 });
    expect(s.lost + s.theft).toBeCloseTo(5288, 6);
  });

  it('reads a payload without the theft fields as no suspected theft', () => {
    expect(splitDrained({ litresLost: 21.3, lossCost: 3820, thefts: 1 }))
      .toEqual({ lost: 21.3, lossCost: 3820, drains: 1, theft: 0, theftCost: 0, thefts: 0 });
  });

  it('never goes below zero, and survives a missing level', () => {
    expect(splitDrained({ litresLost: 10, litresSuspectedTheft: 10.04, lossCost: 1, suspectedTheftCost: 2 }).lost).toBe(0);
    expect(splitDrained(undefined)).toEqual({ lost: 0, lossCost: 0, drains: 0, theft: 0, theftCost: 0, thefts: 0 });
  });
});
