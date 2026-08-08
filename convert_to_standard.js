const fs = require('fs');
const XLSX = require('xlsx');

// 读取 parsed_data.json
const data = JSON.parse(fs.readFileSync('parsed_data.json', 'utf8'));

// 转换为标准格式（6列）
const rows = [];
rows.push(['教师姓名', '星期', '节次', '班级', '课程', '教师']); // 表头

for (const [day, classes] of Object.entries(data.timetable)) {
  for (const [cls, slots] of Object.entries(classes)) {
    for (const slot of slots) {
      rows.push([
        slot.teacher,  // 教师姓名
        day,           // 星期
        slot.period,   // 节次
        cls,           // 班级
        slot.subject,  // 课程
        slot.teacher   // 教师（重复，保持6列格式）
      ]);
    }
  }
}

// 创建 Excel
const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '总表');

// 保存
XLSX.writeFile(wb, '总课表_标准化.xlsx');
console.log(`✅ 已生成 总课表_标准化.xlsx`);
console.log(`   共 ${rows.length - 1} 条课程记录`);
console.log(`   班级数: ${data.classes.length}`);
console.log(`   教师数: ${data.allTeachers?.length || '未知'}`);
