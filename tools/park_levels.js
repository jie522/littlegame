// 停車大師:驗證每一關都停得進去,並重新算出 game.js 裡的 PK_PAR(三顆星秒數)和 PK_PATH(自動解法)
// 用法:node tools/park_levels.js          → 印出結果和新的兩行表格
//       node tools/park_levels.js --write  → 直接寫回 game.js
//       node tools/park_levels.js 51-60 [--write] → 只重算第 51~60 關(其他關保留 game.js 裡原本的)
// 改了 PK_PLAN 或關卡產生的程式之後要重跑一次,不然電腦玩家和教練示範會照舊的路線開。
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'game.js');
let src = fs.readFileSync(file, 'utf8');
const grab = re => { const m = src.match(re); if (!m) throw new Error('找不到 ' + re); return m[0]; };
const code = grab(/function busObbHit[\s\S]*?\n}\n/) + grab(/const busRng = [^\n]*\n/) +
  src.slice(src.indexOf('const PK = {'), src.indexOf('/* ---------- 停車大師的 3D 畫面'));
const api = new Function(code + '\nreturn { PK_PLAN, PK_SALT, parkLevel, pkSolve, pkReplay, pkIn, pkHit, pkPathTime };')();

const range = (process.argv.find(a => /^\d+-\d+$/.test(a)) || '1-9999').split('-').map(Number);
const old = name => { const m = src.match(new RegExp('const ' + name + ' = (\\[[^\\n]*\\]);')); return m ? JSON.parse(m[1]) : []; };
const oldPar = old('PK_PAR'), oldPath = old('PK_PATH'), oldSalt = old('PK_SALT');
api.PK_SALT.forEach((_, i) => { if (oldSalt[i] != null) api.PK_SALT[i] = oldSalt[i]; });
const pars = [], paths = [];
for (let n = 1; n <= api.PK_PLAN.length; n++) {
  if (n < range[0] || n > range[1]) { pars.push(oldPar[n - 1] != null ? oldPar[n - 1] : 99); paths.push(oldPath[n - 1] || ''); continue; }
  let L, p, t0 = Date.now();
  for (let k = 0; k < 25; k++) { // 找不到解法就換亂數種子重新產生這一關
    L = api.parkLevel(n); p = api.pkSolve(L, api.PK_PLAN[n - 1].truck ? 1500000 : 400000);
    if (p) break;
    api.PK_SALT[n - 1]++;
  }
  if (!p) { console.log(`第 ${n} 關:換了 25 個種子都找不到解法,要改 PK_PLAN`); process.exitCode = 1; pars.push(99); paths.push(''); continue; }
  const c = p.slice(1).map(q => String.fromCharCode(97 + q[4])).join('');
  const rp = api.pkReplay(L, c), e = rp[rp.length - 1];
  const ok = api.pkIn(L, e[0], e[1], e[2], 0, e[5]) && rp.every(q => !api.pkHit(L, q[0], q[1], q[2], undefined, undefined, q[5]));
  const par = Math.ceil(api.pkPathTime(p, 3.6, 2.2, 1.0) * 1.15 + 3);
  pars.push(par); paths.push(c);
  console.log(`第 ${n} 關 ${L.name}:${ok ? 'OK' : '重播失敗!'} ${c.length} 步,三星 ${par} 秒(種子 ${api.PK_SALT[n - 1]},${Date.now() - t0}ms)`);
}
const parLine = 'const PK_PAR = ' + JSON.stringify(pars) + '; // 三顆星的秒數(照自動解法算的)';
const saltLine = 'const PK_SALT = ' + JSON.stringify(api.PK_SALT) + '; // 每關的亂數種子(tools/park_levels.js 找不到留路的解法時會自動換)';
const pathLine = 'const PK_PATH = ' + JSON.stringify(paths) + '; // 每關的自動解法(電腦玩家、教練示範用)';
if (process.argv.includes('--write')) {
  let cur = fs.readFileSync(file, 'utf8'); // 重新讀一次:解題跑很久,期間 game.js 如果改了不要蓋掉
  cur = cur.replace(/const PK_PAR = [^\n]*/, () => parLine).replace(/const PK_PATH = [^\n]*/, () => pathLine).replace(/const PK_SALT = [^\n]*/, () => saltLine);
  fs.writeFileSync(file, cur);
  console.log('已寫回 game.js');
} else console.log('\n' + saltLine + '\n' + parLine + '\n' + pathLine);
