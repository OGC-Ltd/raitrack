// How many Driver conduct follow-up cases are pending for the organisation,
// for the count beside Reports in the sidebar. From the server (api/
// driverConduct), so every machine shows the same (operator, 2 Nov 2026: it
// "does not display on every machine" while each browser kept its own). Read
// again when this tab changes a case, when the window comes back into view,
// and every minute for what other machines did.

import { useEffect, useState } from 'react';
import { pendingCount, CHANGED } from '../api/driverConduct';

const EVERY_MS = 60_000;

export function useFollowUpCount(orgId) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!orgId) { setN(0); return undefined; }
    let live = true;
    // A failed read keeps the last count rather than showing none
    const read = () => { pendingCount(orgId).then((c) => { if (live) setN(c); }).catch(() => {}); };
    const onShow = () => { if (document.visibilityState === 'visible') read(); };
    read();
    const tick = setInterval(read, EVERY_MS);
    window.addEventListener(CHANGED, read);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      live = false;
      clearInterval(tick);
      window.removeEventListener(CHANGED, read);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [orgId]);
  return n;
}
