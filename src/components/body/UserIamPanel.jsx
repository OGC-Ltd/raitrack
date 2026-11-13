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
 * People on the left, the chosen person's rights on the right. A choice of
 * Role, Allow or Deny saves the moment it is made: the row shows it at once
 * and says "Saving…" until the server answers, saves go out one at a time in
 * the order they were made, and a failed one puts the row back as it is
 * stored and says which right did not save.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchIamCatalogue, fetchIamUser, listIamUsers, saveIamFleet, saveIamGrants } from "../../api/iam";
import {
  EVERYWHERE, keyOf, resolveEverywhere, resolveIn, spread, standingGrants, toChanges,
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
  full: "by Full access",
};

// One role held under two slugs ("Admin" in an organisation and on the platform) is one name.
const roleNames = (roles) => [...new Set((roles ?? []).map((r) => r.name))].join(", ") || "No role";

function Person({ user, current, onPick }) {
  return (
    <li>
      <button type="button" className="ua-iam__person" aria-current={current ? "true" : undefined} onClick={() => onPick(user.id)}>
        <span className="ua-iam__person-name">{user.fullName}</span>
        <span className="ua-iam__person-role" title={roleNames(user.roles)}>{roleNames(user.roles)}</span>
        <span className="ua-iam__person-mail" title={user.email}>{user.email}</span>
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
function Choice({ value, busy, label, onChoose }) {
  return (
    <div className="ua-iam__choice" role="group" aria-label={label}>
      {CHOICES.map(([effect, word, title]) => (
        <button
          key={effect}
          type="button"
          className={`ua-iam__choice-btn ua-iam__choice-btn--${effect}`}
          aria-pressed={value === effect}
          title={title}
          disabled={busy}
          onClick={() => onChoose(effect)}
        >
          {word}
        </button>
      ))}
      {busy && <span className="ua-iam__unsaved">Saving…</span>}
    </div>
  );
}

const LEDGER_WORDS = { allow: "Allowed", deny: "Denied", inherit: "Back to the role" };
const LEDGER_ORDER = ["allow", "deny", "inherit"];
/** A set this small reads open; a bigger one opens on a click. */
const OPEN_UP_TO = 6;

/**
 * The person's own rights, saved and chosen, in one place above the long
 * table: what they hold that the role does not say, and where. One set per
 * effect and place ("Denied in every organisation, 78 rights"), so a person
 * with many grants reads as a few lines rather than a long list.
 */
function Ledger({ entries }) {
  const sets = useMemo(() => {
    const by = new Map();
    for (const e of entries) {
      const id = `${e.effect}|${e.where}`;
      if (!by.has(id)) by.set(id, { id, effect: e.effect, where: e.where, entries: [] });
      by.get(id).entries.push(e);
    }
    return [...by.values()].sort((a, b) => LEDGER_ORDER.indexOf(a.effect) - LEDGER_ORDER.indexOf(b.effect));
  }, [entries]);
  if (entries.length === 0) return null;
  return (
    <section className="ua-iam__ledger" aria-labelledby="ua-iam-ledger-title">
      <h3 id="ua-iam-ledger-title" className="ua-iam__ledger-title">
        Their own rights <span className="ua-iam__ledger-count">{entries.length}</span>
      </h3>
      <div className="ua-iam__sets">
      {sets.map((set) => {
        const unsaved = set.entries.filter((e) => e.unsaved).length;
        const n = set.entries.length;
        return (
          <details key={set.id} className={`ua-iam__set ua-iam__set--${set.effect}`} open={n <= OPEN_UP_TO || undefined}>
            <summary className="ua-iam__set-head">
              <span className="ua-iam__set-what">
                <span className="ua-iam__set-effect">{LEDGER_WORDS[set.effect]}</span> {set.where}
              </span>
              <span className="ua-iam__set-count">{n} {n === 1 ? "right" : "rights"}</span>
              {unsaved > 0 && <span className="ua-iam__unsaved">{unsaved} saving</span>}
            </summary>
            <ul className="ua-iam__set-list">
              {set.entries.map((e) => (
                <li key={e.key} className="ua-iam__set-item">
                  {e.name}
                  {e.unsaved && <span className="ua-iam__unsaved">Saving…</span>}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
      </div>
    </section>
  );
}

const REACH_ORDER = { all: 0, some: 1, none: 2 };

/**
 * How many rights the person has, drawn as one mark per right: solid where
 * they have it in every organisation they reach, lighter where only in some,
 * faint where nowhere. Held first, so the solid run reads as the share held.
 * Counts what Result says, including choices still saving.
 */
function Marks({ marks, label, small }) {
  const sorted = [...marks].sort((a, b) => REACH_ORDER[a.reach] - REACH_ORDER[b.reach]);
  return (
    <span className={small ? "ua-iam__marks ua-iam__marks--small" : "ua-iam__marks"} role="img" aria-label={label}>
      {sorted.map((m) => (
        <span key={m.slug} className={`ua-iam__mark ua-iam__mark--${m.reach}`} title={m.name} />
      ))}
    </span>
  );
}

/** Held in at least one organisation, out of how many. */
const heldOf = (marks) => marks.filter((m) => m.reach !== "none").length;

function Reach({ marks }) {
  const all = marks.filter((m) => m.reach === "all").length;
  const some = marks.filter((m) => m.reach === "some").length;
  const held = all + some;
  const said = `${held} of ${marks.length} rights${some ? `, ${some} of them in some organisations only` : ""}`;
  return (
    <div className="ua-iam__reach">
      <p className="ua-iam__reach-figure">
        <strong>{held}</strong> of {marks.length} rights
        {some > 0 && <span className="ua-iam__reach-some">{some} in some organisations</span>}
      </p>
      <Marks marks={marks} label={said} />
    </div>
  );
}

// Groups hidden from the board, kept per browser so the board opens as it was left.
const HIDDEN_KEY = "iam.board.hidden";
// Until somebody chooses, the board opens on the first few groups, A to Z.
const SHOWN_AT_FIRST = 10;
const BOARD_STACKS = 5;
const firstFew = (resources) => new Set([...resources].sort(byLabel).slice(SHOWN_AT_FIRST).map((g) => g.resource));
const readHidden = (resources) => {
  try {
    const saved = localStorage.getItem(HIDDEN_KEY);
    return saved === null ? firstFew(resources) : new Set(JSON.parse(saved));
  } catch { return firstFew(resources); }
};
const writeHidden = (set) => {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch { /* storage blocked: this visit only */ }
};

/**
 * Which groups the board shows: a box per group, A to Z, with Show all and
 * Hide all. Closes on a click outside or Escape.
 */
function GroupPicker({ groups, hidden, onToggle, onSet }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => {
      const menu = ref.current;
      if (!menu?.open) return;
      if (e.type === "keydown" ? e.key === "Escape" : !menu.contains(e.target)) menu.open = false;
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  const shown = groups.filter((g) => !hidden.has(g.resource)).length;
  return (
    <details ref={ref} className="ua-iam__groups">
      <summary className="ua-iam__groups-btn">
        <i className="ti ti-layout-columns" aria-hidden="true" />
        Groups <span className="ua-iam__groups-count">{shown} of {groups.length}</span>
        <i className="ti ti-chevron-down" aria-hidden="true" />
      </summary>
      <div className="ua-iam__groups-menu">
        <div className="ua-iam__groups-actions">
          <button type="button" className="ua-iam__link" disabled={shown === groups.length} onClick={() => onSet(new Set())}>
            Show all
          </button>
          <button type="button" className="ua-iam__link" disabled={shown === 0}
                  onClick={() => onSet(new Set(groups.map((g) => g.resource)))}>
            Hide all
          </button>
        </div>
        <ul className="ua-iam__groups-list">
          {groups.map((g) => (
            <li key={g.resource}>
              <label className="ua-iam__groups-opt">
                <input type="checkbox" checked={!hidden.has(g.resource)} onChange={() => onToggle(g.resource)} />
                <span>{g.label}</span>
                <span className="ua-iam__groups-n">{g.permissions.length}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

// The System Administrator's one permission stands for every right.
const WILDCARD = "platform:admin";
const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base" });

/**
 * Before anybody is chosen: every right on one board, a column per group,
 * A to Z. Each card says which roles give it; choosing a role lights the
 * cards it gives and fills each column's strip with its share.
 */
function Board({ resources, roles }) {
  const [roleSlug, setRoleSlug] = useState("");
  const [find, setFind] = useState("");
  const [hidden, setHiddenState] = useState(() => readHidden(resources));
  const setHidden = (next) => { setHiddenState(next); writeHidden(next); };
  const toggleHidden = (resource) => {
    const next = new Set(hidden);
    if (next.has(resource)) next.delete(resource); else next.add(resource);
    setHidden(next);
  };
  const role = roles.find((r) => r.slug === roleSlug) ?? null;
  const sortedGroups = useMemo(() => [...resources].sort(byLabel), [resources]);

  // Right → the names of the roles that give it.
  const givers = useMemo(() => {
    const by = new Map();
    for (const r of roles) {
      const every = r.permissions.includes(WILDCARD);
      for (const group of resources) for (const p of group.permissions) {
        if (!every && !r.permissions.includes(p.slug)) continue;
        if (!by.has(p.slug)) by.set(p.slug, []);
        by.get(p.slug).push(r.name);
      }
    }
    return by;
  }, [resources, roles]);

  const gives = (slug) => Boolean(role) && (givers.get(slug) ?? []).includes(role.name);

  const columns = useMemo(() => {
    const q = find.trim().toLowerCase();
    return resources
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter((p) => !q || `${group.label} ${p.name} ${p.slug}`.toLowerCase().includes(q)),
      }))
      .filter((group) => group.permissions.length > 0 && !hidden.has(group.resource))
      .sort(byLabel);
  }, [resources, find, hidden]);

  // Masonry: five stacks, each group dropped into whichever stack is shortest
  // so far, so a short group has the next one pulled up under it instead of
  // leaving a hole the height of its tallest neighbour. Heights are estimated
  // in card units for the first paint, then each group's drawn height is
  // measured and the board repacks once. Every stack is the same width, so a
  // group is the same height in any of them and the second pack is final.
  const boardRef = useRef(null);
  const [heights, setHeights] = useState({});
  const [width, setWidth] = useState(0);
  const stacks = useMemo(() => {
    const out = Array.from({ length: BOARD_STACKS }, () => ({ h: 0, groups: [] }));
    for (const group of columns) {
      const h = heights[group.resource]
        ?? 48 + (role ? 16 : 0) + group.permissions.reduce((n, p) => n + (p.name.length > 22 ? 82 : 66), 0);
      const low = out.reduce((a, b) => (b.h < a.h ? b : a));
      low.groups.push(group);
      low.h += h;
    }
    return out;
  }, [columns, role, heights]);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const next = {};
    let changed = false;
    for (const el of board.querySelectorAll("[data-group]")) {
      const h = el.offsetHeight;
      next[el.dataset.group] = h;
      if (heights[el.dataset.group] !== h) changed = true;
    }
    if (changed) setHeights((prev) => ({ ...prev, ...next }));
  }, [stacks, width, heights]);

  // A narrower board wraps names onto more lines: measure again.
  const hasColumns = columns.length > 0;
  useEffect(() => {
    const board = boardRef.current;
    if (!board || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(board);
    return () => ro.disconnect();
  }, [hasColumns]);

  const total = resources.reduce((n, g) => n + g.permissions.length, 0);
  const given = role ? resources.reduce((n, g) => n + g.permissions.filter((p) => gives(p.slug)).length, 0) : 0;

  return (
    <div className="ua-iam__board-wrap">
      <header className="ua-iam__board-head">
        <div className="ua-iam__who">
          <h2 className="ua-iam__name">Rights by group</h2>
          <p className="ua-iam__meta">
            {role ? (
              <><strong>{role.name}</strong> gives {given} of {total} rights</>
            ) : (
              `${total} rights in ${resources.length} groups. Choose a person to give or take one.`
            )}
          </p>
        </div>
        <div className="ua-iam__board-tools">
          {role && (
            <p className="ua-iam__key" aria-hidden="true">
              <span className="ua-iam__key-item ua-iam__key-item--given">Given</span>
              <span className="ua-iam__key-item ua-iam__key-item--not">Not given</span>
            </p>
          )}
          <GroupPicker groups={sortedGroups} hidden={hidden} onToggle={toggleHidden} onSet={setHidden} />
          <label className="ua-iam__field">
            <i className="ti ti-users-group ua-iam__search-icon" aria-hidden="true" />
            <span className="ua-iam__visually-hidden">What a role gives</span>
            <select value={roleSlug} onChange={(e) => setRoleSlug(e.target.value)}>
              <option value="">Show what a role gives</option>
              {roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
            </select>
            <i className="ti ti-chevron-down ua-iam__field-chevron" aria-hidden="true" />
          </label>
          <label className="ua-iam__search ua-iam__search--board">
            <i className="ti ti-search ua-iam__search-icon" aria-hidden="true" />
            <span className="ua-iam__visually-hidden">Find a right</span>
            <input type="search" value={find} placeholder="Find a right" onChange={(e) => setFind(e.target.value)} />
          </label>
        </div>
      </header>

      {sortedGroups.length > 0 && sortedGroups.every((g) => hidden.has(g.resource)) ? (
        <EmptyNote icon="ti-eye-off" tone="info" title="Every group is hidden"
                   action={{ label: "Show all groups", onClick: () => setHidden(new Set()) }}>
          Pick the groups to show from Groups above.
        </EmptyNote>
      ) : columns.length === 0 ? (
        <EmptyNote icon="ti-search-off" tone="info" title="No right matches">
          {hidden.size > 0 ? "Try a different word, or show the hidden groups." : "Try a different word."}
        </EmptyNote>
      ) : (
        <div ref={boardRef} className="ua-iam__board" role="list" aria-label="Rights by group">
          {stacks.map((stack, i) => (
          <div key={i} className="ua-iam__stack" role="none">
          {stack.groups.map((group) => {
            const marks = group.permissions.map((p) => ({ slug: p.slug, name: p.name, reach: gives(p.slug) ? "all" : "none" }));
            const n = group.permissions.length;
            return (
              <section key={group.resource} className="ua-iam__column" role="listitem" aria-label={group.label} data-group={group.resource}>
                <header className="ua-iam__column-head">
                  <h3 className="ua-iam__column-name">{group.label}</h3>
                  <span className="ua-iam__group-count">
                    {role ? `${heldOf(marks)} of ${n}` : `${n} ${n === 1 ? "right" : "rights"}`}
                  </span>
                  <button type="button" className="ua-iam__column-hide" aria-label={`Hide ${group.label}`}
                          title={`Hide ${group.label}`} onClick={() => toggleHidden(group.resource)}>
                    <i className="ti ti-eye-off" aria-hidden="true" />
                  </button>
                  {role && <Marks marks={marks} small label={`${role.name} gives ${heldOf(marks)} of ${n} rights in ${group.label}`} />}
                </header>
                <ul className="ua-iam__cards">
                  {group.permissions.map((p) => {
                    const names = givers.get(p.slug) ?? [];
                    const state = !role ? "" : gives(p.slug) ? " ua-iam__card--given" : " ua-iam__card--not";
                    return (
                      <li key={p.slug} className={`ua-iam__card${state}`}>
                        <span className="ua-iam__right">{p.name}</span>
                        <code className="ua-iam__slug">{p.slug}</code>
                        <span className="ua-iam__card-foot">
                          <span className="ua-iam__card-roles" title={names.join(", ") || "No role gives it"}>
                            {names.length} {names.length === 1 ? "role" : "roles"}
                          </span>
                          {!p.grantable && <span className="ua-iam__tag">Role only</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Fleets: per organisation, the whole fleet or only some of its categories
 * (operator, 2026-11-12: "assign an individual access to tankers or van sales
 * or finished goods"). Menengai's categories are its fleet list's tabs.
 *
 * Saves on the click like everything else here. "Some categories" with
 * nothing ticked is only on the page until one is ticked: the server will not
 * store a fleet of nothing. The last category cannot be unticked; "All
 * fleets" is how a restriction is lifted.
 */
function Fleets({ organisations, everyOrganisation, busy, onSave }) {
  // Organisations switched to "Some categories" with none ticked yet.
  const [choosing, setChoosing] = useState(() => new Set());
  const setChoosingOrg = (orgId, on) => setChoosing((now) => {
    const next = new Set(now);
    if (on) next.add(orgId); else next.delete(orgId);
    return next;
  });

  if (everyOrganisation) {
    return (
      <section className="ua-iam__fleets" aria-labelledby="ua-iam-fleets-title">
        <h3 id="ua-iam-fleets-title" className="ua-iam__ledger-title">Fleets</h3>
        <p className="ua-iam__fleet-note">Every fleet: their role covers every organisation.</p>
      </section>
    );
  }

  return (
    <section className="ua-iam__fleets" aria-labelledby="ua-iam-fleets-title">
      <h3 id="ua-iam-fleets-title" className="ua-iam__ledger-title">Fleets</h3>
      <ul className="ua-iam__fleet-list">
        {organisations.map((o) => {
          const f = o.fleet;
          if (!f) return null;
          const some = !f.allVehicles || choosing.has(o.id);
          const saving = busy === o.id;
          const held = new Set(f.groupIds);
          const units = f.categories.filter((c) => held.has(c.id)).reduce((n, c) => n + c.units, 0);
          const toggle = (id) => {
            const next = held.has(id) ? f.groupIds.filter((g) => g !== id) : [...f.groupIds, id];
            if (next.length === 0) return;
            setChoosingOrg(o.id, false);
            onSave(o, { allVehicles: false, vehicleGroupIds: next });
          };
          return (
            <li key={o.id} className="ua-iam__fleet">
              <div className="ua-iam__fleet-head">
                <span className="ua-iam__fleet-org">{o.name}</span>
                {f.narrowable ? (
                  <div className="ua-iam__well" role="group" aria-label={`Fleets in ${o.name}`}>
                    <button type="button" className="ua-iam__well-opt" aria-pressed={!some} disabled={saving}
                            onClick={() => {
                              setChoosingOrg(o.id, false);
                              if (!f.allVehicles) onSave(o, { allVehicles: true, vehicleGroupIds: [] });
                            }}>
                      All fleets
                    </button>
                    <button type="button" className="ua-iam__well-opt" aria-pressed={some} disabled={saving}
                            onClick={() => { if (f.allVehicles) setChoosingOrg(o.id, true); }}>
                      Some categories
                    </button>
                  </div>
                ) : (
                  <span className="ua-iam__tag">{f.allVehicles ? "All fleets" : "Some categories"}</span>
                )}
                <span className="ua-iam__fleet-sum">
                  {saving ? "Saving…"
                    : !some ? "Sees every unit, and units added later"
                    : f.groupIds.length === 0 ? "Tick the categories they may see"
                    : `${f.groupIds.length} ${f.groupIds.length === 1 ? "category" : "categories"} · ${units} units${f.singleUnits ? ` + ${f.singleUnits} single` : ""}`}
                </span>
              </div>
              {!f.narrowable && (
                <p className="ua-iam__fleet-note">
                  {f.reason}
                  {!f.allVehicles && (
                    <> <button type="button" className="ua-iam__fleet-link" disabled={saving}
                               onClick={() => onSave(o, { allVehicles: true, vehicleGroupIds: [] })}>
                      Give the whole fleet
                    </button></>
                  )}
                </p>
              )}
              {f.narrowable && some && (
                f.categories.length === 0 ? (
                  <p className="ua-iam__fleet-note">This organisation has no categories yet.</p>
                ) : (
                  <div className="ua-iam__cats" role="group" aria-label={`Categories in ${o.name}`}>
                    {f.categories.map((c) => {
                      const on = held.has(c.id);
                      const last = on && f.groupIds.length === 1;
                      return (
                        <button key={c.id} type="button" className="ua-iam__cat" aria-pressed={on}
                                disabled={saving || last}
                                title={last ? "The last category: choose All fleets to lift the limit" : undefined}
                                onClick={() => toggle(c.id)}>
                          <i className={`ti ${on ? "ti-square-check-filled" : "ti-square"}`} aria-hidden="true" />
                          <span className="ua-iam__cat-name">{c.name}</span>
                          <span className="ua-iam__cat-count">{c.units}</span>
                        </button>
                      );
                    })}
                  </div>
                )
              )}
            </li>
          );
        })}
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
  // Choices sent and not yet answered, key → effect: drawn as if saved.
  const [pending, setPending] = useState(() => new Map());
  const [find, setFind] = useState("");
  // Rights groups opened, by resource: every group starts folded, its head
  // carrying the group's Role gives / This person / Result. Kept across
  // people, so a group opened stays open while working down the list.
  const [opened, setOpened] = useState(() => new Set());
  const toggleGroup = (resource) => setOpened((now) => {
    const next = new Set(now);
    if (next.has(resource)) next.delete(resource); else next.add(resource);
    return next;
  });
  const [savedOnce, setSavedOnce] = useState(false);
  const [problem, setProblem] = useState("");
  const [held, setHeld] = useState(false);
  // The organisation whose fleet is being saved, or null.
  const [fleetBusy, setFleetBusy] = useState(null);
  // One save at a time, in the order the choices were made.
  const queue = useRef(Promise.resolve());

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
    if (pending.size > 0 || fleetBusy) { setHeld(true); return; }
    setSelectedId(id);
    setProblem("");
    setSavedOnce(false);
    setFind("");
  };

  const choose = (permission, name, effect) => {
    const key = keyOf(scopeId, permission);
    if ((standing.get(key) ?? "inherit") === effect || pending.has(key)) return;
    const userId = selectedId;
    const [change] = toChanges(new Map([[key, effect]]));
    setHeld(false);
    setProblem("");
    setPending((now) => new Map(now).set(key, effect));
    queue.current = queue.current.then(async () => {
      try {
        const next = await saveIamGrants(userId, [change]);
        queryClient.setQueryData(["iam", "user", userId], next);
        queryClient.invalidateQueries({ queryKey: ["iam", "users"] });
        setSavedOnce(true);
      } catch (err) {
        setProblem(`"${name}" was not saved: ${firstMessage(err) ?? "the server did not answer."}`);
      } finally {
        setPending((now) => {
          if (!now.has(key)) return now;
          const rest = new Map(now);
          rest.delete(key);
          return rest;
        });
      }
    });
  };

  const saveFleet = (org, choice) => {
    const userId = selectedId;
    setProblem("");
    setFleetBusy(org.id);
    queue.current = queue.current.then(async () => {
      try {
        const next = await saveIamFleet(userId, { organisationId: org.id, ...choice });
        queryClient.setQueryData(["iam", "user", userId], next);
        setSavedOnce(true);
      } catch (err) {
        setProblem(`Fleets in ${org.name} were not saved: ${firstMessage(err) ?? "the server did not answer."}`);
      } finally {
        setFleetBusy(null);
      }
    });
  };

  const groups = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (catalogue.data?.resources ?? [])
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter((p) =>
          !q || `${group.label} ${p.name} ${p.slug}`.toLowerCase().includes(q)),
      }))
      .filter((group) => group.permissions.length > 0)
      // Groups A to Z by the name on screen; rights inside keep the server's order.
      .sort(byLabel);
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

  // One mark per right that can be given, for the strip in the header.
  const reach = useMemo(() => (catalogue.data?.resources ?? []).flatMap((group) =>
    group.permissions.filter((p) => p.grantable).map((p) => {
      if (locked) return { resource: group.resource, slug: p.slug, name: p.name, reach: "all" };
      const r = resolveEverywhere(organisations, p.slug, standing);
      return { resource: group.resource, slug: p.slug, name: p.name, reach: spread(r.held, r.total) };
    })), [catalogue.data, organisations, standing, locked]);

  const personalHere = (permission) => standing.get(keyOf(scopeId, permission)) ?? "inherit";
  const savedHere = (permission) => savedMap.get(keyOf(scopeId, permission)) ?? "inherit";

  const roleCell = (permission) => {
    if (locked) return "Yes";
    if (scopeOrg) return scopeOrg.fromRoles.includes(permission) ? "Yes" : "No";
    const r = resolveEverywhere(organisations, permission, new Map());
    const s = spread(r.fromRole, r.total);
    return s === "all" ? "Yes" : s === "none" ? "No" : `${r.fromRole} of ${r.total}`;
  };

  const resultCell = (permission) => {
    if (locked) return <Result held>Can, in every organisation</Result>;
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

  /**
   * A group's three values, for its head: how many of its rights the role
   * gives, what this person holds on their own, and how many they end up
   * with — in the scope on screen, as the rows below it say one by one.
   */
  const groupSummary = (permissions) => {
    const n = permissions.length;
    if (locked) {
      return { role: `All ${n}`, person: "Given by the role", held: n, some: 0, n };
    }
    let given = 0, givenSome = 0, held = 0, heldSome = 0, allowed = 0, denied = 0, grantable = 0;
    for (const p of permissions) {
      if (scopeOrg) {
        if (scopeOrg.fromRoles.includes(p.slug)) given += 1;
        if (resolveIn(scopeOrg, p.slug, standing).held) held += 1;
      } else {
        const fromRole = resolveEverywhere(organisations, p.slug, new Map());
        const r = spread(fromRole.fromRole, fromRole.total);
        if (r === "all") given += 1; else if (r === "some") givenSome += 1;
        const res = resolveEverywhere(organisations, p.slug, standing);
        const s = spread(res.held, res.total);
        if (s === "all") held += 1; else if (s === "some") heldSome += 1;
      }
      if (!p.grantable) continue;
      grantable += 1;
      const mine = personalHere(p.slug);
      if (mine === "allow") allowed += 1; else if (mine === "deny") denied += 1;
    }
    const role = `${given} of ${n}${givenSome ? ` · ${givenSome} in some` : ""}`;
    const person = grantable === 0 ? "Set by the role only"
      : allowed + denied === 0 ? "Role"
      : [allowed && `${allowed} allowed`, denied && `${denied} denied`].filter(Boolean).join(" · ");
    return { role, person, held, some: heldSome, n };
  };

  const selectedUser = access?.user ?? (people.data?.users ?? []).find((u) => u.id === selectedId) ?? null;

  // The masthead's three figures, the Login Activity strip's shape.
  const everyone = people.data?.users ?? [];
  const figures = [
    ["people", everyone.length === 1 ? "Person" : "People", people.data ? everyone.length : null],
    ["personal", "With personal rights", people.data ? everyone.filter((u) => u.grants > 0).length : null],
    ["rights", "Rights to give", catalogue.data
      ? catalogue.data.resources.reduce((n, g) => n + g.permissions.filter((p) => p.grantable).length, 0) : null],
  ];

  return (
    <section className={selectedId ? "ua-iam ua-iam--open" : "ua-iam"} aria-labelledby="ua-iam-title">
      <h1 id="ua-iam-title" className="ua-iam__visually-hidden">Access rights</h1>

      <header className="ua-iam__masthead">
        <dl className="ua-iam__kpis">
          {figures.map(([id, label, value]) => (
            <div key={id} className={`ua-iam__kpi ua-iam__kpi--${id}`}>
              <dd>{value ?? "–"}</dd>
              <dt>{label}</dt>
            </div>
          ))}
        </dl>
      </header>

      <div className="ua-iam__split">
      <div className="ua-iam__people">
        <div className="ua-iam__people-head">
          <label className="ua-iam__search">
            <i className="ti ti-search ua-iam__search-icon" aria-hidden="true" />
            <span className="ua-iam__visually-hidden">Find a person</span>
            <input type="search" value={search} placeholder="Name, email or role" onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="ua-iam__well" role="group" aria-label="Show">
            <button type="button" className="ua-iam__well-opt" aria-pressed={!onlyPersonal} onClick={() => setOnlyPersonal(false)}>
              Everyone
            </button>
            <button type="button" className="ua-iam__well-opt" aria-pressed={onlyPersonal} onClick={() => setOnlyPersonal(true)}>
              With personal rights
            </button>
          </div>
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
          catalogue.isLoading ? (
            <EmptyNote icon="ti-loader-2" tone="busy" title="Reading access rights" />
          ) : catalogue.isError ? (
            <EmptyNote icon="ti-alert-triangle" tone="error" title="Access rights could not be loaded"
                       action={{ label: "Try again", onClick: () => catalogue.refetch() }}>
              {firstMessage(catalogue.error) ?? "The server did not answer."}
            </EmptyNote>
          ) : (
            <Board resources={catalogue.data?.resources ?? []} roles={catalogue.data?.roles ?? []} />
          )
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
                <p className="ua-iam__tags">
                  <span className="ua-iam__tag" title={organisations.map((o) => o.name).join(", ")}>
                    {organisations.length === 1
                      ? organisations[0].name
                      : `${organisations.length} organisations`}
                  </span>
                  <span className={grants.length > 0 ? "ua-iam__tag ua-iam__tag--own" : "ua-iam__tag"}>
                    {grants.length} personal {grants.length === 1 ? "right" : "rights"}
                  </span>
                </p>
              </div>
              {reach.length > 0 && <Reach marks={reach} />}
              {!locked && (
                <p className={pending.size > 0 || fleetBusy ? "ua-iam__status ua-iam__status--busy" : "ua-iam__status"} role="status">
                  {pending.size > 0 || fleetBusy ? (
                    <><i className="ti ti-loader-2" aria-hidden="true" /> Saving…</>
                  ) : savedOnce ? (
                    <><i className="ti ti-check" aria-hidden="true" /> Saved</>
                  ) : (
                    "Changes save as you choose"
                  )}
                </p>
              )}
            </header>

            {held && (
              <p className="ua-iam__notice ua-iam__notice--warn" role="alert">
                Still saving for {selectedUser?.fullName}. Choose somebody else in a moment.
              </p>
            )}
            {problem && <p className="ua-iam__notice ua-iam__notice--error" role="alert">{problem}</p>}

            {/* A System Administrator's list is every right, read only: the
                role gives all of it everywhere, so there is nothing to give
                or take here. Change the role on Users to narrow it. */}
              <div className="ua-iam__body">
                {!locked && <Ledger entries={ledger} />}
                {!locked && (
                  <Fleets key={selectedId} organisations={organisations} everyOrganisation={Boolean(access.everyOrganisation)}
                          busy={fleetBusy} onSave={saveFleet} />
                )}
                <div className="ua-iam__bar">
                  {locked ? (
                    <p className="ua-iam__locked">
                      <i className="ti ti-shield-check" aria-hidden="true" />
                      Holds every right in every organisation. Change the role on Users to narrow it.
                    </p>
                  ) : (
                  <label className="ua-iam__scope">
                    <span className="ua-iam__label">Applies in</span>
                    <select value={scopeOrg ? scopeOrg.id : EVERYWHERE} onChange={(e) => setScope(e.target.value)}>
                      <option value={EVERYWHERE}>Every organisation they reach</option>
                      {organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>
                  )}
                  <label className="ua-iam__search ua-iam__search--rights">
                    <i className="ti ti-search ua-iam__search-icon" aria-hidden="true" />
                    <span className="ua-iam__visually-hidden">Find a right</span>
                    <input type="search" value={find} placeholder="Find a right" onChange={(e) => setFind(e.target.value)} />
                  </label>
                  <button type="button" className="ua-iam__button ua-iam__fold-all" disabled={Boolean(find.trim())}
                          onClick={() => setOpened(opened.size > 0 ? new Set() : new Set(groups.map((g) => g.resource)))}>
                    {opened.size > 0 ? "Fold all" : "Open all"}
                  </button>
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
                      {groups.map((group) => {
                        // A search shows every match, folded or not.
                        const open = Boolean(find.trim()) || opened.has(group.resource);
                        const own = group.permissions.filter((p) => p.grantable && personalHere(p.slug) !== "inherit").length;
                        // The whole group, not just a search's matches.
                        const marks = reach.filter((m) => m.resource === group.resource);
                        const has = heldOf(marks);
                        const sum = groupSummary(group.permissions);
                        return (
                        <tbody key={group.resource}>
                          <tr className={open ? "ua-iam__group" : "ua-iam__group ua-iam__group--folded"}>
                            <th scope="rowgroup">
                              <button type="button" className="ua-iam__group-toggle" aria-expanded={open}
                                      onClick={() => toggleGroup(group.resource)}>
                                <span className="ua-iam__group-lead">
                                  <span className="ua-iam__group-name">{group.label}</span>
                                  {own > 0 && <span className="ua-iam__tag ua-iam__tag--own">{own} personal</span>}
                                </span>
                                {marks.length > 0 && (
                                  <span className="ua-iam__group-meter">
                                    <Marks marks={marks} small label={`${has} of ${marks.length} rights in ${group.label}`} />
                                  </span>
                                )}
                              </button>
                            </th>
                            <td className="ua-iam__group-cell" data-label="Role gives">{sum.role}</td>
                            <td className="ua-iam__group-cell" data-label="This person">{sum.person}</td>
                            <td className="ua-iam__group-cell">
                              <Result held={sum.held + sum.some > 0}>
                                {sum.held === sum.n ? `Can, all ${sum.n}`
                                  : sum.held + sum.some === 0 ? `Cannot, any of ${sum.n}`
                                  : `Can ${sum.held} of ${sum.n}${sum.some ? ` · ${sum.some} in some` : ""}`}
                              </Result>
                            </td>
                          </tr>
                          {open && group.permissions.map((p) => (
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
                                {locked ? (
                                  <span className="ua-iam__fixed">Given by the role</span>
                                ) : p.grantable ? (
                                  <Choice
                                    value={personalHere(p.slug)}
                                    busy={pending.has(keyOf(scopeId, p.slug))}
                                    label={`${p.name}, for this person`}
                                    onChoose={(effect) => choose(p.slug, p.name, effect)}
                                  />
                                ) : (
                                  <span className="ua-iam__fixed">Set by the role only</span>
                                )}
                              </td>
                              <td>{resultCell(p.slug)}</td>
                            </tr>
                          ))}
                        </tbody>
                        );
                      })}
                    </table>
                  )}
                </div>
              </div>
          </>
        )}
      </div>
      </div>
    </section>
  );
}
