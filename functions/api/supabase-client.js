/**
 * Supabase 客户端 — Cloudflare Workers / Pages Functions 版本
 * 同时支持本地 Express（CommonJS）和 Cloudflare（ES Module）
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// ── Cloudflare 环境变量 ────────────────────────────────
export function getSupabase(env) {
  const url = env?.SUPABASE_URL;
  const key = env?.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── 内存存储（Cloudflare Workers 内存 / 降级）───────────
export const mem = {
  config:    null,   // { timetable, teacherAssignment, afterSchoolService, classes, allTeachers }
  leaves:    [],
  substitutes: [],
  nextId:    1
};

// ── 初始化课表数据 ─────────────────────────────────────
export function initScheduleData(env) {
  // Cloudflare: env.SCHEDULE_DATA 为 JSON 字符串（wrangler secret 或 kv）
  if (env?.SCHEDULE_DATA) {
    try { mem.config = JSON.parse(env.SCHEDULE_DATA); return true; } catch(e) {}
  }
  // 本地文件 fallback（Express 环境）
  if (typeof process !== 'undefined' && process.env?.FORCE_LOCAL === '1') {
    try {
      const path = typeof __dirname !== 'undefined'
        ? `${__dirname}/../parsed_data.json`
        : './parsed_data.json';
      const fs   = require('fs');
      const data = JSON.parse(fs.readFileSync(path, 'utf8'));
      mem.config = {
        timetable:           data.timetable,
        teacherAssignment:    data.teacherAssignment,
        afterSchoolService:   data.afterSchoolService || [],
        classes:              data.classes,
        allTeachers:          data.allTeachers
      };
      console.log('[DATA] 已自动加载课表：' +
        `${mem.config.classes?.length || 0} 班，` +
        `${mem.config.allTeachers?.length || 0} 名教师，` +
        `${Object.values(mem.config.timetable || {}).reduce?.((a,b)=>a+Object.values(b).reduce?.((a2,b2)=>a2+b2.length,0),0) || 0} 课时`);
      return true;
    } catch(e) { console.error('[DATA] 加载课表失败:', e.message); }
  }
  return false;
}

// ── 管理员密码校验 ────────────────────────────────────
export function checkAdmin(headers) {
  const p = headers.get('x-admin-password') || headers.get('x-admin-pwd') || '';
  return p === 'admin888';
}

// ── 统一 JSON 响应 ───────────────────────────────────
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-password, x-admin-pwd'
    }
  });
}

// ── 统一错误响应 ─────────────────────────────────────
export function err(msg, status = 400) { return json({ success: false, error: msg }, status); }
