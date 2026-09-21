/**
 * User accounts, as a full screen.
 *
 * ## Why it is not a Maintenance sub-tab any more
 *
 * It used to be `MaintenanceScreen`'s third view, gated on `user:create` — so
 * the roster of PEOPLE lived inside the tab about servicing VEHICLES, and the
 * only way to find it was to already know that the Maintenance tab grew an
 * extra sub-tab when you happened to be an admin. It is reached from the
 * avatar menu now, beside Account: both answer "who can use this dashboard".
 *
 * ## The shell, and what it owes UserAdminPanel
 *
 * AccountScreen's back control, so the two pages the avatar menu opens are
 * recognisably one pair. The difference is below it: this page SCROLLS as a
 * whole (`.uadm-page__body`), because the panel is one column of cards rather
 * than AccountScreen's two independent ones.
 *
 * The bar carries ONLY the way out. It had a title and a strapline for about
 * one revision; they went because the page announces itself perfectly well
 * without them — you arrive by clicking "User accounts" in the avatar menu,
 * and the panel's own first line already reads "N people · <org>", which says
 * the same thing while also being a fact. A heading that repeats the control
 * you just clicked is a row of pixels spent on nothing.
 *
 * The panel itself is unchanged and still carries no title of its own.
 * `--maint-gutter` is redeclared on the body because the panel's padding is
 * written against that token — it used to come from the Maintenance scroller.
 */

import { useEffect } from "react";
import { useAppContext } from "../../context/AppContext";
import ErrorBoundary from "../shared/ErrorBoundary";
import UserAdminPanel from "../body/UserAdminPanel";
import "./UserAdminScreen.css";

export default function UserAdminScreen() {
  const { setUserAdminOpen } = useAppContext();

  // Escape closes it, the same contract AccountScreen states.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setUserAdminOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setUserAdminOpen]);

  return (
    <div className="uadm-page">
      {/* The Maintenance tab's orientation strip, and for the same reason it
          exists there: with no page title below it, this is the only thing on
          screen that says where you are. The difference is that the first
          crumb here is a real ancestor you can click — Maintenance IS its own
          tab, so its crumb has nowhere to go, while this page is an overlay
          over the fleet and going back is the whole of the way out. */}
      <header className="uadm-page__bar">
        <nav className="uadm-crumbs" aria-label="Breadcrumb">
          <ol className="uadm-crumbs__list">
            <li className="uadm-crumbs__item">
              <button type="button" className="uadm-page__back" onClick={() => setUserAdminOpen(false)}>
                ← Fleet
              </button>
            </li>
            <li className="uadm-crumbs__item uadm-crumbs__item--current" aria-current="page">
              User accounts
            </li>
          </ol>
        </nav>
      </header>

      <div className="uadm-page__body">
        <ErrorBoundary label="User accounts" fullSection>
          <UserAdminPanel />
        </ErrorBoundary>
      </div>
    </div>
  );
}
