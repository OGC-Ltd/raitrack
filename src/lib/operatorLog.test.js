import { describe, it, expect } from 'vitest';
import { clean, upsert, remove, exportJson, importJson } from './operatorLog';

const e = (over) => ({ kind: 'phone', at: 1_793_000_000_000, plate: 'KCA 224M', vehicleId: 'v9', driver: 'Antony Kangethe', ...over });

describe('operator log', () => {
  it('keeps only well-formed entries', () => {
    expect(clean(e())).toMatchObject({ kind: 'phone', plate: 'KCA 224M', status: 'Online' });
    expect(clean(e({ kind: 'harsh' }))).toBeNull();
    expect(clean(e({ at: 'soon' }))).toBeNull();
    expect(clean(e({ plate: '', vehicleId: '' }))).toBeNull();
  });

  it('adds, replaces by id and removes', () => {
    let list = upsert([], e({ id: 'a' }));
    list = upsert(list, e({ id: 'a', details: 'on a call' }));
    expect(list).toHaveLength(1);
    expect(list[0].details).toBe('on a call');
    expect(remove(list, 'a')).toEqual([]);
  });

  it('exports and imports, an entry held already kept once', () => {
    const list = upsert([], e({ id: 'a' }));
    const file = exportJson(list, 'MENENGAI');
    expect(importJson(list, file)).toMatchObject({ added: 0 });
    const merged = importJson([], file);
    expect(merged.added).toBe(1);
    expect(merged.list[0].id).toBe('a');
    expect(() => importJson([], 'not json')).toThrow();
  });
});
