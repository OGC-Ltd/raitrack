/*
 * The stop watch's list for the Alerts page. Since 10 Nov 2026 the server
 * decides which units stand in a no-go zone or outside every authorised place
 * (fleet-server modules/stop-watch), once for everybody, and toasts each new
 * one down the live stream (components/shared/ToastStack). This only reads what
 * is flagged now, every CHECK_MS while the platform is open, into the shared
 * store (hooks/useStopWatch): Menengai's, and since 19 Nov 2026 West Kenya's
 * (West Kenya, Kabras and Nzoia: trucks and prime movers stopped 5 minutes off
 * site or weighbridge), for each of them the person holds, as one list.
 * Nothing runs for a user who holds none of them.
 */

import { useEffect, useMemo } from 'react';
import { useCompanies } from '../../context/AppContext';
import { resolveOrgId } from '../../api/org';
import { apiFetch } from '../../services/api';
import { setStopWatch } from '../../hooks/useStopWatch';

export const CHECK_MS = 60_000;

/** The companies the server watches (company ids, as AppContext holds them). */
export const WATCHED = ['menengai', 'westsugar', 'kabras', 'nzoia'];

export default function StopWatch() {
  const { companies } = useCompanies();
  const held = useMemo(() => WATCHED.filter((id) => companies.some((c) => c.id === id)), [companies]);
  const key = held.join(',');

  useEffect(() => {
    if (!held.length) { setStopWatch({ status: 'off', flags: [] }); return undefined; }
    let live = true;
    let timer = null;
    const check = async () => {
      try {
        const answers = await Promise.all(held.map(async (id) => {
          const orgId = await resolveOrgId(id);
          if (!orgId) return null;
          const { data } = await apiFetch(`/api/v1/organisations/${orgId}/stop-watch`);
          return data ?? null;
        }));
        if (!live) return;
        const on = answers.filter((a) => a && a.status !== 'off');
        const flags = on.flatMap((a) => (Array.isArray(a.flags) ? a.flags : [])).sort((a, b) => b.since - a.since);
        const failed = on.find((a) => a.status === 'error');
        setStopWatch({
          status: on.length === 0 ? 'off' : on.every((a) => a.status === 'loading') ? 'loading' : failed && on.length === 1 ? 'error' : 'done',
          flags,
          checkedAt: Math.max(...on.map((a) => a.checkedAt ?? 0), 0) || Date.now(),
          message: failed?.message ?? null,
        });
      } catch (err) {
        if (live) setStopWatch({ status: 'error', message: err?.message ?? String(err), checkedAt: Date.now() });
      } finally {
        if (live) timer = setTimeout(check, CHECK_MS);
      }
    };
    setStopWatch({ status: 'loading' });
    check();
    return () => { live = false; clearTimeout(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
