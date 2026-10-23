# Dashcam Alarms tab (Control Tech VSS)

An **Alarms** tab under Live Map: each dashcam alarm (harsh turn, no seat belt,
fatigue, rollover…) with its video clip, snapshot, details and a small map.
Shown only for organisations whose vehicles carry VSS cameras.

## Frontend (this repo)

| File | What it is |
|---|---|
| `src/components/screens/DashcamIncidentsScreen.jsx` / `.css` | The screen: list on the left, clip/snapshot + details + mini map on the right. Classes prefixed `dci-`. |
| `src/api/vssAlarms.js` | The three backend calls, and the row shape the screen uses. `VSS_BASE` is the one place the path lives. |
| `src/lib/dashcamIncidents.js` | Filter chips, time windows, badge rule. |
| `src/lib/dashcamReviewed.js` | "Mark reviewed", kept in the browser (localStorage) per company. |
| `src/lib/mediaDiagnose.js` | Why a clip didn't play (missing / H.265 / sign-in / refused). |
| `src/hooks/useVssBadge.js` | The tab's red count: today's unreviewed warning/critical alarms. |
| `src/hooks/usePermissions.js` | Grants `vss:alarms` when the backend reports ≥ 1 camera for the org. |
| `src/components/layout/SidePanel.jsx` | The nav item (hidden, not greyed, when not granted) and its badge. |
| `src/App.jsx`, `src/store/appSlice.js` | Renders the tab; `dashcam` added to the restorable tabs. |

**Safe to merge before the backend exists.** The tab is shown only when
`GET /api/v1/vss/cameras` returns a count above 0. Any error — including the
backend's "Route not found" — counts as 0, so the tab stays hidden and nothing
else changes.

## Backend contract (to be served by the fleet-server)

All three need the normal signed-in session (cookie or Bearer), and must check
the caller may read `org` **and only return that organisation's vehicles**,
exactly like the other `/organisations/:orgId/...` routes.

### `GET /api/v1/vss/cameras?org=<orgId>`
```json
{ "data": { "cameras": 52 } }
```
How many of the organisation's vehicles have a VSS device. 0 hides the tab.

### `GET /api/v1/vss/alarms?org=<orgId>&since=<ISO 8601>`
```json
{ "data": { "incidents": [ {
  "id": "17925200250010050000000070462493",
  "code": 214, "label": "Harsh turn",
  "severity": "warning",            // critical | warning | informational
  "category": "braking",            // braking | speeding | driver | collision | geofence | other
  "occurredAt": "2026-10-20T15:13:45Z",
  "vehicleId": "<our vehicle id>", "plate": "KCJ 099T",
  "lat": -0.82014, "lng": 34.382572, "speed": 11,
  "videos": [ { "key": "f0", "label": "Road camera", "url": "/api/v1/vss/file?org=…&k=…", "download": "/api/v1/vss/file?org=…&k=…&download=1" } ],
  "photos": [ { "key": "f1", "label": "In cabin",    "url": "/api/v1/vss/file?org=…&k=…", "download": "…" } ]
} ] } }
```
Newest first. `since` is at most 7 days back. `url`/`download` must be the
backend's own `/file` route — **never** a VSS link (VSS links carry a token).

### `GET /api/v1/vss/file?org=<orgId>&k=<key>[&download=1]`
Streams one clip or snapshot from VSS, passing the browser's `Range` header
through (206 Partial Content) so the player can seek. Content-Type must be the
real one (`video/mp4` / `image/jpeg`) — VSS sends `application/octet-stream`.

## What we learned from the live VSS (v2.8) — the backend must handle these

A working reference implementation is `vss.php` (cPanel, in production on
logistics.ogc-monitoring.com since 23 Oct 2026).

1. **Search:** `/vss/record/findRecords.action` (§3.24) with `deviceIdList`
   (all the org's devices) works. One row per FILE; group by `alarmGuid`.
2. **Rate limit (error 10129 "Requests too frequent"):** VSS refused a second
   §3.24 page 2 s after the first. Use big pages (`pageSize` 2000), ≥ 10 s
   between searches, ≥ 2 s between any calls, one search per org at a time
   (others wait for its answer), cache answers ~90 s, and back off ~90 s after
   a 10129. If a later page is refused, keep the pages already received.
3. **Alarm type:** §3.24 rows send `alarmType: null`. Get the type, time, GPS
   and speed from `/vss/alarm/getAlarmByIds.action` (§3.25; field `alarmtype`,
   `createtime`, `AlarmGps` as "lng,lat", `Speed`). Cache them — an alarm
   never changes. Names/severity from Howen's *Device Event Type Code* sheet
   (VSS API column).
4. **Device ↔ vehicle matching:** VSS names devices `"SUKARI - KDR 430Q"`; our
   plate is `"KDR 430Q"`. Compare letters+digits only, and also the part after
   the first `:` / ` - ` when it looks like a registration (≥ 6 chars, letters
   and digits). Never match a bare fleet number like `"FT 13"` on its own.
5. **Files:** served from the VSS host on another port (e.g. `:9988`). Its
   file server answers **416** to a Range that runs past the end of a small
   file — retry without Range. Clips are **H.264** MP4 with the index (`moov`)
   at the END (browsers play them fine via Range).
6. **TLS:** vss.controltech-ea.com omits its Sectigo intermediate certificate;
   the fleet-server's `providers/vss` already supplies it.
