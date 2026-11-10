/*
 * The toast stack, mounted once for the whole app. Every toast comes from the
 * server down the live stream (lib/serverToasts): Menengai's unauthorised
 * stops and every web push. First in, first out: the oldest sits on top and
 * leaves first, each 8 seconds after it came into view (lib/toasts). A pointer
 * on the stack holds the clocks so Copy or Open can be reached.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAppActions } from '../../context/AppContext';
import { LIFE_MS, dismissToast, pauseToasts, subscribeToasts, toastsSnapshot } from '../../lib/toasts';
import { distanceWords, placeLabel, stopCopyText } from '../../lib/stopWatch';
import { copyText } from '../../lib/copyText';
import { cachedPlaceName } from '../../hooks/usePlaceName';
import { requestStopsView } from '../../hooks/useStopWatch';
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
  if (t.kind === 'stop') return t.data?.kind === 'nogo' ? 'ti-hand-stop' : 'ti-map-pin-exclamation';
  return t.level === 'info' ? 'ti-bell' : 'ti-alert-triangle';
}

function Toast({ t }) {
  const { setDesktopActiveTab } = useAppActions();
  const stop = t.kind === 'stop' ? t.data : null;
  const copyOf = () => stopCopyText(stop, { now: Date.now(), area: cachedPlaceName(stop.lat, stop.lng), place: nearestWords(stop.nearest) });
  return (
    <div className={`tst tst--${t.level}`} role={t.level === 'info' ? 'status' : 'alert'}>
      <span className="tst__mark" aria-hidden="true"><i className={`ti ${icon(t)}`} /></span>
      <div className="tst__text">
        <b>{t.title}</b>
        {t.body && <span>{t.body}</span>}
      </div>
      <div className="tst__acts">
        {stop && <CopyStop text={copyOf} plate={stop.plate} />}
        {stop && (
          <button type="button" className="tst__open" onClick={() => { setDesktopActiveTab('alerts'); requestStopsView(); dismissToast(t.id); }}>Open</button>
        )}
        <button type="button" className="tst__x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>{'✕'}</button>
      </div>
      <span className="tst__life" style={{ animationDuration: `${LIFE_MS}ms` }} aria-hidden="true" />
    </div>
  );
}

export default function ToastStack() {
  const { shown, waiting } = useSyncExternalStore(subscribeToasts, toastsSnapshot, toastsSnapshot);
  // Nothing under the pointer once the stack empties: let the clocks run again
  useEffect(() => { if (!shown.length) pauseToasts(false); }, [shown.length]);
  if (!shown.length) return null;
  return (
    <div className="tst-stack" role="region" aria-label="Notifications"
         onMouseEnter={() => pauseToasts(true)} onMouseLeave={() => pauseToasts(false)}
         onFocus={() => pauseToasts(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) pauseToasts(false); }}>
      {shown.map((t) => <Toast key={t.id} t={t} />)}
      {waiting > 0 && <div className="tst-stack__more">{waiting} more waiting</div>}
    </div>
  );
}
