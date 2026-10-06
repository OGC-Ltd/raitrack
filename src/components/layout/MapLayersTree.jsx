/**
 * Map layers — the sidebar's version of the map's layers menu.
 *
 * The sidebar already carried a flat checkbox list under "Map Layers". It said
 * the same words the map's own menu said, in the same order, with no grouping:
 * an org that runs two mills got "Weighbridges", "Sukari Oyani" and "Nyaondo"
 * as three peers, which is three names for two different KINDS of thing.
 *
 * Redesigned 2026-10-02 (operator: the trees read cluttered): no branches.
 * Two collapsible parts, one level deep with no guide lines: Site plans (the
 * layer switches in one card) and Quick links (the scales' switch, then each
 * site as a place to go). Each remembers whether it was left open, and starts
 * shut when it holds more than eight rows. The grouping rules below are
 * unchanged.
 *
 * The two parts:
 *
 *   Site plans     one row per survey this organisation actually has. The names
 *                  come from the plans themselves, so Sukari opens on Oyani and
 *                  Nyaondo and West Kenya opens on neither — nothing here
 *                  writes an org name down.
 *   Quick links    the layer switch, and under it one row per weighing site.
 *                  A site with several scales shows one coloured box per scale, holding its bridge number
 *                  ("Factory ▢▢"); the colour is how recently that scale last
 *                  weighed. The name goes to the site's first scale, a box to
 *                  that scale. Renamed from "Weighbridges" 2026-09-22 and from
 *                  "Quick line" 2026-09-25; the data, the hook and the layer id
 *                  are all still `bridges`.
 *
 * ## Why it reads the published layer list rather than building its own
 *
 * `mapLayers` (MapLayersContext) is FleetMap's own description of what this org
 * has and what is currently drawn — `{ id, label, on, onToggle, legend, note }`
 * — gated on permission and on the org actually holding the geometry. Grouping
 * it here by the shape of its ids is the whole of this component: the switches
 * are the map's, so a plan turned on here is on in the map's own menu below
 * 1024px, and there is no second source of truth about what is drawn.
 */

import { useContext, useMemo, useState } from 'react';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { useMapLayers } from '../../context/MapLayersContext';
import { useWeighbridges } from '../../hooks/useWeighbridges';
import { spokenSiteName } from '../../lib/spokenName';
import { TreeCountsMasked, MASKED_COUNT } from './SideTree';
import './MapLayersTree.css';

/* Surveyed ground, whatever FleetMap happens to call the id.
   `zones` (Estate areas) and `plan` (Planting plan) belong with the surveys.
   They are Mufindi's, and Mufindi has no `site:` layers at all — SITE_PLANS
   carries entries for westsugar, sukari and menengai only — so on that org
   alone the Site plans bucket came out empty, the node never rendered, and its
   two layers dropped through to the ungrouped list at the bottom as bare
   switches under no heading. The same kind of thing as every other org's
   survey, shown differently for no reason a reader could see.

   They keep their own ids: `zones` and `plan` are what mapPrefs stores under
   and what FleetMap's toggles write, and renaming them to suit a grouping rule
   would be moving the data to fit the furniture.

   Module scope, so it is one Set for the life of the page rather than a new
   one per render that the grouping memo would have to depend on. */
const SURVEY_IDS = new Set(['zones', 'plan']);

/**
 * Sort the layers FleetMap publishes into the three places this tree puts them.
 *
 * Exported because it is the whole of the rule and none of the rendering: which
 * org sees a Site plans node at all is decided here, and that is worth a test
 * rather than a click-through per organisation.
 */
export function groupLayers(layers = []) {
  const out = { sitePlans: [], bridgeLayer: null, other: [] };
  for (const l of layers) {
    if (l?.id === 'bridges') out.bridgeLayer = l;
    else if (String(l?.id).startsWith('site:') || SURVEY_IDS.has(l?.id)) out.sitePlans.push(l);
    // Anything FleetMap adds later still gets shown rather than silently
    // dropped, which is what grouping by a fixed list would have done.
    else out.other.push(l);
  }
  return out;
}

/* How recently a scale last weighed, as the colour of its box. */
const HOUR_MS = 60 * 60_000;
export function bridgeActivity(bridge, now = Date.now()) {
  const at = bridge?.last?.at ? Date.parse(bridge.last.at) : NaN;
  if (!Number.isFinite(at)) return 'idle';
  const age = now - at;
  if (age < HOUR_MS) return 'live';
  if (age < 24 * HOUR_MS) return 'today';
  return 'idle';
}
const ACTIVITY_WORDS = { live: 'weighed in the last hour', today: 'weighed in the last 24 hours', idle: 'nothing in the last 24 hours' };

/** Scales grouped by the site they stand at, in first-seen order, each site's
 *  scales in bridge-number order. Exported for the test. */
export function groupBridges(bridges = []) {
  const bySite = new Map();
  for (const b of bridges) {
    const key = b.centerCode ?? b.centerName;
    if (!bySite.has(key)) bySite.set(key, { key, name: b.centerName, scales: [] });
    bySite.get(key).scales.push(b);
  }
  for (const site of bySite.values()) {
    site.scales.sort((a, b) => (a.bridgeNo ?? Infinity) - (b.bridgeNo ?? Infinity));
  }
  return [...bySite.values()];
}

function agoLabel(iso, now = Date.now()) {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return null;
  if (mins < 60) return `${Math.max(mins, 0)} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

/** One layer: its name, its colours while drawn, and a switch. */
function LayerSwitch({ label, sub = null, on, onToggle, swatches = null, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(on)}
      className={`layers__switch${on ? ' layers__switch--on' : ''}`}
      onClick={onToggle}
      title={title}
    >
      <span className="layers__switch-text">
        <span className="layers__switch-label">{label}</span>
        {sub && <span className="layers__switch-sub">{sub}</span>}
      </span>
      {/* The layer's colours, where the layer is drawn. Read-only: the key
          that names them stays in the map's own legend. */}
      {on && swatches?.length > 0 && (
        <span className="side-tree__swatches" aria-hidden="true">
          {swatches.map(sw => (
            <span key={sw.key} className="side-tree__swatch" style={{ '--sw': sw.color }} />
          ))}
        </span>
      )}
      <span className="layers__track" aria-hidden="true"><span className="layers__thumb" /></span>
    </button>
  );
}

/* Folds that start shut once they hold more than this many rows — a tenant
   with twenty surveys or a dozen sites should not open on a wall of them. */
const FOLD_AT = 8;
const foldKey = (id) => `ft-sidebar-fold:${id}`;

function readFold(id) {
  try {
    const v = localStorage.getItem(foldKey(id));
    return v === '1' ? true : v === '0' ? false : null;
  } catch { return null; }
}

/**
 * A collapsible part of the block: a slim header (chevron, name, a summary
 * that stays readable while shut) over its content. Not a tree: one level, no
 * guide lines. Remembered per browser; until the reader chooses, it starts
 * open unless it holds more than FOLD_AT rows.
 */
function Fold({ id, label, summary, size, children }) {
  const [open, setOpen] = useState(() => readFold(id) ?? size <= FOLD_AT);
  const bodyId = `layers-fold-${id}`;
  const toggle = () => setOpen((v) => {
    try { localStorage.setItem(foldKey(id), v ? '0' : '1'); } catch { /* storage unavailable */ }
    return !v;
  });
  return (
    <section className={`layers__fold${open ? ' layers__fold--open' : ''}`}>
      <button
        type="button"
        className="layers__fold-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <i className="ti ti-chevron-right layers__fold-chev" aria-hidden="true" />
        <span className="layers__fold-label">{label}</span>
        {summary && <span className="layers__fold-summary">{summary}</span>}
      </button>
      {open && <div id={bodyId} className="layers__fold-body">{children}</div>}
    </section>
  );
}

export default function MapLayersTree() {
  const { layers = [], focusBridge, revealMap } = useMapLayers() ?? {};
  /* A layer switch draws something ON THE MAP, and this block is reachable
     from every page — flicking one from Maintenance and staying there shows
     nothing. Turning one OFF goes through here too. */
  const withMap = (fn) => (...a) => { revealMap?.(); return fn?.(...a); };
  const { orgId } = useFleetLiveShared();
  const { bridges, loading: bridgesLoading } = useWeighbridges(orgId);
  // Limited access (no map:read): counts read "–", as in the Fleets block.
  const masked = useContext(TreeCountsMasked);
  const n = (v) => (masked ? MASKED_COUNT : v);

  const { sitePlans, bridgeLayer, other } = useMemo(() => groupLayers(layers), [layers]);
  const scales = bridges ?? [];
  const sites  = useMemo(() => groupBridges(bridges ?? []), [bridges]);
  const plain  = [...sitePlans, ...other];
  const plainOn = plain.filter(l => l.on).length;

  if (layers.length === 0) {
    return (
      <div className="side-tree layers">
        <div className="side-tree__section-title">
          <i className="ti ti-layers" aria-hidden="true" /> Map layers
        </div>
        <p className="layers__empty">No layers on this organisation.</p>
      </div>
    );
  }

  return (
    <div className="side-tree layers">
      <div className="side-tree__section-title">
        <i className="ti ti-layers" aria-hidden="true" /> Map layers
      </div>

      {/* Surveys, then anything FleetMap adds later, as switches in one card.
          The summary says how many are drawn, so a shut fold still answers
          "is anything on?". */}
      {plain.length > 0 && (
        <Fold
          id="site-plans"
          label="Site plans"
          summary={`${n(plainOn)} of ${n(plain.length)} on`}
          size={plain.length}
        >
          <div className="layers__card">
            {plain.map(l => (
              <LayerSwitch
                key={l.id}
                label={l.label}
                on={l.on}
                onToggle={withMap(l.onToggle)}
                swatches={l.legend}
                title={`${l.on ? 'Hide' : 'Draw'} ${l.label} on the map`}
              />
            ))}
          </div>
        </Fold>
      )}

      {/* The scales: the layer switch, then each site as a place to GO — a
          name takes the map to the site's first scale, a numbered box to that
          scale, coloured by how recently it last weighed. "Quick links" is
          the operator's name for this (renamed 2026-09-22 / 09-25). */}
      {bridgeLayer && (
        <Fold
          id="quick-links"
          label="Quick links"
          summary={sites.length
            ? `${n(sites.length)} site${sites.length === 1 ? '' : 's'} · ${n(scales.length)} scale${scales.length === 1 ? '' : 's'}`
            : null}
          size={sites.length}
        >
          <div className="layers__card">
            <LayerSwitch
              label="Show on the map"
              on={bridgeLayer.on}
              onToggle={withMap(bridgeLayer.onToggle)}
              swatches={bridgeLayer.legend}
              title={`${bridgeLayer.on ? 'Hide' : 'Draw'} the weighbridges on the map`}
            />
          </div>

          {bridgesLoading && sites.length === 0 && <p className="layers__empty">Loading scales…</p>}

          {sites.length > 0 && (
            <div className="layers__sites">
              <div className="layers__sites-head">
                <span>Go to</span>
                <span className="layers__key" aria-hidden="true">
                  <i className="side-tree__bridgebox side-tree__bridgebox--live" /> hour
                  <i className="side-tree__bridgebox side-tree__bridgebox--today" /> today
                  <i className="side-tree__bridgebox side-tree__bridgebox--idle" /> idle
                </span>
              </div>
              {sites.map(site => {
                const name = spokenSiteName(site.name);
                return (
                  <div key={site.key} className="layers__site">
                    <button
                      type="button"
                      className="layers__site-name"
                      onClick={() => focusBridge?.(site.scales[0])}
                      title={`Take the map to ${name}`}
                    >
                      <i className="ti ti-map-pin" aria-hidden="true" />
                      <span>{name}</span>
                    </button>
                    <span className="side-tree__bridgeboxes">
                      {site.scales.map(b => {
                        const act = bridgeActivity(b);
                        const ago = b.last?.at ? agoLabel(b.last.at) : null;
                        const what = b.label ?? (b.bridgeNo != null ? `Bridge ${b.bridgeNo}` : 'Scale');
                        return (
                          <button
                            key={b.id}
                            type="button"
                            className={`side-tree__bridgebox side-tree__bridgebox--${act}`}
                            onClick={() => focusBridge?.(b)}
                            title={`${name} ${what}: ${ago ? `last weighed ${ago}` : ACTIVITY_WORDS[act]}`}
                            aria-label={`${name} ${what}, ${ACTIVITY_WORDS[act]}`}
                          >
                            {/* The provider's bridge number, which runs across
                                sites; a scale with no tickets gets a dot. */}
                            {b.bridgeNo ?? '·'}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Fold>
      )}
    </div>
  );
}
