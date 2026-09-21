import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  /**
   * Unit tests.
   *
   * `node`, not jsdom: what is worth pinning here is the DECISION logic — which
   * fault a row represents and what somebody should do about it — and none of
   * that touches the DOM. A browser environment would be a dependency and a
   * startup cost bought for nothing. Add jsdom the day a component test earns
   * it, not before.
   *
   * Vitest reuses this config, so the `@` alias and `import.meta.env` behave in
   * a test exactly as they do in the app — which is the point of running it
   * here rather than under a second toolchain.
   */
  test: {
    environment: 'node',
    /* tools/ as well as src/. The KML converter that builds the Kabras site
     * layer is build-time code, but it carries the kind of rule this project
     * tests everywhere else — and it shipped a regex that compiled to
     * something matching nothing while reporting success. A tool that writes
     * a file the map draws is not exempt from having its decisions pinned. */
    include: ['src/**/*.test.{js,jsx}', 'tools/**/*.test.{js,mjs}'],
  },

  plugins: [react()],
  server: {
    // 3000 belongs to the fleet-server backend, so the frontend can't share it.
    port: 5174,
    open: true,
    // Same-origin API in dev: relative /api/* calls (services/api.js) are proxied
    // to the backend, so no CORS and no hardcoded host baked into the build.
    proxy: {
      '/api': {
        // The REMOTE fleet-server, behind nginx. Dev points here rather than at
        // a local backend because only the remote one runs the POLLER, and the
        // poller is what knows two things nothing else can supply:
        //
        //   · `connectionOnline` — the provider's ONLINE/OFFLINE verdict. A local
        //     API-only instance (POLL_ENABLED=false) leaves it null on every
        //     vehicle, so the whole fleet reads OFFLINE and the ONLINE count is 0.
        //   · a current `movement.state`. Against localhost:3000, EX 31 came back
        //     'resting' while the provider had it 'idling' with the ignition on,
        //     so the card said "Parked" beside an "ENGINE ON" tile.
        //
        // Do NOT start a second poller locally to fix that — both would write to
        // the same shared DB. Point dev at the box that already polls.
        //
        // af-south-1, the migration target. This used to point at the old
        // us-east-1 box, which cost an afternoon: it has neither the auth code
        // nor the accounts, so signing in locally returned "Invalid email or
        // password" from a server that had simply never heard of the user.
        //
        // Neither host has an Elastic IP, so the address rerolls on every
        // stop/start; if this times out, get the current public IP from the EC2
        // console, or override without editing this file:
        //
        //     VITE_PROXY_TARGET=http://<host> npm run dev
        target: process.env.VITE_PROXY_TARGET || 'http://13.247.178.217',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'build', // matches the old CRA output folder name, optional
  },
})
