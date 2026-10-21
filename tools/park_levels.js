// 停車大師:驗證每一關都停得進去,並重新算出 game.js 裡的 PK_PAR(三顆星秒數)和 PK_PATH(自動解法)
// 用法:node tools/park_levels.js          → 印出結果和新的兩行表格
//       node tools/park_levels.js --write  → 直接寫回 game.js
// 改了 PK_PLAN 或關卡產生的程式之後要重跑一次,不然電腦玩家和教練示範會照舊的路線開。
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'game.js');
let src = fs.readFileSync(file, 'utf8');
const grab = re => { const m = src.match(re); if (!m) throw new Error('找不到 ' + re); return m[0]; };
const code = grab(/function busObbHit[\s\S]*?\n}\n/) + grab(/const busRng = [^\n]*\n/) +
  src.slice(src.indexOf('const PK = {'), src.indexOf('/* ---------- 停車大師的 3D 畫面'));
const api = new Function(code + '\nreturn { PK_PLAN, parkLevel, pkSolve, pkReplay, pkIn, pkHit, pkPathTime };')();

const pars = [], paths = [];
for (let n = 1; n <= api.PK_PLAN.length; n++) {
  const L = api.parkLevel(n), t0 = Date.now(), p = api.pkSolve(L, 400000);
  if (!p) { console.log(`第 ${n} 關:找不到解法!改一下 PK_SALT(第 ${n} 關) 再試`); process.exitCode = 1; pars.push(99); paths.push(''); continue; }
  const c = p.slice(1).map(q => String.fromCharCode(97 + q[4])).join('');
  const rp = api.pkReplay(L, c), e = rp[rp.length - 1];
  const ok = api.pkIn(L, e[0], e[1], e[2]) && rp.every(q => !api.pkHit(L, q[0], q[1], q[2]));
  const par = Math.ceil(api.pkPathTime(p, 3.6, 2.2, 1.0) * 1.15 + 3);
  pars.push(par); paths.push(c);
  console.log(`第 ${n} 關 ${L.name}:${ok ? 'OK' : '重播失敗!'} ${c.length} 步,三星 ${par} 秒(${Date.now() - t0}ms)`);
}
const parLine = 'const PK_PAR = ' + JSON.stringify(pars) + '; // 三顆星的秒數(照自動解法算的)';
const pathLine = 'const PK_PATH = ' + JSON.stringify(paths) + '; // 每關的自動解法(電腦玩家、教練示範用)';
if (process.argv.includes('--write')) {
  src = src.replace(/const PK_PAR = [^\n]*/, () => parLine).replace(/const PK_PATH = [^\n]*/, () => pathLine);
  fs.writeFileSync(file, src);
  console.log('已寫回 game.js');
} else console.log('\n' + parLine + '\n' + pathLine);
