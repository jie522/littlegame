'use strict';

/* =========================================================
   萌萌派對 — 2~4 人同機手機小遊戲合集
   ========================================================= */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const app = $('#app');

/* ---------- 儲存 ---------- */
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('moe-party-' + k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('moe-party-' + k, JSON.stringify(v)); } catch (e) { /* 無痕模式 */ }
  },
};

const PLAYERS = [
  { name: '粉粉兔', emoji: '🐰', color: '#ff7fa8', soft: '#ffe3ec' },
  { name: '暖暖熊', emoji: '🐻', color: '#ffa04d', soft: '#fff0dc' },
  { name: '呱呱蛙', emoji: '🐸', color: '#3fbf78', soft: '#dcf6e6' },
  { name: '喵喵貓', emoji: '🐱', color: '#5b9bff', soft: '#e0ecff' },
];

const S = {
  n: store.get('n', 2),
  stars: store.get('stars', [0, 0, 0, 0]),
  muted: store.get('muted', false),
};

/* ---------- 音效 & 震動 ---------- */
let actx = null;
function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { actx = null; }
}
function beep(freq, dur = 0.12, type = 'sine', vol = 0.15, when = 0) {
  if (S.muted || !actx) return;
  try {
    const t = actx.currentTime + when;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (e) { /* ignore */ }
}
const SFX = {
  tap: () => beep(rand(600, 760), 0.05, 'triangle', 0.08),
  tick: () => beep(520, 0.08, 'sine', 0.12),
  go: () => { beep(784, 0.1, 'triangle', 0.2); beep(1046, 0.18, 'triangle', 0.2, 0.08); },
  good: () => { beep(880, 0.1, 'sine', 0.16); beep(1320, 0.16, 'sine', 0.16, 0.08); },
  bad: () => beep(170, 0.25, 'square', 0.07),
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => beep(f, 0.22, 'triangle', 0.16, i * 0.11)),
};
function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* ignore */ } }

/* ---------- 計時器管理(離開遊戲時全部清掉) ---------- */
let session = null;
function stopSession() {
  if (session) { session.stop(); session = null; }
}
function newSession() {
  stopSession();
  const s = {
    alive: true,
    timers: [],
    after(ms, fn) { const id = setTimeout(() => { if (s.alive) fn(); }, ms); s.timers.push(id); return id; },
    every(ms, fn) { const id = setInterval(() => { if (s.alive) fn(); }, ms); s.timers.push(id); return id; },
    stop() { s.alive = false; s.timers.forEach(t => { clearTimeout(t); clearInterval(t); }); },
  };
  session = s;
  return s;
}

/* =========================================================
   遊戲清單
   ========================================================= */
const GAMES = [
  {
    id: 'reaction', emoji: '⚡', name: '閃電快手', tag: '反應', color: '#ffbf1f', desc: '看到 ⭐ 就拍!',
    rules: ['等中間出現 ⭐ 時,最快拍自己區域的人得 1 分', '太早拍會出局一回合 🙈', '出現 💣 炸彈千萬別拍,拍到扣 1 分!', '共 5 回合'],
    run: () => gReaction(),
  },
  {
    id: 'tap', emoji: '🥕', name: '狂點拔蘿蔔', tag: '反應', color: '#ff9147', desc: '拼手速拔蘿蔔!',
    rules: ['倒數後瘋狂點擊自己的區域', '每點一下蘿蔔就被拔高一點', '8 秒內點最多下的人獲勝!', '可以用好幾根手指喔 ✌️'],
    run: () => gTap(),
  },
  {
    id: 'math', emoji: '🧮', name: '算數小天才', tag: '益智', color: '#3fbf78', desc: '搶答算數題!',
    rules: ['中間會出現一道算式', '在自己的區域選出正確答案', '最快答對得 1 分,答錯這題就不能再答', '共 7 題,越後面越難!'],
    run: () => gMath(),
  },
  {
    id: 'color', emoji: '🎨', name: '顏色對對碰', tag: '益智+反應', color: '#9b5cff', desc: '字和顏色一樣才拍!',
    rules: ['中間會出現一個顏色的字,例如「紅」', '只有「字的意思」和「字的顏色」一樣時才拍!', '最快拍對得 1 分,拍錯扣 1 分', '共 12 題,小心別被騙了 😜'],
    run: () => gColor(),
  },
  {
    id: 'memory', emoji: '🃏', name: '萌寵翻翻樂', tag: '益智', color: '#5b9bff', desc: '輪流翻牌找配對',
    rules: ['大家輪流,每次翻兩張牌', '翻到一樣的得 1 分,還能再翻一次', '不一樣就換下一位', '全部配對完,分數最高的人獲勝!'],
    run: () => gMemory(),
  },
];
let currentGame = null;

/* =========================================================
   大廳
   ========================================================= */
function home() {
  stopSession();
  app.innerHTML = '';
  const h = el('div', 'screen home');
  h.innerHTML = `
    <header class="hero">
      <div class="hero-emo"><span>🐰</span><span>🐻</span><span>🐸</span><span>🐱</span></div>
      <h1>萌萌派對</h1>
      <p>一支手機,2~4 人一起玩!</p>
    </header>
    <section class="panel">
      <h2>幾個人玩?</h2>
      <div class="count">${[2, 3, 4].map(k => `<button class="cnt ${k === S.n ? 'on' : ''}" data-n="${k}">${k} 人</button>`).join('')}</div>
      <div class="players">${PLAYERS.slice(0, S.n).map((p, i) => `
        <div class="pchip" style="--c:${p.color};--soft:${p.soft}">
          <span class="pemo">${p.emoji}</span><span>${p.name}</span><span class="pstar">⭐ ${S.stars[i]}</span>
        </div>`).join('')}
      </div>
      <p class="tip">📱 把手機平放在桌上,大家圍著一起玩!</p>
    </section>
    <section class="games">${GAMES.map((g, i) => `
      <button class="gcard" data-i="${i}" style="--g:${g.color}">
        <span class="gemo">${g.emoji}</span><b>${g.name}</b>
        <span class="tag">${g.tag}</span><span class="gdesc">${g.desc}</span>
      </button>`).join('')}
    </section>
    <footer class="foot">
      <button class="mini" id="mute">${S.muted ? '🔇 靜音中' : '🔊 音效開'}</button>
      <button class="mini" id="reset">🔄 星星歸零</button>
    </footer>`;
  app.appendChild(h);

  $$('.cnt', h).forEach(b => b.addEventListener('click', () => {
    S.n = +b.dataset.n; store.set('n', S.n); home();
  }));
  $$('.gcard', h).forEach(b => b.addEventListener('click', () => intro(GAMES[+b.dataset.i])));
  $('#mute', h).addEventListener('click', () => {
    S.muted = !S.muted; store.set('muted', S.muted); home();
  });
  $('#reset', h).addEventListener('click', () => {
    if (confirm('確定要把所有星星歸零嗎?')) {
      S.stars = [0, 0, 0, 0]; store.set('stars', S.stars); home();
    }
  });
}

/* ---------- 規則說明 ---------- */
function intro(g) {
  stopSession();
  currentGame = g;
  app.innerHTML = '';
  const d = el('div', 'screen intro');
  d.style.setProperty('--g', g.color);
  d.innerHTML = `
    <div class="icard">
      <div class="iemo">${g.emoji}</div>
      <h1>${g.name}</h1>
      <span class="tag">${g.tag}</span>
      <ul>${g.rules.map(r => `<li>${r}</li>`).join('')}</ul>
      <button class="btn go">開始遊戲!</button>
      <button class="mini back">← 回大廳</button>
    </div>`;
  app.appendChild(d);
  $('.go', d).addEventListener('click', () => { unlockAudio(); g.run(); });
  $('.back', d).addEventListener('click', home);
}

/* ---------- 離開按鈕(按兩次才離開,避免誤觸) ---------- */
function exitBtn() {
  const b = el('button', 'exit', '✕');
  let armed = false, t = null;
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    if (armed) { clearTimeout(t); home(); return; }
    armed = true;
    b.classList.add('armed');
    b.textContent = '離開?';
    t = setTimeout(() => { armed = false; b.classList.remove('armed'); b.textContent = '✕'; }, 2000);
  });
  return b;
}

/* =========================================================
   分區對戰場地:每位玩家一塊區域,上方玩家畫面倒轉
   ========================================================= */
function isFlipped(n, i) {
  return n === 2 ? i === 1 : n === 3 ? i === 2 : i >= 2;
}

function arena() {
  const s = newSession();
  app.innerHTML = '';
  const n = S.n;
  const root = el('div', 'arena p' + n);
  const A = { root, s, zones: [], onTap: null };

  for (let i = 0; i < n; i++) {
    const p = PLAYERS[i];
    const z = el('div', 'zone z' + i + (isFlipped(n, i) ? ' flip' : ''));
    z.style.setProperty('--c', p.color);
    z.style.setProperty('--soft', p.soft);
    z.innerHTML = `
      <div class="zin">
        <div class="zhead"><span class="zemo">${p.emoji}</span><span class="zname">${p.name}</span><span class="zscore">0</span></div>
        <div class="zbody"></div>
      </div>`;
    const Z = { i, p, el: z, zin: $('.zin', z), body: $('.zbody', z), scoreEl: $('.zscore', z), score: 0 };
    z.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (A.onTap) A.onTap(i, e);
    });
    A.zones.push(Z);
    root.appendChild(z);
  }

  const c = el('div', 'center', '<div class="cp top"></div><div class="cp bot"></div>');
  root.appendChild(c);
  root.appendChild(exitBtn());

  A.center = html => $$('.cp', c).forEach(x => { x.innerHTML = html; });
  A.pop = (i, text, neg) => {
    const p = el('div', 'pop' + (neg ? ' neg' : ''), text);
    A.zones[i].zin.appendChild(p);
    setTimeout(() => p.remove(), 900);
  };
  A.add = (i, v) => {
    const Z = A.zones[i];
    Z.score += v;
    Z.scoreEl.textContent = Z.score;
    A.pop(i, v > 0 ? '+' + v : String(v), v < 0);
  };
  A.fx = (i, cls) => {
    const zin = A.zones[i].zin;
    zin.classList.remove('good', 'bad', 'tapped');
    void zin.offsetWidth; // 重新觸發動畫
    zin.classList.add(cls);
  };
  A.scores = () => A.zones.map(z => z.score);

  app.appendChild(root);
  return A;
}

function countdown(A, cb) {
  let k = 3;
  const tick = () => {
    if (k > 0) {
      A.center(`<div class="big pulse">${k}</div>`);
      SFX.tick();
      k--;
      A.s.after(750, tick);
    } else {
      A.center('<div class="big">開始!</div>');
      SFX.go();
      A.s.after(550, cb);
    }
  };
  tick();
}

function finish(A) {
  A.onTap = null;
  A.center('<div class="big">🎉</div><div>結束囉!</div>');
  A.s.after(1300, () => results(A.scores()));
}

/* =========================================================
   1. 閃電快手 ⚡
   ========================================================= */
function gReaction() {
  const A = arena(), s = A.s, R = 5;
  let round = 0, state = 'idle';
  const out = new Set();
  const live = (r, fn) => () => { if (r === round) fn(); };
  const waitScreen = () => A.center(`<div class="small">第 ${round} / ${R} 回合</div><div class="big">🙈</div><div class="small">等 ⭐ 出現…</div>`);

  A.zones.forEach(z => { z.body.innerHTML = '<div class="hint">⭐ 出現就拍這裡!<br>💣 出現別亂拍!</div>'; });

  function knockOut(i) {
    out.add(i);
    A.zones[i].el.classList.add('out');
    A.fx(i, 'bad');
    SFX.bad();
    buzz(80);
    if (out.size >= S.n) {
      state = 'idle';
      A.center('<div class="big">😵</div><div>大家都出局了!</div>');
      s.after(1300, next);
    }
  }

  A.onTap = i => {
    if (out.has(i)) return;
    if (state === 'wait') {
      A.pop(i, '太快了!', true);
      knockOut(i);
    } else if (state === 'bomb') {
      A.add(i, -1);
      knockOut(i);
    } else if (state === 'go') {
      state = 'done';
      A.add(i, 1);
      A.fx(i, 'good');
      SFX.good();
      buzz(30);
      A.zones.forEach(z => z.zin.classList.remove('lit'));
      A.center(`<div class="big">${PLAYERS[i].emoji}</div><div>${PLAYERS[i].name} 最快!</div>`);
      s.after(1500, next);
    }
  };

  function next() {
    round++;
    if (round > R) return finish(A);
    out.clear();
    A.zones.forEach(z => { z.el.classList.remove('out'); z.zin.classList.remove('lit'); });
    state = 'wait';
    waitScreen();
    const r = round;
    if (Math.random() < 0.45) {
      // 先來一顆假炸彈
      s.after(rand(1000, 2200), live(r, () => {
        if (state !== 'wait') return;
        state = 'bomb';
        A.center('<div class="big pulse">💣</div><div>別拍!!</div>');
        SFX.tick();
        s.after(1100, live(r, () => {
          if (state !== 'bomb') return;
          state = 'wait';
          waitScreen();
          s.after(rand(700, 2000), live(r, go));
        }));
      }));
    } else {
      s.after(rand(1500, 3800), live(r, go));
    }
  }

  function go() {
    if (state !== 'wait') return;
    state = 'go';
    const r = round;
    A.center('<div class="big pulse">⭐</div><div>快拍!</div>');
    SFX.go();
    A.zones.forEach(z => { if (!out.has(z.i)) z.zin.classList.add('lit'); });
    s.after(3000, live(r, () => {
      if (state !== 'go') return;
      state = 'done';
      A.zones.forEach(z => z.zin.classList.remove('lit'));
      A.center('<div class="big">🐢</div><div>大家都太慢啦~</div>');
      s.after(1200, next);
    }));
  }

  countdown(A, next);
}

/* =========================================================
   2. 狂點拔蘿蔔 🥕
   ========================================================= */
function gTap() {
  const A = arena(), s = A.s, T = 8, FULL = 60;
  let on = false, done = false;

  A.zones.forEach(z => {
    z.body.innerHTML = `
      <div class="carrot-box"><div class="carrot">🥕</div><div class="dirt"></div></div>
      <div class="taps">0</div>`;
    z.carrot = $('.carrot', z.body);
    z.taps = $('.taps', z.body);
  });

  A.onTap = i => {
    if (!on) return;
    const Z = A.zones[i];
    Z.score++;
    Z.scoreEl.textContent = Z.score;
    Z.taps.textContent = Z.score;
    const h = Math.min(1, Z.score / FULL);
    Z.carrot.style.setProperty('--b', (22 + 38 * h) + '%');
    if (Z.score === FULL) { A.pop(i, '拔出來了!'); SFX.good(); }
    A.fx(i, 'tapped');
    SFX.tap();
  };

  countdown(A, () => {
    on = true;
    let left = T;
    A.center(`<div class="big">${left}</div><div>狂點!!</div>`);
    s.every(1000, () => {
      if (done) return;
      left--;
      if (left > 0) {
        A.center(`<div class="big${left <= 3 ? ' pulse' : ''}">${left}</div><div>狂點!!</div>`);
        SFX.tick();
      } else {
        done = true;
        on = false;
        A.onTap = null;
        A.center('<div class="big">⏰</div><div>時間到!</div>');
        SFX.go();
        s.after(1400, () => results(A.scores()));
      }
    });
  });
}

/* =========================================================
   3. 算數小天才 🧮
   ========================================================= */
function genQuestion(r) {
  let a, b, op, ans;
  if (r <= 2) {
    a = rand(1, 9); b = rand(1, 9); op = '+'; ans = a + b;
  } else if (r <= 4) {
    if (Math.random() < 0.5) { a = rand(5, 19); b = rand(2, 9); op = '+'; ans = a + b; }
    else { a = rand(8, 20); b = rand(2, a - 1); op = '−'; ans = a - b; }
  } else if (Math.random() < 0.6) {
    a = rand(2, 9); b = rand(2, 9); op = '×'; ans = a * b;
  } else {
    a = rand(12, 39); b = rand(3, 12); op = pick(['+', '−']); ans = op === '+' ? a + b : a - b;
  }
  const opts = new Set([ans]);
  while (opts.size < 3) {
    const d = op === '×' ? pick([a, b, 1, 2]) : rand(1, 4);
    const v = ans + (Math.random() < 0.5 ? -d : d);
    if (v >= 0) opts.add(v);
  }
  return { text: `${a} ${op} ${b}`, ans, opts: [...opts] };
}

function gMath() {
  const A = arena(), s = A.s, R = 7;
  let round = 0, state = 'idle', q = null;
  const locked = new Set();

  A.onTap = (i, e) => {
    const b = e.target.closest('.opt');
    if (!b || state !== 'open' || locked.has(i)) return;
    if (+b.dataset.v === q.ans) {
      state = 'done';
      b.classList.add('right');
      A.add(i, 1);
      A.fx(i, 'good');
      SFX.good();
      buzz(30);
      reveal(`${PLAYERS[i].emoji} ${PLAYERS[i].name} 答對了!`);
    } else {
      locked.add(i);
      b.classList.add('wrong');
      A.zones[i].el.classList.add('out');
      A.fx(i, 'bad');
      SFX.bad();
      buzz(60);
      if (locked.size >= S.n) { state = 'done'; reveal('😅 大家都答錯了'); }
    }
  };

  function reveal(msg) {
    A.center(`<div class="q">${q.text} = <b>${q.ans}</b></div><div class="small">${msg}</div>`);
    s.after(1700, next);
  }

  function next() {
    round++;
    if (round > R) return finish(A);
    locked.clear();
    q = genQuestion(round);
    A.zones.forEach(z => {
      z.el.classList.remove('out');
      z.body.innerHTML = `<div class="opts">${shuffle(q.opts).map(v => `<button class="opt" data-v="${v}">${v}</button>`).join('')}</div>`;
    });
    A.center(`<div class="small">第 ${round} / ${R} 題</div><div class="q">${q.text} = ?</div>`);
    state = 'open';
    const r = round;
    s.after(10000, () => {
      if (r === round && state === 'open') { state = 'done'; reveal('⏰ 時間到!'); }
    });
  }

  A.zones.forEach(z => { z.body.innerHTML = '<div class="hint">準備好動動腦!🧠</div>'; });
  countdown(A, next);
}

/* =========================================================
   4. 顏色對對碰 🎨
   ========================================================= */
const COLORS = [
  { n: '紅', c: '#ff3b5c' },
  { n: '藍', c: '#2f6fff' },
  { n: '綠', c: '#1faa55' },
  { n: '黃', c: '#f2b300' },
  { n: '紫', c: '#9547ff' },
];

function gColor() {
  const A = arena(), s = A.s, R = 12;
  let k = 0, state = 'idle', cur = null;
  const tapped = new Set();

  A.zones.forEach(z => { z.body.innerHTML = '<div class="hint">字和顏色<br>一樣就拍!</div>'; });

  A.onTap = i => {
    if (state !== 'show' || tapped.has(i)) return;
    tapped.add(i);
    if (cur.match) {
      state = 'done';
      A.add(i, 1);
      A.fx(i, 'good');
      SFX.good();
      buzz(30);
      A.center(`<div class="word" style="color:${cur.ink.c}">${cur.w.n}</div><div class="small">${PLAYERS[i].emoji} 拍對了!</div>`);
      s.after(1000, next);
    } else {
      A.add(i, -1);
      A.fx(i, 'bad');
      SFX.bad();
      buzz(80);
    }
  };

  function next() {
    k++;
    if (k > R) return finish(A);
    tapped.clear();
    const w = pick(COLORS);
    const match = Math.random() < 0.45;
    const ink = match ? w : pick(COLORS.filter(c => c !== w));
    cur = { w, ink, match };
    state = 'show';
    A.center(`<div class="small">${k} / ${R}</div><div class="word" style="color:${ink.c}">${w.n}</div>`);
    const r = k;
    s.after(Math.max(1200, 2100 - k * 70), () => {
      if (r !== k || state !== 'show') return;
      state = 'gap';
      A.center(`<div class="big">${match ? '😮' : '🙅'}</div><div class="small">${match ? '是一樣的!沒人拍到~' : '不一樣,不能拍喔'}</div>`);
      s.after(800, next);
    });
  }

  countdown(A, next);
}

/* =========================================================
   5. 萌寵翻翻樂 🃏(輪流制)
   ========================================================= */
const FOODS = ['🍓', '🍰', '🍩', '🍉', '🍭', '🧁', '🍪', '🍦', '🍒', '🍑', '🐶', '🐼'];

function gMemory() {
  const s = newSession();
  app.innerHTML = '';
  const n = S.n, pairs = n === 2 ? 8 : 10, rows = pairs * 2 / 4;
  const scores = Array(n).fill(0);
  let turn = 0, first = null, lock = false, matched = 0;

  const root = el('div', 'mem');
  root.innerHTML = `
    <div class="banner top"></div>
    <div class="mscores"></div>
    <div class="grid" style="grid-template-rows:repeat(${rows},1fr)"></div>
    <div class="banner bot"></div>`;
  const grid = $('.grid', root);
  const bar = $('.mscores', root);

  const deck = shuffle(shuffle(FOODS).slice(0, pairs).flatMap(f => [f, f]));
  deck.forEach(f => {
    const c = el('div', 'card', `<div class="in"><div class="face back">🐾</div><div class="face front">${f}</div></div>`);
    c.dataset.f = f;
    c.addEventListener('pointerdown', e => { e.preventDefault(); flip(c); });
    grid.appendChild(c);
  });

  function render() {
    const p = PLAYERS[turn];
    root.style.setProperty('--c', p.color);
    $$('.banner', root).forEach(b => { b.innerHTML = `輪到 ${p.emoji} ${p.name} 囉!`; });
    bar.innerHTML = '';
    bar.appendChild(exitBtn());
    PLAYERS.slice(0, n).forEach((q, i) => {
      const chip = el('div', 'mchip' + (i === turn ? ' on' : ''), `<span>${q.emoji}</span>${scores[i]}`);
      chip.style.setProperty('--c', q.color);
      chip.style.setProperty('--soft', q.soft);
      bar.appendChild(chip);
    });
  }

  function flip(c) {
    if (lock || c.classList.contains('open')) return;
    c.classList.add('open');
    SFX.tap();
    if (!first) { first = c; return; }
    const a = first;
    first = null;
    if (a.dataset.f === c.dataset.f) {
      scores[turn]++;
      matched++;
      [a, c].forEach(x => { x.classList.add('matched'); x.style.setProperty('--mc', PLAYERS[turn].soft); });
      SFX.good();
      buzz(30);
      render();
      if (matched === pairs) {
        lock = true;
        s.after(1000, () => results(scores));
      }
    } else {
      lock = true;
      s.after(900, () => {
        SFX.bad();
        a.classList.remove('open');
        c.classList.remove('open');
        turn = (turn + 1) % n;
        lock = false;
        render();
      });
    }
  }

  render();
  app.appendChild(root);
}

/* =========================================================
   結算畫面
   ========================================================= */
function results(scores) {
  stopSession();
  app.innerHTML = '';
  const g = currentGame;
  const max = Math.max(...scores);
  const winners = max > 0 ? scores.map((v, i) => (v === max ? i : -1)).filter(i => i >= 0) : [];
  winners.forEach(i => { S.stars[i]++; });
  store.set('stars', S.stars);

  const order = scores.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const medal = v => ['🥇', '🥈', '🥉', '🎀'][scores.filter(x => x > v).length];
  const title = winners.length === 0 ? '沒有贏家 😆'
    : winners.length > 1 ? `平手!${winners.map(i => PLAYERS[i].emoji).join(' ')} 都贏了`
      : `${PLAYERS[winners[0]].emoji} ${PLAYERS[winners[0]].name} 獲勝!`;

  const d = el('div', 'screen result');
  d.innerHTML = `
    <div class="trophy">${winners.length ? '🏆' : '🤪'}</div>
    <h1>${title}</h1>
    <div class="ranks">${order.map(({ v, i }, k) => `
      <div class="rank" style="--c:${PLAYERS[i].color};animation-delay:${k * 0.12}s">
        <span class="medal">${medal(v)}</span><span class="remo">${PLAYERS[i].emoji}</span>${PLAYERS[i].name}
        <span class="rsc">${v} 分</span>${winners.includes(i) ? '<span class="rstar">+⭐</span>' : ''}
      </div>`).join('')}
    </div>
    <div class="rbtns">
      <button class="btn again">🔁 再玩一次</button>
      <button class="btn alt nextg">下一個遊戲 ${GAMES[(GAMES.indexOf(g) + 1) % GAMES.length].emoji}</button>
      <button class="btn alt home">🏠 回大廳</button>
    </div>`;
  app.appendChild(d);
  $('.again', d).addEventListener('click', () => g.run());
  $('.nextg', d).addEventListener('click', () => intro(GAMES[(GAMES.indexOf(g) + 1) % GAMES.length]));
  $('.home', d).addEventListener('click', home);

  SFX.win();
  if (winners.length) confetti();
}

function confetti() {
  const bits = ['🎉', '⭐', '💖', '🌸', '🍬', '✨', '🎈'];
  for (let i = 0; i < 28; i++) {
    const c = el('div', 'confetti', pick(bits));
    c.style.left = Math.random() * 100 + 'vw';
    c.style.animationDuration = 2 + Math.random() * 2.5 + 's';
    c.style.animationDelay = Math.random() * 0.8 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 5500);
  }
}

/* ---------- 防止雙指縮放 / 長按選單 ---------- */
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

home();
