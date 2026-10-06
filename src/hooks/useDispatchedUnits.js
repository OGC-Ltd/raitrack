// The units dispatched to the weighbridges and still out, for the board.
//
// Polled rather than pushed: a dispatch lands on the server from FactorySuite's
// webhook, and nothing tells the browser — but a run is hours long, so a
// minute's lag on "it has gone" is invisible on this board. Read only while
// the board is showing a span that reaches now; a past day has no units "out".

import { useEffect, useState } from "react";
import { getDispatchedUnits } from "../api/weighments";

const POLL_MS = 60_000;

export function useDispatchedUnits(orgId, { enabled = true } = {}) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!orgId || !enabled) { setData(null); return undefined; }
    let alive = true;
    const read = () => getDispatchedUnits({ orgId })
      .then(d => { if (alive) setData(d); })
      // A failed read leaves the last good answer up: the board still has the
      // tickets, and blanking the units on one dropped request would flicker.
      .catch(() => {});
    read();
    const t = setInterval(read, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [orgId, enabled]);

  return data;
}
