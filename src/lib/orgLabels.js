/**
 * Words an organisation uses for a page in place of ours.
 *
 * Mufindi Paper Mills (KASULU) calls its drivers "staffs" (operator, 19 Nov
 * 2026: "on mufindi, rename drivers to staffs"): its machines are run by
 * estate staff, not hauliers. Only the name changes; the page, its rights
 * (driver:read) and its key stay the same.
 */
const ORG_NAV_LABELS = {
  KASULU: { drivers: "Staffs" },
};

/** The people the Drivers page lists, singular and plural, per organisation. */
const ORG_PEOPLE = {
  KASULU: { one: "staff", many: "staffs", title: "Staff" },
};
const PEOPLE = { one: "driver", many: "drivers", title: "Driver" };

const codeOf = (orgCode) => String(orgCode ?? "").toUpperCase();

/** A nav item's label for this organisation. */
export function navLabel(key, label, orgCode) {
  return ORG_NAV_LABELS[codeOf(orgCode)]?.[key] ?? label;
}

/** A nav item with its label for this organisation (same object when unchanged). */
export function withOrgLabel(item, orgCode) {
  const label = navLabel(item.key, item.label, orgCode);
  return label === item.label ? item : { ...item, label };
}

/** `{ one, many, title }`: "driver", "drivers", "Driver" (or the org's own words). */
export function peopleWords(orgCode) {
  return ORG_PEOPLE[codeOf(orgCode)] ?? PEOPLE;
}
