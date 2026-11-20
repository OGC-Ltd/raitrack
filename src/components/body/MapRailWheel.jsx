/**
 * Phones: the map's right-hand rail folds into ONE button (operator, 19 Nov
 * 2026: "have one icon only that we can click to open these other icons on a
 * wheel"). Closed, the map shows a single chip. Open, the rail's own buttons
 * fan out around it on two quarter-circle arcs: the menus (fuel alerts, map
 * layers, fleets and units) on the inner one, the camera (zoom in, reset, zoom
 * out) on the outer one.
 *
 * Nothing is re-implemented. The children are the same components the rail
 * always drew, so every menu keeps its own panel, badges, Escape and
 * outside-press rules. Only their BUTTONS move (CSS `translate`, never the
 * wrappers: a transformed ancestor would capture their position: fixed panels).
 *
 * Picking a menu folds the wheel away so its panel has the map to itself; the
 * zoom buttons leave it open, because zooming is pressed several times running.
 * A press outside, Escape, or the button itself folds it too.
 */
import { useEffect, useRef, useState } from "react";
import "./MapRailWheel.css";

function ToolsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </svg>
  );
}

/** Desktop's chip holds only the camera: a magnifier says zoom, the grid would not. */
function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5M10.5 8v5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
  );
}

/**
 * @param {{ children: React.ReactNode, fuelCount?: number, haltedCount?: number, cameraOnly?: boolean }} props
 *   The counts the hidden buttons carry, so the closed chip still says when
 *   something needs looking at. `cameraOnly`: desktop, where the menus live in
 *   the sidebar and the wheel carries just zoom in, reset and zoom out.
 */
export default function MapRailWheel({ children, fuelCount = 0, haltedCount = 0, cameraOnly = false }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const items = useRef(null);
  const btn = useRef(null);

  // Folded buttons are out of the tab order and the accessibility tree.
  // (`inert` set on the node: React 18 does not pass it through as a boolean.)
  // The BUTTONS only, never the whole ring: a menu's panel is rendered inside
  // its wrapper here, and an inert panel lets every press and wheel fall
  // through to the map under it (19 Nov 2026: scrolling the Fleets sheet
  // zoomed the map). Every render, as a menu's button can come and go.
  useEffect(() => {
    items.current?.querySelectorAll(".map-cam-btn").forEach((b) => { b.inert = !open; });
  });

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A menu button folds the wheel once its own click has run; a camera button
  // does not.
  const onItemClick = (e) => {
    const b = e.target.closest(".map-cam-btn");
    if (!b || b.closest(".map-cam-row")) return;
    setTimeout(() => setOpen(false), 0);
  };

  const news = fuelCount + haltedCount;
  const name = cameraOnly ? "Zoom and view" : "Map tools";
  const label = [
    name,
    fuelCount ? `${fuelCount} fuel ${fuelCount === 1 ? "alert" : "alerts"}` : null,
    haltedCount ? `${haltedCount} halted` : null,
  ].filter(Boolean).join(", ");

  return (
    <div className={`rw${cameraOnly ? " rw--camera" : ""}${open ? " rw--open" : ""}`} ref={wrap}>
      <div className="rw__items" ref={items} onClick={onItemClick}>
        {children}
      </div>
      <button
        ref={btn}
        type="button"
        className={`map-cam-btn rw__btn${open ? " rw__btn--open" : ""}`}
        aria-expanded={open}
        aria-label={open ? `Close ${name.toLowerCase()}` : label}
        title={name}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <CloseIcon /> : cameraOnly ? <CameraIcon /> : <ToolsIcon />}
        {!open && news > 0 && (
          <span className={`rw__n${fuelCount ? " rw__n--crit" : ""}`} aria-hidden="true"
                data-digits={String(news).length}>{news}</span>
        )}
      </button>
    </div>
  );
}
