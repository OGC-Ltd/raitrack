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
    expect(html).toContain('the test completes the job');
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
  it('lets the Control Room click any other phase to move the job there', () => {
    const buttons = (html) => (html.match(/class="wf-ladder__btn"/g) ?? []).length;
    const tech = job({ queue: 'controltech', faultCategory: 'tracker', stage: 'fixing', ticketNo: 'RT-2026-00003' });
    expect(buttons(render(tech, grants('repair:verify')))).toBe(5);
    // A mechanical fault has no triage to go back to.
    expect(buttons(render(job({ stage: 'fixing', ticketNo: 'RT-2026-00004' }), grants('repair:verify')))).toBe(4);
    // Nobody else moves it, and a closed job does not move.
    expect(buttons(render(tech, grants('repair:resolve')))).toBe(0);
    expect(buttons(render({ ...tech, resolvedAt: '2026-10-27T00:00:00Z', stage: 'fixed' }, grants('repair:verify')))).toBe(0);
  });

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

describe('the work log opens by stage, to the right person', () => {
  const tech = grants('repair:resolve');
  const room = grants('repair:resolve', 'repair:work_any', 'repair:verify');
  const mine = (stage, over = {}) => job({ stage, assignedToId: 'u1', assignmentStatus: 'accepted', ...over });
  const entryOptions = (html) => [...html.matchAll(/role="radiogroup" aria-label="Entry">(.*?)<\/div>/g)]
    .flatMap((m) => [...m[1].matchAll(/>([A-Za-z]+)<\/button>/g)].map((x) => x[1]));

  it('gives the technician diagnosis at triage and in the workshop', () => {
    expect(entryOptions(render(mine('forwarded'), tech))).toEqual(['Diagnosis', 'Note']);
    expect(entryOptions(render(mine('in_workshop'), tech))).toEqual(['Diagnosis', 'Note']);
  });

  it('gives the technician repair and test together while fixing', () => {
    expect(entryOptions(render(mine('fixing'), tech))).toEqual(['Repair', 'Test', 'Note']);
    expect(entryOptions(render(mine('remote_fix'), tech))).toEqual(['Repair', 'Test', 'Note']);
  });

  it("keeps the technician's entries from the Control Room, even one that may work any job", () => {
    expect(entryOptions(render(mine('fixing'), room, 'sup-1'))).toEqual([]);
    expect(entryOptions(render(mine('in_workshop'), room, 'sup-1'))).toEqual([]);
  });

  it('gives verification to the Control Room once completed, and nothing to the technician', () => {
    expect(entryOptions(render(mine('completed'), room, 'sup-1'))).toEqual(['Verification']);
    expect(entryOptions(render(mine('completed'), tech))).toEqual([]);
  });

  it('opens nothing while awaiting assessment', () => {
    expect(entryOptions(render(mine('awaiting_assessment'), room))).toEqual([]);
  });
});

describe('the trail folds when long', () => {
  const steps = (n) => Array.from({ length: n }, (_, i) => ({ stage: 'forwarded', at: `2026-10-2${i % 9}T08:00:00Z`, note: `step ${i}` }));
  const shown = (html) => (html.match(/wf-trail__e[ "]/g) ?? []).length;

  it('shows the latest three of a long trail, and a way to open the rest', () => {
    const html = render(job({ stageHistory: steps(8) }), grants());
    expect(shown(html)).toBe(3);
    expect(html).toContain('Show all 8 steps');
    expect(html).toContain('step 7');
    expect(html).not.toContain('step 0<');
  });

  it('has nothing to fold in a short trail', () => {
    const html = render(job({ stageHistory: steps(3) }), grants());
    expect(shown(html)).toBe(3);
    expect(html).not.toContain('Show all');
  });
});

describe('the work log moves the job on', () => {
  const mine = (stage, over = {}) => job({ stage, ticketNo: 'RT-1', assignedToId: 'u1', assignmentStatus: 'accepted', ...over });

  it('asks a workshop diagnosis for the damage class, and says it starts the repair', () => {
    const html = render(mine('in_workshop'), grants('repair:resolve'));
    expect(html).toContain('aria-label="Damage"');
    expect(html).toContain('Log and start the repair');
    expect(html).toContain('it starts the repair');
  });

  it('logs a triage diagnosis plainly: the path is still to decide', () => {
    const html = render(mine('forwarded', { queue: 'controltech' }), grants('repair:resolve'));
    expect(html).not.toContain('aria-label="Damage"');
    expect(html).toContain('Log it');
  });

  it('offers the Control Room the verdict, with what was done beside it', () => {
    const html = render(mine('completed', { completedById: 'u1', fixNote: 'Replaced the probe' }), grants('repair:verify'), 'sup-1');
    expect(html).toContain('aria-label="Verdict"');
    expect(html).toContain('Replaced the probe');
  });

  it('keeps the completer from verifying their own repair', () => {
    const html = render(mine('completed', { completedById: 'sup-1' }), grants('repair:verify'), 'sup-1');
    expect(html).toContain('Someone else in the Control Room verifies it');
    expect(html).not.toContain('aria-label="Verdict"');
  });
});
