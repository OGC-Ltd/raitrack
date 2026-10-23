// Dashcam Alarms — the Alarms tab under Live Map, for organisations whose
// vehicles carry Control Tech (VSS) cameras. usePermissions grants the tab
// ('vss:alarms') only where the backend reports at least one camera.
//
// Layout (operator's choice, mockup A): the alarms on the left, the selected
// one's clip or snapshot, its details and a small map on the right.
//
// Data: api/vssAlarms — the backend searches VSS for the organisation's
// alarms that came with evidence, and serves each clip and snapshot through
// its own file route (seeking supported), so no VSS link or token ever reaches
// the browser. A file that fails says why. "Reviewed" marks are kept in this
// browser only (lib/dashcamReviewed); the button says so.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppSelector, useAppActions, useCompanies } from '../../context/AppContext'
import { useFleetLiveShared } from '../../context/FleetLiveContext'
import { usePlaceName } from '../../hooks/usePlaceName'
import { CATEGORIES, RANGES } from '../../lib/dashcamIncidents'
import { vssIncidentsQuery, ensureVssSession } from '../../api/vssAlarms'
import { useDashcamReviewed } from '../../lib/dashcamReviewed'
import { diagnoseMedia } from '../../lib/mediaDiagnose'
import './DashcamIncidentsScreen.css'

const UPLOAD_GRACE_MS = 15 * 60_000     // a clip younger than this may still be uploading
const NONE = []

// ── small helpers ───────────────────────────────────────────────────────────

const two = (n) => String(n).padStart(2, '0')
const clock = (ms) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}` }
const clockSec = (ms) => { const d = new Date(ms); return `${clock(ms)}:${two(d.getSeconds())}` }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
function whenLabel(ms) {
  if (ms == null) return '—'
  const d = new Date(ms), now = new Date()
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (sameDay(d, now)) return `Today ${clockSec(ms)}`
  if (sameDay(d, y)) return `Yesterday ${clockSec(ms)}`
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${clockSec(ms)}`
}
function rowTime(ms) {
  if (ms == null) return ''
  const d = new Date(ms)
  return sameDay(d, new Date()) ? clock(ms) : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${clock(ms)}`
}
const SEVERITY_WORD = { critical: 'CRITICAL', warning: 'WARNING', informational: 'INFO' }

/** Everything the alarm carries to look at: clips first, then snapshots. */
function mediaOf(inc) {
  const videos = (inc.videos ?? []).map((v) => ({ ...v, kind: 'video' }))
  const photos = (inc.photos ?? []).map((p, i, all) => ({
    ...p, kind: 'photo',
    label: videos.length || all.length > 1 ? `Snapshot · ${p.label}` : 'Snapshot',
  }))
  return [...videos, ...photos]
}

// ── the screen ──────────────────────────────────────────────────────────────

export default function DashcamIncidentsScreen() {
  const companyId = useAppSelector((a) => a.activeCompanyId)
  const { activeCompany } = useCompanies()
  const company = activeCompany?.name || 'this organisation'
  const { setSelectedVehicleId, setPendingFocusId, setMobileActiveTab, setDesktopActiveTab } = useAppActions()
  const { vehicles = [], orgId } = useFleetLiveShared()

  const [range, setRange] = useState('today')
  const [category, setCategory] = useState('all')
  const [truck, setTruck] = useState('all')
  const [hideReviewed, setHideReviewed] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  // Shared with the tab's badge (hooks/useVssBadge): a mark here lowers it at once.
  const [reviewed, toggleReviewed] = useDashcamReviewed(`vss:${companyId}`)

  // A different organisation is a different inbox.
  useEffect(() => { setTruck('all'); setSelectedId(null); setCategory('all') }, [orgId])

  const q = useQuery({
    ...vssIncidentsQuery(orgId, range),
    placeholderData: keepPreviousData,
    retry: 1,
  })
  const all = useMemo(() => q.data ?? NONE, [q.data])

  const byVehicle = useMemo(() => new Map(vehicles.map((v) => [v.vehicleId, v])), [vehicles])
  // A big fleet: the truck picker offers only the trucks that raised something.
  const trucks = useMemo(() => {
    const seen = new Map()
    for (const i of all) {
      if (i.vehicleId && !seen.has(i.vehicleId)) seen.set(i.vehicleId, byVehicle.get(i.vehicleId)?.id ?? i.plate)
    }
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => String(a.label).localeCompare(String(b.label)))
  }, [all, byVehicle])

  // Range + truck + reviewed narrow the list; the chips count within that.
  const scoped = useMemo(
    () => all.filter((i) => (truck === 'all' || i.vehicleId === truck) && (!hideReviewed || !reviewed.has(i.id))),
    [all, truck, hideReviewed, reviewed],
  )
  const counts = useMemo(() => {
    const c = { all: scoped.length }
    for (const cat of CATEGORIES) c[cat.key] = 0
    for (const i of scoped) c[i.category] = (c[i.category] ?? 0) + 1
    return c
  }, [scoped])
  const list = useMemo(
    () => (category === 'all' ? scoped : scoped.filter((i) => i.category === category)),
    [scoped, category],
  )

  // Keep a selection: the first row when nothing (or something filtered away) is picked.
  const selected = list.find((i) => i.id === selectedId) ?? list[0] ?? null
  useEffect(() => { if (selected && selected.id !== selectedId) setSelectedId(selected.id) }, [selected, selectedId])

  const openOnMap = (inc) => {
    const v = byVehicle.get(inc.vehicleId)
    const plate = v?.id ?? inc.plate
    setSelectedVehicleId(plate)
    setPendingFocusId(plate)
    setMobileActiveTab('map')
    setDesktopActiveTab('fleet')
  }

  return (
    <div className="dci">
      <header className="dci-top">
        <h1 className="dci-title">Dashcam incidents</h1>
        <div className="dci-chips" role="group" aria-label="Kind of incident">
          <Chip on={category === 'all'} onClick={() => setCategory('all')}>All {counts.all}</Chip>
          {CATEGORIES.filter((c) => c.key !== 'other' || counts.other > 0).map((c) => (
            <Chip key={c.key} on={category === c.key} onClick={() => setCategory(c.key)}>{c.label} {counts[c.key]}</Chip>
          ))}
        </div>
        <div className="dci-filters">
          <label className="dci-check"><input type="checkbox" checked={hideReviewed} onChange={(e) => setHideReviewed(e.target.checked)} /> Hide reviewed</label>
          <select className="dci-select" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Time window">
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <select className="dci-select" value={truck} onChange={(e) => setTruck(e.target.value)} aria-label="Truck">
            <option value="all">All trucks</option>
            {trucks.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </header>

      <div className="dci-body">
        <section className={`dci-list${q.isPlaceholderData ? ' dci-list--stale' : ''}`} aria-label="Incidents">
          {q.isPending && <p className="dci-note">Reading {company}’s dashcam alarms…</p>}
          {q.isError && !all.length && (
            <div className="dci-note dci-note--err">
              Couldn’t read the alarms: {q.error?.message ?? 'unknown error'}
              <button type="button" className="dci-btn" onClick={() => q.refetch()}>Try again</button>
            </div>
          )}
          {!q.isPending && !q.isError && list.length === 0 && (
            <p className="dci-note">No dashcam incidents {category === 'all' ? '' : 'of this kind '}in this period.</p>
          )}
          {list.map((i) => (
            <IncidentRow key={i.id} inc={i} on={selected?.id === i.id} reviewed={reviewed.has(i.id)}
              driver={byVehicle.get(i.vehicleId)?.driver} plate={byVehicle.get(i.vehicleId)?.id ?? i.plate}
              onClick={() => setSelectedId(i.id)} />
          ))}
        </section>

        <section className="dci-detail" aria-label="Selected incident">
          {selected
            ? <Detail inc={selected} orgId={orgId} company={company} vehicle={byVehicle.get(selected.vehicleId)}
                reviewed={reviewed.has(selected.id)} onReviewed={() => toggleReviewed(selected.id)}
                onMap={() => openOnMap(selected)} onTruck={() => setTruck(selected.vehicleId)}
                truckFiltered={truck === selected.vehicleId} />
            : !q.isPending && <div className="dci-empty">Pick an incident to see its clip.</div>}
        </section>
      </div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return <button type="button" className={`dci-chip${on ? ' dci-chip--on' : ''}`} aria-pressed={on} onClick={onClick}>{children}</button>
}

function IncidentRow({ inc, on, reviewed, driver, plate, onClick }) {
  const sub = [plate, driver && driver !== 'Unassigned' ? driver : null,
    inc.speed != null ? `${inc.speed} km/h` : null].filter(Boolean).join(' · ')
  const fresh = inc.occurredMs != null && Date.now() - inc.occurredMs < UPLOAD_GRACE_MS
  return (
    <button type="button" className={`dci-row${on ? ' dci-row--on' : ''}${reviewed ? ' dci-row--done' : ''}`} onClick={onClick} aria-current={on || undefined}>
      <span className={`dci-ic dci-ic--${inc.severity}`} aria-hidden="true">{inc.initials}</span>
      <span className="dci-row__main">
        <span className="dci-row__t">{inc.label}{reviewed && <span className="dci-done">✓ Reviewed</span>}</span>
        <span className="dci-row__s">{sub}</span>
        {inc.hasClip
          ? <span className={`dci-clip${fresh ? ' dci-clip--fresh' : ''}`}>{fresh ? '◷ Clip may still be uploading' : '▶ Clip'}</span>
          : inc.hasPhoto && <span className="dci-clip">▣ Snapshot</span>}
      </span>
      <span className="dci-row__time">{rowTime(inc.occurredMs)}</span>
    </button>
  )
}

function Detail({ inc, orgId, company, vehicle, reviewed, onReviewed, onMap, onTruck, truckFiltered }) {
  const place = usePlaceName(inc.lat, inc.lng, { enabled: inc.lat != null && inc.lng != null })
  const where = place ?? (inc.lat != null ? `${inc.lat.toFixed(4)}, ${inc.lng.toFixed(4)}` : '—')
  const plate = vehicle?.id ?? inc.plate
  const model = vehicle?.name ? vehicle.name.replace(vehicle.id, '').trim() : ''
  const driver = vehicle?.driver && vehicle.driver !== 'Unassigned' ? vehicle.driver : null
  const items = mediaOf(inc)
  const [shownKey, setShownKey] = useState(items[0]?.key ?? null)
  useEffect(() => { setShownKey(mediaOf(inc)[0]?.key ?? null) }, [inc.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = items.find((m) => m.key === shownKey) ?? items[0] ?? null

  return (
    <div className="dci-detail__inner">
      {shown ? <MediaPlayer inc={inc} orgId={orgId} company={company} items={items} shown={shown} plate={plate} onPick={setShownKey} /> : (
        <div className="dci-novid">
          <b>No video for this alarm</b>
          <span>The camera didn’t attach a recording to this alarm.</span>
        </div>
      )}

      <div className="dci-info">
        <div className="dci-card">
          <div className="dci-card__head">
            <span className="dci-card__t">{inc.label}</span>
            <span className={`dci-sev dci-sev--${inc.severity}`}>{SEVERITY_WORD[inc.severity]}</span>
          </div>
          <dl className="dci-kv">
            <dt>Truck</dt><dd>{plate}{model ? ` · ${model}` : ''}</dd>
            <dt>Driver</dt><dd>{driver ?? <span className="dci-muted">Not assigned</span>}</dd>
            <dt>When</dt><dd>{whenLabel(inc.occurredMs)}</dd>
            {inc.speed != null && <><dt>Speed</dt><dd>{inc.speed} km/h</dd></>}
            <dt>Where</dt><dd>{where}</dd>
          </dl>
        </div>
        <MiniMap lat={inc.lat} lng={inc.lng} severity={inc.severity} />
      </div>

      <div className="dci-actions">
        <button type="button" className="dci-btn dci-btn--p" onClick={onMap}>Open on map</button>
        <button type="button" className="dci-btn" onClick={onTruck} disabled={truckFiltered}>
          {truckFiltered ? `Showing ${plate} only` : `All incidents for ${plate}`}
        </button>
        {shown?.download && (
          <a className="dci-btn" href={shown.download} download>⤓ Download {shown.kind === 'photo' ? 'snapshot' : 'clip'}</a>
        )}
        <button type="button" className={`dci-btn${reviewed ? ' dci-btn--done' : ''}`} onClick={onReviewed}
          title="Saved in this browser only">{reviewed ? '✓ Reviewed' : 'Mark reviewed'}</button>
      </div>
    </div>
  )
}

/**
 * Why a clip or snapshot failed, in words — from lib/mediaDiagnose, which asks
 * the file route for two bytes after the <video>/<img> gives up.
 */
function FailMessage({ reason, fresh, item, company, onRetry }) {
  const what = item.kind === 'photo' ? 'snapshot' : 'clip'
  const download = item.download ? <a className="dci-btn" href={item.download} download>⤓ Download {what}</a> : null
  const retry = <button type="button" className="dci-btn" onClick={onRetry}>Try again</button>
  if (reason === 'checking') return <><b>Checking why the {what} didn’t load…</b></>
  if (reason === 'codec') return (
    <>
      <b>This clip is in a format your browser can’t play</b>
      <span>The dashcam records in H.265 (HEVC). Download it and open it in VLC, or ask Control Tech to set the cameras to record H.264.</span>
      {download}
    </>
  )
  if (reason === 'missing') return fresh ? (
    <>
      <b>The {what} is probably still uploading</b>
      <span>The camera sends it a few minutes after the alarm.</span>
      {retry}
    </>
  ) : (
    <>
      <b>No footage for this {what}</b>
      <span>VSS has the alarm, but the camera has not uploaded this file (or it was deleted).</span>
    </>
  )
  if (reason === 'session') return <><b>Your sign-in has expired</b><span>Refresh the page and try again.</span></>
  if (reason === 'denied') return <><b>Your account can’t open {company}’s clips</b><span>Ask an administrator for access.</span></>
  if (reason === 'refused') return (
    <>
      <b>The video server refused this {what}</b>
      <span>It may be busy. Try again in a minute.</span>
      {retry}
    </>
  )
  return <><b>This {what} wouldn’t load</b><span>Check your connection and try again.</span>{retry}{download}</>
}

/** The clip or snapshot, with a switch between cameras, and honest failure states. */
function MediaPlayer({ inc, orgId, company, items, shown, plate, onPick }) {
  const [state, setState] = useState('loading')        // loading | ready | failed
  const [reason, setReason] = useState(null)           // why it failed — see FailMessage
  const [attempt, setAttempt] = useState(0)
  const [sessionReady, setSessionReady] = useState(false)
  useEffect(() => { setAttempt(0) }, [inc.id])
  useEffect(() => { setState('loading'); setReason(null) }, [shown.key, inc.id, attempt])
  // The login cookie must be fresh before the <video>/<img> asks (it carries no token).
  useEffect(() => {
    let alive = true
    setSessionReady(false)
    ensureVssSession(orgId).finally(() => { if (alive) setSessionReady(true) })
    return () => { alive = false }
  }, [inc.id, attempt, orgId])

  const src = sessionReady ? shown.url : undefined
  const fresh = inc.occurredMs != null && Date.now() - inc.occurredMs < UPLOAD_GRACE_MS

  const fail = async () => {
    setState('failed')
    setReason('checking')
    const r = await diagnoseMedia(shown.url)
    // The file arrived but the browser couldn't decode it: the format.
    setReason(r === 'ok' ? (shown.kind === 'photo' ? 'error' : 'codec') : r)
  }
  // Loaded, but with no picture: a codec the browser can't show.
  const checkPicture = (e) => {
    if (e.currentTarget.videoWidth === 0 && e.currentTarget.videoHeight === 0) { setState('failed'); setReason('codec') }
  }

  return (
    <div className="dci-player">
      <div className="dci-player__bar">
        {items.length > 1 ? (
          <div className="dci-seg" role="group" aria-label="Camera">
            {items.map((m) => (
              <button key={m.key} type="button" className={shown.key === m.key ? 'on' : ''} aria-pressed={shown.key === m.key} onClick={() => onPick(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
        ) : <span className="dci-player__cam">{shown.label}</span>}
        <span className="dci-player__stamp">● {plate} · {inc.occurredMs != null ? clockSec(inc.occurredMs) : ''}</span>
      </div>
      <div className="dci-video">
        <span className={`dci-tag dci-tag--${inc.severity}`}>{inc.label.toUpperCase()}</span>
        {src && shown.kind === 'video' && (
          <video key={`${src}#${attempt}`} src={src} controls playsInline preload="metadata"
            onLoadedMetadata={checkPicture}
            onLoadedData={() => setState((s) => (s === 'failed' ? s : 'ready'))}
            onError={fail} />
        )}
        {src && shown.kind === 'photo' && (
          <img key={`${src}#${attempt}`} src={src} alt={`${inc.label} — ${shown.label}`}
            onLoad={() => setState((s) => (s === 'failed' ? s : 'ready'))} onError={fail} />
        )}
        {state === 'failed' && (
          <div className="dci-video__msg">
            <FailMessage reason={reason} fresh={fresh} item={shown} company={company} onRetry={() => setAttempt((n) => n + 1)} />
          </div>
        )}
      </div>
    </div>
  )
}

/** A small, still map with a pin where the alarm happened. */
function MiniMap({ lat, lng, severity }) {
  const box = useRef(null)
  const map = useRef(null)
  const pin = useRef(null)

  useEffect(() => {
    if (!box.current || map.current) return undefined
    const m = L.map(box.current, {
      zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(m)
    m.setView([-0.5, 36.5], 7)
    map.current = m
    return () => { m.remove(); map.current = null; pin.current = null }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    if (pin.current) { pin.current.remove(); pin.current = null }
    if (lat == null || lng == null) return
    const color = severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#d97706' : '#2563eb'
    pin.current = L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(m)
    m.setView([lat, lng], 13)
    // The box can change size with the layout; let Leaflet re-measure.
    setTimeout(() => { try { m.invalidateSize() } catch { /* unmounted */ } }, 50)
  }, [lat, lng, severity])

  return (
    <div className="dci-mini">
      <div ref={box} className="dci-mini__map" />
      {(lat == null || lng == null) && <div className="dci-mini__none">No location</div>}
    </div>
  )
}
