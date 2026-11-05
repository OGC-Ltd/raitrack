import { describe, it, expect } from 'vitest';
import { exitRows, searchExits } from './geofenceExits';

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
