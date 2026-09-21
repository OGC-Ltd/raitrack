// Today/Week/Month toggle used in the header.

import "../../index.css";

export default function TimeRangePicker({ options = [], value, onChange }) {
  return (
    <div className="time-range-picker">
      {options.map((option) => (
        <button
          key={option}
          className={`time-range-picker__btn${value === option ? " time-range-picker__btn--active" : ""}`}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
