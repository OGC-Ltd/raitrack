import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../services/api', () => ({ apiFetch: vi.fn(async () => ({ data: null })) }));

import { JobView, PhaseLadder, mayWork } from './RepairWorkflowJob';
import FlagRepairDialog from './FlagRepairDialog';
import { routeOf, routeOfAll, categoriesForProbeRow, PHASE_OF_STAGE } from '../../api/repairWorkflow';
import { STAGE_LABEL } from '../../api/repairs';

const grants = (...slugs) => (s) => slugs.includes(s);
const job = (over = {}) => ({
  id: 'j1', stage: 'forwarded', faultCategory: 'brakes', targetKind: 'unit', queue: 'workshop',
  vehicle: { registrationPlate: 'KDA 001A' }, stageHistory: [], assessments: [], bookings: [],
  spareParts: [], workEntries: [], checklist: ['pads_shoes'], ...over,
});
const render = (j, can, userId = 'u1') => renderToStaticMarkup(h(JobView, { orgId: 'o', job: j, can, userId }));

describe('routing a flag', () => {
  it('sends telematics to ControlTech and mechanical to the workshop', () => {
    expect(routeOf('tracker')).toBe('controltech');
    expect(routeOf('brakes')).toBe('workshop');
    expect(routeOf('other', 'controltech')).toBe('controltech');
  });

  it('names every workflow stage, and places it in a phase', () => {
    for (const s of Object.keys(PHASE_OF_STAGE)) expect(STAGE_LABEL[s], s).toBeTruthy();
  });
});

describe('the job panel shows the one next step, to whoever may take it', () => {
  it('offers ControlTech the claim on an unclaimed queue job', () => {
    const html = render(job({ queue: 'controltech', faultCategory: 'tracker' }), grants('repair:claim', 'repair:resolve'));
    expect(html).toContain('Claim this job');
  });

  it('holds a step until Save, which starts disabled', () => {
    const html = render(job({ queue: 'controltech', faultCategory: 'tracker' }), grants('repair:claim', 'repair:resolve'));
    expect(html).toContain('Choose the next step above, then save it');
    expect(html).toMatch(/<button type="button" class="sp4-submit-btn" disabled="">Save<\/button>/);
  });

  it('shows no Save bar to someone with no step to take', () => {
    expect(render(job({ stage: 'awaiting_assessment' }), grants())).not.toContain('then save it');
  });

  it('gives the claimer the remote or physical decision', () => {
    const html = render(job({ assignedToId: 'u1', assignmentStatus: 'accepted' }), grants('repair:claim', 'repair:resolve'));
    expect(html).toContain('Fix remotely');
    expect(html).toContain('Needs physical inspection');
  });

  it('asks the supervisor to assess, and the operator only to wait', () => {
    const j = job({ stage: 'awaiting_assessment' });
    expect(render(j, grants('repair:assess', 'repair:book'))).toContain('Can it safely reach the Auto Workshop?');
    const op = render(j, grants('repair:book', 'repair:flag'));
    expect(op).not.toContain('Record assessment');
    expect(op).toContain('Nothing for you to do here');
  });

  it('opens the booking strip once a unit is assessed roadworthy', () => {
    const html = render(job({ stage: 'awaiting_assessment', assessments: [{ id: 'a', roadworthy: true, intervention: 'workshop' }] }), grants('repair:book'));
    expect(html).toContain('Book a workshop day');
    expect(html).toContain('Reading the workshop calendar');
  });

  it('checks a towed unit in, rather than assessing it again', () => {
    const html = render(job({ stage: 'towing' }), grants('repair:book', 'repair:assess'));
    expect(html).toContain('issue the ticket');
    expect(html).not.toContain('Record assessment');
  });

  it('flags suspected malicious damage and keeps the repair going', () => {
    const html = render(job({
      stage: 'fixing', ticketNo: 'RT-2026-00007', damageClass: 'suspected_malicious', damageNote: 'Cut',
      securityInvestigation: { status: 'open' }, workshopTechnicianId: 'u1',
    }), grants('repair:resolve'));
    expect(html).toContain('Suspected malicious damage.');
    expect(html).toContain('The repair continues');
    expect(html).toContain('RT-2026-00007');
    expect(html).toContain('Complete and send to verify');
    expect(html).toContain('Mark warranty void');
  });

  it('lets the Control Room verify, but never the person who completed it', () => {
    const j = job({ stage: 'completed', completedById: 'u1', fixNote: 'Pads replaced', testResult: 'pass' });
    expect(render(j, grants('repair:verify'), 'u2')).toContain('Verify: fixed and available');
    expect(render(j, grants('repair:verify'), 'u1')).toContain('Someone else in the Control Room verifies it');
  });

  it('works a job only when it is yours, or you may work any', () => {
    const j = job({ assignedToId: 'u1', assignmentStatus: 'pending' });
    expect(mayWork(j, grants('repair:resolve'), 'u1')).toBe(false);
    expect(mayWork({ ...j, assignmentStatus: 'accepted' }, grants('repair:resolve'), 'u1')).toBe(true);
    expect(mayWork(j, grants('repair:resolve', 'repair:work_any'), 'u9')).toBe(true);
  });
});

describe('the ladder', () => {
  it('marks the current phase', () => {
    const html = renderToStaticMarkup(h(PhaseLadder, { stage: 'in_workshop' }));
    expect(html).toContain('aria-current="step"');
    expect(html.match(/wf-ladder__step--done/g)).toHaveLength(3);
  });
});

describe('the flag dialog', () => {
  it('renders the fault groups and nothing when closed', () => {
    expect(renderToStaticMarkup(h(FlagRepairDialog, { orgId: 'o', open: false, onClose() {} }))).toBe('');
    const html = renderToStaticMarkup(h(FlagRepairDialog, { orgId: 'o', open: true, onClose() {} }));
    expect(html).toContain('Telematics');
    expect(html).toContain('Mechanical');
    expect(html).toContain('Flag unit');
  });

  it('offers GPS and Ignition under Telematics, as ticks rather than one choice', () => {
    const html = renderToStaticMarkup(h(FlagRepairDialog, { orgId: 'o', open: true, onClose() {} }));
    expect(html).toContain('>GPS<');
    expect(html).toContain('>Ignition<');
    expect(html).not.toContain('role="radio"');
    expect(html.match(/role="checkbox"/g).length).toBeGreaterThan(10);
  });

  it('opens with several faults ticked across groups', () => {
    const html = renderToStaticMarkup(h(FlagRepairDialog, {
      orgId: 'o', open: true, onClose() {}, presetVehicleId: 'v1', presetCategories: ['gps', 'brakes'],
    }));
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html).toContain('GPS to ControlTech, Brakes to the workshop: one job each.');
  });
});

describe('several faults in one flag', () => {
  it('says where a mixed set goes', () => {
    expect(routeOfAll(['gps', 'ignition'])).toBe('controltech');
    expect(routeOfAll(['brakes', 'engine'])).toBe('workshop');
    expect(routeOfAll(['gps', 'brakes'])).toBe('both');
    expect(routeOfAll([])).toBe(null);
  });

  it('ticks the faults a probe row already shows', () => {
    const ch = (gps, ignition) => ({ gps: { state: gps }, ignition: { state: ignition } });
    expect(categoriesForProbeRow({ channels: ch('NOT_REPORTING', 'NOT_REPORTING'), fuelProbe: { state: 'OK' } }))
      .toEqual(['gps', 'ignition']);
    expect(categoriesForProbeRow({ trackerSilent: true, channels: ch('NOT_REPORTING', 'REPORTING') })).toEqual(['tracker']);
    expect(categoriesForProbeRow({ channels: ch('REPORTING', 'REPORTING'), fuelProbe: { state: 'DIED' } })).toEqual(['fuel_probe']);
  });
});
