/**
 * A fence for a Planner stop that has none (operator, 12 Nov 2026): a point
 * keyed in on Deliveries as bare coordinates, or a customer whose fence was
 * deleted. The stop's coordinates come filled in; the person names the fence
 * (and may move the point or widen the circle), saves, and the server draws a
 * circle there and ties the customer to it (POST planner/customers/:id/fence).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { fenceCustomer } from '../../api/planner';

const COORDS_ONLY = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;
const RADIUS_M = 100;

/** "-0.30512, 36.07124" or "-0.30512 36.07124" pasted into either field: both filled. */
function splitPair(text) {
  const m = String(text).trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  return m ? [m[1], m[2]] : null;
}

export default function PlannerFenceDialog({ orgId, stop, onClose, onSaved }) {
  const c = stop.customer;
  const titleId = useId();
  const nameRef = useRef(null);
  const [name, setName] = useState(() => (COORDS_ONLY.test(c.name ?? '') ? '' : c.name ?? ''));
  // Six places is 0.1 m; the stored float carries noise past that
  const [lat, setLat] = useState(() => (Number.isFinite(c.lat) ? String(Number(c.lat.toFixed(6))) : ''));
  const [lng, setLng] = useState(() => (Number.isFinite(c.lng) ? String(Number(c.lng.toFixed(6))) : ''));
  const [radius, setRadius] = useState(String(RADIUS_M));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const la = Number(lat);
  const ln = Number(lng);
  const r = Number(radius);
  const latOk = lat.trim() !== '' && Number.isFinite(la) && la >= -90 && la <= 90;
  const lngOk = lng.trim() !== '' && Number.isFinite(ln) && ln >= -180 && ln <= 180;
  const radiusOk = Number.isInteger(r) && r >= 10 && r <= 5000;
  const ok = name.trim().length > 0 && latOk && lngOk && radiusOk;

  const pasted = (e) => {
    const pair = splitPair(e.clipboardData.getData('text'));
    if (!pair) return;
    e.preventDefault();
    setLat(pair[0]);
    setLng(pair[1]);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const made = await fenceCustomer(orgId, c.id, { name: name.trim(), lat: la, lng: ln, radiusM: r });
      onSaved(made);
    } catch (x) {
      setErr(x?.message || 'The geofence was not drawn. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="sp4-modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="sp4-modal sp4-modal--narrow pl-fd" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={save} noValidate>
        <div className="sp4-modal-head">
          <h2 id={titleId} className="sp4-repair-title">Draw a geofence for stop {stop.sequence}</h2>
          <button type="button" className="sp4-modal-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <div className="sp4-modal-body">
          <p className="pl-fd__lede">This stop is a point with no geofence. Name it and save: a circle is drawn here and the stop is read by it from now on.</p>
          <label className="sp4-field">
            <span className="sp4-label">Geofence name</span>
            <input ref={nameRef} className="sp4-input" value={name} maxLength={200} required disabled={busy}
                   onChange={(e) => setName(e.target.value)} placeholder="Kamau Stores, Nakuru" />
          </label>
          <div className="pl-fd__pair">
            <label className="sp4-field">
              <span className="sp4-label">Latitude</span>
              <input className="sp4-input pl-fd__num" inputMode="decimal" value={lat} disabled={busy} aria-invalid={!latOk}
                     onChange={(e) => setLat(e.target.value)} onPaste={pasted} />
            </label>
            <label className="sp4-field">
              <span className="sp4-label">Longitude</span>
              <input className="sp4-input pl-fd__num" inputMode="decimal" value={lng} disabled={busy} aria-invalid={!lngOk}
                     onChange={(e) => setLng(e.target.value)} onPaste={pasted} />
            </label>
            <label className="sp4-field">
              <span className="sp4-label">Radius, m</span>
              <input className="sp4-input pl-fd__num" inputMode="numeric" value={radius} disabled={busy} aria-invalid={!radiusOk}
                     onChange={(e) => setRadius(e.target.value.replace(/[^\d]/g, ''))} />
            </label>
          </div>
          {(!latOk || !lngOk) && <p className="pl-fd__hint">Latitude runs -90 to 90 and longitude -180 to 180.</p>}
          {!radiusOk && <p className="pl-fd__hint">The radius runs 10 to 5,000 m.</p>}
        </div>
        <div className="sp4-modal-foot">
          {err && <p className="sp4-modal-err pl-fd__err" role="alert">{err}</p>}
          <button type="button" className="sp4-ghost-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="sp4-submit-btn" disabled={!ok || busy}>{busy ? 'Drawing…' : 'Save and draw'}</button>
        </div>
      </form>
    </div>
  );
}
