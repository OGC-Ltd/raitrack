import { describe, it, expect } from 'vitest';
import { belongsHere, stopNoticeTitle } from './serverToasts';

const stop = (orgCode) => ({ kind: 'stop', title: 'Unauthorised stop', body: 'KDE 321Q has stopped 7 min …', data: { orgCode } });

describe('belongsHere', () => {
  it("shows Menengai's stop pop-ups only in Menengai", () => {
    expect(belongsHere(stop('MENENGAI'), 'MENENGAI')).toBe(true);
    expect(belongsHere(stop('MENENGAI'), 'SUKARI')).toBe(false);
    expect(belongsHere(stop('MENENGAI'), 'WESTSUGAR')).toBe(false);
  });

  it("shows West Kenya's three as one: a Kabras stop in West Kenya, Nzoia or Kabras, not elsewhere", () => {
    expect(belongsHere(stop('KABRAS'), 'WESTSUGAR')).toBe(true);
    expect(belongsHere(stop('WESTSUGAR'), 'NZOIA')).toBe(true);
    expect(belongsHere(stop('NZOIA'), 'KABRAS')).toBe(true);
    expect(belongsHere(stop('KABRAS'), 'MENENGAI')).toBe(false);
    expect(belongsHere(stop('WESTSUGAR'), 'SUKARI')).toBe(false);
  });

  it('leaves every other toast alone, and a stop without either code', () => {
    expect(belongsHere({ kind: 'push', title: 'Fuel theft', data: { orgCode: 'MENENGAI' } }, 'SUKARI')).toBe(true);
    expect(belongsHere(stop(null), 'SUKARI')).toBe(true);
    expect(belongsHere(stop('MENENGAI'), null)).toBe(true);
  });
});

describe('stopNoticeTitle', () => {
  it("names the stop's own company", () => {
    expect(stopNoticeTitle(stop('MENENGAI'))).toBe('Menengai: unauthorised stop');
    expect(stopNoticeTitle(stop('KABRAS'))).toBe('West Kenya: unauthorised stop');
    expect(stopNoticeTitle(stop(null))).toBe('Unauthorised stop');
  });
});
