import { describe, it, expect } from 'vitest';
import { feedItemFollowUp, followUpAbilities } from './fuelFollowUps.js';

const fu = (status, viewer = {}) => ({ status, viewer: { deletedIt: false, ownsIt: false, ...viewer } });

describe('followUpAbilities', () => {
  it('lets a case holder accept a waiting follow-up', () => {
    expect(followUpAbilities(fu('OPEN'), true)).toMatchObject({ accept: true, act: false });
  });

  it('never lets the account that deleted the alert accept it', () => {
    expect(followUpAbilities(fu('OPEN', { deletedIt: true }), true)).toMatchObject({ accept: false, why: 'deleted-it' });
  });

  it('gives the decision only to the account that accepted it', () => {
    expect(followUpAbilities(fu('ACCEPTED', { ownsIt: true }), true)).toMatchObject({ act: true });
    expect(followUpAbilities(fu('ACCEPTED'), true)).toMatchObject({ act: false, why: 'someone-else' });
  });

  it('offers nothing without case rights, or once decided', () => {
    expect(followUpAbilities(fu('OPEN'), false)).toMatchObject({ accept: false, act: false, why: 'no-rights' });
    expect(followUpAbilities(fu('ESCALATED', { ownsIt: true }), true)).toMatchObject({ act: false, why: 'closed' });
  });
});

describe('feedItemFollowUp', () => {
  it('reads the follow-up from a live item', () => {
    expect(feedItemFollowUp({ id: 'fu-abc-opened', followUpId: 'abc' })).toBe('abc');
  });

  it('recovers it from the feed id of an item read back from history', () => {
    expect(feedItemFollowUp({ id: 'fu-cmf1x2-escalated' })).toBe('cmf1x2');
    expect(feedItemFollowUp({ id: 'fu-cmf1x2-deescalated' })).toBe('cmf1x2');
  });

  it('ignores every other feed item', () => {
    expect(feedItemFollowUp({ id: 'pa-123', alertType: 'fuelInconsistency' })).toBeNull();
    expect(feedItemFollowUp(null)).toBeNull();
  });
});
