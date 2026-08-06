// Cloudflare Pages Function for /api/leaves
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leave_records?select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) {
      console.error('Leaves GET failed:', res.status);
      return jsonResponse({ success: true, data: [] });
    }
    const records = await res.json();
    return jsonResponse({ success: true, data: records || [] });
  } catch (error) {
    console.error('Leaves GET Error:', error);
    return jsonResponse({ success: true, data: [] });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { leave } = body;
    if (!leave) {
      return jsonResponse({ error: 'leave data is required' }, 400);
    }
    const newLeave = {
      teacher_name: leave.teacherName || leave.teacher_name,
      teacher_id: leave.teacherId || leave.teacher_id,
      leave_date: leave.leaveDate || leave.leave_date,
      day_of_week: leave.dayOfWeek || leave.day_of_week,
      period: leave.period,
      reason: leave.reason || '',
      created_at: new Date().toISOString(),
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leave_records`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(newLeave),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Leaves POST failed:', res.status, errText);
      return jsonResponse({ error: `Insert failed: ${res.status}` }, 500);
    }
    return jsonResponse({ success: true }, 201);
  } catch (error) {
    console.error('Leaves POST Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leave_records`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' },
    });
    if (!res.ok) {
      console.error('Leaves DELETE failed:', res.status);
    }
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Leaves DELETE Error:', error);
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
