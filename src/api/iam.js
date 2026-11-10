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
