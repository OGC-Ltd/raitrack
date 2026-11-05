import { describe, it, expect } from 'vitest';
import { withCornering, corneringByUnit, withoutDrainsBox } from './shiftCornering';

const sheet = () => ({ title: 'END OF SHIFT REPORT', blocks: [
  { kind: 'h2', title: '1. Overview' },
  { kind: 'figures', items: [{ label: 'Fuel refills', value: '2 · 80 L' }, { label: 'Policy breaches', value: '12' }] },
  { kind: 'h2', title: '3. Policy breaches', aside: '12 in the shift · top 5 units for each' },
  { kind: 'table', cols: [{ w: 0 }, { w: 0 }], head: ['Harsh braking', 'Harsh acceleration'], rows: [[{ text: '7' }, { text: '5' }], [{ text: '3 units' }, { text: '2 units' }]] },
  { kind: 'pair', halves: [{ title: 'Harsh braking' }, { title: 'Harsh acceleration' }] },
  { kind: 'note', text: 'On phone ... dashcams.' },
  { kind: 'h2', title: '4. Out of geofence' },
] });
const turn = (vehicleId, plate) => ({ kind: 'cornering', vehicleId, plate, at: 1 });

describe('End of Shift: harsh cornering in Policy breaches', () => {
  it('counts each unit’s turns, the category’s units only', () => {
    const ev = [turn('a', 'KCF 180A'), turn('b', 'KCK 234F'), turn('a', 'KCF 180A'), { kind: 'braking', vehicleId: 'a' }];
    expect(corneringByUnit(ev)).toEqual([{ plate: 'KCF 180A', times: 2 }, { plate: 'KCK 234F', times: 1 }]);
    expect(corneringByUnit(ev, ['b'])).toEqual([{ plate: 'KCK 234F', times: 1 }]);
  });

  it('adds the column, its own half and the totals, once', () => {
    const d = withCornering(sheet(), [turn('a', 'KCF 180A'), turn('a', 'KCF 180A'), turn('b', 'KCK 234F')]);
    const t = d.blocks[3];
    expect(t.head).toEqual(['Harsh braking', 'Harsh acceleration', 'Harsh cornering']);
    expect(t.rows.map((r) => r[2].text)).toEqual(['3', '2 units']);
    expect(d.blocks[5].kind).toBe('pair');
    expect(d.blocks[5].halves[0].title).toBe('Harsh cornering');
    expect(d.blocks[5].halves[0].aside).toBe('all 2 units');
    expect(d.blocks[5].halves[0].body.rows.map((r) => [r[0].text, r[2].text])).toEqual([['KCF 180A', '2'], ['KCK 234F', '1']]);
    expect(d.blocks[6].kind).toBe('note');
    expect(d.blocks[2].aside).toBe('15 in the shift · top 5 units for each');
    expect(d.blocks[1].items[1].value).toBe('15');
    expect(withCornering(d, [turn('a', 'X')])).toBe(d);
  });

  it('says none, or that it could not be read', () => {
    const none = withCornering(sheet(), []);
    expect(none.blocks[3].rows.map((r) => r[2].text)).toEqual(['0', '0 units']);
    expect(none.blocks[5].halves[0].body).toEqual({ kind: 'none', text: 'None in the shift.' });
    expect(none.blocks[2].aside).toBe('12 in the shift · top 5 units for each');
    const failed = withCornering(sheet(), null);
    expect(failed.blocks[3].head).toHaveLength(2);
    expect(failed.blocks.find((b) => b.kind === 'note' && /could not be read/.test(b.text))).toBeTruthy();
  });
});

describe('End of Shift: no Fuel drains box', () => {
  it('leaves the other Overview boxes as they are', () => {
    const doc = { blocks: [{ kind: 'figures', items: [{ label: 'Fuel refills', value: '2 · 126 L' }, { label: 'Fuel drains', value: '0 · 0.0 L' }, { label: 'Escalated thefts', value: '0' }] }] };
    expect(withoutDrainsBox(doc).blocks[0].items.map((i) => i.label)).toEqual(['Fuel refills', 'Escalated thefts']);
  });
});
