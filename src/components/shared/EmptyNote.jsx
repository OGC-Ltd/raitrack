// An empty, busy or failed state for a screen's content area: an icon in a
// soft disc, a title and one line under it, centred in the space the content
// would fill. Fuel › Report and Fuel Audit use it; the look is the vehicle
// panel's "No readings today".
//
//   tone      "ok" (green), "warn" (amber), "error" (red), "busy" (spinning)
//   progress  0–1 draws a bar under the text (a long read with known steps)
//   action    { label, onClick } — a way out where the state is recoverable

import "./EmptyNote.css";

export default function EmptyNote({ icon, title, children, tone = "ok", progress = null, action = null, className = "" }) {
  return (
    <div className={`empty-note empty-note--${tone} ${className}`} role={tone === "error" ? "alert" : "status"}>
      <span className="empty-note__icon" aria-hidden="true"><i className={`ti ${icon}`} /></span>
      <div className="empty-note__title">{title}</div>
      {children && <p className="empty-note__sub">{children}</p>}
      {progress != null && (
        <div className="empty-note__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100}
             aria-valuenow={Math.round(progress * 100)}>
          <span style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
      )}
      {action && <button type="button" className="sp4-ghost-btn empty-note__btn" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
