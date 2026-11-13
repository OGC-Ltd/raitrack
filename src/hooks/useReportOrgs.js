// The organisations a templated report is made for (lib/reportTemplates).
// Each organisation's report is about that organisation alone, with nothing to
// pick. West Kenya's is the exception (operator, 4 Nov 2026): it lists Sukari,
// Kabras, Nzoia, Olepito and Naitiri, any this user can see, and West Kenya
// ticks them all, which is how it opens.
//
// Shared by the Geofence, TAT and Fuel, Dormant Assets and Speed reports.

import { useMemo, useRef, useState } from 'react';
import { useCompanies } from '../context/AppContext';
import { ORG_CODE_BY_COMPANY, resolveOrgId } from '../api/org';
import { familyOf, familyMembers, familyRuns } from '../lib/reportTemplates';
import { keptByKind, kindPicker, siteFleet, siteKind } from '../lib/siteLists';

const codeOf = (company) => ORG_CODE_BY_COMPANY[company?.id] ?? String(company?.id ?? '').toUpperCase();

export function useReportOrgs(reportKey, { orgId, orgCode, companyName }) {
  const { companies = [] } = useCompanies();
  const code = String(orgCode ?? '').toUpperCase();
  const family = familyOf(reportKey, code);
  // The organisations this user can see, by code
  const seen = useMemo(() => new Map(companies.map((c) => [codeOf(c), c])), [companies]);
  const members = useMemo(() => (family ? familyMembers(family, (c) => seen.has(c)) : []), [family, seen]);
  const [ticked, setTicked] = useState(null);       // null: all of them
  const [types, setTypes] = useState(null);         // Naitiri's unit types: null for all of them
  const naitiri = Array.isArray(ticked) && ticked.includes('NAITIRI');
  const runs = useMemo(
    () => (family ? familyRuns(family, ticked, (c) => seen.has(c)) : [{ code, unit: null }]),
    [family, ticked, seen, code],
  );
  const picked = useMemo(() => runs.map((r) => r.code), [runs]);

  // This organisation's id is known; the rest are looked up once
  const ids = useRef(new Map());
  const orgIdOf = async (c) => {
    if (c === code) return orgId;
    if (!ids.current.has(c)) {
      const company = seen.get(c);
      ids.current.set(c, company ? await resolveOrgId(company.id) : null);
    }
    return ids.current.get(c);
  };

  const nameOf = (c) => (c === code ? companyName ?? code : seen.get(c)?.name ?? c);
  /** Is this unit, by its name, on the report when read from organisation `c`? A site is part of its organisation. */
  const keepUnit = (c, name) => {
    const unit = runs.find((r) => r.code === c)?.unit;
    if (unit && !unit.test(String(name ?? ''))) return false;
    // Naitiri's types sort West Kenya's own units only: a Sukari unit keeps its place
    return !naitiri || c !== family?.home || keptByKind(ticked, types, [name]);
  };
  /** What the report calls its fleet: the organisation, the family when all of it, or the names. */
  // Naitiri's options alone: the report is Naitiri's, not West Kenya's (operator, 12 Nov 2026)
  const pickedWords = !family ? companyName ?? code
    : ticked == null ? family.name
      : siteFleet(ticked) ?? members.filter((m) => ticked.includes(m.key)).map((m) => m.label).join(', ');

  /** The unit's kind from the client's lists when a Naitiri option is picked, else null (lib/siteLists siteKind). */
  const kindOf = (name) => siteKind(ticked, name);

  /** Props for a CheckPicker; null when there is nothing to pick. */
  const picker = family ? {
    icon: 'ti-building', label: 'Organisations', noun: 'organisations', allWord: family.name, minOne: true,
    options: members.map((m) => ({ value: m.key, label: m.label })),
    picked: ticked,
    onChange: setTicked,
  } : null;

  /** Naitiri's unit types (Trucks, Tractors…), shown while Naitiri is ticked: its trucks are Naitiri and Trucks. */
  const typePicker = naitiri ? kindPicker(types, setTypes) : null;

  return { code, family, picked, several: picked.length > 1, orgIdOf, nameOf, keepUnit, kindOf, pickedWords, picker, typePicker };
}
