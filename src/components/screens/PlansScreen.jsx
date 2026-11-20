// Work Plan (operator, 2026-11-20): FactorySuite's plan submissions board as its
// own sidebar page. It was Maintenance › Plan; the board itself is unchanged
// (body/PlanSubmissions), only where it opens from moved.
//
// The board scrolls itself and wants to be a direct flex child of a clipping
// column, which is what .maint-screen-scroll was for it inside Maintenance,
// so it keeps that wrapper and the gutter that comes with it.

import { useFleetLiveShared } from "../../context/FleetLiveContext";
import PlanSubmissions from "../body/PlanSubmissions";
import "./MaintenanceScreen.css";

export default function PlansScreen() {
  const { orgId } = useFleetLiveShared();
  return (
    <div className="maint-screen-scroll">
      <PlanSubmissions orgId={orgId} />
    </div>
  );
}
