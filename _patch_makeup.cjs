const fs = require('fs');
const path = require('path');

const backendPath = path.join(__dirname, 'functions', 'api', '[[path]].js');
let content = fs.readFileSync(backendPath, 'utf8');

// 替换第二处（L397 附近），通过更大上下文定位
const oldText = `          leaveId: leave.id,
          leaveTeacher: leave.teacherName,
          substituteTeacher: substitute,
          className: slot.className,
          subject: slot.subject,
          leaveDate: realDate,
          dayOfWeek: leaveWeekday,
          period: slot.period,
          reason: leave.reason,
          leaveType: leave.leaveType || '',
          duration: leave.duration != null ? leave.duration : null,
          status: 'arranged'
        });
        if (!teacherSchedule[substitute]) teacherSchedule[substitute] = {};
        teacherSchedule[substitute][slotKey] = { ...slot };
        existingSubs.push({ substituteTeacher: substitute, dayOfWeek: leaveWeekday });
      }
    }

    // 【新增】处理课后服务时段`;

const newText = `          leaveId: leave.id,
          leaveTeacher: leave.teacherName,
          substituteTeacher: substitute,
          className: slot.className,
          subject: slot.subject,
          leaveDate: realDate,
          dayOfWeek: leaveWeekday,
          period: slot.period,
          reason: leave.reason,
          leaveType: leave.leaveType || '',
          duration: leave.duration != null ? leave.duration : null,
          makeupDay: leave.makeupDay || null,  // 同步补课日
          status: 'arranged'
        });
        if (!teacherSchedule[substitute]) teacherSchedule[substitute] = {};
        teacherSchedule[substitute][slotKey] = { ...slot };
        existingSubs.push({ substituteTeacher: substitute, dayOfWeek: leaveWeekday });
      }
    }

    // 【新增】处理课后服务时段`;

if (content.includes(oldText)) {
  content = content.replace(oldText, newText);
  fs.writeFileSync(backendPath, content, 'utf8');
  console.log('✅ 后端第二处已改');
} else {
  console.log('❌ 未找到第二处');
}
