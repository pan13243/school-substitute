import fs from 'fs';
const p = 'C:\\Users\\HUA WEI\\Downloads\\school-substitute\\app.js';
let s = fs.readFileSync(p, 'utf8');

// 找到 import-json 这一段
const oldHtml = `<h3>📁 方式一：直接导入已解析数据</h3>
      <p class="text-muted">将 <code>parsed_data.json</code> 文件上传，即可自动导入全部课表、教师、课后服务数据。</p>
      <div class="form-group">
        <input type="file" id="import-json" accept=".json" class="form-file"
               onchange="handleJsonImport(this.files[0])">
      </div>
    </div>

    <div class="card">
      <h3>📊 方式二：手动粘贴JSON数据</h3>`;

const newHtml = `<h3>📊 方式一：直接上传总课表 Excel</h3>
      <p class="text-muted">将标准化后的 <code>总课表_标准化.xlsx</code> 上传，系统自动解析全部课表与教师信息。</p>
      <div class="form-group">
        <input type="file" id="import-excel" accept=".xlsx,.xls" class="form-file"
               onchange="handleExcelImport(this.files[0])">
      </div>
    </div>

    <div class="card">
      <h3>📚 方式二：上传课后服务表 Excel</h3>
      <p class="text-muted">上传 <code>课后服务安排表.xlsx</code>，系统自动解析所有班级的课后服务值班。</p>
      <div class="form-group">
        <input type="file" id="import-after" accept=".xlsx,.xls" class="form-file"
               onchange="handleAfterSchoolImport(this.files[0])">
      </div>
    </div>

    <div class="card">
      <h3>📁 方式三：导入 JSON 数据</h3>
      <p class="text-muted">将 <code>parsed_data.json</code> 文件上传。</p>
      <div class="form-group">
        <input type="file" id="import-json" accept=".json" class="form-file"
               onchange="handleJsonImport(this.files[0])">
      </div>
    </div>

    <div class="card">
      <h3>📝 方式四：手动粘贴JSON数据</h3>`;

if (!s.includes(oldHtml)) {
  console.log('❌ 未找到目标 HTML 块');
  process.exit(1);
}
s = s.replace(oldHtml, newHtml);
fs.writeFileSync(p, s, 'utf8');
console.log('✅ HTML 替换成功，文件大小:', s.length);