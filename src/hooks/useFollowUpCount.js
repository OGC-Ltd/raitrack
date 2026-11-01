// How many Driver Behaviour follow-up cases are pending for the organisation
// (lib/followUp), for the count beside Reports in the sidebar. The cases live
// in this browser for now, so it listens for this tab's saves and other tabs'.

import { useEffect, useState } from 'react';
import { loadCases, CHANGED } from '../lib/followUp';

const pendingOf = (orgId) => loadCases(orgId).filter((c) => c.status === 'pending').length;

export function useFollowUpCount(orgId) {
  const [n, setN] = useState(() => pendingOf(orgId));
  useEffect(() => {
    const read = () => setN(pendingOf(orgId));
    read();
    window.addEventListener(CHANGED, read);
    window.addEventListener('storage', read);
    return () => { window.removeEventListener(CHANGED, read); window.removeEventListener('storage', read); };
  }, [orgId]);
  return n;
}
