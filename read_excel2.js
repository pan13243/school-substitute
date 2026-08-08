const XLSX = require('xlsx');
const path = require('path');

const files = [
    'E:\\课后服务\\调课表\\2026春\\双井镇中心小学026年春季学期总课表.xlsx',
    'E:\\课后服务\\调课表\\2026春\\2026年春季学期课后服务安排表.xlsx',
    'E:\\课后服务\\调课表\\2026春\\双井镇中心小学2026年春季学期任课教师一览表.xlsx',
];

files.forEach(f => {
    console.log('\n=== ' + path.basename(f) + ' ===');
    try {
        const wb = XLSX.readFile(f);
        console.log('Sheets:', wb.SheetNames);
        wb.SheetNames.forEach(name => {
            const ws = wb.Sheets[name];
            const data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
            console.log('\n-- Sheet: ' + name + ' (' + data.length + ' rows x ' + (data[0] ? data[0].length : 0) + ' cols) --');
            // Print first 8 rows to understand structure
            for (let i = 0; i < Math.min(8, data.length); i++) {
                const row = data[i];
                const nonEmpty = row.map((c, idx) => [idx, c]).filter(([,v]) => v !== '');
                if (nonEmpty.length > 0) {
                    console.log('Row ' + i + ':', nonEmpty.map(([idx, v]) => idx + ':' + JSON.stringify(v)).join(', '));
                }
            }
        });
    } catch(e) {
        console.log('Error:', e.message);
    }
});
