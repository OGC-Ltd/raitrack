/**
 * User accounts for one organisation.
 *
 * ## The thing that shapes this page
 *
 * A person is not "a user with a role". They are a user with a role *per
 * organisation* — a dispatcher at one site and an accountant at another — and
 * the first version of this form could not say that. It had one role dropdown
 * and one implicit organisation, so anybody who worked across two sites was
 * either wrong in the roster or entered twice.
 *
 * So the form's centre of gravity is the ORGANISATION LIST: pick the
 * organisations, and each one gets its own roles beneath it. One org with one
 * role is the common case and still costs two clicks; the harder case is
 * possible at all, which it was not before.
 *
 * Only organisations the ADMIN can reach are offered, because those are the
 * only ones the server will accept — it re-checks every one of them, so a
 * picker showing more would just be a way to earn a 403.
 *
 * The roles under each are whatever the server's roles table holds for that
 * organisation, catalogue roles first. The list is not filtered in the client
 * and not filtered against a constant on the server: a role an operator added
 * by hand is a real role, and a picker that silently omitted it would have
 * nothing on screen to explain the absence.
 *
 * ## Invitations, not passwords
 *
 * There is no password field and there will not be one. The person sets their
 * own through an emailed link, which also closes a real hole: provisioning
 * used to overwrite the password of any account matching the email, so typing
 * a colleague's address at another tenant handed you their account.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppContext } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";
import { usePermissions } from "../../hooks/usePermissions";
import { useApiData } from "../../hooks/useApiData";
import {
  listUsersAcrossOrgs, listAssignableRoles, createOrgUser, resendInvite, setUserStatus,
  listUserMemberships, setUserMembership, removeUserMembership,
  deleteOrgUserPermanently,
} from "../../api/users";
import { firstMessage, isMissingEndpoint } from "../../lib/formErrors";
import { accountState } from "../../lib/accountState";
import {
  confirmPhraseFor, confirmMatches, confirmState, skipsTypedConfirmation,
} from "../../lib/deleteConfirmation";
import LoadError from "../shared/LoadError";
import TabEmptyState from "../shared/TabEmptyState";
import { DriversIcon } from "../footer/NavIcons";
import "./UserAdminPanel.css";

const EMPTY_FORM = { fullName: "", email: "", phone: "", employeeId: "" };

/**
 * The status filters, and why they are these five.
 *
 * They are `accountState`'s own keys, not `status` — because ACTIVE covers two
 * opposite situations and the whole reason that helper exists is to tell them
 * apart. "No live invite" is the pair `expired` + `replaced` under one word an
 * administrator can act on: nobody is coming, and nobody will be told.
 */
/* `noun` is the chip's label as it reads inside a sentence, and it is a
   separate string because the label is not one: lowercasing "No live invite"
   into the empty-state line produced "No no live invite account matching kip". */
const STATUS_TABS = [
  { key: "all",       label: "All",            noun: "account" },
  { key: "active",    label: "Active",         noun: "active account" },
  { key: "pending",   label: "Pending",        noun: "pending account" },
  { key: "expired",   label: "No live invite", noun: "account with a lapsed invitation" },
  { key: "suspended", label: "Suspended",      noun: "suspended account" },
];

/** The role names this person holds IN the organisation being administered. */
function rolesIn(user, orgId) {
  return (user.userRoles ?? [])
    .filter((ur) => ur.role?.organisationId === orgId)
    .map((ur) => ur.role.name);
}

/**
 * Four fields, not one.
 *
 * Searching the name alone is the obvious build and the wrong one: an admin
 * chasing a stalled invitation has the EMAIL in front of them, and one chasing
 * a payroll query has the employee ID. Phone is in for the same reason. All of
 * them are optional on the server, hence the guard.
 */
function matchesQuery(user, needle) {
  if (!needle) return true;
  return [user.fullName, user.email, user.phone, user.employeeId]
    .some((v) => v && String(v).toLowerCase().includes(needle));
}

/** The role filter's sentinel for "holds nothing here" — a real thing to look
 *  for, and the roster already flags it in amber. Two colons because a <select>
 *  value is a plain string and a role could otherwise be named the sentinel;
 *  roles come from the server's roles table, where names are human ("Dispatcher",
 *  "Finance Manager") and cannot start with punctuation. */
const NO_ROLE = "::none";

/** The "every organisation I administer" choice. Same sentinel discipline as
 *  NO_ROLE above: a real organisation id is a cuid and cannot collide. */
const ALL_ORGS = "::all";

/**
 * A row's identity, which is the PAIR and not the person.
 *
 * Once the roster can show more than one organisation, the same account
 * appears once per organisation it belongs to — deliberately, because
 * "Dispatcher at Menengai" and "Operator at Sukari" are different rows with
 * different chips and different buttons. So `u.id` is no longer unique in
 * `shown`, and every place that used it to mean "this row" — the React key,
 * the open editor, the delete confirmation — has to use this instead. Keying
 * on the id alone would open both organisations' editors from one click.
 */
const rowKey = (u) => `${u.scopeOrgId}:${u.id}`;


function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function UserAdminPanel() {
  const { activeCompany } = useAppContext();
  const { orgs, user: me } = useAuth();
  const { orgId, can, canIn, isPlatform } = usePermissions();

  /**
   * Which organisation's people the roster is showing.
   *
   * ## Why this is not just the active company
   *
   * Permission to administer people is held PER ORGANISATION and is checked
   * against the organisation in the request path, never against the caller's
   * own — middleware/authorize.ts is explicit that "their home org says
   * nothing about the request in front of us". So somebody granted System
   * Administrator in two companies has always been entitled to edit and delete
   * in both, from one session, without touching the header switcher.
   *
   * The dashboard simply never asked. The roster was `listOrgUsers(orgId)`
   * with `orgId` resolved from the active company, so the only way to reach
   * another organisation's people was to become that company first — and
   * switching companies re-points the map, the fleet filters and every other
   * screen, to administer one account.
   *
   * `scope` is either an organisation id or ALL_ORGS. It starts on the active
   * company, because that is where you are and it should not surprise you.
   */
  const [scope, setScope] = useState(orgId ?? null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rowBusy, setRowBusy] = useState(null);

  /**
   * Which organisations are selected, and the roles chosen in each.
   * `{ [orgId]: string[] }` — presence of the key IS the selection, so an
   * organisation with no roles yet is still a valid grant (access, no role).
   */
  const [picked, setPicked] = useState({});
  const [rolesByOrg, setRolesByOrg] = useState({});

  /**
   * The row being edited, and its access.
   *
   * `base` is what the server said when the editor opened; `draft` is what the
   * administrator has changed it to. Both are kept because the save is a DIFF
   * — an organisation that was ticked and still is with the same roles is not
   * written at all, so opening a row and closing it touches nothing.
   */
  const [editing, setEditing] = useState(null);
  const [editBase, setEditBase] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [editBusy, setEditBusy] = useState(false);

  /**
   * The row whose permanent delete is being confirmed, and what has been typed
   * into it.
   *
   * A row rather than a dialog, for the reason the access editor gives above:
   * nothing in this app implements a focus trap, so a modal here would be a
   * worse version of the same thing. It sits under the person it is about, and
   * only one can be open at a time — `deleting` is an id, not a set.
   */
  const [deleting, setDeleting] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  /**
   * Finding one person, and the state that does it.
   *
   * All of it is CLIENT-side, which is a decision rather than a shortcut:
   * `listOrgUsers` fetches the organisation's system accounts in one page of
   * 100 and they are all in memory already. A server round-trip per keystroke
   * would be slower, would need debouncing, and would spend a request to
   * re-learn something this component is holding.
   *
   * It stops being the right call the day an organisation passes that page —
   * at which point the fix is paging the request, not filtering harder here.
   */
  const [query, setQuery] = useState("");
  const [statusKey, setStatusKey] = useState("all");
  const [roleName, setRoleName] = useState("any");
  const searchRef = useRef(null);

  /**
   * The invite form is closed until asked for.
   *
   * It used to be the first thing on the page, above the roster, expanded on
   * every visit — five fields and an organisation picker between you and the
   * thing you came to read. Inviting is occasional; reading the roster is why
   * this screen is open. So the roster leads and the form opens in place.
   */
  const [inviteOpen, setInviteOpen] = useState(false);

  const canAssignRoles = can("user:assign_role");
  /* NOTE: the typed-confirmation shortcut and the per-row action gates used
     to be computed here, once, from the ACTIVE company. They are now computed
     per row from that row's own organisation — see `rowCan` in the table
     below. Grading every row by the company on screen was the whole reason
     administering another organisation meant switching to it first. */
  /* NOTE: `canEdit` used to live here — one grade, taken in the ACTIVE
     company, that decided whether the Edit access button was drawn on every
     row. It is gone rather than merely unused: the row asks `rowCan` about its
     own organisation instead, which is the whole point of this screen being
     able to show more than one. */

  /**
   * The organisations whose rosters this account may read.
   *
   * `user:read` and not "every organisation I can reach": membership grants
   * reach, roles grant permission, and neither implies the other — a person
   * can belong to a tenant and hold nothing in it. Offering such an
   * organisation in the picker would be offering a list that can only 403.
   */
  const adminOrgs = useMemo(
    () => (orgs ?? []).filter((o) => canIn(o.id, "user:read")),
    [orgs, canIn],
  );

  /**
   * Keep `scope` on something real.
   *
   * Two ways it goes stale: the company switcher moves under us, and the
   * account loses a grant between loads. ALL_ORGS survives both — it is a
   * choice the administrator made and re-pointing it because the header moved
   * would undo that choice for no reason. A named organisation that has
   * dropped off `adminOrgs` falls back to the active company.
   */
  useEffect(() => {
    if (scope === ALL_ORGS) return;
    if (scope && adminOrgs.some((o) => o.id === scope)) return;
    setScope(orgId ?? adminOrgs[0]?.id ?? null);
  }, [scope, adminOrgs, orgId]);

  /** The organisations the current scope actually reads. */
  const scopeIds = useMemo(() => {
    if (scope === ALL_ORGS) return adminOrgs.map((o) => o.id);
    return scope ? [scope] : [];
  }, [scope, adminOrgs]);

  /** Stable across re-renders that did not change the set, so the fetch below
   *  does not re-run on every keystroke in the search box. */
  const scopeKey = scopeIds.join(",");

  /** Is the Organisation column worth its width? Only when rows can differ. */
  const showOrgColumn = scopeIds.length > 1;

  const orgNameById = useMemo(
    () => new Map((orgs ?? []).map((o) => [o.id, o.name])),
    [orgs],
  );

  // The current organisation starts selected: it is the one being administered
  // and unticking it is a deliberate act, not a default.
  useEffect(() => {
    if (orgId) setPicked((p) => (orgId in p ? p : { ...p, [orgId]: [] }));
  }, [orgId]);

  // Roles are fetched per organisation, because each has its own set — a role
  // list borrowed from one org would offer slugs another does not have.
  // The editor offers every organisation the admin can reach, so its roles are
  // needed for all of them rather than only the ticked ones.
  const wantedOrgIds = useMemo(
    () => (editing ? orgs.map((o) => o.id) : Object.keys(picked)),
    [editing, orgs, picked],
  );

  useEffect(() => {
    if (!canAssignRoles) return undefined;
    let cancelled = false;
    const missing = wantedOrgIds.filter((id) => !(id in rolesByOrg));
    if (missing.length === 0) return undefined;

    Promise.all(missing.map(async (id) => [id, await listAssignableRoles(id).catch(() => [])]))
      .then((pairs) => {
        if (cancelled) return;
        setRolesByOrg((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
      });
    return () => { cancelled = true; };
  }, [wantedOrgIds, rolesByOrg, canAssignRoles]);

  /**
   * One fetch for however many organisations the scope names.
   *
   * `listUsersAcrossOrgs` is used even for a single organisation, rather than
   * branching to `listOrgUsers`. The one-org path is the common case and the
   * many-org path is the rare one, so if they were different code the rare one
   * would be the one nobody exercises — and, more concretely, only the
   * cross-org call stamps `scopeOrgId` onto each row. Every row must carry it,
   * because every row's buttons are addressed by it.
   *
   * The cache key carries the whole scope: a cached "all organisations" roster
   * handed to a single-organisation view would show people who are not there.
   */
  const { data, loading, error: loadError, retry, revalidate, mutate } = useApiData(
    () => listUsersAcrossOrgs(scopeIds),
    [scopeKey],
    { cacheKey: `ft-org-users:${scopeKey}` },
  );

  /* Memoised so the `?? []` fallback does not hand the filters below a brand
     new empty array on every render — which would re-run all three of them
     for a roster that has not changed. */
  const users = useMemo(() => data?.users ?? [], [data]);

  /**
   * Search first, then the facets — and the counts come from BETWEEN the two.
   *
   * `counts` is tallied over the searched list rather than the whole roster,
   * so "Active 3" means "three of the people matching what you typed", which
   * is what the number is asked to mean when you are about to click it.
   * Tallying the full roster instead would offer a chip that promises eight
   * and delivers three.
   */
  const needle = query.trim().toLowerCase();

  const searched = useMemo(
    () => users.filter((u) => matchesQuery(u, needle)),
    [users, needle],
  );

  const counts = useMemo(() => {
    const tally = { all: searched.length };
    for (const u of searched) {
      const key = accountState(u).key;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    return tally;
  }, [searched]);

  /** Only roles somebody actually holds here. A picker offering every
   *  assignable role would list options that can only return nothing. */
  const roleOptions = useMemo(() => {
    const held = new Set();
    for (const u of users) for (const name of rolesIn(u, u.scopeOrgId)) held.add(name);
    return [...held].sort((a, b) => a.localeCompare(b));
  }, [users]);

  const shown = useMemo(() => searched.filter((u) => {
    if (statusKey !== "all" && accountState(u).key !== statusKey) return false;
    if (roleName === NO_ROLE) return rolesIn(u, u.scopeOrgId).length === 0;
    if (roleName !== "any" && !rolesIn(u, u.scopeOrgId).includes(roleName)) return false;
    return true;
  }), [searched, statusKey, roleName]);

  const filtering = needle !== "" || statusKey !== "all" || roleName !== "any";

  const clearFilters = useCallback(() => {
    setQuery(""); setStatusKey("all"); setRoleName("any");
    searchRef.current?.focus();
  }, []);

  const set = useCallback((key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setNotice("");
  }, []);

  function toggleOrg(id) {
    setNotice("");
    setPicked((p) => {
      const next = { ...p };
      if (id in next) delete next[id];
      else next[id] = [];
      return next;
    });
  }

  function toggleRole(id, slug) {
    setNotice("");
    setPicked((p) => {
      const held = p[id] ?? [];
      return {
        ...p,
        [id]: held.includes(slug) ? held.filter((s) => s !== slug) : [...held, slug],
      };
    });
  }

  const selectedOrgIds = useMemo(() => Object.keys(picked), [picked]);

  async function handleCreate(e) {
    e.preventDefault();
    if (busy || !form.fullName.trim() || !form.email.trim() || selectedOrgIds.length === 0) return;
    setBusy(true); setError(""); setNotice("");
    try {
      // The org being administered is the path organisation; anything else the
      // admin ticked rides along as an extra membership with its own roles.
      const extras = selectedOrgIds
        .filter((id) => id !== orgId)
        .map((id) => ({ organisationId: id, roleSlugs: picked[id] ?? [], allVehicles: true }));

      const result = await createOrgUser(orgId, {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        employeeId: form.employeeId.trim(),
        roleSlugs: picked[orgId] ?? [],
        memberships: extras,
      });

      const where = selectedOrgIds.length === 1
        ? (activeCompany?.name ?? "this organisation")
        : `${selectedOrgIds.length} organisations`;

      if (result?.created === false) {
        setNotice(`That address already has an account. They have been added to ${where}.`);
      } else if (result?.invite?.sent) {
        setNotice(`Invitation sent to ${form.email.trim()} · added to ${where}.`);
      } else if (result?.invite?.reason === "queued") {
        /* Queued is NOT the failure branch below, and putting it there would be
           the worst misreport on this screen: it tells an administrator the
           person cannot sign in, when the link is in flight with three attempts
           behind it. It is not the success branch either — nothing has left
           the building yet, and "sent" is what someone reads before deciding
           whether to chase it. */
        setNotice(`Account created and added to ${where}. The invitation to ${form.email.trim()} is queued for delivery.`);
      } else if (result && result.invite === undefined) {
        // No `invite` key AT ALL means the API that answered predates
        // invitations — it created the account the old way and sent nothing.
        // Reporting that as reason "unknown" sent people looking for a mail
        // failure that never happened.
        setNotice(
          `Account created, but this server cannot send invitations yet — it is running an older build. ` +
          `${form.email.trim()} has no way to sign in until it is updated and they receive a link.`,
        );
      } else {
        // The honest version of a failure that would otherwise be invisible:
        // the account exists but nobody can sign in to it.
        const why = {
          unconfigured: "email is not configured on the server",
          "send-failed": "the mail server rejected it",
          "no-email": "the account has no email address",
          "account-already-active": "that account already has a password",
          "not-requested": "no invitation was requested",
        }[result?.invite?.reason] ?? result?.invite?.reason ?? "reason not reported";
        setNotice(
          `Account created, but the invitation could not be sent — ${why}. ` +
          `They cannot sign in until they receive a link.`,
        );
      }

      setForm(EMPTY_FORM);
      setPicked(orgId ? { [orgId]: [] } : {});
      /* Show the person who was just created.
         A new account is Pending with whatever roles were ticked, so a filter
         left on "Suspended", or on a role they do not hold, would hide the row
         the invitation just added — the notice would say it worked and the
         roster would appear not to have changed. Clearing is the smaller
         surprise, and it only happens on success. */
      setQuery(""); setStatusKey("all"); setRoleName("any");
      retry();
    } catch (err) {
      setError(isMissingEndpoint(err)
        ? "Creating users is not available yet — this server does not have the account API."
        : firstMessage(err, "email", "Could not create that user."));
    } finally {
      setBusy(false);
    }
  }

  async function handleResend(user) {
    setRowBusy(rowKey(user)); setError(""); setNotice("");
    try {
      const invite = await resendInvite(user.scopeOrgId, user.id);
      setNotice(invite?.sent
        ? `New invitation sent to ${user.email}.`
        : invite?.reason === "queued"
          ? `New invitation to ${user.email} is queued for delivery.`
          : `Could not send the invitation (${invite?.reason ?? "unknown"}).`);
    } catch (err) {
      setError(firstMessage(err, null, "Could not resend that invitation."));
    } finally {
      setRowBusy(null);
    }
  }

  async function handleStatus(user) {
    const next = user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    setRowBusy(rowKey(user)); setError(""); setNotice("");
    try {
      await setUserStatus(user.scopeOrgId, user.id, next);
      setNotice(next === "SUSPENDED"
        ? `${user.fullName} has been suspended and signed out.`
        : `${user.fullName} has been reactivated.`);
      retry();
    } catch (err) {
      setError(firstMessage(err, null, "Could not change that account."));
    } finally {
      setRowBusy(null);
    }
  }

  // ── Destroying an account ────────────────────────────────────────────────

  function openDelete(user) {
    setConfirmText("");
    setError(""); setNotice("");
    setDeleting((key) => (key === rowKey(user) ? null : rowKey(user)));
    // Closing the access editor: the two panels are about the same row and
    // both are tall, so having them open together pushes the person they
    // describe off the top of the screen.
    setEditing(null);
  }

  /**
   * Permanent, and said so in every word on screen.
   *
   * The failures worth naming separately are the server's REFUSALS — you
   * cannot delete yourself, somebody whose home is another organisation, or
   * anybody carrying operations history. Each arrives as a 409 whose message
   * already names the reason and its numbers, so it is shown as written rather
   * than replaced with a house sentence that would say less.
   */
  async function handleDelete(user) {
    if (deleteBusy) return;
    setDeleteBusy(true); setError(""); setNotice("");
    try {
      const gone = await deleteOrgUserPermanently(user.scopeOrgId, user.id);
      const also = [
        gone?.removed?.roles    ? `${gone.removed.roles} role grant${gone.removed.roles === 1 ? "" : "s"}` : null,
        gone?.removed?.sessions ? `${gone.removed.sessions} session${gone.removed.sessions === 1 ? "" : "s"}` : null,
        gone?.removed?.invites  ? `${gone.removed.invites} invitation${gone.removed.invites === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      setNotice(
        `${user.fullName} has been permanently deleted`
        + (also.length ? `, with ${also.join(", ")}.` : ".")
        + " This cannot be undone.",
      );
      setDeleting(null);
      setConfirmText("");

      /* The list is corrected from what we know, not from what the server says
         next — and the cache with it.
         `retry()` would have been the obvious call and is the wrong one here.
         It blanks the roster and repaints it as "Loading…" to tell the reader
         something they just watched happen, and it leaves a window in which
         the cached copy still holds the deleted person: this hook keeps the
         last good data when a refresh fails, so one flaky request after a
         successful delete would put the account back on screen and back in
         localStorage, where it survives a reload and outlives the row itself.
         A delete has exactly one possible effect on a list, so it is applied
         directly; the server is asked afterwards, quietly, in case anything
         else moved. */
      mutate((prev) => (prev ? {
        ...prev,
        /* The PAIR, not the id: the same person may be on this list once for
           each organisation they belong to, and deleting them from one does
           not remove them from another. */
        users: (prev.users ?? []).filter((row) => rowKey(row) !== rowKey(user)),
        total: Math.max(0, (prev.total ?? 1) - 1),
      } : prev));
      revalidate();
    } catch (err) {
      setError(isMissingEndpoint(err)
        ? "Permanent deletion is not available yet — this server does not have the account API."
        : firstMessage(err, null, "Could not delete that account."));
    } finally {
      setDeleteBusy(false);
    }
  }

  // ── Editing one person's access ──────────────────────────────────────────

  async function openEditor(user) {
    if (editing === rowKey(user)) { setEditing(null); return; }
    setEditing(rowKey(user));
    setEditBase(null);
    setEditDraft({});
    setError(""); setNotice("");
    try {
      const memberships = await listUserMemberships(user.scopeOrgId, user.id);
      const asDraft = Object.fromEntries(
        memberships.map((m) => [m.organisationId, (m.roles ?? []).map((r) => r.slug)]),
      );
      setEditBase(asDraft);
      setEditDraft(asDraft);
    } catch (err) {
      setEditing(null);
      setError(isMissingEndpoint(err)
        ? "Editing access is not available yet — this server does not have the membership API."
        : firstMessage(err, null, "Could not read that person's access."));
    }
  }

  function toggleEditOrg(id) {
    setEditDraft((d) => {
      const next = { ...d };
      if (id in next) delete next[id];
      else next[id] = [];
      return next;
    });
  }

  function toggleEditRole(id, slug) {
    setEditDraft((d) => {
      const held = d[id] ?? [];
      return {
        ...d,
        [id]: held.includes(slug) ? held.filter((x) => x !== slug) : [...held, slug],
      };
    });
  }

  /**
   * Write only what changed, and write removals last.
   *
   * Removals last so a mistake cannot strand somebody: if a grant fails, the
   * access they already had is still there. Doing it the other way round could
   * leave a person with nothing when the second half of the save threw.
   *
   * Each organisation is one PUT carrying the COMPLETE set of roles it should
   * end with — that is how one call both adds a role and takes another away,
   * and it is why the unchanged organisations are skipped rather than resent.
   */
  async function saveEditor(user) {
    if (!editBase) return;
    const before = editBase;
    const after = editDraft;

    const same = (a = [], b = []) =>
      a.length === b.length && [...a].sort().join() === [...b].sort().join();

    const toWrite = Object.keys(after).filter((id) => !(id in before) || !same(before[id], after[id]));
    const toRemove = Object.keys(before).filter((id) => !(id in after));

    if (toWrite.length === 0 && toRemove.length === 0) { setEditing(null); return; }

    if (toRemove.length && Object.keys(after).length === 0) {
      setError("Somebody must belong to at least one organisation. Suspend the account instead.");
      return;
    }

    setEditBusy(true); setError(""); setNotice("");
    try {
      for (const id of toWrite) await setUserMembership(id, user.id, after[id] ?? []);
      for (const id of toRemove) await removeUserMembership(id, user.id);

      const named = (ids) => ids
        .map((id) => orgs.find((o) => o.id === id)?.name ?? "an organisation")
        .join(", ");
      const parts = [];
      if (toWrite.length) parts.push(`updated ${named(toWrite)}`);
      if (toRemove.length) parts.push(`removed from ${named(toRemove)}`);
      setNotice(`${user.fullName}: ${parts.join("; ")}.`);

      setEditing(null);
      retry();
    } catch (err) {
      setError(firstMessage(err, null, "Could not save that change. Some of it may have been applied."));
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div className="ua-page">
      <div className="ua-page__inner">
        {/* No page title: the crumb in the screen's bar above already names
            this page, and you arrived by clicking the same words in the avatar
            menu. What the band carries instead is the Maintenance tab's own
            opening statement — whose data this is, on the left, and the figures
            the page exists for as KPI tiles on the right.

            The second tile appears only while a filter is on, which is what
            makes a short roster explain itself: 4 showing, of 12. */}
        <header className="ua-header">
          {/* The scope picker replaces the flat company name once there is
              more than one organisation to administer. With only one it stays
              a label, because a select with a single option is a control that
              cannot do anything. */}
          {adminOrgs.length > 1 ? (
            <label className="ua-header__scope">
              <span className="ua-header__scopelabel">People in</span>
              <select
                className="ua-header__scopesel"
                value={scope ?? ""}
                onChange={(e) => {
                  /* Closing both panels: they are about a row that is about to
                     stop existing on screen, and an editor left open over a
                     different organisation's roster would write to the wrong
                     membership. */
                  setEditing(null); setDeleting(null); setConfirmText("");
                  setError(""); setNotice("");
                  setScope(e.target.value);
                }}
              >
                {adminOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}{o.id === orgId ? " (current)" : ""}
                  </option>
                ))}
                <option value={ALL_ORGS}>All organisations ({adminOrgs.length})</option>
              </select>
            </label>
          ) : (
            <span className="ua-header__org">
              {adminOrgs[0]?.name ?? activeCompany?.name ?? "Fleet"}
            </span>
          )}

          {loading ? (
            <span className="ua-kpi__loading">Loading…</span>
          ) : (
            <div className="ua-kpis">
              <div className="ua-kpi">
                <span className="ua-kpi__n">{users.length}</span>
                <span className="ua-kpi__l">{users.length === 1 ? "Person" : "People"}</span>
              </div>
              {filtering && (
                <div className="ua-kpi ua-kpi--shown">
                  <span className="ua-kpi__n">{shown.length}</span>
                  <span className="ua-kpi__l">Showing</span>
                </div>
              )}
            </div>
          )}
        </header>

        {/* The controls, as one band under the count.
            Typed text first because it is the fastest way to one person;
            the state chips second because they are how you find a GROUP —
            everyone still waiting, everyone whose invitation lapsed — which
            is the other half of what this roster is read for. */}
        <div className="ua-filters">
          <div className="ua-search">
            {/* Drawn here rather than imported. The app ships no icon set, and
                the Maintenance filter bar draws its own magnifier the same
                way — two elements, so the pair cannot fall out of step. */}
            <svg className="ua-search__icon" width="13" height="13" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              className="ua-search__input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Escape clears rather than closing anything: this input is not
              // a dialog, and a search box that throws away the screen on
              // Escape is the behaviour nobody wants twice.
              onKeyDown={(e) => { if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); } }}
              placeholder="Search name, email or ID"
              aria-label="Search people"
              autoComplete="off"
            />
            {query && (
              <button type="button" className="ua-search__clear"
                      onClick={() => { setQuery(""); searchRef.current?.focus(); }}>
                Clear
              </button>
            )}
          </div>

          <span className="ua-filters__divider" aria-hidden="true" />

          <div className="ua-filter-group">
            <span className="ua-filter-label" id="ua-state-label">State</span>
            <div className="ua-chips" role="group" aria-labelledby="ua-state-label">
            {STATUS_TABS.map((t) => {
              const n = counts[t.key] ?? 0;
              return (
                <button
                  key={t.key}
                  type="button"
                  className={"ua-chip" + (statusKey === t.key ? " ua-chip--on" : "")}
                  aria-pressed={statusKey === t.key}
                  // A chip that can only return an empty roster is not worth a
                  // click — but it stays on screen, because "nobody here is
                  // suspended" is itself something an administrator came to
                  // learn. The one exception is the chip already selected:
                  // disabling it would trap the filter on an empty result.
                  disabled={n === 0 && statusKey !== t.key}
                  onClick={() => setStatusKey(t.key)}
                >
                  {t.label}<span className="ua-chip__n">{n}</span>
                </button>
              );
            })}
            </div>
          </div>

          {/* Only rendered where it can mean something. One organisation with
              one role in use makes this a picker with a single choice. */}
          {roleOptions.length > 1 && (
            <div className="ua-filter-group">
              <span className="ua-filter-label" id="ua-role-label">Role</span>
              <label className="ua-rolepick">
                <select className="ua-rolepick__select" value={roleName}
                        aria-labelledby="ua-role-label"
                        onChange={(e) => setRoleName(e.target.value)}>
                  <option value="any">Any role</option>
                  {roleOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                  <option value={NO_ROLE}>No role here</option>
                </select>
              </label>
            </div>
          )}

          {/* The bar's last element, and the only one that does not filter:
              Export's slot in the Maintenance bar, and Export's shape. */}
          <button
            type="button"
            className={"ua-invite-btn" + (inviteOpen ? " ua-invite-btn--open" : "")}
            aria-expanded={inviteOpen}
            aria-controls="ua-invite"
            onClick={() => { setInviteOpen((v) => !v); setError(""); setNotice(""); }}
          >
            {inviteOpen ? "Close" : "Invite someone"}
          </button>
        </div>

        {/* `hidden`, not a height transition: the fields must leave the tab
            order when the form is shut, and a five-field form sliding open is
            motion spent on nothing. */}
        <section className="ua-card ua-invite" id="ua-invite" hidden={!inviteOpen}>
          <div className="ua-card__head">
            <span className="ua-card__title">New account</span>
            <span className="ua-card__hint">They choose their own password from an emailed link.</span>
          </div>

          <form className="ua-form" onSubmit={handleCreate} noValidate>
            <div className="ua-form__row">
              <label className="ua-field">
                <span className="ua-label">Full name</span>
                <input className="ua-input" type="text" value={form.fullName}
                       onChange={set("fullName")} disabled={busy} required />
              </label>

              <label className="ua-field">
                <span className="ua-label">Email</span>
                <input className="ua-input" type="email" autoComplete="off" value={form.email}
                       onChange={set("email")} disabled={busy} required />
              </label>

              <label className="ua-field">
                <span className="ua-label">Phone (optional)</span>
                <input className="ua-input" type="tel" value={form.phone}
                       onChange={set("phone")} disabled={busy} />
              </label>

              <label className="ua-field">
                <span className="ua-label">Employee ID (optional)</span>
                <input className="ua-input" type="text" value={form.employeeId}
                       onChange={set("employeeId")} disabled={busy} />
              </label>
            </div>

            {/* Access. The organisation list is the spine of this form: roles
                hang off an organisation, never the other way round. */}
            <fieldset className="ua-access">
              <legend className="ua-access__legend">
                Access
                <span className="ua-access__hint">
                  Tick each organisation, then choose what they are in it.
                  {!canAssignRoles && " You cannot assign roles, so they will be granted access with no role."}
                </span>
              </legend>

              {orgs.length === 0 ? (
                <p className="ua-access__empty">No organisations are available to you.</p>
              ) : (
                <ul className="ua-orgs">
                  {orgs.map((org) => {
                    const on = org.id in picked;
                    const available = rolesByOrg[org.id];
                    const chosen = picked[org.id] ?? [];
                    return (
                      <li className={"ua-org" + (on ? " ua-org--on" : "")} key={org.id}>
                        <button type="button" className="ua-org__toggle"
                                role="checkbox" aria-checked={on}
                                onClick={() => toggleOrg(org.id)} disabled={busy}>
                          <span className="ua-box" aria-hidden="true" />
                          <span className="ua-org__name">{org.name}</span>
                          {org.id === orgId && <span className="ua-org__here">current</span>}
                        </button>

                        {/* Roles appear only once the organisation is ticked —
                            a list of roles for an org nobody selected is noise. */}
                        {on && canAssignRoles && (
                          <div className="ua-roles">
                            {available === undefined ? (
                              <span className="ua-roles__empty">Loading roles…</span>
                            ) : available.length === 0 ? (
                              // Distinguishes "this org genuinely has none" from
                              // "the request failed" — which, before the account
                              // API is deployed, is the case that actually fires.
                              <span className="ua-roles__empty">
                                No roles available here yet.
                              </span>
                            ) : (
                              available.map((r) => (
                                <button
                                  key={r.slug}
                                  type="button"
                                  className={"ua-role"
                                    + (chosen.includes(r.slug) ? " ua-role--on" : "")
                                    + (r.platform ? " ua-role--platform" : "")}
                                  aria-pressed={chosen.includes(r.slug)}
                                  onClick={() => toggleRole(org.id, r.slug)}
                                  disabled={busy}
                                  title={r.platform
                                    ? "This role reaches every organisation, not only this one."
                                    : undefined}
                                >
                                  {r.name}
                                  {/* Said in words, not colour: this is a grant
                                      made inside one organisation that takes
                                      effect in all of them, and an admin
                                      choosing it needs to know that before
                                      they click, not after. */}
                                  {r.platform && <span className="ua-role__scope">all orgs</span>}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>

            <div className="ua-msg ua-msg--error" role="alert" aria-live="polite">{error}</div>
            <div className="ua-msg ua-msg--ok" role="status" aria-live="polite">{notice}</div>

            <button className="ua-submit" type="submit"
                    disabled={busy || !form.fullName.trim() || !form.email.trim() || selectedOrgIds.length === 0}>
              {busy ? "Creating…" : "Create and invite"}
            </button>
          </form>
        </section>

        {/* A tenant that failed on its own.
            `listUsersAcrossOrgs` catches each roster separately, so one
            organisation timing out costs its own rows and nothing else. That
            is the right behaviour and a silent one: the list simply comes back
            short. Saying which organisation is missing is what stops a partial
            roster being read as a complete one — and it is a warning rather
            than an error, because everything else on screen is real. */}
        {(data?.failures?.length ?? 0) > 0 && (
          <p className="ua-partial" role="status">
            Could not load {data.failures.map((f) => orgNameById.get(f.orgId) ?? "an organisation").join(", ")}.
            These people are not shown.
            {" "}<button type="button" className="ua-action" onClick={retry}>Try again</button>
          </p>
        )}

        {loadError ? (
          <LoadError label="User accounts" onRetry={retry} fullSection />
        ) : !loading && users.length === 0 ? (
          <TabEmptyState
            icon={<DriversIcon size={44} />}
            title="No accounts yet"
            hint="Nobody has been invited to the dashboard yet. Invite somebody and they will appear here. Drivers synced from the operations registry are not shown — they have no sign-in."
          />
        ) : !loading && shown.length === 0 ? (
          /* NOT the empty state above, and the difference matters: there are
             people here, the filter is simply hiding them. So this says what
             was asked for, and offers the way back — an empty screen with no
             explanation is how a filter gets mistaken for a broken roster. */
          <div className="ua-nomatch" role="status">
            <p className="ua-nomatch__line">
              No {STATUS_TABS.find((t) => t.key === statusKey).noun}
              {needle && <> matching <span className="ua-nomatch__q">{query.trim()}</span></>}
              {roleName !== "any" && <> {roleName === NO_ROLE ? "without a role here" : `holding ${roleName}`}</>}.
            </p>
            <button type="button" className="ua-action" onClick={clearFilters}>Clear filters</button>
          </div>
        ) : (
          <section className="ua-roster">
            <div className="ua-table-scroll">
              <table className="ua-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    {showOrgColumn && <th>Organisation</th>}
                    <th>Roles here</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Password</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => {
                    /* Everything about this row is graded in the row's OWN
                       organisation, not in the one the header is showing. An
                       administrator can hold user:delete in one company and
                       nothing but user:read in another, and the buttons have
                       to say so — a Delete drawn over a row the server will
                       refuse is worse than no Delete at all. */
                    const rowOrg = u.scopeOrgId;
                    const rowCan = (slug) => canIn(rowOrg, slug);
                    const key = rowKey(u);
                    const roles = rolesIn(u, rowOrg);
                    const changes = u.passwordChangeCount ?? 0;
                    const state = accountState(u);
                    const open = editing === key;
                    const confirming = deleting === key;
                    const phrase = confirmPhraseFor(u);
                    const match = confirming ? confirmState(confirmText, phrase) : "empty";
                    /* Per row for the same reason: the shortcut belongs to an
                       administrator OF THIS ORGANISATION. */
                    const rowSkipsTyping = skipsTypedConfirmation({ isPlatform, can: rowCan });
                    const armed = rowSkipsTyping || confirmMatches(confirmText, phrase);
                    return (
                      <Fragment key={key}>
                      {/* `data-label` on every cell is what lets the roster
                          become a stack of cards under 768px (UserAdminPanel.css):
                          with no table head to sit under, each value has to
                          carry the column name it came from. They are inert on
                          a desktop, where the head is still doing that job. */}
                      <tr className={"ua-row" + (open || confirming ? " ua-row--open" : "")}>
                        <td data-label="Name">
                          <span className="ua-row__name">{u.fullName}</span>
                          <span className="ua-row__email">{u.email ?? "no email"}</span>
                        </td>
                        {showOrgColumn && (
                          <td data-label="Organisation">
                            <span className="ua-row__org">
                              {orgNameById.get(rowOrg) ?? "—"}
                            </span>
                            {rowOrg === orgId && (
                              <span className="ua-row__orghere">current</span>
                            )}
                          </td>
                        )}
                        <td className="ua-row__rolescell" data-label="Roles here">
                          {roles.length === 0 ? (
                            <span className="ua-row__norole">none</span>
                          ) : (
                            <span className="ua-row__roles">
                              {roles.map((name) => (
                                <span className="ua-rolechip" key={name}>{name}</span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td data-label="Status">
                          <span className={`ua-pill ua-pill--${state.key}`}>
                            {state.label}
                          </span>
                        </td>
                        <td className="ua-row__num" data-label="Created">{fmtDate(u.createdAt)}</td>
                        <td className="ua-row__num" data-label="Password">
                          {changes === 0 ? (
                            // Distinct from "changed once, long ago": an account
                            // that has never had a password cannot sign in, and
                            // that is the thing an admin needs to spot.
                            <span className="ua-row__never">never set</span>
                          ) : (
                            <>
                              {fmtDate(u.passwordChangedAt)}
                              <span className="ua-row__count">
                                {changes} {changes === 1 ? "change" : "changes"}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="ua-row__actionscell" data-label="Actions">
                          <div className="ua-row__actions">
                          {/* Only offered while an invitation is the thing
                              standing between them and the dashboard. The
                              server refuses to re-invite an account that
                              already has a password — that is an account
                              takeover vector — so showing this to everybody
                              would be offering a click that can only fail. */}
                          {state.key !== "active" && (
                            <button type="button" className="ua-action"
                                    onClick={() => handleResend(u)}
                                    disabled={rowBusy === key || !u.email}>
                              Resend invite
                            </button>
                          )}
                          {(rowCan("user:assign_role") || rowCan("user:update")) && (
                            <button type="button" className="ua-action"
                                    onClick={() => openEditor(u)}
                                    aria-expanded={open}
                                    disabled={editBusy}>
                              {open ? "Close" : "Edit access"}
                            </button>
                          )}
                          {rowCan("user:update") && (
                            <button type="button" className="ua-action"
                                    onClick={() => handleStatus(u)}
                                    disabled={rowBusy === key}>
                              {u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                            </button>
                          )}
                          {/* Never offered for the account doing the looking.
                              The server refuses it anyway, but a control whose
                              only outcome is an error message is a control
                              that should not be drawn. */}
                          {rowCan("user:delete") && u.id !== me?.id && (
                            <button type="button" className="ua-action ua-action--danger"
                                    onClick={() => openDelete(u)}
                                    aria-expanded={confirming}
                                    disabled={deleteBusy}>
                              {confirming ? "Keep" : "Delete"}
                            </button>
                          )}
                          </div>
                        </td>
                      </tr>

                      {/* The editor sits in the flow of the table rather than
                          in a dialog: it is about the row above it, and
                          nothing in this app implements a focus trap, so a
                          modal here would be a worse version of the same
                          thing. */}
                      {open && (
                        <tr className="ua-editrow">
                          <td colSpan={showOrgColumn ? 7 : 6}>
                            {editBase === null ? (
                              <p className="ua-edit__loading">Reading their access…</p>
                            ) : (
                              <div className="ua-edit">
                                <div className="ua-edit__head">
                                  <span className="ua-edit__title">Access for {u.fullName}</span>
                                  <span className="ua-edit__hint">
                                    Tick an organisation to add it, untick to remove it. Roles
                                    are per organisation — what you leave ticked is what they
                                    will hold.
                                  </span>
                                </div>

                                <ul className="ua-orgs">
                                  {orgs.map((org) => {
                                    const on = org.id in editDraft;
                                    const chosen = editDraft[org.id] ?? [];
                                    const available = rolesByOrg[org.id];
                                    const wasIn = org.id in editBase;
                                    return (
                                      <li className={"ua-org" + (on ? " ua-org--on" : "")} key={org.id}>
                                        <button type="button" className="ua-org__toggle"
                                                role="checkbox" aria-checked={on}
                                                onClick={() => toggleEditOrg(org.id)}
                                                disabled={editBusy}>
                                          <span className="ua-box" aria-hidden="true" />
                                          <span className="ua-org__name">{org.name}</span>
                                          {wasIn && !on && <span className="ua-org__going">removing</span>}
                                          {!wasIn && on && <span className="ua-org__here">adding</span>}
                                        </button>

                                        {on && canAssignRoles && (
                                          <div className="ua-roles">
                                            {available === undefined ? (
                                              <span className="ua-roles__empty">Loading roles…</span>
                                            ) : available.length === 0 ? (
                                              <span className="ua-roles__empty">No roles available here yet.</span>
                                            ) : (
                                              available.map((r) => (
                                                <button key={r.slug} type="button"
                                                        className={"ua-role"
                                                          + (chosen.includes(r.slug) ? " ua-role--on" : "")
                                                          + (r.platform ? " ua-role--platform" : "")}
                                                        aria-pressed={chosen.includes(r.slug)}
                                                        onClick={() => toggleEditRole(org.id, r.slug)}
                                                        disabled={editBusy}
                                                        title={r.platform
                                                          ? "This role reaches every organisation, not only this one."
                                                          : undefined}>
                                                  {r.name}
                                                  {r.platform && <span className="ua-role__scope">all orgs</span>}
                                                </button>
                                              ))
                                            )}
                                          </div>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>

                                <div className="ua-edit__foot">
                                  <button type="button" className="ua-submit ua-submit--inline"
                                          onClick={() => saveEditor(u)} disabled={editBusy}>
                                    {editBusy ? "Saving…" : "Save access"}
                                  </button>
                                  <button type="button" className="ua-action"
                                          onClick={() => setEditing(null)} disabled={editBusy}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                      {/* The confirmation, in the flow of the table like the
                          editor above it — and deliberately NOT sharing its
                          shape. This one is red-ruled, narrow, and has one
                          field in it, because the difference between "change
                          what they can reach" and "destroy them" should be
                          visible before anything is read. */}
                      {confirming && (
                        <tr className="ua-editrow ua-editrow--danger">
                          <td colSpan={showOrgColumn ? 7 : 6}>
                            <div className="ua-danger">
                              <div className="ua-danger__head">
                                <span className="ua-danger__title">
                                  Permanently delete {u.fullName}
                                </span>
                                <span className="ua-danger__hint">
                                  The account row is removed from storage along with its role
                                  grants, sign-in sessions and invitations. It is not marked
                                  deleted — there is nothing left to restore, and the same
                                  address can be invited again as a new person.
                                  {" "}Suspending keeps the account and ends every session.
                                </span>
                              </div>

                              {rowSkipsTyping ? (
                                /* Nothing to type, so nothing that looks like a
                                   form. A disabled-looking field with no job
                                   would read as a step somebody forgot to
                                   remove. What replaces it is the sentence that
                                   makes the live button legible: it is live
                                   BECAUSE of who you are, which is not
                                   otherwise visible anywhere on this row. */
                                <p className="ua-danger__armed">
                                  You are an administrator here, so this does not ask you to type
                                  the address. The next click deletes {u.fullName}.
                                </p>
                              ) : (
                              <div className="ua-danger__confirm">
                              {/* `ua-field` is what DRAWS a field on this page.
                                  `ua-input` is deliberately chrome-less —
                                  transparent, no border, no padding — and takes
                                  its box from the wrapper, exactly as every
                                  field in the invite form above does. Without
                                  the wrapper this rendered as invisible text on
                                  the card: nothing to aim at, nothing to type
                                  into, and a button that could never arm. */}
                              <label className={"ua-field ua-danger__field ua-danger__field--" + match}>
                                <span className="ua-label">
                                  Type <code className="ua-danger__phrase">{phrase}</code> to confirm
                                </span>
                                <input
                                  className="ua-input"
                                  type="text"
                                  autoComplete="off"
                                  spellCheck="false"
                                  autoCapitalize="none"
                                  autoCorrect="off"
                                  value={confirmText}
                                  onChange={(e) => setConfirmText(e.target.value)}
                                  disabled={deleteBusy}
                                  aria-describedby={`${u.id}-confirm-state`}
                                  aria-label={`Type ${phrase} to confirm deletion`}
                                />
                                {/* Why the button below is dead, said on the
                                    field that controls it. Three states, and
                                    the middle one earns its place: "keep
                                    going" is not the same message as "wrong",
                                    and a disabled button beside a filled-in
                                    box with neither of them on screen is what
                                    made this control read as broken. */}
                              </label>
                                <span className="ua-danger__state" id={`${u.id}-confirm-state`} role="status">
                                  {match === "match"
                                    ? "Matches — the button below is live."
                                    : match === "partial"
                                      ? "Not the whole address yet. Capitals do not matter."
                                      : "The button below stays disabled until this matches."}
                                </span>
                              </div>
                              )}

                              <div className="ua-edit__foot">
                                <button type="button" className="ua-submit ua-submit--inline ua-submit--danger"
                                        onClick={() => handleDelete(u)}
                                        disabled={deleteBusy || !armed}>
                                  {deleteBusy ? "Deleting…" : "Delete permanently"}
                                </button>
                                <button type="button" className="ua-action"
                                        onClick={() => { setDeleting(null); setConfirmText(""); }}
                                        disabled={deleteBusy}>
                                  Keep the account
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
