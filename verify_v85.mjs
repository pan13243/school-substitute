fetch('https://school-substitute.pages.dev/app.js?v=85')
  .then(r => r.text())
  .then(t => {
    // 找出 principalPwd 相关的关键代码段
    const lines = t.split('\n');
    let inRelevant = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("sessionStorage.setItem('principalPwd'") ||
          lines[i].includes("getItem('principalPwd'") ||
          lines[i].includes("x-principal-pwd'") ||
          lines[i].includes('x-principal-pwd')) {
        console.log(`L${i+1}: ${lines[i]}`);
      }
    }
  });
