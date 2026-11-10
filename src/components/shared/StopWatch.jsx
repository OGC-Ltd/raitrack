/*
 * The stop watch's list for the Alerts page. Since 10 Nov 2026 the server
 * decides which of Menengai's units stand in a no-go zone or outside every
 * authorised place (fleet-server modules/stop-watch), once for everybody, and
 * toasts each new one down the live stream (components/shared/ToastStack).
 * This only reads what is flagged now, every CHECK_MS while the platform is
 * open, into the shared store (hooks/useStopWatch). Nothing runs for a user
 * who does not hold Menengai.
 */

import { useEffect } from 'react';
import { useCompanies } from '../../context/AppContext';
import { resolveOrgId } from '../../api/org';
import { apiFetch } from '../../services/api';
import { setStopWatch } from '../../hooks/useStopWatch';

export const CHECK_MS = 60_000;

export default function StopWatch() {
  const { companies } = useCompanies();
  const holds = companies.some((c) => c.id === 'menengai');

  useEffect(() => {
    if (!holds) { setStopWatch({ status: 'off', flags: [] }); return undefined; }
    let live = true;
    let timer = null;
    const check = async () => {
      try {
        const orgId = await resolveOrgId('menengai');
        if (!orgId) throw new Error('Menengai is not on this account');
        const { data } = await apiFetch(`/api/v1/organisations/${orgId}/stop-watch`);
        if (!live) return;
        setStopWatch({
          status: data?.status === 'error' ? 'error' : data?.status === 'loading' ? 'loading' : 'done',
          flags: Array.isArray(data?.flags) ? data.flags : [],
          checkedAt: data?.checkedAt ?? Date.now(),
          message: data?.message ?? null,
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
  }, [holds]);

  return null;
}
