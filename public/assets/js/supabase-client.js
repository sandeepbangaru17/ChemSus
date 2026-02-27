// ============================================================
// public/assets/js/supabase-client.js
// ============================================================
// STEP 1: Replace the values below with your Supabase project URLs.
//         Go to: https://supabase.com/dashboard → Your Project → Settings → API
// STEP 2: Set ADMIN_EMAIL to the exact email that should have admin access.
// ============================================================

const SUPABASE_URL = "https://yndsnyxalvrctcsncoep.supabase.co";           // e.g. https://xyzxyz.supabase.co
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InluZHNueXhhbHZyY3Rjc25jb2VwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjcyOTMsImV4cCI6MjA4Nzc0MzI5M30.BlDKHruMH0o1hYQ2h_AxLSeIMeqn0jPQhOcz0O1BWd4";      // "anon public" key shown in API settings
const ADMIN_EMAIL = "pavankumar.prrp@gmail.com";             // Change to your actual admin email

// ============================================================
// DO NOT EDIT BELOW THIS LINE
// ============================================================

if (typeof supabase !== 'undefined') {
  window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.ADMIN_EMAIL = ADMIN_EMAIL;
} else {
  console.warn("[ChemSus] Supabase JS library not loaded. Check CDN link.");
}

// Auto-update the navbar auth button on every page
document.addEventListener("DOMContentLoaded", async () => {
  const authLink = document.getElementById("nav-auth-link");
  const authText = document.getElementById("nav-auth-text");
  if (!window.supabaseClient || !authLink || !authText) return;

  const { data: { session } } = await window.supabaseClient.auth.getSession();

  if (session) {
    const email = session.user.email;
    const display = email.length > 18
      ? email.split('@')[0].substring(0, 12) + '…'
      : email;

    authText.textContent = `Logout (${display})`;
    authLink.href = "#";
    authLink.onclick = async (e) => {
      e.preventDefault();
      await window.supabaseClient.auth.signOut();
      window.location.reload();
    };
  }
  // Show "My Orders" nav link when logged in
    const myOrdersLink = document.getElementById("nav-my-orders");
    if (myOrdersLink) {
      myOrdersLink.style.display = session ? "block" : "none";
    }
  // else: already shows "Log In / Sign Up" + links to /login.html (default HTML)
});
