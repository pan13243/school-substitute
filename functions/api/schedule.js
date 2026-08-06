// Cloudflare Pages Function for /api/schedule
// 使用 fetch 直接调用 Supabase REST API

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

// GET /api/schedule - 获取课表数据（从 Supabase 读取并转换为前端格式）
export async function onRequestGet(context) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/schedule?select=*`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
    const records = await res.json();
    
    // 转换数据库字段名为前端字段名
    const data = (records || []).map(r => ({
      className: r.class_name,
      teacherName: r.teacher_name,
      subject: r.subject,
      weekday: r.weekday,
      period: r.period,
      oddWeekTeacher: r.odd_week_teacher,
      evenWeekTeacher: r.even_week_teacher,
      isAfterSchool: r.is_after_school,
    }));
    
    return jsonResponse({ success: true, data });
  } catch (error) {
    console.error('Schedule GET Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

// POST /api/schedule - 保存课表数据（覆盖）
export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { records } = body;

    if (!Array.isArray(records)) {
      return jsonResponse({ error: 'records must be an array' }, 400);
    }

    // 先删除旧数据
    const deleteRes = await fetch(`${SUPABASE_URL}/rest/v1/schedule`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
    });
    if (!deleteRes.ok) throw new Error(`Delete error: ${deleteRes.status}`);

    // 转换前端字段名为数据库字段名
    const dbRecords = records.map(r => ({
      class_name: r.className,
      teacher_name: r.teacherName,
      subject: r.subject || '',
      weekday: r.weekday,
      period: parseInt(r.period) || 0,
      odd_week_teacher: r.oddWeekTeacher || null,
      even_week_teacher: r.evenWeekTeacher || null,
      is_after_school: r.isAfterSchool || false,
    }));

    // 批量插入新数据
    if (dbRecords.length > 0) {
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/schedule`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(dbRecords),
      });
      if (!insertRes.ok) {
        const errText = await insertRes.text();
        throw new Error(`Insert error: ${insertRes.status} - ${errText}`);
      }
    }

    return jsonResponse({ success: true, count: dbRecords.length });
  } catch (error) {
    console.error('Schedule POST Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

// DELETE /api/schedule - 清空课表数据
export async function onRequestDelete(context) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/schedule`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
    });
    if (!res.ok) throw new Error(`Delete error: ${res.status}`);
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Schedule DELETE Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

// OPTIONS - CORS 预检
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
