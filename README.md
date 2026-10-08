# Rai Operations — fleet dashboard (new-ui)

The live fleet dashboard served at **logistics.raioperations.com**: live map,
fuel and probe monitoring, route replay, weighbridges, maintenance and
per-fleet analytics for every organisation on the fleet-server platform.
React + Vite, Redux Toolkit for client state, TanStack Query for server data.

Organisations (`src/data/companyData.jsx`): Sukari Industries, Mufindi Paper
Mills (Kasulu), Menengai Oil Refineries, West Kenya Sugar, Kabras Sugar,
Nzoia Sugar, Timsales and Aquamist.

**Contents:** [Quick start](#quick-start) · [How dev works](#how-dev-works) ·
[Configuration](#configuration) · [Scripts](#scripts) · [Code layout](#code-layout) ·
[Deployment](#deployment) · [Troubleshooting](#troubleshooting)

---

## Quick start

```bash
npm install
npm run dev
```

Opens at `http://localhost:5174` and signs in against the production
fleet-server, so use your normal account. Add a `.env` (see
[Configuration](#configuration)) for live traffic; the map itself needs no key.

## How dev works

**Dev talks to the remote backend, on purpose.** `vite.config.js` proxies
`/api/*` to the deployed fleet-server (af-south-1), not to localhost. Only the
deployed instance runs the **poller**, which is the sole source of the
provider's `connectionOnline` verdict and a current `movement.state`. Against a
local API-only backend every vehicle reads OFFLINE and a moving unit's card
says "Parked" beside an "ENGINE ON" tile.

Do **not** start a second poller locally to work around that: both would write
to the same shared database.

The host has no Elastic IP, so its address changes on every stop/start.
Override it without editing the config:

```bash
VITE_PROXY_TARGET=http://<host> npm run dev
```

**Ports.** new-ui owns 5174, dash 5175, fleet-server 3000. `strictPort` is on,
so a taken port fails loudly instead of drifting onto another app's port.

## Configuration

All keys are read at build time from `.env` (gitignored; ask for the values,
do not look for them in the repo). Browser map keys ship in the bundle and are
public by design. What protects them is the domain or referrer restriction in
each provider's console, not secrecy.

| Variable | Needed for | Without it |
|---|---|---|
| `VITE_MYTOMTOM_API_KEY` | Live traffic layer and trip ETAs | Map works; traffic silently disappears |
| `VITE_GOOGLE_MAPS_API_KEY` | Google as a second base map (Maps panel) | OpenStreetMap only; the choice is not offered |
| `VITE_MAPBOX_API_KEY` | Mapbox base map, only if `MAPBOX_ENABLED` is switched on | Unused while the flag is off |
| `VITE_API_URL` | Pointing the bundle at a non-same-origin API | Same-origin `/api` (the normal case) |
| `VITE_PROXY_TARGET` | Dev only: where `/api` is proxied | The af-south-1 box in `vite.config.js` |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on 5174, API proxied to the box |
| `npm run build` | Production bundle into `build/` |
| `npm run preview` | Serve the built bundle locally |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | ESLint |
| `npm run bake:sprites` | Regenerate the vehicle sprite atlases |

## Code layout

```
src/
├── index.jsx              React entry
├── App.jsx                app shell: tabs, organisation, tab title
│
├── api/                   one module per backend area; resolves orgId, then fetches
├── services/              transport: fetch wrapper, SSE, snapshot cache
├── store/                 Redux Toolkit slices (client state) and persistence
├── context/               providers: auth, live fleet, app selectors and actions
├── hooks/                 data hooks (useApiData wraps TanStack Query), live fleet,
│                          playback, telemetry, fuel events, cross-org unit lookup
├── lib/                   pure logic: vehicle state, map engine adapter (Leaflet),
│                          playback paths, traffic, analytics filters
├── utils/                 formatting and report generation
├── data/                  static config; companyData.jsx holds the organisations
│                          and their branding
├── assets/                logos and images
│
└── components/
    ├── layout/            side panel, header, vehicle detail panel, feeds
    ├── body/              FleetMap, map tool rail, Units panel, overlays,
    │                      RoutePlayback, SensorPanel, MaintenancePage
    ├── screens/           full pages: Analytics, Fuel report, Weighbridges,
    │                      Drivers, Maintenance, Audit, Logbook, admin
    ├── cards/             detail cards
    ├── charts/            donuts, histograms, rate series
    ├── mobile/            small-screen variants
    ├── header/            company switcher, user menu, stat cards, pickers
    ├── footer/            bottom navigation
    ├── warehouse/         storage views
    ├── shared/            cross-area pieces
    └── ui/                primitives
```

Tests sit beside the code they cover, as `*.test.js` / `*.test.jsx`.

**External services:** OpenStreetMap tiles and Nominatim (base map, place
search, no key), TomTom (traffic, ETAs), Google Maps (optional base map),
Open-Meteo (weather card, no key). Everything else comes from fleet-server.

## Deployment

**Every push to `main` deploys to production** via
`.github/workflows/deploy.yml`. There is no staging step, so push to `main`
only what should go live.

The bundle is built **on the runner and copied to the box**, never built on the
box. Rebuilding in place once silently replaced a good bundle with one missing
the sprite atlases and the estate-plan layer. The workflow:

1. checks every file in `public/` survived into `build/`;
2. writes `build/DEPLOYED_COMMIT` (the commit being served);
3. copies the live bundle aside as `build.bak-<stamp>` (the box keeps 3);
4. copies the new bundle to `~/prod/dash/build`, which nginx serves straight
   from disk;
5. confirms the site serves the new hashed entry script.

**Check what is live:**

```bash
curl -s https://logistics.raioperations.com/DEPLOYED_COMMIT
```

**Repository secrets** (`production` environment): `EC2_SSH_KEY`, `EC2_HOST`,
`EC2_HOST_KEY` to reach the box (set up as in `fleet-server/docs/ci-deploy.md`;
`EC2_HOST` must be re-entered when the address changes), plus
`VITE_MYTOMTOM_API_KEY` (checked, the build refuses without it) and
`VITE_GOOGLE_MAPS_API_KEY` (optional).

**Roll back** by copying a backup over the served directory. Nothing to rebuild
or reload:

```bash
ssh -i keys/ustawi.pem ubuntu@<host> 'cd ~/prod/dash && ls -d build.bak-* && cp -r build.bak-<stamp>/. build/'
```

> The deploy directory is still named `dash` for historical reasons. A push of
> the separate `dash` project to that box would overwrite this site.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every unit OFFLINE, moving units say "Parked" | Dev is pointed at a local backend; use the remote proxy target |
| "Invalid email or password" in dev | Proxy points at an old host without the accounts; check `VITE_PROXY_TARGET` |
| `/api` calls time out in dev | The box's address changed; set `VITE_PROXY_TARGET` |
| No traffic layer, no ETAs | `VITE_MYTOMTOM_API_KEY` missing at build time |
| Page unstyled, no errors anywhere | Vite served empty CSS after a whole-file rewrite; touch the CSS file |
| `npm run dev` exits: port in use | Another app holds 5174; ports are strict on purpose |
| A deploy seems not to have landed | Compare `/DEPLOYED_COMMIT` with `git rev-parse origin/main` |
