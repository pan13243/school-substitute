fetch('https://school-substitute.pages.dev/app.js?v=86')
  .then(r => r.text())
  .then(t => {
    console.log('v86 contains PC端401清sessionStorage逻辑:',
      t.includes('[PC] 校长密码失效'));
    console.log('v86 contains innerWidth>=601判断:',
      t.includes('innerWidth >= 601'));
  })
  .catch(e => console.error(e));
