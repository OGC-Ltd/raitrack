// The unit's camera feed, as a window over the map.
//
// ## What this can and cannot do today
//
// NOTHING IN THIS FLEET REPORTS A CAMERA. Searched 2026-08-29 across the Prisma
// schema, the fleet-server modules and the Wialon adapter: there is no camera,
// video, stream, rtsp or hls field anywhere, and the provider sends no media of
// any kind. The two nearby things are not this either — production/videos holds
// fixed CCTV of a PET line and a loading bay, and yolo-aquamist counts bottles
// and cartons on those same fixed cameras. Neither is a vehicle dash-cam.
//
// So this window is the INTERFACE, wired to a capability flag that nothing sets
// yet. It is deliberately built to say that rather than to look busy: a spinner
// that never resolves, or a black rectangle, both read as a broken feed and
// would send someone to check the vehicle's hardware.
//
// The missing half is a stream URL, and its shape is not guessable. Wialon does
// carry media for DVR-equipped units, but the call that retrieves it depends on
// the camera vendor's own Wialon integration — which cannot be written against
// a fleet that has no such device to answer it.

import { useFloatingWindow } from "../../hooks/useFloatingWindow";
import "./VehicleCamera.css";

export default function VehicleCamera({ vehicle, onClose }) {
  const { ref, onPointerDown } = useFloatingWindow({
    id: "vehicle-camera",
    dock: "bottom-right",
  });

  // Undefined until something populates it — see the header. Read off the
  // vehicle rather than hardcoded, so the day a unit reports a camera this
  // window starts working without being rewritten.
  const hasCamera = Boolean(vehicle?.hasCamera);
  const streamUrl = vehicle?.cameraStreamUrl ?? null;

  return (
    <div ref={ref} className="vcam">
      <div className="vcam__bar" onPointerDown={onPointerDown} title="Hold and drag to move">
        <span className="vcam__grip" aria-hidden="true">⠿</span>
        <span className="vcam__plate">{vehicle?.id} · camera</span>
        <button type="button" className="vt-action" onClick={onClose} aria-label="Close camera" title="Close">✕</button>
      </div>

      <div className="vcam__stage">
        {streamUrl ? (
          <video className="vcam__video" src={streamUrl} autoPlay muted playsInline controls />
        ) : (
          /* Stated, not spun. An operator who sees a loading state on a unit
             with no camera goes and checks the vehicle; one who reads this
             does not. */
          <div className="vcam__empty">
            <span className="vcam__empty-icon" aria-hidden="true">◎</span>
            <p className="vcam__empty-head">
              {hasCamera ? "Camera fitted, no stream available" : "No camera on this unit"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
