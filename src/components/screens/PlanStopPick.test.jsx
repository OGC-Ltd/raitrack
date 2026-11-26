import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PlanStopPick from './PlanStopPick';

const choices = Array.from({ length: 11 }, (_, i) => ({ key: `n:SHOP ${i + 1}`, label: `SHOP ${i + 1}`, name: `SHOP ${i + 1}` }));
const draw = (has = () => false) => renderToStaticMarkup(
  <PlanStopPick plate="KDE 268P" from="Van Sales" here="Finished Goods" what="Wialon itinerary" day="Wed 25 Nov"
                choices={choices} has={has} onAdd={() => {}} onClose={() => {}} />,
);

describe('picking a Van Sales unit’s Finished Goods routes from its VS itinerary (operator, 2026-11-25)', () => {
  it('lists every VS stop in route order, none ticked, and adds nothing until one is', () => {
    const html = draw();
    expect(html.match(/role="menuitemcheckbox"/g)).toHaveLength(11);
    expect(html).not.toContain('aria-checked="true"');
    expect(html.indexOf('SHOP 1<')).toBeLessThan(html.indexOf('SHOP 11<'));
    expect(html).toContain('Tick the stops to add');
    expect(html).toContain('Van Sales keeps all of its own');
  });

  it('a stop already on Finished Goods shows ticked and cannot be added twice', () => {
    const html = draw((c) => c.name === 'SHOP 3');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain('on Finished Goods');
  });
});
