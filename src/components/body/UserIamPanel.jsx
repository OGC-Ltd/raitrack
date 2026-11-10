/**
 * IAM, the fourth section of Users: access rights, person by person.
 *
 * A person's access is their role with their own grants laid over it. The
 * role is set on the Users section and is the same everywhere; this section
 * is where one right is given to, or taken from, one person, in one
 * organisation or in all of theirs.
 *
 * Only the System Administrator is shown this section (UserAdminScreen), and
 * the server refuses everybody else whatever the page draws.
 *
 * People on the left, the chosen person's rights on the right. Nothing is
 * sent until Save: the Result column shows what the choices will come to
 * first (lib/iamAccess, the server's own rules), and a person with unsaved
 * choices cannot be left by accident.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchIamCatalogue, fetchIamUser, listIamUsers, saveIamGrants } from "../../api/iam";
import {
  EVERYWHERE, keyOf, resolveEverywhere, resolveIn, spread, standingGrants, toChanges, withChoice,
} from "../../lib/iamAccess";
import { firstMessage } from "../../lib/formErrors";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "./TablePager";
import "./UserIamPanel.css";

const CHOICES = [
  ["inherit", "Role", "Leave it to the role"],
  ["allow", "Allow", "Give this right"],
  ["deny", "Deny", "Take this right away"],
];

const SOURCE_WORDS = {
  role: "from the role",
  allow: "given here",
  "allow-all": "given in every organisation",
  deny: "taken here",
  "deny-all": "taken in every organisation",
};

const roleNames = (roles) => (roles ?? []).map((r) => r.name).join(", ") || "No role";

function Person({ user, current, onPick }) {
  return (
    <li>
      <button type="button" className="ua-iam__person" aria-current={current ? "true" : undefined} onClick={() => onPick(user.id)}>
        <span className="ua-iam__person-name">{user.fullName}</span>
        <span className="ua-iam__person-role">{roleNames(user.roles)}</span>
        <span className="ua-iam__person-mail">{user.email}</span>
        {user.grants > 0 && (
          <span className="ua-iam__badge" title="Rights given to or taken from this person, on top of the role">
            {user.grants} personal
          </span>
        )}
      </button>
    </li>
  );
}

/** Role / Allow / Deny for one right in the scope on screen. */
function Choice({ value, saved, label, disabled, onChoose }) {
  return (
    <div className="ua-iam__choice" role="group" aria-label={label}>
      {CHOICES.map(([effect, word, title]) => (
        <button
          key={effect}
          type="button"
          className={`ua-iam__choice-btn ua-iam__choice-btn--${effect}`}
          aria-pressed={value === effect}
          title={title}
          disabled={disabled}
          onClick={() => onChoose(effect)}
        >
          {word}
        </button>
      ))}
      {value !== saved && <span className="ua-iam__unsaved">Not saved</span>}
    </div>
  );
}

const LEDGER_WORDS = { allow: "Allowed", deny: "Denied", inherit: "Back to the role" };

/**
 * The person's own rights, saved and chosen, in one place above the long
 * table: what they hold that the role does not say, and where.
 */
function Ledger({ entries }) {
  if (entries.length === 0) return null;
  return (
    <section className="ua-iam__ledger" aria-labelledby="ua-iam-ledger-title">
      <h3 id="ua-iam-ledger-title" className="ua-iam__ledger-title">Their own rights</h3>
      <ul className="ua-iam__ledger-list">
        {entries.map((e) => (
          <li key={e.key} className={`ua-iam__entry ua-iam__entry--${e.effect}`}>
            <span className="ua-iam__entry-effect">{LEDGER_WORDS[e.effect]}</span>
            <span className="ua-iam__entry-right">{e.name}</span>
            <span className="ua-iam__entry-where">{e.where}</span>
            {e.unsaved && <span className="ua-iam__unsaved">Not saved</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Result({ held, children }) {
  return (
    <span className={held ? "ua-iam__result ua-iam__result--yes" : "ua-iam__result ua-iam__result--no"}>
      <i className={`ti ${held ? "ti-check" : "ti-x"}`} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

export default function UserIamPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [onlyPersonal, setOnlyPersonal] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [scope, setScope] = useState(EVERYWHERE);
  const [pending, setPending] = useState(() => new Map());
  const [find, setFind] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [held, setHeld] = useState(false);

  const people = useQuery({ queryKey: ["iam", "users"], queryFn: listIamUsers, staleTime: 60_000 });
  const catalogue = useQuery({ queryKey: ["iam", "catalogue"], queryFn: fetchIamCatalogue, staleTime: 30 * 60_000 });
  const detail = useQuery({
    queryKey: ["iam", "user", selectedId],
    queryFn: () => fetchIamUser(selectedId),
    enabled: Boolean(selectedId),
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (people.data?.users ?? []).filter((u) => {
      if (onlyPersonal && !u.grants) return false;
      if (!q) return true;
      return `${u.fullName} ${u.email} ${roleNames(u.roles)}`.toLowerCase().includes(q);
    });
  }, [people.data, search, onlyPersonal]);
  const pager = usePager(shown, `${search}|${onlyPersonal}`);

  const access = detail.data ?? null;
  const organisations = useMemo(() => access?.organisations ?? [], [access]);
  const grants = useMemo(() => access?.grants ?? [], [access]);
  const standing = useMemo(() => standingGrants(grants, pending), [grants, pending]);
  const savedMap = useMemo(() => standingGrants(grants), [grants]);
  const scopeOrg = scope === EVERYWHERE ? null : organisations.find((o) => o.id === scope) ?? null;
  const scopeId = scopeOrg?.id ?? null;
  const locked = Boolean(access?.systemAdministrator);

  // A scope left over from the last person may be an organisation this one
  // does not reach.
  useEffect(() => {
    if (scope !== EVERYWHERE && access && !organisations.some((o) => o.id === scope)) setScope(EVERYWHERE);
  }, [access, organisations, scope]);

  const pick = (id) => {
    if (id === selectedId) return;
    if (pending.size > 0) { setHeld(true); return; }
    setSelectedId(id);
    setProblem("");
    setFind("");
  };

  const discard = () => { setPending(new Map()); setHeld(false); setProblem(""); };

  const choose = (permission, effect) => {
    setHeld(false);
    setPending((now) => withChoice(now, grants, scopeId, permission, effect));
  };

  const save = async () => {
    if (!selectedId || pending.size === 0 || saving) return;
    setSaving(true);
    setProblem("");
    try {
      const next = await saveIamGrants(selectedId, toChanges(pending));
      queryClient.setQueryData(["iam", "user", selectedId], next);
      queryClient.invalidateQueries({ queryKey: ["iam", "users"] });
      setPending(new Map());
      setHeld(false);
    } catch (err) {
      setProblem(firstMessage(err) ?? "The changes could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const groups = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (catalogue.data?.resources ?? [])
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter((p) =>
          !q || `${group.label} ${p.name} ${p.slug}`.toLowerCase().includes(q)),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [catalogue.data, find]);

  // The ledger: every right this person holds or loses on their own, saved or chosen.
  const ledger = useMemo(() => {
    const names = new Map();
    for (const group of catalogue.data?.resources ?? []) for (const p of group.permissions) names.set(p.slug, p.name);
    const orgNames = new Map(organisations.map((o) => [o.id, o.name]));
    const keys = [...new Set([...savedMap.keys(), ...pending.keys()])];
    return keys.map((key) => {
      const [{ organisationId, permission }] = toChanges(new Map([[key, "inherit"]]));
      const effect = standing.get(key) ?? "inherit";
      return {
        key,
        effect,
        name: names.get(permission) ?? permission,
        where: organisationId === null ? "in every organisation" : `in ${orgNames.get(organisationId) ?? "an organisation"}`,
        unsaved: effect !== (savedMap.get(key) ?? "inherit"),
      };
    });
  }, [catalogue.data, organisations, savedMap, pending, standing]);

  const personalHere = (permission) => standing.get(keyOf(scopeId, permission)) ?? "inherit";
  const savedHere = (permission) => savedMap.get(keyOf(scopeId, permission)) ?? "inherit";

  const roleCell = (permission) => {
    if (scopeOrg) return scopeOrg.fromRoles.includes(permission) ? "Yes" : "No";
    const r = resolveEverywhere(organisations, permission, new Map());
    const s = spread(r.fromRole, r.total);
    return s === "all" ? "Yes" : s === "none" ? "No" : `${r.fromRole} of ${r.total}`;
  };

  const resultCell = (permission) => {
    if (scopeOrg) {
      const r = resolveIn(scopeOrg, permission, standing);
      return <Result held={r.held}>{r.held ? "Can" : "Cannot"}, {SOURCE_WORDS[r.source]}</Result>;
    }
    const r = resolveEverywhere(organisations, permission, standing);
    const s = spread(r.held, r.total);
    return (
      <Result held={s !== "none"}>
        {s === "all" ? "Can, in every organisation" : s === "none" ? "Cannot, anywhere" : `Can in ${r.held} of ${r.total} organisations`}
      </Result>
    );
  };

  const selectedUser = access?.user ?? (people.data?.users ?? []).find((u) => u.id === selectedId) ?? null;

  return (
    <section className={selectedId ? "ua-iam ua-iam--open" : "ua-iam"} aria-labelledby="ua-iam-title">
      <h1 id="ua-iam-title" className="ua-iam__visually-hidden">Access rights</h1>

      <div className="ua-iam__people">
        <div className="ua-iam__people-head">
          <label className="ua-iam__search">
            <i className="ti ti-search" aria-hidden="true" />
            <span className="ua-iam__visually-hidden">Find a person</span>
            <input type="search" value={search} placeholder="Name, email or role" onChange={(e) => setSearch(e.target.value)} />
          </label>
          <button type="button" className="ua-iam__toggle" aria-pressed={onlyPersonal} onClick={() => setOnlyPersonal((v) => !v)}>
            With personal rights
          </button>
        </div>

        {people.isLoading ? (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Loading people" />
        ) : people.isError ? (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="People could not be loaded"
                     action={{ label: "Try again", onClick: () => people.refetch() }}>
            {firstMessage(people.error) ?? "The server did not answer."}
          </EmptyNote>
        ) : shown.length === 0 ? (
          <EmptyNote icon="ti-user-search" tone="info" title="Nobody matches">
            {onlyPersonal ? "Nobody here has rights of their own on top of a role." : "Try a different name, email or role."}
          </EmptyNote>
        ) : (
          <ul className="ua-iam__list">
            {pager.pageRows.map((u) => (
              <Person key={u.id} user={u} current={u.id === selectedId} onPick={pick} />
            ))}
          </ul>
        )}
        <TablePager pager={pager} label="People pages" always />
      </div>

      <div className="ua-iam__editor">
        {!selectedId ? (
          <EmptyNote icon="ti-shield-lock" tone="info" title="Choose a person">
            Their role sets what they can do. Here you give or take single rights on top of it.
          </EmptyNote>
        ) : detail.isLoading || catalogue.isLoading ? (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Reading access rights" />
        ) : detail.isError || catalogue.isError ? (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="Access rights could not be loaded"
                     action={{ label: "Try again", onClick: () => { detail.refetch(); catalogue.refetch(); } }}>
            {firstMessage(detail.error ?? catalogue.error) ?? "The server did not answer."}
          </EmptyNote>
        ) : (
          <>
            <header className="ua-iam__head">
              <button type="button" className="ua-iam__back" onClick={() => pick(null)}>
                <i className="ti ti-arrow-left" aria-hidden="true" /> People
              </button>
              <div className="ua-iam__who">
                <h2 className="ua-iam__name">{selectedUser?.fullName}</h2>
                <p className="ua-iam__meta">{roleNames(access.roles)}</p>
              </div>
              <dl className="ua-iam__figures">
                <div className="ua-iam__figure">
                  <dt>{organisations.length === 1 ? "Organisation" : "Organisations"}</dt>
                  <dd>{organisations.length === 1 ? organisations[0].name : organisations.length}</dd>
                </div>
                <div className="ua-iam__figure">
                  <dt>Personal rights</dt>
                  <dd>{grants.length}</dd>
                </div>
              </dl>
              {!locked && (
                <div className="ua-iam__actions">
                  <button type="button" className="ua-iam__button" disabled={pending.size === 0 || saving} onClick={discard}>
                    Discard
                  </button>
                  <button type="button" className="ua-iam__button ua-iam__button--lead" disabled={pending.size === 0 || saving} onClick={save}>
                    {saving ? "Saving" : pending.size > 0 ? `Save ${pending.size} ${pending.size === 1 ? "change" : "changes"}` : "Save"}
                  </button>
                </div>
              )}
            </header>

            {held && (
              <p className="ua-iam__notice ua-iam__notice--warn" role="alert">
                Save or discard the changes for {selectedUser?.fullName} before choosing somebody else.
              </p>
            )}
            {problem && <p className="ua-iam__notice ua-iam__notice--error" role="alert">{problem}</p>}

            {locked ? (
              <EmptyNote icon="ti-shield-check" tone="ok" title="Holds every access right">
                A System Administrator can do everything in every organisation, so there is nothing to give or take. Change the role on Users to narrow it.
              </EmptyNote>
            ) : (
              <>
                <Ledger entries={ledger} />
                <div className="ua-iam__bar">
                  <label className="ua-iam__scope">
                    <span className="ua-iam__label">Applies in</span>
                    <select value={scopeOrg ? scopeOrg.id : EVERYWHERE} onChange={(e) => setScope(e.target.value)}>
                      <option value={EVERYWHERE}>Every organisation they reach</option>
                      {organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>
                  <label className="ua-iam__search ua-iam__search--rights">
                    <i className="ti ti-search" aria-hidden="true" />
                    <span className="ua-iam__visually-hidden">Find a right</span>
                    <input type="search" value={find} placeholder="Find a right" onChange={(e) => setFind(e.target.value)} />
                  </label>
                </div>

                <div className="ua-iam__rights">
                  {groups.length === 0 ? (
                    <EmptyNote icon="ti-search-off" tone="info" title="No right matches">Try a different word.</EmptyNote>
                  ) : (
                    <table className="ua-iam__table">
                      <thead>
                        <tr>
                          <th scope="col">Right</th>
                          <th scope="col">Role gives</th>
                          <th scope="col">This person</th>
                          <th scope="col">Result</th>
                        </tr>
                      </thead>
                      {groups.map((group) => (
                        <tbody key={group.resource}>
                          <tr className="ua-iam__group">
                            <th scope="colgroup" colSpan={4}>{group.label}</th>
                          </tr>
                          {group.permissions.map((p) => (
                            <tr key={p.slug} className={[
                              "ua-iam__row",
                              p.grantable && personalHere(p.slug) !== "inherit" ? `ua-iam__row--own ua-iam__row--${personalHere(p.slug)}` : "",
                              p.grantable && personalHere(p.slug) !== savedHere(p.slug) ? "ua-iam__row--unsaved" : "",
                            ].filter(Boolean).join(" ")}>
                              <th scope="row">
                                <span className="ua-iam__right">{p.name}</span>
                                <code className="ua-iam__slug">{p.slug}</code>
                              </th>
                              <td data-label="Role gives">{roleCell(p.slug)}</td>
                              <td className="ua-iam__choice-cell">
                                {p.grantable ? (
                                  <Choice
                                    value={personalHere(p.slug)}
                                    saved={savedHere(p.slug)}
                                    label={`${p.name}, for this person`}
                                    disabled={saving}
                                    onChoose={(effect) => choose(p.slug, effect)}
                                  />
                                ) : (
                                  <span className="ua-iam__fixed">Set by the role only</span>
                                )}
                              </td>
                              <td>{resultCell(p.slug)}</td>
                            </tr>
                          ))}
                        </tbody>
                      ))}
                    </table>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
