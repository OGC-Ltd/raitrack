// Company avatar + name shown in the header.

import "../../index.css";

export default function BrandLogo({
  avatarLetter = "S",
  avatarColor,
  name = "Sukari Industries",
  suffix = "Ltd · KE",
  vehicleCount = 0,
}) {
  return (
    <div className="brand-logo">
      <div
        className="brand-logo__avatar"
        style={avatarColor ? { backgroundColor: avatarColor } : undefined}
      >{avatarLetter}</div>

      <div className="brand-logo__info">
        <div className="brand-logo__name-row">
          <span className="brand-logo__name">{name}</span>
          <span className="brand-logo__suffix">{suffix}</span>
        </div>

        <div className="brand-logo__status-row">
          <div className="brand-logo__dot" />
          <span className="brand-logo__status-text">{vehicleCount} vehicles live</span>
        </div>
      </div>
    </div>
  );
}
