/**
 * The period on Fuel and on Staffs › Operators: Today, 7, 14 or 31 days, or
 * any one day on the calendar (operator, 19 Nov 2026: "alongside the 7 days,
 * 14 day 31 day we need to select a custom day and by default it should be on
 * today"). `pick` is what lib/factoryFuel periodRange reads.
 */
import DateRangePicker from "../layout/DateRangePicker";
import { periodRange } from "../../lib/factoryFuel";

export const FUEL_PERIODS = [["today", "Today"], [7, "7 days"], [14, "14 days"], [31, "31 days"]];

/** Nothing on the calendar before this (a year back is far beyond any plan kept). */
const YEAR = 366 * 86_400_000;

/**
 * @param {{ pick: "today"|number|string, onPick: (p) => void, chips?: boolean, label?: string }} props
 *   `chips` draws the buttons as the Staffs page's chips; otherwise as the
 *   Fuel header's segmented switch.
 */
export default function FuelPeriodPicker({ pick, onPick, chips = false, label = "Days shown" }) {
  const today = periodRange("today").to;
  const custom = typeof pick === "string" && pick !== "today";
  const day = custom ? pick : today;
  const btn = (on) => (chips ? `dr-chip${on ? " dr-chip--active" : ""}` : `dr-viewswitch__btn${on ? " is-on" : ""}`);
  return (
    <span className="fuel-period">
      <span className={chips ? "dr-seg" : "dr-viewswitch"} role="group" aria-label={label}>
        {FUEL_PERIODS.map(([p, text]) => (
          <button key={p} type="button" aria-pressed={pick === p} className={btn(pick === p)} onClick={() => onPick(p)}>
            {text}
          </button>
        ))}
      </span>
      <DateRangePicker
        from={day} to={day} today={today} maxDays={1} quickPicks={false} align="right"
        minDay={periodRange("today", Date.now() - YEAR).to}
        label="Pick a day" text={custom ? undefined : "Pick a day"} on={custom}
        onChange={(f) => onPick(f === today ? "today" : f)}
      />
    </span>
  );
}
