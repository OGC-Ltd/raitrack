// Who is signed in, what they may do, and which organisations they may open.
//
// Sits ABOVE AppProvider, because the organisation switcher can only be built
// from the list this resolves — a user with one organisation should not be
// offered four, and the active-company seed has to be validated against what
// they may actually reach.
//
// The server answers all of it in one call. GET /api/v1/auth/me returns the
// user, the organisations they can open, the permissions they hold IN EACH
// (org-scoped roles mean the answer differs per organisation), and the vehicle
// scope where their view is narrowed. Splitting that across several requests
// would mean rendering a half-authorised UI while the rest arrived.

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch, setAccessToken, setSessionLostHandler, refreshOnce } from "../services/api";

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [orgs, setOrgs] = useState([]);          // [{ id, name, code, permissions[], vehicleIds|null }]
  const [isPlatform, setIsPlatform] = useState(false);
  // `booting` covers the silent-refresh round trip on mount. Rendering the
  // login screen during it would flash a sign-in form at someone who is
  // already signed in, on every single page load.
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState(null);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setOrgs([]);
    setIsPlatform(false);
  }, []);

  const loadMe = useCallback(async () => {
    const { data } = await apiFetch("/api/v1/auth/me");
    setUser(data.user);
    setOrgs(data.organisations ?? []);
    setIsPlatform(Boolean(data.isPlatform));
    return data;
  }, []);

  // A refused refresh anywhere in the app means the cookie is spent — most
  // often because token reuse was detected and the family was revoked. Drop
  // straight to the login screen rather than letting every panel render its own
  // "failed to load".
  useEffect(() => { setSessionLostHandler(clear); return () => setSessionLostHandler(null); }, [clear]);

  // Silent re-login. The access token lives in memory and is gone after a
  // reload; the refresh cookie is httpOnly and survives, so trading it here is
  // what keeps a signed-in user signed in across reloads.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshOnce();
        if (!cancelled) await loadMe();
      } catch {
        // No session, or it expired. Not an error worth showing — it is simply
        // the signed-out state, and the login screen says so already.
        if (!cancelled) clear();
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadMe, clear]);

  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      const { data } = await apiFetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setAccessToken(data.accessToken ?? null);
      await loadMe();
      return true;
    } catch (err) {
      // The server answers every failed sign-in identically on purpose, so
      // nobody can probe which addresses exist. Pass that through unchanged.
      setError(err?.status === 401 ? "Invalid email or password." : (err?.message ?? "Sign-in failed."));
      return false;
    }
  }, [loadMe]);

  const logout = useCallback(async () => {
    // The cookie is what actually ends the session, so the request matters more
    // than its answer — clear locally whatever it says.
    try { await apiFetch("/api/v1/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    clear();
  }, [clear]);

  const value = useMemo(() => {
    const byId = new Map(orgs.map((o) => [o.id, o]));
    const permsFor = (orgId) => new Set(byId.get(orgId)?.permissions ?? []);

    return {
      user,
      orgs,
      isPlatform,
      booting,
      error,
      isAuthenticated: Boolean(user),
      login,
      logout,
      reload: loadMe,

      /**
       * Does this person hold `slug` in this organisation?
       *
       * `platform:admin` is the wildcard the server also honours; checking it
       * here as well keeps the UI from hiding controls a super admin would then
       * find perfectly usable if they guessed the URL.
       */
      can: (slug, orgId) => {
        const held = permsFor(orgId);
        return held.has("platform:admin") || held.has(slug);
      },

      /**
       * The vehicles visible in this organisation, or NULL for no restriction.
       *
       * Null and an empty array are different answers and must not be
       * conflated: null is the whole fleet, an empty array is nothing.
       */
      vehicleScope: (orgId) => byId.get(orgId)?.vehicleIds ?? null,
    };
  }, [user, orgs, isPlatform, booting, error, login, logout, loadMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
