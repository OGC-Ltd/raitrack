// One vehicle's fuel ledger for one fleet day — its drains and fillings, as
// the server judged them — for the fuel chart's event bands (lib/fuelEpisodes)
// and the FUEL RATE / FUEL DOWN summary under it (lib/fuelRateSummary).
//
// The same two list endpoints the fuel tab reads for the whole fleet, filtered
// to the unit: two small requests rather than the fleet's day. A finished day
// never changes, so it is kept for the session; today is re-read every few
// minutes while the chart is open, since the adjudicator judges drains every
// quarter hour.

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/api';
import { dayBounds } from '../lib/vehicleDay';
import { fuelEpisodes, levelsFromPings } from '../lib/fuelEpisodes';
import { fleetDayKey } from './useFuelEvents';

const TODAY_REFRESH_MS = 5 * 60_000;
const EMPTY = { drains: [], fillings: [], loading: false, error: null };
const cache = new Map();   // `${org}|${vehicle}|${day}` -> { drains, fillings }

export function useVehicleFuelEvents(orgId, vehicleId, dayKey) {
  const key = orgId && vehicleId && dayKey ? `${orgId}|${vehicleId}|${dayKey}` : null;
  const [state, setState] = useState(() => {
    const held = key ? cache.get(key) : null;
    return held ? { ...held, loading: false, error: null } : { ...EMPTY, loading: Boolean(key) };
  });

  useEffect(() => {
    if (!key) { setState(EMPTY); return undefined; }
    const held = cache.get(key);
    if (held) { setState({ ...held, loading: false, error: null }); return undefined; }

    const isToday = dayKey === fleetDayKey();
    const { start, end } = dayBounds(dayKey);
    const q = `vehicleId=${encodeURIComponent(vehicleId)}&from=${new Date(start).toISOString()}`
      + `&to=${new Date(end).toISOString()}&limit=200`;
    let ctrl = null;

    const load = () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const { signal } = ctrl;
      Promise.all([
        apiFetch(`/api/v1/organisations/${orgId}/fuel/thefts?${q}`, { signal }),
        apiFetch(`/api/v1/organisations/${orgId}/fuel/fillings?${q}`, { signal }),
      ]).then(([d, f]) => {
        if (signal.aborted) return;
        const got = { drains: d?.data ?? [], fillings: f?.data ?? [] };
        if (!isToday) cache.set(key, got);
        setState({ ...got, loading: false, error: null });
      }).catch(err => {
        if (err?.name === 'AbortError' || signal.aborted) return;
        setState(s => ({ ...s, loading: false, error: err?.message ?? 'Could not load the fuel events' }));
      });
    };

    setState(s => ({ ...s, loading: true, error: null }));
    load();
    const timer = isToday ? setInterval(load, TODAY_REFRESH_MS) : null;
    return () => { ctrl?.abort(); if (timer) clearInterval(timer); };
  }, [key, orgId, vehicleId, dayKey]);

  return state;
}

/**
 * The day's events placed on its tank line and numbered (lib/fuelEpisodes).
 * Worked out once by the panel and handed to both the chart and the FUEL RATE
 * / FUEL DOWN summary under it, so the numbers the two show are the same ones.
 */
export function useFuelEpisodes(drains, fillings, pings) {
  return useMemo(
    () => fuelEpisodes({ drains, fillings, levels: levelsFromPings(pings) }),
    [drains, fillings, pings],
  );
}
