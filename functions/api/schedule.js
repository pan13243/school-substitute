const SUPABASE_URL = 'https://mucdpljnchabygrrdvda.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11Y2RwbGpuY2hhYnlncnJkdmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MzY0OTMsImV4cCI6MjEwMTUxMjQ5M30.rXPhoaN4OfgDntjllIUkHsuOSZhCuMWZ7yLCUL76CrE';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function onRequestGet(context) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/schedule?select=*&order=id`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const data = await res.json();
    return jsonResponse({ success: true, data: data || [] });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { records } = body;
    if (!Array.isArray(records)) return jsonResponse({ error: 'records must be an array' }, 400);
    await fetch(`${SUPABASE_URL}/rest/v1/schedule`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: { neq: 0 } }),
    });
    if (records.length > 0) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/schedule`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(records),
      });
      if (!res.ok) throw new Error('Insert failed');
    }
    return jsonResponse({ success: true, count: records.length });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/schedule`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: { neq: 0 } }),
    });
    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
