// Fuel › Report: what the operator picked and how they like the page laid out.
//
// Two kinds of state, kept apart:
//   - the period and the request last executed live for the session, so
//     leaving the page and coming back shows the same report — the report
//     itself is in the query cache under the request's key;
//   - the unit last picked, per organisation, the period PRESET last picked,
//     and the layout (header folded, chart layers) are this viewer's
//     preferences, persisted by store/persist. Per organisation because a unit
//     only exists inside one fleet; the preset rather than its dates because
//     "Yesterday" should mean yesterday on the day the page is opened.

import { createSlice } from "@reduxjs/toolkit";

export const FUEL_REPORT_PREFS = ["unitByOrg", "presetId", "headerCollapsed", "bg", "lines", "marks"];

/** The period presets, in the order the chips show them. */
export const PERIOD_PRESETS = ["today", "yesterday", "week", "month"];

const initialState = {
  unitByOrg: {},          // { [orgId]: vehicleId } — the unit last picked there
  span: null,            // { from, to, id } as datetime-local strings; null = from presetId
  presetId: "today",     // the preset last picked — kept when dates are typed by hand
  request: null,         // { unitId, from, to } ms — the last Execute
  tab: "graph",
  headerCollapsed: false,
  bg: { trip: true, parking: true, stop: true },
  lines: { fuelL: true, speedKmh: false, mileageKm: false },
  marks: { fill: true, drain: true, stop: true },
};

const fuelReportSlice = createSlice({
  name: "fuelReport",
  initialState,
  reducers: {
    unitChosen: {
      reducer(state, { payload: { orgId, unitId } }) {
        if (!orgId) return;
        if (unitId) state.unitByOrg[orgId] = unitId;
        else delete state.unitByOrg[orgId];
      },
      prepare: (orgId, unitId) => ({ payload: { orgId, unitId: unitId ?? null } }),
    },
    spanChosen(state, { payload }) {
      state.span = payload;
      // Hand-typed dates (id null) are this visit's; the preset stays the one
      // the page opens on next time.
      if (PERIOD_PRESETS.includes(payload?.id)) state.presetId = payload.id;
    },
    executed(state, { payload }) { state.request = payload; },
    tabChosen(state, { payload }) { state.tab = payload; },
    headerToggled(state) { state.headerCollapsed = !state.headerCollapsed; },
    layerToggled(state, { payload: { group, key } }) {
      if (state[group] && key in state[group]) state[group][key] = !state[group][key];
    },
  },
});

export const { unitChosen, spanChosen, executed, tabChosen, headerToggled, layerToggled } = fuelReportSlice.actions;
export default fuelReportSlice.reducer;
