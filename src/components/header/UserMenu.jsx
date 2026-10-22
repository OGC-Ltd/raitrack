/**
 * The signed-in user's menu — who you are, and what you can do about it:
 * your own account, the roster of everyone else's if you administer them, and
 * the way out.
 *
 * ## Why it exists at all
 *
 * `AuthContext.logout()` has been complete and working for as long as there
 * has been an AuthContext, and nothing in the app ever called it: there was no
 * way to sign out short of clearing cookies by hand. This is the control that
 * was missing, not the capability.
 *
 * ## Where it sits
 *
 * The header renders its right-hand cluster TWICE — once for desktop
 * (`.sukari-header__right`) and once for narrow screens
 * (`.sukari-header__top-right`) — and CSS decides which one is visible at
 * 639px. So this mounts in both, beside the theme toggle, and gets desktop and
 * mobile from one component. The mobile-shell components under components/
 * mobile/ are NOT the mobile surface: App.jsx runs AppShell at every width, so
 * editing those would ship nothing.
 *
 * ## Dismissal
 *
 * The same contract MapLayersMenu documents and FleetsMenu and FuelAlertsMenu
 * copy: `pointerdown` rather than `click` so a press that starts inside and
 * releases outside does not close the menu out from under a gesture, Escape
 * returns focus to the trigger, and the listeners exist only while open.
 */

import { useEffect, useRef, useState, useId } from "react";
import { useAuth } from "../../context/AuthContext";
import { useAppActions } from "../../context/AppContext";
import { usePermissions } from "../../hooks/usePermissions";
import "./UserMenu.css";

/** Up to two initials from a display name. Falls back to the email, then to a
 *  neutral glyph — `fullName` is NOT NULL on the server, but an account synced
 *  from the driver registry can carry something unhelpful. */
function initialsOf(name, email) {
  const source = String(name ?? "").trim() || String(email ?? "").trim();
  if (!source) return "·";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function UserMenu() {
  const { user, orgs, logout } = useAuth();
  // The account page is a full screen now, so whether it is open is app-level
  // navigation rather than something this menu owns.
  const { setAccountOpen, setUserAdminOpen } = useAppActions();
  // User accounts used to be a Maintenance sub-tab. It is here because it
  // belongs with Account rather than with vehicle servicing — and because this
  // menu is already the one place in the app that is about WHO you are.
  // The page supports read-only access too; writes remain gated by the
  // organisation-specific permissions enforced by the API.
  const { canIn } = usePermissions();
  const canAdminUsers = (orgs ?? []).some((org) => canIn(org.id, "user:read"));
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Rendered inside the authenticated shell, so this should never happen —
  // but a header that throws takes the whole app down with it.
  if (!user) return null;

  const name = user.fullName || user.email || "Signed in";

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`user-menu__trigger${open ? " user-menu__trigger--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account menu for ${name}`}
        title={name}
      >
        <span className="user-menu__initials" aria-hidden="true">
          {initialsOf(user.fullName, user.email)}
        </span>
      </button>

      {open && (
        <div className="user-menu__panel" id={panelId} role="menu" aria-label="Account">
          {/* Identity, not a control — which is why it is not a menuitem. The
              email is here because it is the thing you actually sign in with
              and the one field the account form will not let you change. */}
          <div className="user-menu__who">
            <div className="user-menu__name">{user.fullName || "-"}</div>
            {user.email && <div className="user-menu__email">{user.email}</div>}
          </div>

          <button
            type="button"
            className="user-menu__item"
            role="menuitem"
            onClick={() => { setOpen(false); setAccountOpen(true); }}
          >
            Account
          </button>

          {canAdminUsers && (
            <button
              type="button"
              className="user-menu__item"
              role="menuitem"
              onClick={() => { setOpen(false); setUserAdminOpen(true); }}
            >
              Users
            </button>
          )}

          <button
            type="button"
            className="user-menu__item user-menu__item--signout"
            role="menuitem"
            onClick={() => { setOpen(false); logout(); }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
