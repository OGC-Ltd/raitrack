/*
 * The stop watch (lib/stopWatch): mounted once for the whole app, it reads
 * Menengai's fleet every CHECK_MS while the platform is open, in any page or a
 * background tab, and flags units standing in a no-go zone or stopped outside
 * every authorised place. Each new one pops up here, with a sound and, once
 * allowed, a browser notification; the Alerts page lists those flagged now.
 * Nothing runs for a user who does not hold Menengai.
 */

import { useEffect, useRef, useState } from 'react';
import { useAppActions, useCompanies } from '../../context/AppContext';
import { resolveOrgId } from '../../api/org';
import { fetchSnapshot } from '../../services/snapshot';
import { mapSnapshotVehicle } from '../../lib/vehicleMap';
import { loadZones } from '../../hooks/useEstateZones';
import { AUTHORISED, NO_GO } from '../../data/menengaiStopPlaces';
import { desktopAlertsOn, flaggedUnits, placesOf, flagWords, nearestWords, stopCopyText } from '../../lib/stopWatch';
import { copyText } from '../../lib/copyText';
import { cachedPlaceName } from '../../hooks/usePlaceName';
import { setStopWatch, requestStopsView } from '../../hooks/useStopWatch';
import './StopWatch.css';

export const CHECK_MS = 60_000;
const ZONES_MS = 60 * 60_000;
const ALERTED = 'ft-stopwatch-alerted-v1';
const KEEP_MS = 24 * 3_600_000;

function alerted() {
  try {
    const all = JSON.parse(localStorage.getItem(ALERTED) ?? '{}');
    const fresh = Date.now() - KEEP_MS;
    return new Map(Object.entries(all).filter(([, at]) => at > fresh));
  } catch { return new Map(); }
}
function remember(map) {
  try { localStorage.setItem(ALERTED, JSON.stringify(Object.fromEntries(map))); } catch { /* blocked: this session only */ }
}

let audio = null;
function beep() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.6);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.65);
  } catch { /* no sound in this browser */ }
}
function notify(text) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && desktopAlertsOn()) {
      new Notification('Menengai: unauthorised stop', { body: text, tag: text });
    }
  } catch { /* not allowed here */ }
}

/**
 * Copy the stop, beside Open (operator, 7 Nov 2026): the same text the Alerts
 * page copies, to paste into a chat. The icon turns to a tick, or a warning
 * when the browser refused, then back.
 */
function CopyStop({ text, plate }) {
  const [state, setState] = useState('idle');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onCopy = async () => {
    const ok = await copyText(text());
    setState(ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), ok ? 1600 : 2600);
  };
  const words = state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : `Copy the ${plate} stop`;
  return (
    <button type="button" className={`stw-pop__copy stw-pop__copy--${state}`} onClick={onCopy} title={words} aria-label={words}>
      <i className={`ti ${state === 'copied' ? 'ti-check' : state === 'failed' ? 'ti-alert-triangle' : 'ti-copy'}`} aria-hidden="true" />
    </button>
  );
}

export default function StopWatch() {
  const { companies } = useCompanies();
  const { setDesktopActiveTab } = useAppActions();
  const holds = companies.some((c) => c.id === 'menengai');
  const [pops, setPops] = useState([]);           // the new ones, newest first
  const seen = useRef(alerted());
  const zones = useRef({ at: 0, places: [] });
  const places = useRef([]);          // every authorised place, for the copy's nearest one

  useEffect(() => {
    if (!holds) { setStopWatch({ status: 'off', flags: [] }); return undefined; }
    let live = true;
    let timer = null;
    const noGo = placesOf(NO_GO);
    const fromFile = placesOf(AUTHORISED);
    const check = async () => {
      try {
        const orgId = await resolveOrgId('menengai');
        if (!orgId) throw new Error('Menengai is not on this account');
        if (Date.now() - zones.current.at > ZONES_MS) {
          // Menengai's own geofences (its customers and yards) are authorised places too
          const fc = await loadZones(orgId).catch(() => null);
          if (fc) zones.current = { at: Date.now(), places: placesOf(fc.features) };
        }
        const snap = await fetchSnapshot(orgId);
        if (!live) return;
        const fleet = (Array.isArray(snap?.data) ? snap.data : []).map(mapSnapshotVehicle);
        const now = Date.now();
        places.current = [...fromFile, ...zones.current.places];
        const flags = flaggedUnits(fleet, { authorised: places.current, noGo, now });
        const fresh = flags.filter((f) => !seen.current.has(f.key));
        for (const f of fresh) seen.current.set(f.key, now);
        if (fresh.length) {
          remember(seen.current);
          setPops((p) => [...fresh.map((f) => ({ ...f, text: flagWords(f, now) })), ...p].slice(0, 4));
          beep();
          for (const f of fresh.slice(0, 3)) notify(flagWords(f, now));
        }
        setStopWatch({ status: 'done', flags, checkedAt: now, message: null });
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

  if (!pops.length) return null;
  const copyOf = (p) => stopCopyText(p, { now: Date.now(), area: cachedPlaceName(p.lat, p.lng), place: nearestWords(p, places.current) });
  return (
    <div className="stw-pops" role="region" aria-label="Unauthorised stops">
      {pops.map((p) => (
        <div key={p.key} className={`stw-pop stw-pop--${p.kind}`} role="alert">
          <span className="stw-pop__mark" aria-hidden="true">
            <i className={`ti ${p.kind === 'nogo' ? 'ti-hand-stop' : 'ti-map-pin-exclamation'}`} />
          </span>
          <div className="stw-pop__text">
            <b>{p.kind === 'nogo' ? 'No-go zone' : 'Unauthorised stop'}</b>
            <span>{p.text}</span>
          </div>
          <div className="stw-pop__acts">
            <CopyStop text={() => copyOf(p)} plate={p.plate} />
            <button type="button" className="stw-pop__open" onClick={() => { setDesktopActiveTab('alerts'); requestStopsView(); setPops((x) => x.filter((y) => y.key !== p.key)); }}>Open</button>
            <button type="button" className="stw-pop__x" aria-label="Dismiss" onClick={() => setPops((x) => x.filter((y) => y.key !== p.key))}>{"\u2715"}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
