function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        // 优先选择"总表"sheet
        var sheetName = workbook.SheetNames.find(function(s) { return s.indexOf('总表') >= 0; }) || workbook.SheetNames[0];
        console.log('[课表解析] 使用Sheet: ' + sheetName + ', 所有Sheet: ' + workbook.SheetNames.join(', '));
        var sheet = workbook.Sheets[sheetName];

        // 展开合并单元格 - 只展开表头区域（前4行），避免数据区域的节次标签合并导致重复检测
        var merges = sheet['!merges'] || [];
        console.log('[课表解析] 合并单元格数量: ' + merges.length);
        for (var i = 0; i < merges.length; i++) {
          var merge = merges[i];
          // 只展开起始行在前4行的合并区域（标题行、星期行、班级行、午别行）
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
        console.log('[课表解析] 展开合并单元格后, 行数: ' + jsonData.length + ', 列数: ' + (jsonData[0] ? jsonData[0].length : 0));

        if (jsonData.length < 2) {
          reject(new Error('Excel文件数据不足，请检查格式'));
          return;
        }

        var result = parseScheduleData(jsonData);
        resolve(result);
      } catch (err) {
        reject(new Error('解析Excel文件失败: ' + err.message));
      }
    };
    reader.onerror = function() { reject(new Error('文件读取失败')); };
    reader.readAsArrayBuffer(file);
  });
}
