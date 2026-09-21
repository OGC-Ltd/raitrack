/**
 * Fleets — the sidebar's version of the map's funnel and units menus.
 *
 * Four branches, in the order an operator reaches for them:
 *
 *   Machine types        narrow the fleet to the machines in question
 *   In transit only      narrow it again to what is moving
 *   Stopped in transit   the units that were moving and have not been for ten
 *                        minutes, outside every known zone. NOT a filter — see
 *                        below
 *   Units                every unit, to track or to open
 *
 * The first two change what the map draws. The last two are lists you click a
 * row of to go somewhere. FleetsMenu's own header explains why mixing those two
 * behaviours needs care; here the tree does the explaining, because a branch
 * that toggles and a branch that lists are visibly different things before
 * either is opened.
 *
 * ## Where the data comes from
 *
 * Everything except the stranded list is derived here from the live fleet and
 * the per-org selections in AppContext, exactly as the map's menus derived it —
 * this is a second view of the same state, not a copy of it, so a type ticked
 * here is ticked in the map's funnel below 1024px too.
 *
 * The stranded list is the exception and has to arrive by context. Deciding a
 * unit is stranded needs the estate's zone geometry to rule out the ones parked
 * somewhere they belong, and only FleetMap has loaded that. It computes the
 * list and publishes it (MapLayersContext), the same direction the layers
 * travel.
 */

import { useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { useMapLayers } from '../../context/MapLayersContext';
import { usePermissions } from '../../hooks/usePermissions';
import { fleetTypeOptions, isInTransit } from '../../lib/vehicleMap';
import { TreeNode, TreeSwitch, TreeLink, TreeEmpty, TreeNote } from './SideTree';

/** How long it has been standing. Same wording as the map's own flagged list. */
function stoppedFor(ms) {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${String(mins % 60).padStart(2, '0')}m`;
}

export default function FleetsTree() {
  const {
    fleetTypes = [], setFleetTypes,
    inTransitOnly, setInTransitOnly,
  } = useAppContext();
  const { vehicles = [] } = useFleetLiveShared();
  const { focusVehicle, stranded = [], setUnitsOpen, revealMap } = useMapLayers() ?? {};
  const { can } = usePermissions();

  const options  = useMemo(() => fleetTypeOptions(vehicles), [vehicles]);
  const selected = useMemo(() => new Set(fleetTypes), [fleetTypes]);

  /* How many units are actually moving.

     The badge beside Movement used to be `inTransitOnly ? 1 : 0` — the number
     of filters switched on, not the number of vehicles. In this slot that is
     a lie by neighbourhood: Units counts units, Stopped in transit counts
     units, and a machine type counts units, so a 1 here read as "one unit is
     in transit" on a fleet with dozens moving.

     isInTransit rather than a local speed test: it is the same predicate the
     map marker, the vehicle card and the topbar's IN TRANSIT button use, so
     this number cannot disagree with them. It is ONLINE and moving under
     power — not `status !== 'parked'`, which counts a yard of idling units as
     though they were driving. */
  const inTransitCount = useMemo(() => vehicles.filter(isInTransit).length, [vehicles]);

  // A fleet of one machine type has nothing to narrow. The same rule the map's
  // funnel uses, and for the same reason: a control that cannot change the view
  // is worse than no control.
  const showTypes = can('map:filter') && options.length > 1;
  const canFilter = can('map:filter');

  /* Every control in this tree narrows what the MAP draws, and the tree is on
     screen from every page. Narrowing the map from the Drivers page and staying
     on Drivers shows the reader nothing at all, so acting on one of these is
     taken as a request to be looking at the map. */
  const toggleType = (kind) => {
    revealMap?.();
    setFleetTypes(selected.has(kind)
      ? fleetTypes.filter(k => k !== kind)
      : [...fleetTypes, kind]);
  };

  return (
    <div className="side-tree">
      <div className="side-tree__section-title">
        <i className="ti ti-truck" aria-hidden="true" /> Fleets
      </div>

      {showTypes && (
        <TreeNode
          label="Machine types"
          icon="filter"
          count={selected.size}
          tone={selected.size ? 'on' : 'plain'}
        >
          {options.map(o => (
            <TreeSwitch
              key={o.kind}
              label={o.label}
              count={o.count}
              on={selected.has(o.kind)}
              onToggle={() => toggleType(o.kind)}
              title={`Show only ${o.label.toLowerCase()} on the map`}
            />
          ))}
          <TreeNote>
            Nothing ticked means the whole fleet, not an empty map.
          </TreeNote>
        </TreeNode>
      )}

      {canFilter && (
        <TreeNode
          label="Movement"
          icon="route"
          count={inTransitCount}
          /* 'on' means THIS FILTER IS APPLIED, which is what it means on
             Machine types one node up. It was hardcoded, so Movement sat lit
             from the moment the tree rendered and the highlight said nothing. */
          tone={inTransitOnly ? 'on' : 'plain'}
        >
          <TreeSwitch
            label="In transit only"
            count={inTransitCount}
            on={Boolean(inTransitOnly)}
            onToggle={() => { revealMap?.(); setInTransitOnly(v => !v); }}
            title="Draw only the units that are moving"
          />
        </TreeNode>
      )}

      {canFilter && (
        <TreeNode
          label="Stopped in transit"
          icon="alert-triangle"
          count={stranded.length}
          tone="alert"
        >
          {stranded.length === 0 ? (
            <TreeEmpty>Nothing standing where it should not be.</TreeEmpty>
          ) : (
            <>
              {stranded.map(({ vehicle, why }) => (
                <TreeLink
                  key={vehicle.id}
                  tone="alert"
                  label={vehicle.id}
                  meta={stoppedFor(why.forMs)}
                  note={[
                    why.state === 'idling' ? 'engine running' : 'engine off',
                    // Said out loud rather than assumed either way: we know
                    // where it stopped only once the zone engine has actually
                    // evaluated this unit.
                    why.zonesKnown ? null : 'location unverified',
                  ].filter(Boolean).join(' · ')}
                  onClick={() => focusVehicle?.(vehicle.id)}
                  title="Show this unit on the map"
                />
              ))}
              <TreeNote>
                Moving, then stationary 10 min or more, outside every known zone.
              </TreeNote>
            </>
          )}
        </TreeNode>
      )}

      {/* Units is a LINK, not a branch.
          It opened a tree of 597 rows, each a tick box for tracking. Two things
          wrong with that: clicking a unit meant "show me this one" and got a
          checkbox instead, and the list itself — search, sortable columns,
          recency, the route toggle — already exists and is good. This row opens
          that panel, unchanged, exactly as the map's own Units button does
          below 1024px. The panel is still FleetMap's, because it needs the
          map's route toggle and its clock; only the flag that opens it travels
          (MapLayersContext). */}
      <button
        type="button"
        className="side-tree__row side-tree__row--link side-tree__row--lead"
        onClick={() => { revealMap?.(); setUnitsOpen?.(true); }}
      >
        <i className="ti ti-list side-tree__icon" aria-hidden="true" />
        <span className="side-tree__rowlabel">Units</span>
        <span className="side-tree__rowcount">{vehicles.length}</span>
      </button>

      {/* Kept out of the tree on purpose. Clearing is a single action on
          everything above, and burying it inside one branch would make it look
          like it belonged to that branch alone. */}
      {(selected.size > 0 || inTransitOnly) && (
        <button
          type="button"
          className="side-tree__row side-tree__row--link"
          onClick={() => { revealMap?.(); setFleetTypes([]); if (inTransitOnly) setInTransitOnly(false); }}
        >
          <span className="side-tree__rowlabel">Show the whole fleet</span>
        </button>
      )}
    </div>
  );
}
