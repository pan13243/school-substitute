process.env.FORCE_LOCAL = '1';
import('./api/supabase-client.js').then(async s => {
  await s.initScheduleData(process.env);
  import('./api/algorithm.js').then(a => {
    const ta = a.buildTeacherAssignment(s.mem.config.timetable);
    console.log('一（1）语文:', JSON.stringify(ta['一（1）']?.['语文']));
    console.log('一（1）数学:', JSON.stringify(ta['一（1）']?.['数学']));
    console.log('二（1）语文:', JSON.stringify(ta['二（1）']?.['语文']));
    // 看龙燕在哪
    for (const [cls, subjs] of Object.entries(ta)) {
      for (const [subj, periods] of Object.entries(subjs)) {
        for (const [p, t] of Object.entries(periods)) {
          if (t.includes('龙')) console.log(`${cls} ${subj} 第${p}节: ${t}`);
        }
      }
    }
  });
});