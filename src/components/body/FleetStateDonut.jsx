import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { ChartContainer, ChartTooltipContent } from "../ui/chart";

// ─── State definitions ───────────────────────────────────────────────────

/**
 * Four states displayed in the donut:
 *
 * Operational : engine on, moving
 * Stationary  : engine on, not moving; includes IDLING
 * Parked      : reporting, engine off
 * Offline     : no recent report
 *
 * IMPORTANT:
 * "Operational" is the display label for the WORKING state.
 * "Working" is the centre total and means:
 *
 *   Operational + Stationary
 */
const STATES = [
  {
    key: "WORKING",
    label: "Operational",
    color: "var(--chart-3)",
  },
  {
    key: "STATIONARY",
    label: "Stationary",
    color: "var(--chart-7)",
  },
  {
    key: "PARKED",
    label: "Parked",
    color: "var(--chart-1)",
  },
  {
    key: "OFFLINE",
    label: "Offline",
    color: "var(--chart-8)",
  },
];

/**
 * Coverage mode for fleets where some units do not have trackers.
 *
 * The slices are mutually exclusive and together account for
 * the full fleet.
 */
const COVER = [
  {
    key: "reportingNow",
    label: "Reporting now",
    color: "var(--chart-3)",
  },
  {
    key: "trackedSilent",
    label: "Tracked, quiet",
    color: "var(--chart-4)",
  },
  {
    key: "untracked",
    label: "No tracker",
    color: "var(--chart-1)",
  },
];

const fmt = function (n) {
  return new Intl.NumberFormat("en-GB").format(n ?? 0);
};

export default function FleetStateDonut({
  state,
  ops,
  mode = "state",
}) {
  const cover = mode === "coverage";
  const worked = mode === "operational";

  // ── Coverage mode (haulage) ───────────────────────────────────────────

  if (cover) {
    const mon = state?.monitoring ?? {};

    const total = mon.total ?? 0;
    const reportingNow = mon.reportingNow ?? 0;
    const trackedSilent = mon.trackedSilent ?? 0;
    const untracked = mon.untracked ?? 0;

    const slots = COVER
      .map(function (s) {
        var val;

        if (s.key === "reportingNow") {
          val = reportingNow;
        } else if (s.key === "trackedSilent") {
          val = trackedSilent;
        } else {
          val = untracked;
        }

        return {
          ...s,
          value: val,
        };
      })
      .filter(function (s) {
        return s.value > 0;
      });

    if (total === 0) {
      return (
        <div className="an-fleet__empty">
          No fleet data
        </div>
      );
    }

    return (
      <div className="an-fleet__top">
        <div className="an-fleet__donut">
          <ChartContainer
            config={Object.fromEntries(
              COVER.map(function (s) {
                return [
                  s.key,
                  {
                    label: s.label,
                    color: s.color,
                  },
                ];
              }),
            )}
            className="an-fleet__chart"
          >
            <PieChart>
              <Tooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={function (v, n) {
                      return (
                        n +
                        ": " +
                        fmt(v) +
                        " units"
                      );
                    }}
                  />
                }
              />

              <Pie
                data={slots}
                dataKey="value"
                nameKey="label"
                innerRadius="62%"
                outerRadius="92%"
                paddingAngle={2}
                strokeWidth={0}
                isAnimationActive={false}
              >
                {slots.map(function (s) {
                  return (
                    <Cell
                      key={s.key}
                      fill={s.color}
                    />
                  );
                })}
              </Pie>
            </PieChart>
          </ChartContainer>

          <div className="an-fleet__centre">
            <div className="an-fleet__centre-v">
              {fmt(total)}
            </div>

            <div className="an-fleet__centre-l">
              fleet
            </div>
          </div>
        </div>

        <div className="an-fleet__legend">
          {COVER.map(function (s) {
            var val;

            if (s.key === "reportingNow") {
              val = reportingNow;
            } else if (s.key === "trackedSilent") {
              val = trackedSilent;
            } else {
              val = untracked;
            }

            if (val === 0) {
              return null;
            }

            return (
              <div
                key={s.key}
                className="an-fleet__leg"
              >
                <span
                  className="an-fleet__dot"
                  style={{
                    background: s.color,
                  }}
                />

                <span className="an-fleet__leg-k">
                  {s.label}
                </span>

                <span className="an-fleet__leg-v">
                  {fmt(val)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Operational mode (plant) ──────────────────────────────────────────
  //
  // Display:
  //   Operational
  //   Stationary
  //   Parked
  //   Offline
  //
  // Centre:
  //   Working
  //
  // Working = Operational + Stationary
  //
  // IDLING is merged into Stationary.

  if (worked) {
    const counts = state?.counts ?? {};

    const mergedCounts = {
      WORKING: counts.WORKING ?? 0,

      STATIONARY:
        (counts.STATIONARY ?? 0) +
        (counts.IDLING ?? 0),

      PARKED: counts.PARKED ?? 0,

      OFFLINE: counts.OFFLINE ?? 0,
    };

    // Working = Operational + Stationary
    var workingUnits =
      mergedCounts.WORKING +
      mergedCounts.STATIONARY;

    const slots = STATES
      .map(function (s) {
        return {
          ...s,
          value: mergedCounts[s.key] ?? 0,
        };
      })
      .filter(function (s) {
        return s.value > 0;
      });

    if (slots.length === 0) {
      return (
        <div className="an-fleet__top">
          <div className="an-fleet__donut">
            <div
              className="an-fleet__centre"
              style={{
                position: "relative",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div className="an-fleet__centre-v">
                0
              </div>

              <div className="an-fleet__centre-l">
                Working
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="an-fleet__top">
        <div className="an-fleet__donut">
          <ChartContainer
            config={Object.fromEntries(
              STATES.map(function (s) {
                return [
                  s.key,
                  {
                    label: s.label,
                    color: s.color,
                  },
                ];
              }),
            )}
            className="an-fleet__chart"
          >
            <PieChart>
              <Tooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={function (v, n) {
                      return (
                        n +
                        ": " +
                        fmt(v) +
                        " units"
                      );
                    }}
                  />
                }
              />

              <Pie
                data={slots}
                dataKey="value"
                nameKey="label"
                innerRadius="62%"
                outerRadius="92%"
                paddingAngle={2}
                strokeWidth={0}
                isAnimationActive={false}
              >
                {slots.map(function (s) {
                  return (
                    <Cell
                      key={s.key}
                      fill={s.color}
                    />
                  );
                })}
              </Pie>
            </PieChart>
          </ChartContainer>

          {/* Centre = total Working units */}
          <div className="an-fleet__centre">
            <div className="an-fleet__centre-v">
              {fmt(workingUnits)}
            </div>

            <div className="an-fleet__centre-l">
              Working
            </div>
          </div>
        </div>

        <div className="an-fleet__legend">
          {slots.map(function (s) {
            return (
              <div
                key={s.key}
                className="an-fleet__leg"
              >
                <span
                  className="an-fleet__dot"
                  style={{
                    background: s.color,
                  }}
                />

                <span className="an-fleet__leg-k">
                  {s.label}
                </span>

                <span className="an-fleet__leg-v">
                  {fmt(s.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Legacy state mode ─────────────────────────────────────────────────
  //
  // Same display semantics:
  //
  //   Operational
  //   Stationary
  //   Parked
  //   Offline
  //
  // Centre:
  //   Working = Operational + Stationary
  //
  // IDLING is merged into Stationary.

  const counts = state?.counts ?? {};

  const mergedCounts = {
    WORKING: counts.WORKING ?? 0,

    STATIONARY:
      (counts.STATIONARY ?? 0) +
      (counts.IDLING ?? 0),

    PARKED: counts.PARKED ?? 0,

    OFFLINE: counts.OFFLINE ?? 0,
  };

  const slots = STATES
    .map(function (s) {
      return {
        ...s,
        value: mergedCounts[s.key] ?? 0,
      };
    })
    .filter(function (s) {
      return s.value > 0;
    });

  // Working = Operational + Stationary
  var workingUnits =
    mergedCounts.WORKING +
    mergedCounts.STATIONARY;

  if (slots.length === 0) {
    return (
      <div className="an-fleet__top">
        <div className="an-fleet__donut">
          <div
            className="an-fleet__centre"
            style={{
              position: "relative",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div className="an-fleet__centre-v">
              0
            </div>

            <div className="an-fleet__centre-l">
              Working
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="an-fleet__top">
      <div className="an-fleet__donut">
        <ChartContainer
          config={Object.fromEntries(
            STATES.map(function (s) {
              return [
                s.key,
                {
                  label: s.label,
                  color: s.color,
                },
              ];
            }),
          )}
          className="an-fleet__chart"
        >
          <PieChart>
            <Tooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={function (v, n) {
                    return (
                      n +
                      ": " +
                      fmt(v) +
                      " units"
                    );
                  }}
                />
              }
            />

            <Pie
              data={slots}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {slots.map(function (s) {
                return (
                  <Cell
                    key={s.key}
                    fill={s.color}
                  />
                );
              })}
            </Pie>
          </PieChart>
        </ChartContainer>

        {/* Centre = total Working units */}
        <div className="an-fleet__centre">
          <div className="an-fleet__centre-v">
            {fmt(workingUnits)}
          </div>

          <div className="an-fleet__centre-l">
            Working
          </div>
        </div>
      </div>

      <div className="an-fleet__legend">
        {slots.map(function (s) {
          return (
            <div
              key={s.key}
              className="an-fleet__leg"
            >
              <span
                className="an-fleet__dot"
                style={{
                  background: s.color,
                }}
              />

              <span className="an-fleet__leg-k">
                {s.label}
              </span>

              <span className="an-fleet__leg-v">
                {fmt(s.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}