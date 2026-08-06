import { createClient } from '@supabase/supabase-js';

function getSupabase(env) {
  const url = env.SUPABASE_URL || 'https://mucdpljnchabygrrdvda.supabase.co';
  const key = env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11Y2RwbGpuY2hhYnlncnJkdmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MzY0OTMsImV4cCI6MjEwMTUxMjQ5M30.rXPhoaN4OfgDntjllIUkHsuOSZhCuMWZ7yLCUL76CrE';
  return createClient(url, key);
}

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

// GET /api/leaves - 获取请假记录
export async function onRequestGet(context) {
  try {
    const supabase = getSupabase(context.env);
    const { data: records, error } = await supabase.from('leaves').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return jsonResponse({ success: true, data: records || [] });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// POST /api/leaves - 添加请假记录
export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { teacher, reason, startDate, endDate, periods, type } = body;
    if (!teacher || !startDate) return jsonResponse({ error: 'teacher and startDate are required' }, 400);
    const supabase = getSupabase(context.env);
    const { data, error } = await supabase.from('leaves').insert({ teacher, reason: reason || '', start_date: startDate, end_date: endDate || startDate, periods: periods || '', type: type || 'personal' }).select();
    if (error) throw error;
    return jsonResponse({ success: true, data: data[0] });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// DELETE /api/leaves - 清空请假记录
export async function onRequestDelete(context) {
  try {
    const supabase = getSupabase(context.env);
    const { error } = await supabase.from('leaves').delete().neq('id', 0);
    if (error) throw error;
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
