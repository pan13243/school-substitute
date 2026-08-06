function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        console.log('[课表解析] 所有Sheet: ' + workbook.SheetNames.join(', '));
        
        const mergedResult = { classes: {}, teachers: new Set() };
        let totalRecords = 0;
        
        for (const sheetName of workbook.SheetNames) {
          console.log('[课表解析] 处理Sheet: ' + sheetName);
          var sheet = workbook.Sheets[sheetName];

          var merges = sheet['!merges'] || [];
          for (var i = 0; i < merges.length; i++) {
            var merge = merges[i];
            if (merge.s.r > 3) continue;
            var originAddr = XLSX.utils.encode_cell(merge.s);
            var originCell = sheet[originAddr];
            var originVal = originCell ? (originCell.v !== undefined ? originCell.v : (originCell.w || '')) : '';
            for (var r = merge.s.r; r <= merge.e.r; r++) {
              for (var c = merge.s.c; c <= merge.e.c; c++) {
                if (r === merge.s.r && c === merge.s.c) continue;
                var addr = XLSX.utils.encode_cell({ r: r, c: c });
                if (!sheet[addr]) {
                  sheet[addr] = { t: 's', v: originVal };
                }
              }
            }
          }

          var jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          console.log('[课表解析] Sheet "' + sheetName + '" 行数: ' + jsonData.length);

          if (jsonData.length < 2) continue;

          var result = parseScheduleData(jsonData);
          if (result && result.classes) {
            for (const [className, weekData] of Object.entries(result.classes)) {
              if (!mergedResult.classes[className]) {
                mergedResult.classes[className] = {};
              }
              for (const [weekday, periodData] of Object.entries(weekData)) {
                if (!mergedResult.classes[className][weekday]) {
                  mergedResult.classes[className][weekday] = {};
                }
                for (const [period, entry] of Object.entries(periodData)) {
                  if (!mergedResult.classes[className][weekday][period]) {
                    mergedResult.classes[className][weekday][period] = entry;
                    totalRecords++;
                  }
                }
              }
            }
            if (result.teachers) {
              const teacherList = Array.isArray(result.teachers) ? result.teachers : Array.from(result.teachers);
              teacherList.forEach(t => mergedResult.teachers.add(t));
            }
          }
        }
        
        mergedResult.teachers = Array.from(mergedResult.teachers);
        console.log('[课表解析] 合并完成：' + Object.keys(mergedResult.classes).length + ' 个班级，' + totalRecords + ' 条记录');
        
        if (Object.keys(mergedResult.classes).length === 0) {
          reject(new Error('未能解析到有效课表数据'));
          return;
        }
        
        resolve(mergedResult);
      } catch (err) {
        reject(new Error('解析Excel文件失败: ' + err.message));
      }
    };
    reader.onerror = function() { reject(new Error('文件读取失败')); };
    reader.readAsArrayBuffer(file);
  });
}
