// What the signed-in account may do IN THE ORGANISATION currently open.
//
// Roles are org-scoped on the server, so "can they see analytics" has no answer
// on its own — the same person can be a manager at one site and an operator at
// another. Everything here is therefore resolved against the active company,
// and re-resolves when that changes.

import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useAppSelector } from "../context/AppContext";
import { ORG_CODE_BY_COMPANY } from "../api/org";

/**
 * The grader for ONE organisation, with no hook and no active company.
 *
 * Permissions are org-scoped, so "may they open Analytics" is a question about
 * a PAIR — an account and an organisation. `usePermissions` answers it for the
 * one on screen, which is what almost every caller wants. This answers it for
 * any of them, which is what you need in order to say where someone locked out
 * of the organisation they are looking at should be sent instead.
 *
 * Exported so that question has exactly one implementation. Asking it a second
 * way is how the header came to offer a tenant the app then rendered empty.
 */
export function accessIn(orgs, companyId) {
  const code = ORG_CODE_BY_COMPANY[companyId] ?? String(companyId ?? "").toUpperCase();
  const org = (orgs ?? []).find((o) => o.code === code) ?? null;
  const held = new Set(org?.permissions ?? []);
  // The same wildcard the server honours. Checking it here too stops the UI
  // hiding a control a super admin would find perfectly usable if they
  // guessed the URL — a mismatch between what is drawn and what is allowed is
  // its own kind of bug.
  const can = (slug) => held.has("platform:admin") || anyOf(slug).some((s) => held.has(s));
  // A restriction, not a grant, so the wildcard must not switch it on.
  const flaggedOnly = held.has("vehicle:flagged_only") && !held.has("platform:admin");
  return { org, can, flaggedOnly };
}

/**
 * A slug, or a list of slugs any one of which will do. A screen reached by
 * more than one grant (Alerts: fuel_theft:read for its fuel alerts,
 * analytics:read for its overspeeding) names them all in NAV_ITEMS, and every
 * place that grades a NAV_ITEMS permission gets the either-or for free.
 */
const anyOf = (slug) => (Array.isArray(slug) ? slug : [slug]);

/**
 * The grader for one organisation BY ID, with no active company involved.
 *
 * `accessIn` above answers "what may they do at the company on screen", which
 * is the question almost every screen asks. This answers "what may they do in
 * organisation X", which is the question the user-administration roster asks
 * once it stops being about one company at a time.
 *
 * The difference is not cosmetic. An administrator added to two organisations
 * holds a different role in each, so a row belonging to organisation A must be
 * graded against A — not against whichever company the header happens to be
 * showing. Grading every row by the active company is how a Delete button
 * comes to be drawn over a row the server will refuse, or hidden over one it
 * would have allowed.
 *
 * `/me` already merges platform permissions into every organisation's list
 * (auth.controller.ts), so a platform administrator grades true everywhere
 * through the same code path as everyone else — there is no isPlatform branch
 * here and there must not be one.
 */
export function canInOrg(orgs, orgId, slug) {
  if (!orgId) return false;
  const org = (orgs ?? []).find((o) => o.id === orgId);
  if (!org) return false;
  const held = new Set(org.permissions ?? []);
  return held.has("platform:admin") || anyOf(slug).some((s) => held.has(s));
}

export function usePermissions() {
  const { orgs, isPlatform } = useAuth();
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);

  const { org, can, flaggedOnly } = useMemo(
    () => accessIn(orgs, activeCompanyId),
    [orgs, activeCompanyId],
  );

  return useMemo(() => ({
    orgId: org?.id ?? null,
    isPlatform,
    can,
    /** Restricted to units with an open repair job (technicians). */
    flaggedOnly,
    /** True only if EVERY slug is held — for controls that need a pair. */
    canAll: (...slugs) => slugs.every(can),
    /** True if ANY slug is held — for a screen reachable several ways. */
    canAny: (...slugs) => slugs.some(can),
    /**
     * Grade against a NAMED organisation rather than the one on screen.
     *
     * For surfaces that show rows from more than one tenant at once. See
     * `canInOrg` for why this cannot be `can` with a different active company.
     */
    canIn: (id, slug) => canInOrg(orgs, id, slug),
    /** Every organisation where the account holds `slug`. */
    orgsWhere: (slug) => (orgs ?? []).filter((o) => canInOrg(orgs, o.id, slug)),
    /**
     * Vehicles visible here, or NULL for no restriction.
     *
     * Null and an empty array are different answers: null is the whole fleet,
     * an empty array is nothing. Collapsing them blanks the map for every
     * unrestricted user, or hands a scoped one the entire fleet.
     */
    vehicleIds: org?.vehicleIds ?? null,
    /** Convenience for filtering a list the server already scoped. */
    isVehicleVisible: (id) => (org?.vehicleIds ?? null) === null || org.vehicleIds.includes(id),
  }), [org, can, flaggedOnly, isPlatform, orgs]);
}

/**
 * Render children only when the permission is held.
 *
 * `fallback` is for the rare place where something must occupy the space —
 * most callers want nothing, because a control the user cannot use is better
 * absent than present and dead.
 */
export function Can({ permission, fallback = null, children }) {
  const { can } = usePermissions();
  return can(permission) ? children : fallback;
}
