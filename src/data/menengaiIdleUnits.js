/**
 * Menengai fleet units monitored for idle-time alerts.
 *
 * Any unit idle for IDLE_THRESHOLD_MS or longer triggers an alert.
 * "Idle" = no movement (speed ≈ 0) and/or engine on but not moving for the
 * threshold period, as reported by the last position update from the server.
 *
 * To add/remove trucks: edit the PLATES array below.
 * To change the threshold: update IDLE_THRESHOLD_MS.
 *
 * When this moves to the backend, copy this config into the server's
 * idle-alert job and delete this file.
 */

export const IDLE_ORG_CODE = "menengai";
export const IDLE_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours

/**
 * Truck plates and their size/designation from the fleet list provided
 * 2026-11-10. Keep in the same order so diffs are readable.
 */
export const MENENGAI_IDLE_UNITS = [
  { plate: "KCE 780B", size: "PROBOX",  designation: "GT/MT" },
  { plate: "KCC 348A", size: "PICKUP",  designation: "GT/MT" },
  { plate: "KCC 345A", size: "PICKUP",  designation: "GT/MT" },
  { plate: "KCF 483V", size: "PICKUP",  designation: "GT/MT" },
  { plate: "KCB 123P", size: "HYUNDAI", designation: "GT/MT" },
  { plate: "KCB 234J", size: "HYUNDAI", designation: "GT/MT" },
  { plate: "KCB 345K", size: "HYUNDAI", designation: "GT/MT" },
  { plate: "KCH 467T", size: "HINO",    designation: "GT/MT" },
  { plate: "KCH 474T", size: "HINO",    designation: "GT/MT" },
  { plate: "KCH 473T", size: "HINO",    designation: "GT/MT" },
  { plate: "KCH 502T", size: "HINO",    designation: "GT/MT" },
  { plate: "KDE 123E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 125E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 126E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 130E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 132E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 133E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 135E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 136E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 137E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 138E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 139E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDE 145E", size: "HYUNDAI", designation: "RETAIL" },
  { plate: "KDM 124L", size: "HINO",    designation: "RETAIL" },
  { plate: "KDM 154L", size: "HINO",    designation: "RETAIL" },
];

/** Plate strings only — for quick lookup. */
export const IDLE_UNIT_PLATES = new Set(MENENGAI_IDLE_UNITS.map((u) => u.plate));
