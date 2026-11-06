const TIME_ZONE = "Africa/Nairobi";

function dayInTimeZone(value, timeZone = TIME_ZONE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Collapse repeated sign-ins into one user/day row while preserving events. */
export function groupLoginActivity(rows) {
  const groups = new Map();
  for (const event of rows ?? []) {
    const user = event.user ?? {};
    const day = dayInTimeZone(event.loggedInAt);
    const key = `${user.id ?? user.email ?? user.fullName ?? "unknown"}|${day}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, day, user, events: [] };
      groups.set(key, group);
    }
    group.events.push(event);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    events: group.events.sort((a, b) => Date.parse(b.loggedInAt) - Date.parse(a.loggedInAt)),
  }));
}
