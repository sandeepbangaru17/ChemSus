// ============================================================
// public/assets/js/supabase-client.js
// ============================================================
// Loads Supabase creds from /config.json (served by the backend from env vars)
// so keys never live in git history. See README for the required env vars.
// ============================================================

const CONFIG_ENDPOINT = "/config.json";
const FALLBACK_SESSION_KEY = "chemsus_supabase_session_fallback";

function readFallbackSession() {
  try {
    const raw = localStorage.getItem(FALLBACK_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.access_token || !session.user?.email) return null;
    if (session.expires_at && Date.now() / 1000 > Number(session.expires_at)) {
      localStorage.removeItem(FALLBACK_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function writeFallbackSession(session) {
  try {
    if (!session || !session.access_token || !session.user?.email) return;
    localStorage.setItem(FALLBACK_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage errors
  }
}

function clearFallbackSession() {
  try {
    localStorage.removeItem(FALLBACK_SESSION_KEY);
  } catch {
    // Ignore storage errors
  }
}

function patchAuthWithFallback(client) {
  if (!client || !client.auth || client.__chemsusFallbackPatched) return client;
  client.__chemsusFallbackPatched = true;

  const originalGetSession = client.auth.getSession?.bind(client.auth);
  const originalSignOut = client.auth.signOut?.bind(client.auth);
  const originalSetSession = client.auth.setSession?.bind(client.auth);

  if (originalGetSession) {
    client.auth.getSession = async (...args) => {
      try {
        const res = await originalGetSession(...args);
        const liveSession = res?.data?.session || null;
        if (liveSession) {
          writeFallbackSession(liveSession);
          return res;
        }
        const fallback = readFallbackSession();
        if (fallback) return { data: { session: fallback }, error: null };
        return res;
      } catch (err) {
        const fallback = readFallbackSession();
        if (fallback) return { data: { session: fallback }, error: null };
        throw err;
      }
    };
  }

  if (originalSignOut) {
    client.auth.signOut = async (...args) => {
      clearFallbackSession();
      try {
        return await originalSignOut(...args);
      } catch {
        return { error: null };
      }
    };
  }

  if (originalSetSession) {
    client.auth.setSession = async (...args) => {
      const res = await originalSetSession(...args);
      const liveSession = res?.data?.session || null;
      if (liveSession) writeFallbackSession(liveSession);
      return res;
    };
  }

  return client;
}

window.chemsusAuthFallback = {
  key: FALLBACK_SESSION_KEY,
  readSession: readFallbackSession,
  writeSession: writeFallbackSession,
  clearSession: clearFallbackSession,
};

async function loadSupabaseConfig() {
  if (window.__CHEMSUS_CONFIG) return window.__CHEMSUS_CONFIG;
  try {
    const res = await fetch(CONFIG_ENDPOINT, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    window.__CHEMSUS_CONFIG = cfg;
    return cfg;
  } catch (err) {
    console.error("[ChemSus] Unable to load Supabase config", err);
    return null;
  }
}

window.supabaseReady = (async () => {
  const cfg = await loadSupabaseConfig();
  if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    console.error("[ChemSus] Missing Supabase config. Set SUPABASE_URL and SUPABASE_ANON_KEY env vars on the server.");
    return null;
  }
  if (typeof supabase === "undefined") {
    console.warn("[ChemSus] Supabase JS library not loaded. Check CDN link.");
    return null;
  }

  window.supabaseClient = patchAuthWithFallback(
    supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
  );
  window.ADMIN_EMAIL = cfg.adminEmail || "";
  return window.supabaseClient;
})();

// Auto-update the navbar auth button on every page
document.addEventListener("DOMContentLoaded", async () => {
  const client = await window.supabaseReady;
  const authLink = document.getElementById("nav-auth-link");
  const authText = document.getElementById("nav-auth-text");
  if (!client || !authLink || !authText) return;

  const { data: { session } } = await client.auth.getSession();

  if (session) {
    const email = session.user.email;
    const display = email.length > 18
      ? email.split("@")[0].substring(0, 12) + "..."
      : email;

    authText.textContent = `Logout (${display})`;
    authLink.href = "#";
    authLink.onclick = async (e) => {
      e.preventDefault();
      await client.auth.signOut();
      window.location.reload();
    };
  }
  // Show "My Orders" nav link when logged in
  const myOrdersLink = document.getElementById("nav-my-orders");
  if (myOrdersLink) {
    myOrdersLink.style.display = session ? "block" : "none";
  }
});
