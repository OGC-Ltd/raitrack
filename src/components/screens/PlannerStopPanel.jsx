/**
 * One customer on a plan, opened from its row (operator, 11 Nov 2026: "a side
 * panel pop, with more info, the geocodes, location, load, tonnage, and a map
 * with a playable route for the unit to that client and the geofence").
 *
 * The app's detail sidebar (shared/DetailSidebar, as the Alerts page opens an
 * alert): another row swaps the customer in place, × or Esc closes it, the
 * plan stays usable beside it, at the panel's standard width.
 *
 * The map is the panel's own small Leaflet map (lib/mapEngine, OSM base, as
 * the Fuel Report draws one): the customer's fence, the truck's drive to it,
 * from the stop it left before (or home) to leaving this one. Under it, the
 * leg's speed: pointing along that line moves the truck on the map to that
 * moment, as on the Fuel Report.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadMapEngine, maps as mapsNs } from '../../lib/mapEngine';
import { installOsmBase, OSM_TYPE_ID } from '../../lib/osmBase';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { spriteIcon, bearingDeg } from '../../lib/fleetSprite';
import { spriteKind } from '../../lib/vehicleMap';
import { pathOf, middleOfPath } from '../../lib/planOverlay';
import { copyText, formatCoords } from '../../lib/copyText';
import { fenceOf, spanWords, clockWords, kmWords, OUTCOMES } from '../../lib/plannerActual';
import DetailSidebar, { DetailSidebarFacts, DetailSidebarIdent, DetailSidebarSection } from '../shared/DetailSidebar';
import './PlannerStopPanel.css';

const GAP_MS = 5 * 60_000;
const TAIL_MS = 10 * 60_000;
const money = (n) => (Number.isFinite(n) ? n.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : '-');
const tons = (n) => (Number.isFinite(n) ? `${n.toLocaleString('en-GB', { maximumFractionDigits: 3 })} t` : '-');
const ord = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const HM = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Nairobi' });
const HMS = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Nairobi' });

/**
 * The leg to this customer: from leaving the stop visited before it in time
 * (or leaving home) to leaving this one; a stop not reached gets the whole run.
 * Points carry their heading and a gap mark, as the playback clock reads them.
 */
export function legTo(stopId, track, actual, window_) {
  if (!track?.length || !actual?.telemetry) return { points: [], from: null, kind: 'none' };
  const me = actual.stops.find((s) => s.id === stopId);
  let a; let b; let from; let kind;
  if (me?.at != null) {
    const before = actual.stops.filter((s) => s.at != null && s.at < me.at).sort((x, y) => y.at - x.at)[0];
    a = before?.leftAt ?? before?.at ?? actual.leftAt ?? window_.from;
    from = before ? { stopId: before.id } : { home: true };
    b = me.leftAt ?? me.at + TAIL_MS;
    kind = 'leg';
  } else {
    a = actual.leftAt ?? window_.from;
    b = actual.backAt ?? window_.to;
    from = { home: true };
    kind = 'run';
  }
  const raw = track.filter((p) => p.t >= a && p.t <= b && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat !== 0);
  let heading = 0;
  const points = raw.map((p, i) => {
    const next = raw[i + 1];
    if (next && (next.lat !== p.lat || next.lng !== p.lng)) heading = bearingDeg(p, next);
    const speed = p.speedKmh ?? p.speed ?? null;
    return { t: p.t, lat: p.lat, lng: p.lng, heading, speed, moving: (speed ?? 0) >= 5, gapBefore: i > 0 && p.t - raw[i - 1].t > GAP_MS };
  });
  return { points, from, kind };
}

function LegMap({ fence, points, vehicle, label, n }) {
  const el = useRef(null);
  const map = useRef(null);
  const drawn = useRef({ static: [], unit: null });
  const [state, setState] = useState('loading');
  const [cursor, setCursor] = useState(null);
  const kind = spriteKind(vehicle ?? {});

  useEffect(() => {
    let alive = true;
    loadMapEngine()
      .then((maps) => {
        if (!alive || !el.current || map.current) return;
        map.current = new maps.Map(el.current, { center: { lat: -0.3, lng: 36.1 }, zoom: 12, zoomControl: true, fullscreenControl: true });
        installOsmBase(maps, map.current);
        map.current.setMapTypeId(OSM_TYPE_ID);
        setState('ready');
      })
      .catch(() => alive && setState('failed'));
    return () => { alive = false; };
  }, []);

  // The fence with its number, the leg and where it starts; framed on both.
  useEffect(() => {
    const m = map.current; const maps = mapsNs;
    if (state !== 'ready' || !m || !maps) return;
    const d = drawn.current;
    d.static.forEach((x) => x.setMap(null));
    d.static = [];
    const css = getComputedStyle(el.current);
    const tok = (k) => css.getPropertyValue(k).trim();
    const ring = pathOf(fence);
    if (ring) d.static.push(new maps.Polygon({ map: m, paths: ring, strokeColor: tok('--psp-fence'), strokeWeight: 2, fillColor: tok('--psp-fence'), fillOpacity: 0.18, zIndex: 10 }));
    // The customer's number on its fence, so a 100 m circle still reads when
    // the leg is framed kilometres wide.
    const mid = middleOfPath(fence, ring);
    if (mid && Number.isFinite(mid.lat)) {
      d.static.push(new maps.Marker({
        map: m, position: mid, zIndex: 40, title: fence?.properties?.name ?? label,
        label: { text: String(n), color: tok('--psp-halo'), fontSize: '11px', fontWeight: '700' },
        icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: tok('--psp-fence'), fillOpacity: 1, strokeColor: tok('--psp-halo'), strokeWeight: 2 },
      }));
    }
    const path = points.map((p) => ({ lat: p.lat, lng: p.lng }));
    if (path.length > 1) {
      d.static.push(new maps.Polyline({ map: m, path, strokeColor: tok('--psp-trail'), strokeOpacity: 0.9, strokeWeight: 4, zIndex: 20 }));
      d.static.push(new maps.Marker({
        map: m, position: path[0], zIndex: 30, title: 'Where the leg starts',
        icon: { path: maps.SymbolPath.CIRCLE, scale: 6, fillColor: tok('--psp-start'), fillOpacity: 1, strokeColor: tok('--psp-halo'), strokeWeight: 2 },
      }));
    }
    const b = new maps.LatLngBounds();
    [...(ring ?? []), ...path].forEach((p) => b.extend(p));
    if (!b.isEmpty()) m.fitBounds(b, 36);
  }, [state, fence, points, label, n]);

  // Where the trace's crosshair is, on the map, as the Fuel Report does: the
  // unit as the live map draws it, green while it moves, the idling blue
  // while it stands, turned the way it was heading.
  useEffect(() => {
    const m = map.current; const maps = mapsNs;
    if (state !== 'ready' || !m || !maps) return;
    const d = drawn.current;
    if (!cursor) { d.unit?.setMap(null); return; }
    if (!d.unit) d.unit = new maps.Marker({ zIndex: 999, clickable: false });
    d.unit.setIcon(spriteIcon(maps, kind, { heading: cursor.heading, status: cursor.moving ? 'ok' : 'idling', px: 36 }));
    d.unit.setPosition({ lat: cursor.lat, lng: cursor.lng });
    d.unit.setMap(m);
  }, [state, cursor, kind]);

  const has = points.length > 1;
  const data = useMemo(() => points.map((p) => ({ ...p, kmh: Number.isFinite(p.speed) ? p.speed : null })), [points]);
  return (
    <div className="psp-map">
      <div className="psp-map__canvas" ref={el} aria-label={`Map of the drive to ${label}`} role="img" />
      {state === 'failed' && <p className="psp-map__note">The map could not load.</p>}
      {has && (
        <div className="psp-trace">
          <div className="psp-trace__read">
            {cursor
              ? <><b>{HMS.format(cursor.t)}</b><span>{Number.isFinite(cursor.speed) ? `${Math.round(cursor.speed)} km/h` : 'Speed not reported'}</span><span>{cursor.moving ? 'Moving' : 'Standing'}</span></>
              : <span>Point along the speed line to see where the truck was</span>}
          </div>
          <div className="psp-trace__plot">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                         onMouseMove={(e) => {
                           const i = Number(e?.activeTooltipIndex ?? e?.activeIndex);
                           setCursor(Number.isInteger(i) ? data[i] ?? null : null);
                         }}
                         onMouseLeave={() => setCursor(null)}>
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t) => HM.format(t)} tick={{ fontSize: 10 }} minTickGap={36} />
                <YAxis tick={{ fontSize: 10 }} width={28} />
                <Tooltip content={() => null} cursor={{ stroke: 'var(--sp4-text-3)', strokeWidth: 1 }} />
                <Area type="stepAfter" dataKey="kmh" stroke="var(--psp-trail)" fill="var(--psp-trail)" fillOpacity={0.12} strokeWidth={1.5} isAnimationActive={false} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyCoords({ lat, lng }) {
  const [done, setDone] = useState(null);
  useEffect(() => { if (!done) return undefined; const t = setTimeout(() => setDone(null), 1600); return () => clearTimeout(t); }, [done]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return <span>-</span>;
  const text = formatCoords(lat, lng);
  return (
    <span className="psp-coords">
      <span>{text}</span>
      <button type="button" className="psp-icon-btn" aria-label={done === 'ok' ? 'Copied' : 'Copy the coordinates'} title={done === 'ok' ? 'Copied' : 'Copy'}
              onClick={async () => setDone((await copyText(text)) ? 'ok' : 'no')}>
        <i className={`ti ${done === 'ok' ? 'ti-check' : done === 'no' ? 'ti-alert-triangle' : 'ti-copy'}`} aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * @param {object} props
 * @param {object} props.plan, stop        the plan and the stop opened
 * @param {object} props.actual            planActual's answer, or null
 * @param {Array}  props.track             the run's readings (the main tracker)
 * @param {object} props.window_           planWindow
 * @param {Map}    props.zonesById
 * @param {object} [props.vehicle]         the live unit, for its sprite
 */
export default function PlannerStopPanel({ plan, stop, actual, track, window_, zonesById, vehicle, homeLabel,
  canWrite, canMap, canFence, onOutcome, RemarkInput, onClose, onShowOnMap, onFence }) {
  const a = actual?.stops.find((s) => s.id === stop.id) ?? {};
  const c = stop.customer;
  const fence = useMemo(() => fenceOf(c, zonesById), [c, zonesById]);
  const leg = useMemo(() => legTo(stop.id, track, actual, window_), [stop.id, track, actual, window_]);
  const fromWords = leg.from?.stopId
    ? (() => { const p = plan.stops.find((s) => s.id === leg.from.stopId); return p ? `${p.sequence}. ${p.customer.name}` : 'the stop before'; })()
    : homeLabel;
  const own = !c.geofenceId || zonesById.get(c.geofenceId) == null;
  const fenceName = zonesById.get(c.geofenceId)?.properties?.name ?? c.name;

  const reached = a.at != null;
  const tone = reached ? 'ok' : actual?.telemetry ? 'crit' : 'new';
  const status = reached ? 'Reached' : !actual?.telemetry ? 'No telemetry' : a.reachedAt != null ? 'Passed, did not stop' : 'Not reached';
  const osm = Number.isFinite(c.lat) ? `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=17/${c.lat}/${c.lng}` : null;

  return (
    <DetailSidebar
      title={`Stop ${stop.sequence} of ${plan.stops.length}`}
      label={`${c.name}, stop ${stop.sequence}`}
      itemKey={stop.id}

      onClose={onClose}
      footer={(
        <>
          {osm && (
            <a className="sp4-ghost-btn" href={osm} target="_blank" rel="noreferrer noopener">
              <i className="ti ti-external-link" aria-hidden="true" /> OpenStreetMap
            </a>
          )}
          {canFence && (
            <button type="button" className="sp4-ghost-btn" onClick={onFence}><i className="ti ti-pencil" aria-hidden="true" /> Redraw fence</button>
          )}
          {canMap && (
            <button type="button" className="sp4-ghost-btn" onClick={onShowOnMap}><i className="ti ti-map-2" aria-hidden="true" /> Show on Live Map</button>
          )}
        </>
      )}
    >
      <DetailSidebarIdent
        kind={<span className={`pl-tag pl-tag--${tone}`}>{status}</span>}
        name={c.name}
        nameTitle={c.name}
        sub={[c.code, stop.rep && `Rep ${stop.rep}`, c.location].filter(Boolean).join(', ')}
      />

      <DetailSidebarFacts facts={[
        { label: 'Arrived', value: reached ? clockWords(a.at) : '-' },
        { label: 'Time there', value: a.stayMs != null ? spanWords(a.stayMs) : reached ? 'Still there' : '-' },
        { label: 'Km driven to it', value: kmWords(a.kmFromPrev) },
      ]} />

      <DetailSidebarSection title="The drive">
        <p className="psp-lede">
          {leg.kind === 'leg' ? <>From {fromWords} to {c.name}{a.visit != null && a.visit !== stop.sequence ? `, visited ${ord(a.visit)}` : ''}.</>
            : leg.kind === 'run' ? <>Not reached: the whole run is shown{a.nearestM != null ? `; closest ${kmWords(a.nearestM / 1000)} away` : ''}.</>
              : <>No telemetry for this truck on the day: the fence alone.</>}
        </p>
        <LegMap fence={fence} points={leg.points} vehicle={vehicle} label={plan.plate} n={stop.sequence} />
      </DetailSidebarSection>

      <DetailSidebarSection title="Delivery">
        <dl className="psp-list">
          <div><dt>Invoice</dt><dd>{stop.invoiceNo || '-'}</dd></div>
          <div><dt>Amount</dt><dd>{money(stop.amount)}</dd></div>
          <div><dt>Load</dt><dd>{tons(stop.tonnage)}</dd></div>
          <div><dt>Outcome</dt><dd>
            <div className="pl-seg" role="group" aria-label={`Outcome at ${c.name}`}>
              {OUTCOMES.map((o) => (
                <button key={o.id} type="button" disabled={!canWrite}
                        className={`pl-seg__btn pl-seg__btn--${o.id.toLowerCase()}${stop.outcome === o.id ? ' is-on' : ''}`}
                        aria-pressed={stop.outcome === o.id}
                        onClick={() => onOutcome({ outcome: stop.outcome === o.id ? null : o.id })}>{o.label}</button>
              ))}
            </div>
          </dd></div>
          <div><dt>Remarks</dt><dd><RemarkInput value={stop.remarks} disabled={!canWrite} onSave={(remarks) => onOutcome({ remarks })} label={`Remarks for ${c.name}`} /></dd></div>
        </dl>
      </DetailSidebarSection>

      <DetailSidebarSection title="Place">
        <dl className="psp-list">
          <div><dt>Location</dt><dd>{c.location || '-'}</dd></div>
          <div><dt>Coordinates</dt><dd><CopyCoords lat={c.lat} lng={c.lng} /></dd></div>
          <div><dt>Geofence</dt><dd>{own ? 'A 100 m circle at the point (not loaded yet)' : fenceName}</dd></div>
          <div><dt>Customer ID</dt><dd>{c.code}</dd></div>
        </dl>
      </DetailSidebarSection>
    </DetailSidebar>
  );
}
