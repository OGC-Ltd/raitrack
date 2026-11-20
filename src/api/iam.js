/**
 * Access rights per person (the IAM section of Users).
 *
 * The System Administrator only: the server answers 403 to everybody else,
 * a Director and an organisation's Admin included. None of this is addressed
 * to an organisation, because one person's rights span all of theirs.
 */

import { apiFetch } from "../services/api";

const base = "/api/v1/iam";

/** Every permission grouped by resource, and what each standard role holds. */
export async function fetchIamCatalogue() {
  const res = await apiFetch(`${base}/catalogue`);
  return res.data ?? { resources: [], roles: [] };
}

/** Everybody who can sign in, with their role and their count of personal grants. */
export async function listIamUsers() {
  const res = await apiFetch(`${base}/users?limit=500`);
  return { users: res.data ?? [], total: res.meta?.total ?? (res.data?.length ?? 0) };
}

/** One person: what the role gives in each organisation, their own grants, and the result. */
export async function fetchIamUser(userId) {
  const res = await apiFetch(`${base}/users/${encodeURIComponent(userId)}`);
  return res.data;
}

/**
 * Give, take or hand back rights.
 *
 * `changes` is [{ organisationId | null, permission, effect }], where a null
 * organisation is every one the person reaches and `effect` is "allow",
 * "deny" or "inherit" (back to the role). Returns the person as they now stand.
 */
export async function saveIamGrants(userId, changes) {
  const res = await apiFetch(`${base}/users/${encodeURIComponent(userId)}/grants`, {
    method: "PUT",
    body: JSON.stringify({ changes }),
  });
  return res.data;
}

/**
 * Which part of one organisation's fleet a person sees: all of it
 * (`allVehicles: true`), or only the categories named (vehicle group ids,
 * Menengai's Tankers, Van Sales, …). Returns the person as they now stand.
 */
export async function saveIamFleet(userId, { organisationId, allVehicles, vehicleGroupIds = [] }) {
  const res = await apiFetch(`${base}/users/${encodeURIComponent(userId)}/fleet`, {
    method: "PUT",
    body: JSON.stringify({ organisationId, allVehicles, vehicleGroupIds }),
  });
  return res.data;
}

/**
 * The units Wialon has deactivated, and those already gone from it, per
 * organisation (fleet-server iam/wialon-deactivated). Read-only.
 * `{ checkedAt, fieldsSeen, companies: [{ orgCode, orgName, units, deactivated, removed, error }] }`
 */
export async function fetchDeactivatedUnits() {
  const res = await apiFetch(`${base}/wialon/deactivated-units`);
  return res.data ?? { checkedAt: null, fieldsSeen: [], companies: [] };
}
