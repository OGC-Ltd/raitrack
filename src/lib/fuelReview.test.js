import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../services/api';
import { fetchReviewRights, reviewIncident, reviewState, _resetReviews } from './fuelReview';

beforeEach(() => {
  _resetReviews();
  apiFetch.mockReset();
});

describe('reviewState', () => {
  it('offers both ways on an undecided alert', () => {
    expect(reviewState(null).offer).toEqual(['ESCALATED', 'DEESCALATED']);
  });
  it('offers only the other way once decided', () => {
    expect(reviewState({ status: 'CONFIRMED_THEFT' })).toMatchObject({ label: 'Escalated', offer: ['DEESCALATED'] });
    expect(reviewState({ status: 'NOT_THEFT' })).toMatchObject({ label: 'De-escalated', offer: ['ESCALATED'] });
  });
});

describe('fetchReviewRights', () => {
  it('asks once per organisation', async () => {
    apiFetch.mockResolvedValue({ data: { canReview: true } });
    expect(await fetchReviewRights('o1')).toBe(true);
    expect(await fetchReviewRights('o1')).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
  it('reads a failure as no, and asks again next time', async () => {
    apiFetch.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ data: { canReview: true } });
    expect(await fetchReviewRights('o1')).toBe(false);
    expect(await fetchReviewRights('o1')).toBe(true);
  });
});

describe('reviewIncident', () => {
  it('posts the outcome and the reason', async () => {
    apiFetch.mockResolvedValue({ data: { id: 't1', review: { status: 'NOT_THEFT' } } });
    const r = await reviewIncident('o1', 't1', 'DEESCALATED', 'Probe fault');
    expect(r).toEqual({ status: 'NOT_THEFT' });
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/organisations/o1/fuel/thefts/t1/review', {
      method: 'POST', body: JSON.stringify({ outcome: 'DEESCALATED', note: 'Probe fault' }),
    });
  });
});
