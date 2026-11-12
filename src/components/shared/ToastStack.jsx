/*
 * The toast stack, mounted once for the whole app. Every toast comes from the
 * server down the live stream (lib/serverToasts): Menengai's unauthorised
 * stops and every web push. The page itself adds a few of its own, level
 * 'success' (the Planner's saved sheets). Last in, first out: only the newest
 * is drawn, the rest wait unseen behind it and the next comes forward when it
 * is closed or its 8 seconds run out (lib/toasts). A pointer on it holds the
 * clock so Copy or Open can be reached.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAppActions } from '../../context/AppContext';
import { LIFE_MS, dismissToast, pauseToasts, subscribeToasts, toastsSnapshot } from '../../lib/toasts';
import { distanceWords, placeLabel, stopCopyText } from '../../lib/stopWatch';
import { copyText } from '../../lib/copyText';
import { cachedPlaceName } from '../../hooks/usePlaceName';
import { requestStopsView } from '../../hooks/useStopWatch';
import { companyMark } from '../../lib/companyLogos';
import './ToastStack.css';

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
    <button type="button" className={`tst__copy tst__copy--${state}`} onClick={onCopy} title={words} aria-label={words}>
      <i className={`ti ${state === 'copied' ? 'ti-check' : state === 'failed' ? 'ti-alert-triangle' : 'ti-copy'}`} aria-hidden="true" />
    </button>
  );
}

const nearestWords = (n) => (n?.name ? `${n.name} (${placeLabel(n.category)}), ${distanceWords(n.metres)}` : null);

function icon(t) {
  if (t.level === 'success') return 'ti-circle-check';
  if (t.kind === 'stop') return t.data?.kind === 'nogo' ? 'ti-hand-stop' : 'ti-map-pin-exclamation';
  return t.level === 'info' ? 'ti-bell' : 'ti-alert-triangle';
}

function Toast({ t }) {
  const { setDesktopActiveTab } = useAppActions();
  const stop = t.kind === 'stop' ? t.data : null;
  const orgCode = typeof t.data?.orgCode === 'string' ? t.data.orgCode : null;
  const logo = orgCode ? companyMark({ code: orgCode }) : null;
  const copyOf = () => stopCopyText(stop, { now: Date.now(), area: cachedPlaceName(stop.lat, stop.lng), place: nearestWords(stop.nearest) });
  return (
    <div className={`tst tst--${t.level}`} role={t.level === 'info' || t.level === 'success' ? 'status' : 'alert'}>
      {/* Laid out as the desktop's own notification card (operator, 11 Nov
          2026): a square tile on the left, title and lines beside it, the
          actions under the text, dismiss in the corner. */}
      {logo ? (
        /* The organisation the toast is about, its severity as a badge on the logo
           (operator, 10 Nov 2026: a push carries the logo of its organisation). */
        <span className="tst__org" aria-hidden="true">
          <img src={logo} alt="" width="48" height="48" />
          <i className={`ti ${icon(t)} tst__sev`} />
        </span>
      ) : (
        <span className="tst__mark" aria-hidden="true"><i className={`ti ${icon(t)}`} /></span>
      )}
      <div className="tst__text">
        <b>{t.title}</b>
        {t.body && <span>{t.body}</span>}
        {stop && (
          <div className="tst__acts">
            <button type="button" className="tst__open" onClick={() => { setDesktopActiveTab('alerts'); requestStopsView(); dismissToast(t.id); }}>Open</button>
            <CopyStop text={copyOf} plate={stop.plate} />
          </div>
        )}
      </div>
      <button type="button" className="tst__x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
        <i className="ti ti-x" aria-hidden="true" />
      </button>
      <span className="tst__life" style={{ animationDuration: `${LIFE_MS}ms` }} aria-hidden="true" />
    </div>
  );
}

export default function ToastStack() {
  const { front } = useSyncExternalStore(subscribeToasts, toastsSnapshot, toastsSnapshot);
  // Nothing under the pointer once the stack empties: let the clock run again
  useEffect(() => { if (!front) pauseToasts(false); }, [front]);
  if (!front) return null;
  return (
    <div className="tst-stack" role="region" aria-label="Notifications"
         onMouseEnter={() => pauseToasts(true)} onMouseLeave={() => pauseToasts(false)}
         onFocus={() => pauseToasts(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) pauseToasts(false); }}>
      {/* Keyed by id: each toast that comes forward is a fresh card, so it
          slides in and its 8-second line starts full. */}
      <Toast key={front.id} t={front} />
    </div>
  );
}
