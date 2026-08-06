// Cloudflare Pages Function for /api/substitutes
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/substitute_records?select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) {
      console.error('Substitutes GET failed:', res.status);
      return jsonResponse({ success: true, data: [] });
    }
    const records = await res.json();
    return jsonResponse({ success: true, data: records || [] });
  } catch (error) {
    console.error('Substitutes GET Error:', error);
    return jsonResponse({ success: true, data: [] });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { records } = body;
    if (!Array.isArray(records)) {
      return jsonResponse({ error: 'records must be an array' }, 400);
    }
    const dbRecords = records.map(r => ({
      leave_id: r.leaveId || r.leave_id,
      substitute_teacher: r.substituteTeacher || r.substitute_teacher,
      class_name: r.className || r.class_name,
      day_of_week: r.dayOfWeek || r.day_of_week,
      period: r.period,
      subject: r.subject || '',
      created_at: new Date().toISOString(),
    }));
    if (dbRecords.length > 0) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/substitute_records`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(dbRecords),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('Substitutes POST failed:', res.status, errText);
        return jsonResponse({ error: `Insert failed: ${res.status}` }, 500);
      }
    }
    return jsonResponse({ success: true, count: dbRecords.length }, 201);
  } catch (error) {
    console.error('Substitutes POST Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/substitute_records`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' },
    });
    if (!res.ok) {
      console.error('Substitutes DELETE failed:', res.status);
    }
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Substitutes DELETE Error:', error);
    return jsonResponse({ success: true });
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
