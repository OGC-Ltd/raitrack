import { describe, it, expect } from 'vitest';
import { REPORT_NODES, reportKeysFor, firstReport, hasRecoveryTab, MOVEMENTS_TAB_GROUPS, groupMovementsTabs, groupOfTab } from './reportNav';

describe('the reports menu', () => {
  it('lists the reports A–Z by name', () => {
    const labels = REPORT_NODES.map((n) => n.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    expect(labels[0]).toBe('Driver conduct');
  });

  it('still opens on Shift, where the grants allow it', () => {
    expect(firstReport(reportKeysFor(() => true))).toBe('shift');
    expect(firstReport(reportKeysFor((g) => g !== 'weighbridge:read'))).toBe(reportKeysFor(() => false)[0]);
  });

  it('shows Recovery under Movements only for the four configured organisations and telemetry readers', () => {
    for (const org of ['SUKARI', 'WESTSUGAR', 'KABRAS', 'NZOIA']) {
      expect(hasRecoveryTab(() => true, org)).toBe(true);
    }
    expect(hasRecoveryTab(() => true, 'MENENGAI')).toBe(false);
    expect(hasRecoveryTab((permission) => permission !== 'telemetry:read', 'SUKARI')).toBe(false);
  });
});

describe('Movements tab headings', () => {
  const all = ['hourly', 'tankers', 'deliveries', 'geofences', 'tatFuel', 'recovery', 'speed', 'probes', 'dormant', 'alarmDist', 'unauthorizedPassengers', 'fuelConsumption', 'fuelGraphs', 'machinery', 'shiftHours'];
  const tabsOf = (keys) => keys.map((key) => ({ key, label: key }));
  const flat = (groups) => groups.flatMap((g) => g.tabs.map((t) => t.key));

  it('puts every tab under exactly one heading', () => {
    const named = MOVEMENTS_TAB_GROUPS.flatMap((g) => g.tabs);
    expect([...named].sort()).toEqual([...all].sort());
    expect(new Set(named).size).toBe(named.length);
  });

  it("gives Sukari's eleven tabs four headings and loses none", () => {
    const sukari = ['hourly', 'geofences', 'tatFuel', 'recovery', 'speed', 'probes', 'dormant', 'alarmDist', 'unauthorizedPassengers', 'fuelConsumption', 'fuelGraphs'];
    const groups = groupMovementsTabs(tabsOf(sukari));
    expect(groups.map((g) => g.key)).toEqual(['trips', 'fuel', 'safety', 'sites']);
    expect(flat(groups).sort()).toEqual([...sukari].sort());
  });

  it('leaves out a heading with no tabs, and keeps a tab no heading names', () => {
    const groups = groupMovementsTabs(tabsOf(['hourly', 'fuelConsumption', 'fuelGraphs', 'unauthorizedPassengers', 'newOne']));
    expect(groups.map((g) => g.key)).toEqual(['trips', 'fuel', 'safety']);
    expect(groups[0].tabs.map((t) => t.key)).toEqual(['hourly', 'newOne']);
  });

  it('finds the heading a tab sits under', () => {
    const groups = groupMovementsTabs(tabsOf(all));
    expect(groupOfTab(groups, 'shiftHours')).toBe('sites');
    expect(groupOfTab(groups, 'probes')).toBe('fuel');
    expect(groupOfTab(groups, 'nope')).toBe('trips');
  });
});
