import { useCallback, useEffect, useMemo, useState } from "react";
import { listOrgUsers } from "../../api/users";
import {
  addUserToGroup, createUserGroup, deleteUserGroup, listUserGroups,
  removeUserFromGroup, updateUserGroup,
} from "../../api/userGroups";
import { useAuth } from "../../context/AuthContext";
import { usePermissions } from "../../hooks/usePermissions";
import "./UserGroupsPanel.css";

const EMPTY_GROUP = { name: "", description: "" };

export default function UserGroupsPanel() {
  const { orgs } = useAuth();
  const { orgId, canIn } = usePermissions();
  const adminOrgs = useMemo(
    () => (orgs ?? []).filter((org) => canIn(org.id, "user:read")),
    [orgs, canIn],
  );
  const [selectedOrgId, setSelectedOrgId] = useState(orgId ?? "");
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const canManage = selectedOrgId
    ? canIn(selectedOrgId, "user:assign_role")
    : false;

  useEffect(() => {
    if (adminOrgs.some((org) => org.id === selectedOrgId)) return;
    setSelectedOrgId(orgId && adminOrgs.some((org) => org.id === orgId)
      ? orgId
      : adminOrgs[0]?.id ?? "");
  }, [adminOrgs, orgId, selectedOrgId]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!selectedOrgId) {
      setGroups([]);
      setUsers([]);
      setSelectedGroupId("");
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      listUserGroups(selectedOrgId),
      listOrgUsers(selectedOrgId, { limit: 100 }),
    ]).then(([nextGroups, roster]) => {
      if (cancelled) return;
      setGroups(nextGroups);
      setUsers(roster.users);
      setSelectedGroupId((current) =>
        nextGroups.some((group) => group.id === current)
          ? current
          : nextGroups[0]?.id ?? "");
    }).catch((err) => {
      if (!cancelled) setError(err.message || "Could not load groups and users.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [selectedOrgId, reloadKey]);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const members = useMemo(
    () => users.filter((user) => user.groups?.some((group) => group.id === selectedGroupId)),
    [users, selectedGroupId],
  );
  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((user) =>
      !user.groups?.some((group) => group.id === selectedGroupId)
      && (!needle || `${user.fullName} ${user.email ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [users, search, selectedGroupId]);

  function beginCreate() {
    setSelectedGroupId("");
    setGroupForm(EMPTY_GROUP);
    setEditing(true);
    setConfirmDelete(false);
    setError("");
    setNotice("");
  }

  function beginEdit() {
    if (!selectedGroup) return;
    setGroupForm({
      name: selectedGroup.name,
      description: selectedGroup.description ?? "",
    });
    setEditing(true);
    setConfirmDelete(false);
    setError("");
    setNotice("");
  }

  function cancelEdit() {
    setEditing(false);
    setGroupForm(EMPTY_GROUP);
    if (!selectedGroupId && groups.length) setSelectedGroupId(groups[0].id);
  }

  async function saveGroup(event) {
    event.preventDefault();
    if (!canManage || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (selectedGroup) {
        const saved = await updateUserGroup(selectedOrgId, selectedGroup.id, groupForm);
        setGroups((current) => current.map((group) =>
          group.id === saved.id ? { ...group, ...saved } : group));
        setNotice("Group updated.");
      } else {
        const created = await createUserGroup(selectedOrgId, groupForm);
        setGroups((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedGroupId(created.id);
        setNotice("Group created.");
      }
      setEditing(false);
      setGroupForm(EMPTY_GROUP);
    } catch (err) {
      setError(err.message || "Could not save this group.");
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup() {
    if (!selectedGroup || !canManage || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await deleteUserGroup(selectedOrgId, selectedGroup.id);
      setGroups((current) => current.filter((group) => group.id !== selectedGroup.id));
      setSelectedGroupId("");
      setConfirmDelete(false);
      setNotice("Group deleted.");
    } catch (err) {
      setError(err.message || "Could not delete this group.");
    } finally {
      setBusy(false);
    }
  }

  async function changeMembership(user, action) {
    if (!selectedGroup || !canManage || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "add") {
        await addUserToGroup(selectedOrgId, selectedGroup.id, user.id);
        setNotice(`${user.fullName} added to ${selectedGroup.name}.`);
      } else {
        await removeUserFromGroup(selectedOrgId, selectedGroup.id, user.id);
        setNotice(`${user.fullName} removed from ${selectedGroup.name}.`);
      }
      reload();
    } catch (err) {
      setError(err.message || "Could not change this membership.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ug-page" aria-labelledby="ug-title">
      <header className="ug-heading">
        <div>
          <h1 id="ug-title">User groups</h1>
          <p>Create organisation-specific groups and manage their memberships.</p>
        </div>
        {adminOrgs.length > 1 ? (
          <label className="ug-org-picker">
            <span>Organisation</span>
            <select value={selectedOrgId} disabled={busy} onChange={(event) => {
              setSelectedOrgId(event.target.value);
              setSelectedGroupId("");
              setEditing(false);
              setConfirmDelete(false);
              setSearch("");
              setError("");
              setNotice("");
            }}>
              {adminOrgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <span className="ug-org-name">{adminOrgs[0]?.name ?? "No organisation"}</span>
        )}
      </header>

      {error && <p className="ug-message ug-message--error" role="alert">{error}</p>}
      {notice && <p className="ug-message" role="status">{notice}</p>}

      {!selectedOrgId ? (
        <p className="ug-empty">You do not have access to an organisation user roster.</p>
      ) : (
        <div className="ug-layout">
          <aside className="ug-list" aria-label="Groups">
            <div className="ug-list__heading">
              <h2>Groups <span>{groups.length}</span></h2>
              {canManage && (
                <button type="button" className="ug-button ug-button--primary"
                        onClick={beginCreate} disabled={busy}>
                  Create group
                </button>
              )}
            </div>
            {loading ? <p className="ug-muted">Loading groups…</p>
              : groups.length === 0 ? (
                <p className="ug-empty">No custom groups yet.</p>
              ) : (
                <ul>
                  {groups.map((group) => (
                    <li key={group.id}>
                      <button type="button"
                              className={"ug-group" + (selectedGroupId === group.id ? " ug-group--selected" : "")}
                              aria-current={selectedGroupId === group.id ? "true" : undefined}
                              disabled={busy}
                              onClick={() => {
                                setSelectedGroupId(group.id);
                                setEditing(false);
                                setConfirmDelete(false);
                                setError("");
                              }}>
                        <span className="ug-group__name">{group.name}</span>
                        <span className="ug-group__count">
                          {group._count?.users ?? users.filter((user) =>
                            user.groups?.some((membership) => membership.id === group.id)).length}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </aside>

          <div className="ug-detail">
            {editing ? (
              <form className="ug-form" onSubmit={saveGroup}>
                <h2>{selectedGroup ? "Edit group" : "Create group"}</h2>
                <label>
                  <span>Group name</span>
                  <input autoFocus required minLength={2} maxLength={100}
                         value={groupForm.name}
                         onChange={(event) => setGroupForm((form) => ({ ...form, name: event.target.value }))} />
                </label>
                <label>
                  <span>Description <small>Optional</small></span>
                  <textarea maxLength={500} rows={3}
                            value={groupForm.description}
                            onChange={(event) => setGroupForm((form) => ({ ...form, description: event.target.value }))} />
                </label>
                <div className="ug-actions">
                  <button type="button" className="ug-button" onClick={cancelEdit} disabled={busy}>Cancel</button>
                  <button type="submit" className="ug-button ug-button--primary" disabled={busy}>
                    {busy ? "Saving…" : selectedGroup ? "Save group" : "Create group"}
                  </button>
                </div>
              </form>
            ) : selectedGroup ? (
              <>
                <header className="ug-detail__heading">
                  <div>
                    <h2>{selectedGroup.name}</h2>
                    <p>{selectedGroup.description || "No description"}</p>
                  </div>
                  {canManage && (
                    <div className="ug-actions">
                      <button type="button" className="ug-button" onClick={beginEdit} disabled={busy}>Edit</button>
                      <button type="button" className="ug-button ug-button--danger"
                              onClick={removeGroup} disabled={busy}>
                        {confirmDelete ? "Confirm delete" : "Delete"}
                      </button>
                    </div>
                  )}
                </header>
                {confirmDelete && (
                  <p className="ug-delete-warning" role="alert">
                    This deletes the group and removes its memberships, but does not delete user accounts.
                    <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
                  </p>
                )}

                {canManage && (
                  <div className="ug-add">
                    <label>
                      <span>Add a user</span>
                      <input type="search" value={search}
                             onChange={(event) => setSearch(event.target.value)}
                             placeholder="Search by name or email" />
                    </label>
                    <div className="ug-candidates">
                      {candidates.slice(0, 8).map((user) => (
                        <div className="ug-person" key={user.id}>
                          <span><strong>{user.fullName}</strong><small>{user.email}</small></span>
                          <button type="button" className="ug-button"
                                  aria-label={`Add ${user.fullName} to ${selectedGroup.name}`}
                                  onClick={() => changeMembership(user, "add")}
                                  disabled={busy}>Add</button>
                        </div>
                      ))}
                      {candidates.length === 0 && (
                        <p className="ug-muted">{search ? "No matching users to add." : "Everyone in this roster is already in the group."}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="ug-members">
                  <h3>Members <span>{members.length}</span></h3>
                  {loading ? <p className="ug-muted">Loading members…</p>
                    : members.length === 0 ? <p className="ug-empty">This group has no members.</p>
                      : <ul>
                        {members.map((user) => (
                          <li className="ug-person" key={user.id}>
                            <span>
                              <strong>{user.fullName}</strong>
                              <small>{user.email || "No email address"}</small>
                              {user.groups.length > 1 && (
                                <span className="ug-memberships">
                                  Also in {user.groups.filter((group) => group.id !== selectedGroup.id)
                                    .map((group) => group.name).join(", ")}
                                </span>
                              )}
                            </span>
                            {canManage && (
                              <button type="button" className="ug-button ug-button--quiet"
                                      aria-label={`Remove ${user.fullName} from ${selectedGroup.name}`}
                                      onClick={() => changeMembership(user, "remove")} disabled={busy}>
                                Remove
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>}
                </div>
              </>
            ) : (
              <div className="ug-empty ug-empty--large">
                <h2>{groups.length ? "Select a group" : "Create your first group"}</h2>
                <p>{groups.length
                  ? "Choose a group to view its members and manage access."
                  : canManage
                    ? "Groups are created by your organisation administrator."
                    : "An administrator can create groups for this organisation."}</p>
                {!groups.length && canManage && (
                  <button type="button" className="ug-button ug-button--primary" onClick={beginCreate}>
                    Create group
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
