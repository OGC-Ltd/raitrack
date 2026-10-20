/**
 * Every open repair moves through its Workshop steps, so the older screens
 * (Maintenance, Fuel Audit) hand the job over instead of moving it themselves.
 */

import { useAppActions } from "../../context/AppContext";
import { openInWorkshop } from "../../api/repairWorkflow";

export default function OpenInWorkshop({ itemId, className = "sp4-ghost-btn", children = "Open in Workshop" }) {
  const { setDesktopActiveTab } = useAppActions();
  if (!itemId) return null;
  return (
    <button type="button" className={className}
            onClick={(e) => { e.stopPropagation(); openInWorkshop(itemId); setDesktopActiveTab("workshop"); }}>
      {children}
    </button>
  );
}
