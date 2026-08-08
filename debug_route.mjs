process.env.FORCE_LOCAL = '1';
import('./api/supabase-client.js').then(async s => {
  await s.initScheduleData(process.env);
  
  // 加请假（模拟用户操作）
  const leaveId = 't_' + Date.now();
  s.mem.leaves.push({
    id: leaveId,
    teacherName: '龙燕',
    leaveDate: '2026-08-10',
    dayOfWeek: '星期一',
    reason: '测试持久化',
    status: 'approved',
    createdAt: new Date().toISOString()
  });
  s.saveData(); // 持久化

  import('./api/algorithm.js').then(a => {
    const leaves = s.mem.leaves.filter(l => l.status === 'approved' || l.status === 'pending');
    console.log('请假数量:', leaves.length);
    
    // 手动执行部分算法逻辑，打印中间结果
    const { buildTeacherAssignment, buildTeacherSchedule } = a;
    const timetable = s.mem.config.timetable;
    const ta = buildTeacherAssignment(timetable);
    
    // 打印一(1)语文第1节是谁
    console.log('一(1)语文第1节教师:', ta['一（1）']?.['语文']?.[1]);
    
    // 打印龙燕在 teacherAssignment 里教什么
    const longYan = Object.entries(ta).find(([cls, subs]) => 
      Object.values(subs).some(periods => Object.values(periods).includes('龙燕'))
    );
    if (longYan) {
      console.log('龙燕 任课班级:', longYan[0]);
      const subjs = Object.entries(longYan[1]);
      for (const [subj, periods] of subjs) {
        const myPeriods = Object.entries(periods).filter(([,t]) => t==='龙燕').map(([p])=>p);
        console.log(`  ${subj}: 第${myPeriods.join(',')}节`);
      }
    }
    
    // 手动调 generateSubstitutes
    const result = a.generateSubstitutes(timetable, ta, leaves, '2026-08-10');
    console.log('\n结果:', JSON.stringify(result.summary));
    result.results.forEach(r => console.log(`  ${r.dayOfWeek} ${r.period} ${r.className} ${r.subject}: ${r.substituteTeacher}`));
  });
});