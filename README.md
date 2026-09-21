# Fleet Command

Real-time fleet dashboard for the organisations on the fleet-server platform —
Sukari, Kasulu, Menengai and West Sugar. Live map, fuel and probe monitoring,
route replay, and per-fleet analytics. React + Vite.

## Getting started

```bash
npm install
npm run dev
```

Opens at `http://localhost:5174`. Port 3000 belongs to the fleet-server backend,
so the two cannot share it.

### You need a map key

Create `.env` with:

```
VITE_GOOGLE_MAPS_API_KEY=<key>
```

The map is **Google Maps**, loaded at runtime by `FleetMap.jsx`. Without the key
the app builds, serves, and renders a dashboard whose API calls all return 200
behind a dead map — so this is worth getting right before wondering what broke.
`.env` is gitignored; ask for the value rather than looking for it in the repo.

Maps JS keys ship inside the browser bundle and are public by design. What
protects this one is the HTTP referrer restriction in the Google Cloud console,
not secrecy.

### Dev talks to the *remote* backend

`vite.config.js` proxies `/api/*` to the deployed fleet-server, not to
localhost. That is deliberate: only the deployed instance runs the **poller**,
and the poller is the sole source of two things nothing else can supply — the
provider's `connectionOnline` verdict, and a current `movement.state`. Against a
local API-only backend every vehicle reads OFFLINE and a moving unit's card says
"Parked" beside an "ENGINE ON" tile.

Do **not** start a second poller locally to work around that. Both would write
to the same shared database.

Override the target if the box's address changes:

```bash
VITE_PROXY_TARGET=http://<host> npm run dev
```

The host has no Elastic IP, so its public DNS rerolls on every stop/start.

## Scripts

| | |
|---|---|
| `npm run dev` | dev server on 5174, API proxied to the box |
| `npm run build` | production bundle into `build/` |
| `npm run preview` | serve the built bundle locally |
| `npm test` | vitest, single run |
| `npm run test:watch` | vitest in watch mode |
| `npm run lint` | eslint |
| `npm run bake:sprites` | regenerate the vehicle sprite atlases |

## Deployment

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.

The bundle is built **on the runner and copied to the box** — never built on the
box. Rebuilding in place there has silently replaced a good bundle with one
missing the vehicle sprite atlases and the estate-plan layer, because the served
build had been produced from newer source than that checkout. The workflow
checks that every file in `public/` survived into `build/`, copies the live
bundle aside before writing, and afterwards confirms the site serves the new
hashed entry script.

Requires four repository secrets on the `production` environment. Three are for
reaching the box — `EC2_SSH_KEY`, `EC2_HOST`, `EC2_HOST_KEY` — set up exactly as
described in `fleet-server/docs/ci-deploy.md`, which also covers the Elastic IP
problem: `EC2_HOST` has to be re-entered whenever the public DNS rerolls.

The fourth is `VITE_GOOGLE_MAPS_API_KEY`, and it is easy to overlook for the
reason described above: a keyless bundle passes every other check the workflow
makes. It now refuses to build without one, and re-checks that the key actually
reached the bundle — a present secret is not proof of a baked one, since vite
only exposes variables it sees at build time under the `VITE_` prefix.

To roll back, copy a backup over the served directory — nginx serves it straight
from disk, so there is nothing to rebuild or reload:

```bash
ssh -i keys/logistics.pem ubuntu@<host> 'cd ~/prod/dash && cp -r build.bak-<stamp>/. build/'
```

The box keeps the three most recent bundles. It used to keep every one, and by
August 2026 held 91 of them — 822 MB on a 13 GB disk that also runs the API.

## Layout

```
src/
├── index.jsx              React entry
├── App.jsx                root component, global state
│
├── api/                   one module per backend area (org, machineOps,
│                          probeHealth …). Resolves orgId, then fetches.
├── services/              transport — fetch wrapper, SSE, snapshot cache
├── hooks/                 useFleetLive (shared SSE + snapshot), playback,
│                          telemetry, fuel events, windowing
├── lib/                   pure logic: vehicle state machine, playback paths,
│                          marker state, analytics filters
├── utils/                 formatting and report generation
├── context/               app-wide providers
├── data/                  static config — companyData.jsx holds the four
│                          organisations and their branding
│
└── components/
    ├── header/            stat cards, vehicle panel, search, notifications
    ├── body/              FleetMap and its overlays, RoutePlayback,
    │                      SensorPanel, MaintenancePage
    ├── cards/             right-panel detail cards
    ├── charts/            donuts, histograms, rate series
    ├── screens/           full-page views (Analytics)
    ├── footer/            company switcher and nav
    ├── mobile/            small-screen variants
    ├── warehouse/         storage views
    ├── shared/            cross-area pieces
    └── ui/                primitives
```

Tests sit beside the code they cover, as `*.test.js`.

## External services

- **Google Maps** — base map, satellite imagery and geocoding. Needs the key above.
- **Open-Meteo** — the weather card. No key.

Everything else comes from fleet-server.
