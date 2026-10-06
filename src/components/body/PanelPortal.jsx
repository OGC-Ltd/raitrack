/**
 * Renders a dialog OUTSIDE the table it was opened from, into the nearest
 * `.sp4-root` (the panel root, which carries the --sp4-* theme variables).
 *
 * Why (operator, 2026-10-01): a job's detail row sits in a `.sp4-table-scroll`
 * that is a size container (AuditScreen.css), and a size container is the
 * containing block for `position: fixed`. The sign-off dialog opened from it
 * was fixed to the table instead of the viewport, and the table's sticky
 * header painted over its top. Moved up to the panel root it is fixed to the
 * viewport again, and still inherits the theme.
 */

import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function PanelPortal({ children }) {
  const [anchor, setAnchor] = useState(null);
  const [host, setHost] = useState(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    setHost(anchor.closest(".sp4-root") ?? anchor.closest(".app-container") ?? document.body);
  }, [anchor]);
  return (
    <>
      <span ref={setAnchor} hidden />
      {host && createPortal(children, host)}
    </>
  );
}
