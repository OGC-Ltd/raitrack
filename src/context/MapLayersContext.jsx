// MapLayersContext — shared map actions between FleetMap and other components.
//
// - publishLayers: FleetMap registers its layer list → SidePanel renders checkboxes
// - registerFocus: FleetMap registers handleFocusVehicle → AppHeader search calls it
// - registerPlayback: FleetMap registers its route-playback starter → the vehicle panel's Playback button calls it
// - registerFilter: FleetMap registers handleFilter → SidePanel stat cards and the
//   mobile status rail call it. It must be `handleFilter` and NOT the raw
//   `setActiveFilter` setter: the setter only changes which markers are drawn,
//   while handleFilter also moves the camera onto them. CRITICAL and WARNING
//   usually select one unit out of hundreds, so without the camera move the
//   card reads as "the map just emptied".
//
// - publishStranded / stranded: FleetMap is the only place that can work out
//   which units are stranded — the test needs the estate's zone geometry, which
//   only the map has loaded — so it computes the list and publishes it for the
//   sidebar's Fleets tree to render. Same direction as `layers`.
// - registerFocusBridge / focusBridge: takes the camera to a weighbridge and
//   turns its layer on, for the rows under the sidebar's Weighbridges node.
//
// - registerReveal / revealMap: put the map ON SCREEN. FleetMap stays mounted
//   behind the other tabs and, on a phone, behind a button, so every control
//   in this file can change what the map draws while the reader is looking at
//   Drivers or Maintenance and sees nothing happen at all. The sidebar is
//   reachable from every page; these controls exist for no purpose except the
//   map; so acting on one is a request to BE there. Anything that changes what
//   the map shows calls this first.
//
// `activeFilter` flows the other way — FleetMap publishes it, so the sidebar
// cards and the mobile rail both highlight from one value rather than each
// keeping a copy. They are two views of one filter, and the map is the only
// thing that knows which one is really applied: it also clears the filter
// itself in places the panels cannot see (switching organisation, and the
// per-company refit as a new fleet loads).

import { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import { useAppContext } from './AppContext';

const MapLayersContext = createContext(null);

export function MapLayersProvider({ children }) {
  /* Safe: App.jsx mounts this provider INSIDE AppProvider. */
  const { setDesktopActiveTab, setMobileActiveTab } = useAppContext();
  const [layers, setLayers] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [stranded, setStranded] = useState([]);
  /* The units panel belongs to FleetMap — it needs the map's route toggle and
     its clock — but on a desktop it is OPENED from the sidebar. Only the open
     flag crosses; the panel and its data stay where they were. */
  const [unitsOpen, setUnitsOpen] = useState(false);
  const focusFnRef    = useRef(null);
  const filterFnRef   = useRef(null);
  const playbackFnRef = useRef(null);
  const bridgeFnRef   = useRef(null);
  const revealFnRef   = useRef(null);

  const publishLayers  = useCallback((l) => setLayers(l ?? []), []);
  const registerFocus  = useCallback((fn) => { focusFnRef.current  = fn; }, []);
  const focusVehicle   = useCallback((id) => { focusFnRef.current?.(id); }, []);
  const registerFilter = useCallback((fn) => { filterFnRef.current = fn; }, []);
  const applyFilter    = useCallback((f)  => { filterFnRef.current?.(f); }, []);
  const registerPlayback = useCallback((fn) => { playbackFnRef.current = fn; }, []);
  const startPlayback    = useCallback((id) => { playbackFnRef.current?.(id); }, []);
  // Raised by FleetMap whenever the filter changes, from whichever control
  // changed it.
  const publishFilter  = useCallback((f) => setActiveFilter(f ?? 'all'), []);
  const publishStranded = useCallback((list) => setStranded(list ?? []), []);
  const registerFocusBridge = useCallback((fn) => { bridgeFnRef.current = fn; }, []);
  const focusBridge = useCallback((b) => { bridgeFnRef.current?.(b); }, []);
  const registerReveal = useCallback((fn) => { revealFnRef.current = fn; }, []);
  /* The tab switch happens HERE, not only in the function FleetMap registers.
     A reader who last left the app on Drivers has never mounted the map this
     session, so there is nothing registered to call — and a sidebar control
     that works only once the map has already been visited is the bug this is
     fixing, not a fix for it. Switching the tab is what mounts FleetMap; its
     own function then handles the part only it can know about, the phone's
     map overlay. Both are idempotent, so doing the tabs twice costs nothing. */
  const revealMap = useCallback(() => {
    setDesktopActiveTab('fleet');
    setMobileActiveTab('map');
    revealFnRef.current?.();
  }, [setDesktopActiveTab, setMobileActiveTab]);

  // Memoised: `layers` changes on every FleetMap reconcile, and an unmemoised
  // object would re-render every consumer — including the 793-line vehicle
  // panel — on each SSE frame.
  const value = useMemo(() => ({
    layers, publishLayers,
    registerFocus, focusVehicle,
    registerFilter, applyFilter,
    registerPlayback, startPlayback,
    activeFilter, publishFilter,
    stranded, publishStranded,
    registerFocusBridge, focusBridge,
    registerReveal, revealMap,
    unitsOpen, setUnitsOpen,
  }), [
    layers, publishLayers, registerFocus, focusVehicle, registerFilter,
    applyFilter, registerPlayback, startPlayback, activeFilter, publishFilter,
    stranded, publishStranded, registerFocusBridge, focusBridge,
    registerReveal, revealMap, unitsOpen, setUnitsOpen,
  ]);

  return (
    <MapLayersContext.Provider value={value}>
      {children}
    </MapLayersContext.Provider>
  );
}

export function useMapLayers() {
  return useContext(MapLayersContext);
}
