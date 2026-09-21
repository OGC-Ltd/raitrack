/**
 * Map layers — the sidebar's version of the map's layers menu.
 *
 * The sidebar already carried a flat checkbox list under "Map Layers". It said
 * the same words the map's own menu said, in the same order, with no grouping:
 * an org that runs two mills got "Weighbridges", "Sukari Oyani" and "Nyaondo"
 * as three peers, which is three names for two different KINDS of thing.
 *
 * Two branches instead:
 *
 *   Site plans     one row per survey this organisation actually has. The names
 *                  come from the plans themselves, so Sukari opens on Oyani and
 *                  Nyaondo and West Kenya opens on neither — nothing here
 *                  writes an org name down.
 *   Weighbridges   the layer switch, and under it the scales themselves. A row
 *                  is a place you can go: clicking one turns the layer on if it
 *                  is off and takes the camera to that scale.
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

import { useMemo } from 'react';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { useMapLayers } from '../../context/MapLayersContext';
import { useWeighbridges } from '../../hooks/useWeighbridges';
import { TreeNode, TreeSwitch, TreeLink, TreeEmpty, TreeNote } from './SideTree';

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

export default function MapLayersTree() {
  const { layers = [], focusBridge, revealMap } = useMapLayers() ?? {};
  /* A layer switch draws something ON THE MAP, and this tree is reachable from
     every page — flicking one from Maintenance and staying on Maintenance is
     the whole of what the reader sees. Turning a layer OFF goes through here
     too: it is still an instruction about the map, and leaving the reader
     somewhere else to guess whether it took is the same failure. */
  const withMap = (fn) => (...a) => { revealMap?.(); return fn?.(...a); };
  const { orgId } = useFleetLiveShared();
  const { bridges, loading: bridgesLoading } = useWeighbridges(orgId);

  // The ids are FleetMap's: `bridges` for the scales, `site:<planId>` for each
  // survey. Splitting on them rather than on the labels, because a label is
  // a place name and will differ per org while the id shape will not.
  const { sitePlans, bridgeLayer, other } = useMemo(() => groupLayers(layers), [layers]);

  const plansOn = sitePlans.filter(l => l.on).length;
  const scales  = bridges ?? [];

  // Nothing at all to offer: no geometry on this org, or no permission to see
  // layers. A heading over an empty box is worse than no heading.
  if (layers.length === 0) {
    return (
      <div className="side-tree">
        <div className="side-tree__section-title">
          <i className="ti ti-layers" aria-hidden="true" /> Map layers
        </div>
        <TreeEmpty>No layers on this organisation.</TreeEmpty>
      </div>
    );
  }

  return (
    <div className="side-tree">
      <div className="side-tree__section-title">
        <i className="ti ti-layers" aria-hidden="true" /> Map layers
      </div>

      {sitePlans.length > 0 && (
        <TreeNode
          label="Site plans"
          icon="map-2"
          count={plansOn}
          /* 'on' means at least one of them is drawn, the way it does on every
             other node in the sidebar. It was hardcoded, so the node sat lit
             whether anything was on the map or not. */
          tone={plansOn ? 'on' : 'plain'}
        >
          {sitePlans.map(l => (
            <TreeSwitch
              key={l.id}
              label={l.label}
              on={l.on}
              onToggle={withMap(l.onToggle)}
              swatches={l.on ? l.legend : null}
              /* "the Kabras site plan survey" would be saying it twice, and
                 "the Estate areas survey" is not what those are. The label
                 already names the thing; the title says what the switch does
                 to it. */
              title={`Draw ${l.label} on the map`}
            />
          ))}
          {/* A plan that is still fetching says so on its own row rather than
              in a status line that names no plan. */}
          {sitePlans.some(l => l.note) && (
            <TreeNote>
              {sitePlans.filter(l => l.note).map(l => `${l.label} ${l.note}`).join(' · ')}
            </TreeNote>
          )}
        </TreeNode>
      )}

      {bridgeLayer && (
        <TreeNode
          label="Weighbridges"
          icon="scale"
          count={scales.length}
          tone={bridgeLayer.on ? 'on' : 'plain'}
        >
          <TreeSwitch
            label="Show on the map"
            on={bridgeLayer.on}
            onToggle={withMap(bridgeLayer.onToggle)}
            swatches={bridgeLayer.on ? bridgeLayer.legend : null}
          />

          {bridgesLoading && scales.length === 0 && <TreeEmpty>Loading scales…</TreeEmpty>}

          {scales.map(b => (
            <TreeLink
              key={b.id}
              label={b.centerName}
              meta={`#${b.bridgeNo}`}
              onClick={() => focusBridge?.(b)}
              title={`Take the map to ${b.centerName} bridge ${b.bridgeNo}`}
            />
          ))}

          {scales.length > 0 && (
            <TreeNote>
              Clicking a scale takes the map to it. Hover its marker for the last
              ticket; click to keep the card open.
            </TreeNote>
          )}
        </TreeNode>
      )}

      {/* Whatever else the map publishes, flat — it has no tree of its own yet
          and hiding it would be worse than an ungrouped row. */}
      {other.map(l => (
        <TreeSwitch
          key={l.id}
          label={l.label}
          on={l.on}
          onToggle={withMap(l.onToggle)}
          swatches={l.on ? l.legend : null}
        />
      ))}
    </div>
  );
}
