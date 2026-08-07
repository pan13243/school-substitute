const { createClient } = require('@supabase/supabase-js');

const supabaseUrl  = process.env.SUPABASE_URL  || 'https://mucdpljnchabygrrdvda.supabase.co';
const supabaseKey  = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11Y2RwbGpuY2hhYnlncnJkdmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MzY0OTMsImV4cCI6MjEwMTUxMjQ5M30.rXPhoaN4OfgDntjllIUkHsuOSZhCuMWZ7yLCUL76CrE';

let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[DB] Supabase connected ✓');
  } catch(e) {
    console.error('[DB] Supabase init failed:', e.message);
  }
} else {
  console.warn('[DB] No env vars — using in-memory store');
}

// ── Memory store (dev fallback / offline mode) ──────────────────────────────
const mem = { schedule: [], leaves: [], substitutes: [], config: {} };

// ── Admin password ───────────────────────────────────────────────────────────
const ADMIN_HASH = 'admin888'; // 首次部署请改为强密码

function authAdmin(headers) {
  const p = headers['x-admin-password'] || headers['x-admin-pwd'] || '';
  return p === ADMIN_HASH;
}

module.exports = { supabase, mem, authAdmin, ADMIN_HASH };
