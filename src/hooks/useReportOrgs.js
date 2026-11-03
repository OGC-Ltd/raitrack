// The organisations a templated report is made for (lib/reportTemplates):
// this one by default, or, where it is one of a family (West Kenya: West
// Sugar, Kabras, Nzoia), any of the family this user can see, ticked
// together (operator, 3 Nov 2026: "each organization have its report but in
// case we want all then we can generate it").
//
// Shared by the Geofence and Dormant Assets reports.

import { useMemo, useRef, useState } from 'react';
import { useCompanies } from '../context/AppContext';
import { ORG_CODE_BY_COMPANY, resolveOrgId } from '../api/org';
import { familyOf } from '../lib/reportTemplates';

const codeOf = (company) => ORG_CODE_BY_COMPANY[company?.id] ?? String(company?.id ?? '').toUpperCase();

export function useReportOrgs(reportKey, { orgId, orgCode, companyName }) {
  const { companies = [] } = useCompanies();
  const code = String(orgCode ?? '').toUpperCase();
  const family = familyOf(reportKey, code);
  // The family's organisations this user can see, this one first
  const mates = useMemo(() => {
    const own = { code, name: companyName ?? code, companyId: null };
    const others = family
      ? companies.map((c) => ({ code: codeOf(c), name: c.name, companyId: c.id })).filter((c) => c.code !== code && family.orgs.includes(c.code))
      : [];
    return [own, ...others];
  }, [companies, code, companyName, family]);
  const [orgs, setOrgs] = useState(null);           // null: this organisation alone
  const picked = orgs ?? [code];

  // This organisation's id is known; the rest are looked up once
  const ids = useRef(new Map());
  const orgIdOf = async (c) => {
    if (c === code) return orgId;
    if (!ids.current.has(c)) {
      const mate = mates.find((m) => m.code === c);
      ids.current.set(c, mate ? await resolveOrgId(mate.companyId) : null);
    }
    return ids.current.get(c);
  };

  const nameOf = (c) => mates.find((m) => m.code === c)?.name ?? c;
  /** What the report calls its fleet: the organisation, the family when all of it, or the names. */
  const fleetWords = (list) => (list.length > 1
    ? (family && family.orgs.every((o) => list.includes(o) || !mates.some((m) => m.code === o)) ? family.name : list.map(nameOf).join(', '))
    : companyName ?? code);

  /** Props for a CheckPicker of the organisations; null when there is nothing to pick. */
  const picker = mates.length > 1 ? {
    icon: 'ti-building', label: 'Organisations', noun: 'organisations', allWord: family?.name ?? 'All', minOne: true,
    options: mates.map((m) => ({ value: m.code, label: m.name })),
    picked,
    onChange: (v) => setOrgs(v == null ? mates.map((m) => m.code) : v.length === 1 && v[0] === code ? null : v),
  } : null;

  return { code, family, mates, picked, several: picked.length > 1, orgIdOf, nameOf, fleetWords, picker };
}
