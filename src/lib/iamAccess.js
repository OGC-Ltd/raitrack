// What one person may do once their own grants are laid over their role.
//
// The server decides access (fleet-server lib/authz/subject, applyPersonalGrants)
// and the IAM page reads its answer. This file exists only so the page can show
// what a change WILL come to before it is saved; the rules are the server's,
// in the server's order: allowances first, denials last, so a denial wins.

/** The scope that means "every organisation this person can reach". */
export const EVERYWHERE = "*";

export const keyOf = (organisationId, permission) => `${organisationId ?? EVERYWHERE}|${permission}`;

/**
 * The grants that will stand after the pending changes, as a Map of
 * key → "allow" | "deny". `pending` is a Map of key → "allow" | "deny" | "inherit".
 */
export function standingGrants(grants, pending) {
  const out = new Map();
  for (const g of grants ?? []) out.set(keyOf(g.organisationId, g.permission), g.effect);
  for (const [key, effect] of pending ?? []) {
    if (effect === "inherit") out.delete(key);
    else out.set(key, effect);
  }
  return out;
}

/**
 * One permission in one organisation.
 *
 *   held    whether they end up with it
 *   source  "role"           the role decides, nothing personal
 *           "allow"          given to them in this organisation
 *           "allow-all"      given to them in every organisation
 *           "deny"           taken from them in this organisation
 *           "deny-all"       taken from them in every organisation
 */
export function resolveIn(org, permission, standing) {
  const fromRole = (org?.fromRoles ?? []).includes(permission);
  const here = standing.get(keyOf(org?.id, permission));
  const all = standing.get(keyOf(null, permission));
  if (here === "deny") return { held: false, fromRole, source: "deny" };
  if (all === "deny") return { held: false, fromRole, source: "deny-all" };
  if (here === "allow") return { held: true, fromRole, source: "allow" };
  if (all === "allow") return { held: true, fromRole, source: "allow-all" };
  return { held: fromRole, fromRole, source: "role" };
}

/**
 * One permission across every organisation the person reaches: in how many
 * the role gives it, and in how many they end up holding it.
 */
export function resolveEverywhere(organisations, permission, standing) {
  const orgs = organisations ?? [];
  let fromRole = 0;
  let held = 0;
  for (const org of orgs) {
    const r = resolveIn(org, permission, standing);
    if (r.fromRole) fromRole += 1;
    if (r.held) held += 1;
  }
  return { total: orgs.length, fromRole, held };
}

/** "all", "some" or "none" of a count. */
export const spread = (n, total) => (total > 0 && n === total ? "all" : n > 0 ? "some" : "none");

/** The pending Map as the body the server takes. */
export function toChanges(pending) {
  return [...(pending ?? [])].map(([key, effect]) => {
    const cut = key.indexOf("|");
    const scope = key.slice(0, cut);
    return { organisationId: scope === EVERYWHERE ? null : scope, permission: key.slice(cut + 1), effect };
  });
}

/**
 * Record a choice. Choosing what already stands on the server is not a change,
 * so it is dropped: the Save button counts real changes only.
 */
export function withChoice(pending, grants, organisationId, permission, effect) {
  const key = keyOf(organisationId, permission);
  const saved = (grants ?? []).find((g) => keyOf(g.organisationId, g.permission) === key)?.effect ?? "inherit";
  const next = new Map(pending ?? []);
  if (effect === saved) next.delete(key);
  else next.set(key, effect);
  return next;
}
