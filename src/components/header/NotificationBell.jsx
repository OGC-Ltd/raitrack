// Header notification bell button.

import { BellIcon } from "./Icons";
import "../../index.css";
export default function NotificationBell({ count = 0, onClick, title }) {
  return (
    <div
      className="notification-bell"
      onClick={onClick}
      title={title ?? (count > 0 ? `${count} vehicle${count === 1 ? "" : "s"} due for maintenance` : "No maintenance alerts")}
      style={onClick ? { cursor: "pointer" } : undefined}
    >
      <BellIcon />
      {count > 0 && (
        <span className="notification-bell__badge">{count}</span>
      )}
    </div>
  );
}
