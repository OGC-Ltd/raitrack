import { describe, it, expect } from 'vitest';
import { byRead, exitCopyText, exitRows, searchExits, zoneIdOf, zoneIndex } from './geofenceExits';
import { isUnread, withRead } from './feedReads';

describe('Alerts: today’s geofence exits from the notification history', () => {
  const byOrg = [
    { orgId: 'men', items: [
      { id: 'n1', ts: '2026-11-05T06:12:00.000Z', plate: 'KDE 127E', text: 'KDE 127E left MORL HQ.', alertType: 'ZONE_EXIT' },
      { id: 'n2', ts: '2026-11-05T08:40:00.000Z', plate: 'KCP 136P', text: 'KCP 136P left Nairobi Depot and is now in Industrial Area.' },
      { id: 'n1', ts: '2026-11-05T06:12:00.000Z', plate: 'KDE 127E', text: 'KDE 127E left MORL HQ.' },          // the same one twice
    ] },
    { orgId: 'suk', items: [{ id: 'n9', time: '2026-11-05T07:00:00.000Z', plate: null, text: '' }] },
  ];
  it('lists each exit once, newest first, with its organisation', () => {
    const rows = exitRows(byOrg);
    expect(rows.map((r) => [r.orgId, r.plate, r.text])).toEqual([
      ['men', 'KCP 136P', 'KCP 136P left Nairobi Depot and is now in Industrial Area.'],
      ['suk', null, 'Left a geofence'],
      ['men', 'KDE 127E', 'KDE 127E left MORL HQ.'],
    ]);
  });
  it('finds a plate however it is typed, or a geofence by name', () => {
    const rows = exitRows(byOrg);
    expect(searchExits(rows, 'kde127').map((r) => r.plate)).toEqual(['KDE 127E']);
    expect(searchExits(rows, 'nairobi depot').map((r) => r.plate)).toEqual(['KCP 136P']);
    expect(searchExits(rows, '')).toHaveLength(3);
  });
});

describe('Alerts: the geofence an exit was for', () => {
  it('reads the geofence id out of the crossing id', () => {
    expect(zoneIdOf('zn-cmveh123-cmzone456-o-1762430000000')).toBe('cmzone456');
    expect(zoneIdOf('zn-1f0e-4a2b-cmzone456-o-1762430000000')).toBe('cmzone456');
    expect(zoneIdOf('zn-cmveh123-cmzone456-i-1762430000000')).toBeNull();
    expect(zoneIdOf(undefined)).toBeNull();
  });

  it('indexes the organisations’ geofences by id with the server’s category', () => {
    const index = zoneIndex([
      { features: [{ properties: { id: 'z1', name: 'MENENGAI_FG: NAIVAS', category: 'customer' } }] },
      { features: [{ properties: { id: 'z2', name: 'Menengai Yard' } }] },
      null,
    ]);
    expect(index.get('z1')).toEqual({ name: 'MENENGAI_FG: NAIVAS', category: 'customer' });
    expect(index.get('z2')).toEqual({ name: 'Menengai Yard', category: 'other' });
  });

  it('copies an exit as lines to paste', () => {
    const row = { plate: 'KDE 127E', at: Date.parse('2026-11-06T11:32:00Z'), text: 'KDE 127E left MENENGAI_FG: NAIVAS.' };
    expect(exitCopyText(row, { type: 'Customer', zone: 'MENENGAI_FG: NAIVAS', org: 'Menengai' })).toBe([
      'Geofence exit · KDE 127E',
      'When: 6 Nov 2026, 14:32',
      'Geofence: MENENGAI_FG: NAIVAS (Customer)',
      'Organisation: Menengai',
      'Details: KDE 127E left MENENGAI_FG: NAIVAS.',
    ].join('\n'));
    expect(exitCopyText(row)).not.toContain('Geofence:');
  });

  it('finds an exit by its geofence type', () => {
    const rows = [{ plate: 'A', text: 'left X' }, { plate: 'B', text: 'left Y' }];
    expect(searchExits(rows, 'customer', (r) => (r.plate === 'B' ? 'Customer' : 'Yard'))).toEqual([rows[1]]);
  });
});

describe('Alerts: geofence exits read and unread', () => {
  const rows = exitRows([{ orgId: 'men', items: [
    { id: 'zn-v1-z1-o-1', ts: '2026-11-06T06:00:00.000Z', plate: 'KDE 127E', text: 'left A' },
    { id: 'zn-v2-z2-o-2', ts: '2026-11-06T07:00:00.000Z', plate: 'KCP 136P', text: 'left B' },
  ] }]);

  it('keeps the feed line’s id and time, so the bell’s marks apply', () => {
    const reads = withRead({ since: 0, ids: new Map() }, [rows[1]], Date.parse('2026-11-06T08:00:00Z'));
    expect(rows.map((r) => isUnread(r, reads))).toEqual([true, false]);
  });

  it('lists the unread or the read, and keeps a row opened under the filter', () => {
    const unread = (r) => r.plate === 'KCP 136P';
    expect(byRead(rows, 'all', unread)).toHaveLength(2);
    expect(byRead(rows, 'unread', unread).map((r) => r.plate)).toEqual(['KCP 136P']);
    expect(byRead(rows, 'read', unread).map((r) => r.plate)).toEqual(['KDE 127E']);
    expect(byRead(rows, 'unread', () => false, new Set([rows[0].key]))).toEqual([rows[0]]);
  });
});
