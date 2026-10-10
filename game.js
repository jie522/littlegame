'use strict';

/* =========================================================
   萌萌派對 — 2~4 人「各自用自己的手機」連線小遊戲合集
   連線:PeerJS (WebRTC 點對點),房主的手機負責主持遊戲
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
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

/* 依加入順序分配角色:房主 = 0 號 */
const PLAYERS = [
  { name: '粉粉兔', emoji: '🐰', color: '#ff7fa8', soft: '#ffe3ec' },
  { name: '暖暖熊', emoji: '🐻', color: '#ffa04d', soft: '#fff0dc' },
  { name: '呱呱蛙', emoji: '🐸', color: '#3fbf78', soft: '#dcf6e6' },
  { name: '喵喵貓', emoji: '🐱', color: '#5b9bff', soft: '#e0ecff' },
];

const S = { muted: store.get('muted', false) };

/* ---------- 音效 & 震動 ---------- */
let actx = null;
function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { actx = null; }
}
document.addEventListener('pointerdown', unlockAudio, { passive: true });
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
  join: () => { beep(660, 0.08, 'sine', 0.12); beep(990, 0.12, 'sine', 0.12, 0.07); },
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => beep(f, 0.22, 'triangle', 0.16, i * 0.11)),
};
function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* ignore */ } }

function toast(msg) {
  const t = el('div', 'toast', esc(msg));
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* ---------- 螢幕常亮 ---------- */
let wake = null;
async function requestWake() {
  try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
}
function releaseWake() {
  try { if (wake) wake.release(); } catch (e) { /* ignore */ }
  wake = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && NET.role) requestWake();
});

/* ---------- 計時器(換畫面時全部清掉) ---------- */
function makeTimers() {
  const s = {
    alive: true,
    ids: [],
    after(ms, fn) { const id = setTimeout(() => { if (s.alive) fn(); }, ms); s.ids.push(id); return id; },
    every(ms, fn) { const id = setInterval(() => { if (s.alive) fn(); }, ms); s.ids.push(id); return id; },
    stop() { s.alive = false; s.ids.forEach(t => { clearTimeout(t); clearInterval(t); }); },
  };
  return s;
}
let viewT = makeTimers();
function resetView() {
  viewT.stop();
  viewT = makeTimers();
  V = null;
  return viewT;
}

/* =========================================================
   連線
   ========================================================= */
const PREFIX = 'moeparty-jie522-';
const PEER_OPTS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
  },
};

const NET = {
  role: null,        // 'host' | 'client' | null
  peer: null,
  code: null,
  conn: null,        // client → host
  conns: new Map(),  // host: slot → conn
  mySlot: 0,
  players: [],       // [{slot, name, online}]
  stars: [0, 0, 0, 0],
  phase: 'lobby',    // host: lobby | intro | game | results
  introG: null,
  game: null,        // host 遊戲進行中的狀態
  hostT: null,
};

const pinfo = slot => {
  const p = NET.players.find(x => x.slot === slot);
  return { ...PLAYERS[slot], name: p ? p.name : PLAYERS[slot].name, online: p ? p.online : false };
};
const myName = () => (store.get('name', '') || '').trim().slice(0, 8);

function leaveRoom(msg) {
  const old = NET;
  const peer = old.peer, conn = old.conn, conns = [...old.conns.values()];
  if (old.hostT) old.hostT.stop();
  Object.assign(NET, {
    role: null, peer: null, code: null, conn: null, conns: new Map(), mySlot: 0,
    players: [], stars: [0, 0, 0, 0], phase: 'lobby', introG: null, game: null, hostT: null,
  });
  releaseWake();
  try { conns.forEach(c => c.close()); if (conn) conn.close(); if (peer) peer.destroy(); } catch (e) { /* ignore */ }
  home();
  if (msg) toast(msg);
}

/* ---- 房主 ---- */
function createRoom() {
  if (!window.Peer) return toast('連線元件載入失敗,請檢查網路後重新整理');
  showWait('建立房間中…');
  const code = String(rand(1000, 9999));
  const peer = new Peer(PREFIX + code, PEER_OPTS);
  let opened = false;
  Object.assign(NET, { role: 'host', peer, code, mySlot: 0, phase: 'lobby', stars: [0, 0, 0, 0] });
  NET.players = [{ slot: 0, name: myName() || PLAYERS[0].name, online: true }];

  peer.on('open', () => {
    opened = true;
    requestWake();
    hostToLobby();
  });
  peer.on('error', err => {
    if (NET.peer !== peer) return;
    if (!opened && err.type === 'unavailable-id') {
      NET.role = null;
      peer.destroy();
      createRoom(); // 房號撞到了,換一個
    } else if (!opened) {
      leaveRoom('建立房間失敗(' + err.type + '),請再試一次');
    } else {
      console.warn('peer error', err.type);
    }
  });
  peer.on('disconnected', () => {
    // 與配對伺服器斷線(已連上的玩家不受影響),重新連回去才能讓新玩家加入
    if (NET.peer === peer && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) { /* ignore */ } }, 1000);
  });
  peer.on('connection', conn => conn.on('open', () => onClientConn(conn)));
}

function onClientConn(conn) {
  let slot = null;
  conn.on('data', m => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (slot !== null) return;
      const used = new Set(NET.players.filter(p => p.online).map(p => p.slot));
      const free = [1, 2, 3].find(s => !used.has(s));
      if (free == null) {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 600);
        return;
      }
      slot = free;
      NET.conns.set(slot, conn);
      NET.players = NET.players.filter(p => p.slot !== slot);
      NET.players.push({ slot, name: String(m.name || '').trim().slice(0, 8) || PLAYERS[slot].name, online: true });
      NET.players.sort((a, b) => a.slot - b.slot);
      NET.stars[slot] = 0;
      conn.send({ t: 'welcome', slot });
      SFX.join();
      if (NET.phase === 'lobby') hostToLobby();
      else {
        hostBroadcast({ t: 'presence', players: NET.players });
        if (NET.phase === 'intro') conn.send({ t: 'intro', g: NET.introG, players: NET.players });
        else conn.send({ t: 'busy', players: NET.players });
      }
    } else if (slot !== null) {
      hostInput(slot, m);
    }
  });
  conn.on('close', () => {
    if (slot === null || NET.conns.get(slot) !== conn) return;
    NET.conns.delete(slot);
    const p = NET.players.find(x => x.slot === slot);
    if (p) p.online = false;
    if (NET.phase === 'lobby') hostToLobby();
    else {
      hostBroadcast({ t: 'presence', players: NET.players });
      if (NET.game && NET.game.logic && NET.game.logic.presence) NET.game.logic.presence();
    }
  });
}

function hostBroadcast(m) {
  NET.conns.forEach(c => { if (c.open) { try { c.send(m); } catch (e) { /* ignore */ } } });
  queueMicrotask(() => onMsg(m)); // 房主自己的畫面
}
function sendInput(m) {
  if (NET.role === 'host') queueMicrotask(() => hostInput(0, m));
  else if (NET.conn && NET.conn.open) { try { NET.conn.send(m); } catch (e) { /* ignore */ } }
}
function hostInput(slot, m) {
  const H = NET.game;
  if (m.t === 'in' && H && !H.done && H.players.includes(slot)) H.logic.input(slot, m);
}

function pruneOffline() { NET.players = NET.players.filter(p => p.online); }

function hostToLobby() {
  if (NET.hostT) NET.hostT.stop();
  NET.game = null;
  NET.phase = 'lobby';
  pruneOffline();
  hostBroadcast({ t: 'lobby', code: NET.code, players: NET.players, stars: NET.stars });
}
function hostPickGame(id) {
  NET.phase = 'intro';
  NET.introG = id;
  hostBroadcast({ t: 'intro', g: id, players: NET.players });
}

/* ---- 玩家(加入者) ---- */
function joinRoom(code) {
  code = String(code || '').trim();
  if (!/^\d{4}$/.test(code)) return toast('請輸入 4 位數房號');
  if (!window.Peer) return toast('連線元件載入失敗,請檢查網路後重新整理');
  showWait('連線到房間 ' + code + '…');
  const peer = new Peer(PEER_OPTS);
  Object.assign(NET, { role: 'client', peer, code });
  let ok = false;
  const fail = msg => { if (NET.peer === peer) leaveRoom(msg); };
  const timer = setTimeout(() => { if (!ok) fail('連線逾時,請確認房號或換個網路試試'); }, 20000);

  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    NET.conn = conn;
    conn.on('open', () => {
      ok = true;
      clearTimeout(timer);
      conn.send({ t: 'hello', name: myName() });
      requestWake();
    });
    conn.on('data', m => { if (NET.peer === peer) onMsg(m); });
    conn.on('close', () => fail('和房主的連線中斷了 😢'));
  });
  peer.on('error', err => {
    if (err.type === 'peer-unavailable') { clearTimeout(timer); fail('找不到房間 ' + code + ' 🤔'); }
    else if (!ok) { clearTimeout(timer); fail('連線失敗(' + err.type + ')'); }
  });
}

/* ---- 每台手機共用的訊息處理 ---- */
let V = null;  // 目前遊戲畫面
function onMsg(m) {
  if (!m || !NET.role) return;
  switch (m.t) {
    case 'welcome': NET.mySlot = m.slot; break;
    case 'full': leaveRoom('房間已經滿了(最多 4 人)'); break;
    case 'lobby':
      NET.players = m.players; NET.stars = m.stars; NET.code = m.code;
      lobbyView();
      break;
    case 'presence':
      NET.players = m.players;
      if (V) V.renderChips();
      else if ($('.intro')) introPlayers();
      break;
    case 'busy': NET.players = m.players; busyView(); break;
    case 'intro': NET.players = m.players; introView(GAME[m.g]); break;
    case 'play': playView(m); break;
    case 'cd': if (V) V.countdown(m.n); break;
    case 'score': if (V) V.setScores(m); break;
    case 'g':
      if (!V) break;
      if (m.e === 'end') { V.onTap = null; V.stage('<div class="big">🎉</div><div>結束囉!</div>'); SFX.go(); }
      else V.on(m);
      break;
    case 'results': NET.stars = m.stars; NET.players = m.pl; resultsView(m); break;
  }
}

/* =========================================================
   遊戲清單:host = 房主手機上跑的邏輯,view = 每台手機的畫面
   ========================================================= */
const GAMES = [
  {
    id: 'reaction', emoji: '⚡', name: '閃電快手', tag: '反應', color: '#ffbf1f', desc: '看到 ⭐ 就拍!',
    rules: ['等畫面出現 ⭐ 時,用最快速度拍下按鈕', '比的是每個人自己手機上的反應毫秒數,網路慢也公平!', '太早拍會出局一回合 🙈', '出現 💣 千萬別拍,拍到扣 1 分!共 5 回合'],
    host: hReaction, view: vReaction,
  },
  {
    id: 'tap', emoji: '🥕', name: '狂點拔蘿蔔', tag: '反應', color: '#ff9147', desc: '拼手速拔蘿蔔!',
    rules: ['倒數後瘋狂點擊下方的區域', '每點一下蘿蔔就被拔高一點', '上方可以看到大家的進度', '8 秒內點最多下的人獲勝!'],
    host: hTap, view: vTap, noCountdown: true,
  },
  {
    id: 'math', emoji: '🧮', name: '算數小天才', tag: '益智', color: '#3fbf78', desc: '搶答算數題!',
    rules: ['每台手機會同時出現一道算式', '選出正確答案,最快答對的人得 1 分', '每題只能答一次,答錯就沒機會囉', '共 7 題,越後面越難!'],
    host: hMath, view: vMath,
  },
  {
    id: 'color', emoji: '🎨', name: '顏色對對碰', tag: '益智+反應', color: '#9b5cff', desc: '字和顏色一樣才拍!',
    rules: ['畫面會出現一個顏色的字,例如「紅」', '只有「字的意思」和「字的顏色」一樣時才拍!', '最快拍對得 1 分,拍錯扣 1 分', '共 12 題,小心別被騙了 😜'],
    host: hColor, view: vColor,
  },
  {
    id: 'memory', emoji: '🃏', name: '萌寵翻翻樂', tag: '益智', color: '#5b9bff', desc: '輪流翻牌找配對',
    rules: ['大家看到同一副牌,輪流翻兩張', '輪到你時手機會震動提醒', '翻到一樣的得 1 分,還能再翻一次', '全部配對完,分數最高的人獲勝!'],
    host: hMemory, view: vMemory, noCountdown: true,
  },
  {
    id: 'chess', emoji: '♟️', name: '暗棋大對決', tag: '益智', color: '#d9773f', desc: '翻棋吃子 2 人對戰',
    rules: ['2 人對戰!房間超過 2 人時抽籤決定誰上場,其他人觀戰', '輪到你時:翻開一顆棋,或把自己的棋走一格', '第一個翻棋的人,翻到什麼顏色就是那一方', '大吃小:帥 > 仕 > 相 > 俥 > 傌 > 炮 > 兵,但兵能吃帥、帥不能吃兵', '炮要隔著一顆棋跳過去吃,吃光對方或讓對方無路可走就贏了!'],
    host: hChess, view: vChess, noCountdown: true,
  },
];
const GAME = Object.fromEntries(GAMES.map(g => [g.id, g]));

/* =========================================================
   畫面:首頁
   ========================================================= */
function home() {
  resetView();
  app.innerHTML = '';
  const roomParam = new URLSearchParams(location.search).get('room') || '';
  const h = el('div', 'screen home');
  h.innerHTML = `
    <header class="hero">
      <div class="hero-emo"><span>🐰</span><span>🐻</span><span>🐸</span><span>🐱</span></div>
      <h1>萌萌派對</h1>
      <p>每人一支手機,2~4 人連線同樂!</p>
    </header>
    <section class="panel">
      <h2>你的暱稱</h2>
      <input class="field" id="name" maxlength="8" placeholder="輸入暱稱(可不填)" value="${esc(myName())}">
    </section>
    <section class="panel">
      <button class="btn wide" id="create">🏠 建立房間</button>
      <div class="or"><span>或</span></div>
      <div class="join">
        <input class="field" id="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="4 位數房號" value="${esc(roomParam)}">
        <button class="btn" id="join">加入</button>
      </div>
      <p class="tip">📱 一人建立房間,其他人輸入房號加入<br>建議大家連同一個 Wi-Fi,連線最穩喔!</p>
    </section>
    <section class="panel">
      <h2>遊戲列表</h2>
      <div class="glist">${GAMES.map(g => `<div class="gitem" style="--g:${g.color}"><span>${g.emoji}</span><b>${g.name}</b><span class="tag">${g.tag}</span></div>`).join('')}</div>
    </section>
    <footer class="foot"><button class="mini" id="mute">${S.muted ? '🔇 靜音中' : '🔊 音效開'}</button></footer>`;
  app.appendChild(h);

  const nameIn = $('#name', h), codeIn = $('#code', h);
  const saveName = () => store.set('name', nameIn.value.trim().slice(0, 8));
  nameIn.addEventListener('change', saveName);
  $('#create', h).addEventListener('click', () => { saveName(); createRoom(); });
  $('#join', h).addEventListener('click', () => { saveName(); joinRoom(codeIn.value); });
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') { saveName(); joinRoom(codeIn.value); } });
  $('#mute', h).addEventListener('click', () => { S.muted = !S.muted; store.set('muted', S.muted); home(); });
}

function showWait(msg) {
  resetView();
  app.innerHTML = '';
  const d = el('div', 'screen wait', `<div class="spin">🐾</div><p>${esc(msg)}</p><button class="mini">取消</button>`);
  app.appendChild(d);
  $('button', d).addEventListener('click', () => leaveRoom());
}

function playerChipsHTML(withStars) {
  return NET.players.map(p => {
    const P = PLAYERS[p.slot];
    const tags = (p.slot === 0 ? '<span class="ptag">房主</span>' : '') + (p.slot === NET.mySlot ? '<span class="ptag me">我</span>' : '');
    return `<div class="pchip${p.online ? '' : ' off'}" style="--c:${P.color};--soft:${P.soft}">
      <span class="pemo">${P.emoji}</span><span class="pname">${esc(p.name)}</span>${tags}
      ${withStars ? `<span class="pstar">⭐ ${NET.stars[p.slot] || 0}</span>` : ''}</div>`;
  }).join('');
}

/* ---------- 房間大廳 ---------- */
function lobbyView() {
  resetView();
  app.innerHTML = '';
  const isHost = NET.role === 'host';
  const enough = NET.players.filter(p => p.online).length >= 2;
  const d = el('div', 'screen lobby');
  d.innerHTML = `
    <section class="panel room">
      <div class="small">房號</div>
      <div class="code">${esc(NET.code)}</div>
      <button class="mini" id="share">📤 邀請朋友</button>
    </section>
    <section class="panel">
      <h2>玩家 ${NET.players.length} / 4</h2>
      <div class="players">${playerChipsHTML(true)}</div>
      ${NET.players.length < 4 ? '<p class="tip">等朋友輸入房號加入… 🐾</p>' : ''}
    </section>
    ${isHost ? `
      <h2 class="sect">${enough ? '選一個遊戲開始吧!' : '至少 2 人才能開始喔'}</h2>
      <section class="games">${GAMES.map(g => `
        <button class="gcard" data-g="${g.id}" style="--g:${g.color}" ${enough ? '' : 'disabled'}>
          <span class="gemo">${g.emoji}</span><b>${g.name}</b>
          <span class="tag">${g.tag}</span><span class="gdesc">${g.desc}</span>
        </button>`).join('')}
      </section>` : `
      <section class="panel waiting"><div class="spin">🎲</div><p>等房主選遊戲…</p></section>`}
    <footer class="foot"><button class="mini" id="leave">🚪 離開房間</button></footer>`;
  app.appendChild(d);

  $('#share', d).addEventListener('click', shareRoom);
  $('#leave', d).addEventListener('click', () => {
    if (!isHost || confirm('你是房主,離開後房間會解散,確定嗎?')) leaveRoom();
  });
  $$('.gcard', d).forEach(b => b.addEventListener('click', () => hostPickGame(b.dataset.g)));
}

async function shareRoom() {
  const url = location.origin + location.pathname + '?room=' + NET.code;
  const text = `來玩萌萌派對!房號 ${NET.code}`;
  try {
    if (navigator.share) { await navigator.share({ title: '萌萌派對', text, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text + ' ' + url); toast('邀請連結已複製 ✨'); }
  catch (e) { toast('房號:' + NET.code); }
}

function busyView() {
  resetView();
  app.innerHTML = '';
  const d = el('div', 'screen wait', `<div class="spin">🎮</div><p>大家正在玩一局<br>下一局就能一起玩囉!</p><button class="mini">🚪 離開房間</button>`);
  app.appendChild(d);
  $('button', d).addEventListener('click', () => leaveRoom());
}

/* ---------- 規則說明 ---------- */
function introView(g) {
  resetView();
  app.innerHTML = '';
  const isHost = NET.role === 'host';
  const d = el('div', 'screen intro');
  d.style.setProperty('--g', g.color);
  d.innerHTML = `
    <div class="icard">
      <div class="iemo">${g.emoji}</div>
      <h1>${g.name}</h1>
      <span class="tag">${g.tag}</span>
      <ul>${g.rules.map(r => `<li>${r}</li>`).join('')}</ul>
      <div class="players small-chips"></div>
      ${isHost ? '<button class="btn go">開始遊戲!</button><button class="mini back">← 換遊戲</button>'
    : '<p class="waittxt"><span class="spin-s">⏳</span> 等房主按開始…</p>'}
    </div>`;
  app.appendChild(d);
  introPlayers();
  if (isHost) {
    $('.go', d).addEventListener('click', () => hostStartGame(g));
    $('.back', d).addEventListener('click', hostToLobby);
  }
}
function introPlayers() {
  const box = $('.intro .players');
  if (box) box.innerHTML = playerChipsHTML(false);
}

/* =========================================================
   遊戲畫面(每台手機):上方計分、中間舞台、下方自己的按鈕區
   ========================================================= */
function exitBtn() {
  const b = el('button', 'exit', '✕');
  let armed = false, t = null;
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    if (armed) {
      clearTimeout(t);
      if (NET.role === 'host') hostToLobby(); else leaveRoom();
      return;
    }
    armed = true;
    b.classList.add('armed');
    b.textContent = NET.role === 'host' ? '結束?' : '離開?';
    t = setTimeout(() => { armed = false; b.classList.remove('armed'); b.textContent = '✕'; }, 2000);
  });
  return b;
}

function playView(m) {
  const g = GAME[m.g];
  const T = resetView();
  app.innerHTML = '';
  const me = PLAYERS[NET.mySlot];
  const root = el('div', 'play play-' + g.id);
  root.style.setProperty('--c', me.color);
  root.style.setProperty('--soft', me.soft);
  root.innerHTML = `
    <div class="topbar"><div class="chips"></div></div>
    <div class="stage"><div class="sin"></div></div>
    <div class="pad"></div>`;
  $('.topbar', root).prepend(exitBtn());
  app.appendChild(root);

  const chipsEl = $('.chips', root), sin = $('.sin', root), pad = $('.pad', root);
  const v = {
    g, T, root, pad, me: NET.mySlot,
    players: m.players,
    scores: { ...m.scores },
    onTap: null,
    on: () => {},
    stage(html) { sin.innerHTML = html; },
    send(o) { sendInput({ t: 'in', ...o }); },
    renderChips() {
      chipsEl.innerHTML = v.players.map(s => {
        const p = pinfo(s);
        return `<div class="chip${s === v.me ? ' me' : ''}${p.online ? '' : ' off'}" data-s="${s}" style="--c:${p.color};--soft:${p.soft}">
          <span class="ce">${p.emoji}</span><span class="cn">${s === v.me ? '我' : esc(p.name)}</span><b>${v.scores[s] || 0}</b></div>`;
      }).join('');
    },
    setScores(msg) {
      v.scores = { ...msg.scores };
      v.renderChips();
      if (!msg.pop) return;
      const { slot, v: val } = msg.pop;
      if (slot === v.me) {
        v.pop(val > 0 ? '+' + val : String(val), val < 0);
        if (val > 0) { SFX.good(); buzz(40); v.fx('good'); }
        else { SFX.bad(); buzz(120); v.fx('bad'); }
      }
      const chip = $(`.chip[data-s="${slot}"]`, chipsEl);
      if (chip) chip.classList.add('bump');
    },
    countdown(n) {
      v.stage(n > 0 ? `<div class="big pulse">${n}</div>` : '<div class="big">開始!</div>');
      if (n > 0) SFX.tick(); else SFX.go();
    },
    pop(text, neg) {
      const p = el('div', 'pop' + (neg ? ' neg' : ''), text);
      pad.appendChild(p);
      setTimeout(() => p.remove(), 900);
    },
    fx(cls) {
      pad.classList.remove('good', 'bad', 'tapped');
      void pad.offsetWidth; // 重新觸發動畫
      pad.classList.add(cls);
    },
    lit(on) { pad.classList.toggle('lit', on); },
    out(on) { pad.classList.toggle('out', on); },
  };
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (v.onTap) v.onTap(e);
  });
  V = v;
  v.renderChips();
  g.view(v);
}

/* ---------- 結算 ---------- */
function resultsView(m) {
  resetView();
  app.innerHTML = '';
  const g = GAME[m.g];
  const isHost = NET.role === 'host';
  const sc = m.players.map(s => m.scores[s]);
  const order = m.players.map(s => ({ s, v: m.scores[s] })).sort((a, b) => b.v - a.v);
  const medal = v => ['🥇', '🥈', '🥉', '🎀'][sc.filter(x => x > v).length];
  const iWon = m.winners.includes(NET.mySlot);
  const title = m.winners.length === 0 ? '沒有贏家 😆'
    : m.winners.length > 1 ? `平手!${m.winners.map(s => PLAYERS[s].emoji).join(' ')} 都贏了`
      : `${PLAYERS[m.winners[0]].emoji} ${esc(pinfo(m.winners[0]).name)} 獲勝!`;

  const d = el('div', 'screen result');
  d.innerHTML = `
    <div class="trophy">${iWon ? '🏆' : m.winners.length ? '👏' : '🤪'}</div>
    <h1>${title}</h1>
    ${iWon ? '<p class="youwin">你好棒!獲得一顆 ⭐</p>' : ''}
    <div class="ranks">${order.map(({ s, v }, k) => {
    const p = pinfo(s);
    return `<div class="rank${s === NET.mySlot ? ' mine' : ''}" style="--c:${p.color};animation-delay:${k * 0.12}s">
        <span class="medal">${medal(v)}</span><span class="remo">${p.emoji}</span><span class="rname">${esc(p.name)}</span>
        <span class="rsc">${v} 分</span><span class="rstar">⭐${m.stars[s] || 0}</span>
      </div>`;
  }).join('')}
    </div>
    <div class="rbtns">${isHost ? `
      <button class="btn again">🔁 再玩一次</button>
      <button class="btn alt other">🎲 選其他遊戲</button>` : `
      <p class="waittxt"><span class="spin-s">⏳</span> 等房主決定下一局…</p>
      <button class="mini leave">🚪 離開房間</button>`}
    </div>`;
  app.appendChild(d);
  if (isHost) {
    $('.again', d).addEventListener('click', () => hostStartGame(g));
    $('.other', d).addEventListener('click', hostToLobby);
  } else {
    $('.leave', d).addEventListener('click', () => leaveRoom());
  }

  SFX.win();
  if (iWon) { confetti(); buzz([60, 60, 120]); }
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

/* =========================================================
   房主:開局 / 結算
   ========================================================= */
function hostStartGame(g) {
  pruneOffline();
  if (NET.players.length < 2) { toast('至少要 2 人才能開始喔'); return hostToLobby(); }
  if (NET.hostT) NET.hostT.stop();
  const T = makeTimers();
  NET.hostT = T;
  const players = NET.players.map(p => p.slot);
  const H = { g, s: T, players, scores: {}, done: false };
  players.forEach(s => { H.scores[s] = 0; });
  H.bc = hostBroadcast;
  H.online = s => { const p = NET.players.find(x => x.slot === s); return !!(p && p.online); };
  H.active = () => H.players.filter(H.online);
  H.add = (slot, v) => {
    H.scores[slot] += v;
    hostBroadcast({ t: 'score', scores: H.scores, pop: { slot, v } });
  };
  H.finish = () => {
    if (H.done) return;
    H.done = true;
    hostBroadcast({ t: 'g', e: 'end' });
    T.after(1500, () => hostResults(H));
  };
  H.countdown = cb => {
    let n = 3;
    const tick = () => {
      hostBroadcast({ t: 'cd', n });
      if (n === 0) T.after(600, cb);
      else { n--; T.after(800, tick); }
    };
    tick();
  };

  NET.game = H;
  NET.phase = 'game';
  hostBroadcast({ t: 'play', g: g.id, players, scores: H.scores });
  H.logic = g.host(H);
  if (g.noCountdown) T.after(500, H.logic.start);
  else T.after(500, () => H.countdown(H.logic.start));
}

function hostResults(H) {
  const max = Math.max(...H.players.map(s => H.scores[s]));
  const winners = max > 0 ? H.players.filter(s => H.scores[s] === max) : [];
  winners.forEach(s => { NET.stars[s]++; });
  NET.game = null;
  NET.phase = 'results';
  hostBroadcast({ t: 'results', g: H.g.id, players: H.players, scores: H.scores, winners, stars: NET.stars, pl: NET.players });
}

/* =========================================================
   1. 閃電快手 ⚡
   ========================================================= */
function hReaction(H) {
  const R = 5;
  let round = 0, phase = 'idle';
  const out = new Set(), rts = new Map();
  const live = (r, fn) => () => { if (r === round) fn(); };
  const pending = () => H.active().filter(s => !out.has(s) && !rts.has(s));

  function next() {
    round++;
    if (round > R) return H.finish();
    out.clear();
    rts.clear();
    phase = 'wait';
    H.bc({ t: 'g', e: 'wait', round, R });
    const r = round;
    if (Math.random() < 0.45) {
      H.s.after(rand(1200, 2400), live(r, () => {
        if (phase !== 'wait') return;
        phase = 'bomb';
        H.bc({ t: 'g', e: 'bomb' });
        H.s.after(1300, live(r, () => {
          if (phase !== 'bomb') return;
          phase = 'wait';
          H.bc({ t: 'g', e: 'wait', round, R });
          H.s.after(rand(800, 2200), live(r, go));
        }));
      }));
    } else {
      H.s.after(rand(1600, 4000), live(r, go));
    }
  }
  function go() {
    if (phase !== 'wait') return;
    phase = 'go';
    H.bc({ t: 'g', e: 'go' });
    H.s.after(4000, live(round, decide));
  }
  function decide() {
    if (phase !== 'go') return;
    phase = 'done';
    let best = null;
    rts.forEach((rt, s) => { if (!best || rt < best.rt) best = { s, rt }; });
    if (best) H.add(best.s, 1);
    H.bc({ t: 'g', e: 'result', winner: best ? best.s : null, rt: best ? best.rt : 0 });
    H.s.after(2300, next);
  }
  function checkAllOut() {
    if (H.active().every(s => out.has(s))) {
      phase = 'done';
      H.bc({ t: 'g', e: 'allout' });
      H.s.after(1600, next);
    }
  }
  return {
    start: next,
    input(slot, m) {
      if (out.has(slot) || rts.has(slot)) return;
      if (m.e === 'early' && phase === 'wait') { out.add(slot); checkAllOut(); }
      else if (m.e === 'bomb' && phase === 'bomb') { out.add(slot); H.add(slot, -1); checkAllOut(); }
      else if (m.e === 'rt' && phase === 'go') {
        rts.set(slot, Math.max(0, Math.min(9999, +m.rt || 9999)));
        if (!pending().length) decide();
        else if (rts.size === 1) H.s.after(700, live(round, decide)); // 給網路慢一點的人一點時間
      }
    },
    presence() { if (phase === 'go' && rts.size && !pending().length) decide(); },
  };
}

function vReaction(V) {
  let phase = 'idle', round = 0, sent = false, goAt = 0;
  V.pad.innerHTML = '<div class="bigbtn">拍!</div>';
  V.stage('<div class="big">⚡</div><div>準備好了嗎?</div>');
  const waitStage = R => V.stage(`<div class="small">第 ${round} / ${R} 回合</div><div class="big">🙈</div><div class="small">等 ⭐ 出現…</div>`);

  V.onTap = () => {
    if (sent || phase === 'idle' || phase === 'done') return;
    sent = true;
    if (phase === 'wait') {
      V.send({ e: 'early' });
      V.out(true);
      V.pop('太快了!', true);
      SFX.bad();
      buzz(100);
    } else if (phase === 'bomb') {
      V.send({ e: 'bomb' });
      V.out(true);
    } else if (phase === 'go') {
      const rt = Math.round(performance.now() - goAt);
      V.send({ e: 'rt', rt });
      V.lit(false);
      V.fx('tapped');
      SFX.tap();
      V.stage(`<div class="big">${rt}</div><div class="small">毫秒 — 等其他人…</div>`);
    }
  };
  V.on = m => {
    if (m.e === 'wait') {
      if (m.round !== round) { round = m.round; sent = false; V.out(false); }
      phase = 'wait';
      V.lit(false);
      waitStage(m.R);
    } else if (m.e === 'bomb') {
      phase = 'bomb';
      V.stage('<div class="big pulse">💣</div><div>別拍!!</div>');
      SFX.tick();
    } else if (m.e === 'go') {
      phase = 'go';
      V.stage('<div class="big pulse">⭐</div><div>快拍!</div>');
      goAt = performance.now();
      requestAnimationFrame(() => { goAt = performance.now(); }); // 以畫面真正顯示的時間起算
      if (!sent) { V.lit(true); SFX.go(); }
    } else if (m.e === 'allout') {
      phase = 'done';
      V.stage('<div class="big">😵</div><div>大家都出局了!</div>');
    } else if (m.e === 'result') {
      phase = 'done';
      V.lit(false);
      if (m.winner == null) V.stage('<div class="big">🐢</div><div>大家都太慢啦~</div>');
      else {
        const p = pinfo(m.winner);
        V.stage(`<div class="big">${p.emoji}</div><div>${m.winner === V.me ? '你' : esc(p.name)} 最快!</div><div class="small">${m.rt} 毫秒</div>`);
      }
    }
  };
}

/* =========================================================
   2. 狂點拔蘿蔔 🥕
   ========================================================= */
const TAP_FULL = 60;

function hTap(H) {
  const T = 8;
  const counts = {}, finals = new Set();
  let ended = false;
  function end() {
    if (ended) return;
    ended = true;
    H.players.forEach(s => { H.scores[s] = counts[s] || 0; });
    H.bc({ t: 'score', scores: H.scores });
    H.finish();
  }
  return {
    start() {
      H.bc({ t: 'g', e: 'start', T });
      H.s.every(400, () => { if (!ended) H.bc({ t: 'g', e: 'prog', counts }); });
      H.s.after((3 + T) * 1000 + 4000, end); // 保險:等不到某人的最終成績也會結束
    },
    input(slot, m) {
      if (m.e !== 'count' || ended) return;
      counts[slot] = Math.max(counts[slot] || 0, Math.min(400, +m.n || 0));
      if (m.final) {
        finals.add(slot);
        if (H.active().every(s => finals.has(s))) end();
      }
    },
    presence() { if (!ended && H.active().every(s => finals.has(s))) end(); },
  };
}

function vTap(V) {
  let count = 0, on = false, over = false, left = 0, sentN = -1, others = {};
  V.pad.innerHTML = `
    <div class="carrot-box"><div class="carrot">🥕</div><div class="dirt"></div></div>
    <div class="taps">0</div>`;
  const carrot = $('.carrot', V.pad), taps = $('.taps', V.pad);
  V.stage('<div class="big">🥕</div><div>準備拔蘿蔔!</div>');

  function race() {
    const rows = V.players.map(s => {
      const p = pinfo(s);
      const n = s === V.me ? count : (others[s] || 0);
      return `<div class="rrow" style="--c:${p.color}"><span>${p.emoji}</span><div class="rbar"><i style="width:${Math.min(100, n / TAP_FULL * 100)}%"></i></div><b>${n}</b></div>`;
    }).join('');
    V.stage(`<div class="timer${left <= 3 && on ? ' pulse' : ''}">${on ? left : '⏰'}</div><div class="race">${rows}</div>`);
  }
  function sendCount(final) {
    if (!final && count === sentN) return;
    sentN = count;
    V.send({ e: 'count', n: count, final: !!final });
  }

  V.onTap = () => {
    if (!on) return;
    count++;
    taps.textContent = count;
    carrot.style.setProperty('--b', (22 + 38 * Math.min(1, count / TAP_FULL)) + '%');
    if (count === TAP_FULL) { V.pop('拔出來了!'); SFX.good(); }
    V.fx('tapped');
    SFX.tap();
  };
  V.on = m => {
    if (m.e === 'start') {
      // 倒數在每台手機上各自進行,網路延遲不影響可點擊的時間
      let n = 3;
      const cd = () => {
        V.countdown(n);
        if (n > 0) { n--; V.T.after(800, cd); return; }
        on = true;
        left = m.T;
        race();
        V.T.every(250, () => { if (on) sendCount(false); });
        V.T.every(1000, () => {
          if (!on) return;
          left--;
          if (left > 0) { SFX.tick(); race(); return; }
          on = false;
          over = true;
          sendCount(true);
          SFX.go();
          race();
        });
      };
      cd();
    } else if (m.e === 'prog') {
      others = m.counts;
      if (on || over) race();
    }
  };
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

function hMath(H) {
  const R = 7;
  let round = 0, phase = 'idle', q = null;
  const wrong = new Set(), right = new Map();
  const live = (r, fn) => () => { if (r === round) fn(); };
  const pending = () => H.active().filter(s => !wrong.has(s) && !right.has(s));

  function next() {
    round++;
    if (round > R) return H.finish();
    q = genQuestion(round);
    wrong.clear();
    right.clear();
    phase = 'open';
    H.bc({ t: 'g', e: 'q', round, R, text: q.text, opts: q.opts });
    H.s.after(12000, live(round, () => { if (phase === 'open') decide(); }));
  }
  function decide() {
    if (phase !== 'open') return;
    phase = 'done';
    let best = null;
    right.forEach((rt, s) => { if (!best || rt < best.rt) best = { s, rt }; });
    if (best) H.add(best.s, 1);
    H.bc({ t: 'g', e: 'reveal', text: q.text, ans: q.ans, winner: best ? best.s : null, timeout: !best && pending().length > 0 });
    H.s.after(2200, next);
  }
  return {
    start: next,
    input(slot, m) {
      if (m.e !== 'ans' || phase !== 'open' || m.round !== round || wrong.has(slot) || right.has(slot)) return;
      if (+m.v === q.ans) {
        right.set(slot, Math.max(0, +m.rt || 99999));
        if (right.size === 1) H.s.after(600, live(round, decide));
      } else {
        wrong.add(slot);
      }
      if (!pending().length) decide();
    },
    presence() { if (phase === 'open' && !pending().length) decide(); },
  };
}

function vMath(V) {
  let round = 0, answered = false, shownAt = 0, picked = null;
  V.pad.innerHTML = '<div class="hint">準備好動動腦!🧠</div>';
  V.stage('<div class="big">🧮</div><div>算數小天才</div>');

  V.onTap = e => {
    const b = e.target.closest('.opt');
    if (!b || answered || !round) return;
    answered = true;
    picked = b;
    b.classList.add('picked');
    SFX.tap();
    V.send({ e: 'ans', v: +b.dataset.v, rt: Math.round(performance.now() - shownAt), round });
  };
  V.on = m => {
    if (m.e === 'q') {
      round = m.round;
      answered = false;
      picked = null;
      V.stage(`<div class="small">第 ${m.round} / ${m.R} 題</div><div class="q">${m.text} = ?</div>`);
      V.pad.innerHTML = `<div class="opts">${shuffle(m.opts).map(v => `<button class="opt" data-v="${v}">${v}</button>`).join('')}</div>`;
      shownAt = performance.now();
      requestAnimationFrame(() => { shownAt = performance.now(); });
    } else if (m.e === 'reveal') {
      answered = true;
      $$('.opt', V.pad).forEach(b => { if (+b.dataset.v === m.ans) b.classList.add('right'); });
      if (picked && +picked.dataset.v !== m.ans) { picked.classList.add('wrong'); V.fx('bad'); SFX.bad(); buzz(80); }
      let line;
      if (m.winner == null) line = m.timeout ? '⏰ 時間到!' : '😅 大家都答錯了';
      else line = `${pinfo(m.winner).emoji} ${m.winner === V.me ? '你' : esc(pinfo(m.winner).name)} 最快答對!`;
      V.stage(`<div class="q">${m.text} = <b>${m.ans}</b></div><div>${line}</div>`);
    }
  };
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

function hColor(H) {
  const R = 12;
  let idx = 0, phase = 'idle', cur = null;
  const tapped = new Set(), claims = new Map();

  function next() {
    idx++;
    if (idx > R) return H.finish();
    tapped.clear();
    claims.clear();
    const w = pick(COLORS);
    const match = Math.random() < 0.45;
    const ink = match ? w : pick(COLORS.filter(c => c !== w));
    cur = { match };
    phase = 'show';
    H.bc({ t: 'g', e: 'p', i: idx, R, w: w.n, c: ink.c });
    const r = idx;
    H.s.after(Math.max(1500, 2400 - idx * 70), () => {
      if (r !== idx || phase !== 'show') return;
      if (claims.size) return decide();
      phase = 'gap';
      H.bc({ t: 'g', e: 'miss', match });
      H.s.after(1100, next);
    });
  }
  function decide() {
    if (phase !== 'show') return;
    phase = 'gap';
    let best = null;
    claims.forEach((rt, s) => { if (!best || rt < best.rt) best = { s, rt }; });
    H.add(best.s, 1);
    H.bc({ t: 'g', e: 'hit', slot: best.s });
    H.s.after(1300, next);
  }
  return {
    start: next,
    input(slot, m) {
      if (m.e !== 'tap' || phase !== 'show' || m.i !== idx || tapped.has(slot)) return;
      tapped.add(slot);
      if (cur.match) {
        claims.set(slot, Math.max(0, +m.rt || 99999));
        if (claims.size === 1) { const r = idx; H.s.after(500, () => { if (r === idx) decide(); }); }
      } else {
        H.add(slot, -1);
      }
    },
  };
}

function vColor(V) {
  let idx = 0, tapped = true, shownAt = 0;
  V.pad.innerHTML = '<div class="bigbtn">一樣!<br>拍!</div>';
  V.stage('<div class="big">🎨</div><div>字和顏色一樣才拍!</div>');

  V.onTap = () => {
    if (tapped) return;
    tapped = true;
    V.fx('tapped');
    SFX.tap();
    V.send({ e: 'tap', i: idx, rt: Math.round(performance.now() - shownAt) });
  };
  V.on = m => {
    if (m.e === 'p') {
      idx = m.i;
      tapped = false;
      V.stage(`<div class="small">${m.i} / ${m.R}</div><div class="word" style="color:${m.c}">${m.w}</div>`);
      shownAt = performance.now();
      requestAnimationFrame(() => { shownAt = performance.now(); });
    } else if (m.e === 'hit') {
      tapped = true;
      const p = pinfo(m.slot);
      V.stage(`<div class="big">${p.emoji}</div><div>${m.slot === V.me ? '你' : esc(p.name)} 拍對了!</div>`);
    } else if (m.e === 'miss') {
      tapped = true;
      V.stage(m.match ? '<div class="big">😮</div><div>是一樣的!沒人拍到~</div>' : '<div class="big">🙅</div><div>不一樣,不能拍喔</div>');
    }
  };
}

/* =========================================================
   5. 萌寵翻翻樂 🃏(輪流制,大家看同一副牌)
   ========================================================= */
const FOODS = ['🍓', '🍰', '🍩', '🍉', '🍭', '🧁', '🍪', '🍦', '🍒', '🍑', '🐶', '🐼'];

function hMemory(H) {
  const n = H.players.length, pairs = n <= 2 ? 8 : 10;
  const deck = shuffle(shuffle(FOODS).slice(0, pairs).flatMap(f => [f, f]));
  const owner = Array(deck.length).fill(null);
  let open = [], turnI = 0, lock = false, matched = 0;

  const board = () => ({
    t: 'g', e: 'board', turn: H.players[turnI],
    cells: deck.map((f, i) => ({ f: owner[i] != null || open.includes(i) ? f : null, m: owner[i] })),
  });
  const advance = () => {
    for (let k = 0; k < n; k++) {
      turnI = (turnI + 1) % n;
      if (H.online(H.players[turnI])) break;
    }
  };
  return {
    start() { H.bc(board()); },
    input(slot, m) {
      if (m.e !== 'flip' || lock || slot !== H.players[turnI]) return;
      const i = +m.i;
      if (!(i >= 0 && i < deck.length) || owner[i] != null || open.includes(i)) return;
      open.push(i);
      H.bc(board());
      if (open.length < 2) return;
      const [a, b] = open;
      if (deck[a] === deck[b]) {
        owner[a] = owner[b] = slot;
        open = [];
        matched++;
        H.add(slot, 1);
        H.bc(board());
        if (matched === pairs) { lock = true; H.s.after(1000, H.finish); }
      } else {
        lock = true;
        H.s.after(1200, () => {
          open = [];
          advance();
          lock = false;
          H.bc(board());
        });
      }
    },
    presence() {
      if (!lock && !H.online(H.players[turnI])) { open = []; advance(); H.bc(board()); }
    },
  };
}

function vMemory(V) {
  let cards = [], myTurn = false, lastTurn = null;
  V.stage('<div>🃏 洗牌中…</div>');

  V.onTap = e => {
    const c = e.target.closest('.card');
    if (!c || !myTurn || c.classList.contains('open')) return;
    SFX.tap();
    V.send({ e: 'flip', i: +c.dataset.i });
  };
  V.on = m => {
    if (m.e !== 'board') return;
    if (!cards.length) {
      const grid = el('div', 'grid');
      grid.style.gridTemplateRows = `repeat(${m.cells.length / 4}, 1fr)`;
      cards = m.cells.map((_, i) => {
        const c = el('div', 'card', '<div class="in"><div class="face back">🐾</div><div class="face front"></div></div>');
        c.dataset.i = i;
        grid.appendChild(c);
        return c;
      });
      V.pad.innerHTML = '';
      V.pad.appendChild(grid);
    }
    m.cells.forEach((cell, i) => {
      const c = cards[i];
      const wasOpen = c.classList.contains('open');
      if (cell.f) $('.front', c).textContent = cell.f; // 蓋回去時保留圖案,翻轉動畫才不會變空白
      c.classList.toggle('open', !!cell.f);
      if (cell.m != null && !c.classList.contains('matched')) {
        c.classList.add('matched');
        c.style.setProperty('--mc', PLAYERS[cell.m].soft);
        c.style.setProperty('--mb', PLAYERS[cell.m].color);
      }
      if (cell.f && !wasOpen && m.turn !== V.me) SFX.tap();
    });
    myTurn = m.turn === V.me;
    V.root.classList.toggle('myturn', myTurn);
    if (myTurn) V.stage('<div class="turn">輪到你了!翻兩張牌 👇</div>');
    else {
      const p = pinfo(m.turn);
      V.stage(`<div class="turn">輪到 ${p.emoji} ${esc(p.name)}…</div>`);
    }
    if (myTurn && lastTurn !== V.me) { SFX.tick(); buzz(80); }
    lastTurn = m.turn;
  };
}

/* =========================================================
   6. 暗棋大對決 ♟️(2 人回合制,4 x 8 棋盤,直式顯示)
   棋盤格子:{h:1} = 還沒翻開、{c:'r'|'b', k} = 翻開的棋、null = 空格
   ========================================================= */
const CHESS_RANK = { K: 7, A: 6, E: 5, R: 4, N: 3, C: 2, P: 1 };
const CHESS_NAME = {
  r: { K: '帥', A: '仕', E: '相', R: '俥', N: '傌', C: '炮', P: '兵' },
  b: { K: '將', A: '士', E: '象', R: '車', N: '馬', C: '包', P: '卒' },
};
const CHESS_COLS = 4, CHESS_ROWS = 8;
const COLOR_LABEL = { r: '🔴 紅方', b: '⚫ 黑方' };

function chessCan(cells, from, to) {
  const a = cells[from], d = cells[to];
  if (!a || a.h || from === to) return false;
  const fr = Math.floor(from / CHESS_COLS), fc = from % CHESS_COLS;
  const tr = Math.floor(to / CHESS_COLS), tc = to % CHESS_COLS;
  const adj = Math.abs(fr - tr) + Math.abs(fc - tc) === 1;
  if (!d) return adj;
  if (d.h || d.c === a.c) return false;
  if (a.k === 'C') {
    // 炮:同一直線、中間剛好隔一顆棋(翻開或沒翻開都算)才能吃
    if (fr !== tr && fc !== tc) return false;
    const step = fr === tr ? Math.sign(tc - fc) : Math.sign(tr - fr) * CHESS_COLS;
    let between = 0;
    for (let i = from + step; i !== to; i += step) if (cells[i]) between++;
    return between === 1;
  }
  if (!adj) return false;
  if (a.k === 'K' && d.k === 'P') return false;
  if (a.k === 'P' && d.k === 'K') return true;
  return CHESS_RANK[a.k] >= CHESS_RANK[d.k];
}
const chessTargets = (cells, from) => cells.map((_, i) => i).filter(i => chessCan(cells, from, i));
const chessHasAction = (cells, color) =>
  cells.some(x => x && x.h) || cells.some((x, i) => x && !x.h && x.c === color && chessTargets(cells, i).length > 0);

function hChess(H) {
  const fighters = shuffle(H.players).slice(0, 2); // 超過 2 人就抽籤
  const KINDS = ['K', 'A', 'A', 'E', 'E', 'R', 'R', 'N', 'N', 'C', 'C', 'P', 'P', 'P', 'P', 'P'];
  const board = shuffle(['r', 'b'].flatMap(c => KINDS.map(k => ({ c, k, up: false }))));
  const color = {};
  let turnI = 0, idle = 0, last = null, over = false;

  const view = () => board.map(p => (!p ? null : p.up ? { c: p.c, k: p.k } : { h: 1 }));
  const left = c => board.filter(p => p && p.c === c).length;
  const bc = () => H.bc({
    t: 'g', e: 'board', cells: view(), turn: fighters[turnI], fighters, color, last,
    left: { r: left('r'), b: left('b') }, idle,
  });
  function end(winner, reason) {
    over = true;
    if (winner != null) H.scores[winner] = 1;
    H.bc({ t: 'score', scores: H.scores });
    H.bc({ t: 'g', e: 'over', winner, reason });
    H.s.after(3000, H.finish);
  }
  function afterAction(slot) {
    const opp = fighters[1 - turnI];
    if (left(color[opp]) === 0) { bc(); return end(slot, '吃光對方的棋子!'); }
    turnI = 1 - turnI;
    if (!chessHasAction(view(), color[opp])) { bc(); return end(slot, '對方沒有棋可以走了!'); }
    bc();
    if (idle >= 50) end(null, '連續 50 步沒有翻棋或吃子,平手!');
  }

  return {
    start() { H.bc({ t: 'g', e: 'intro', fighters }); H.s.after(1800, bc); },
    input(slot, m) {
      if (over || slot !== fighters[turnI]) return;
      if (m.e === 'flip') {
        const i = +m.i, p = board[i];
        if (!p || p.up) return;
        p.up = true;
        if (!color[slot]) { // 第一個翻的棋決定顏色
          color[slot] = p.c;
          color[fighters[1 - turnI]] = p.c === 'r' ? 'b' : 'r';
        }
        idle = 0;
        last = { type: 'flip', to: i, slot };
        afterAction(slot);
      } else if (m.e === 'move') {
        const from = +m.from, to = +m.to;
        if (!(from >= 0 && from < 32 && to >= 0 && to < 32)) return;
        const p = board[from];
        if (!p || !p.up || p.c !== color[slot] || !chessCan(view(), from, to)) return;
        const cap = board[to];
        board[to] = p;
        board[from] = null;
        idle = cap ? 0 : idle + 1;
        last = { type: cap ? 'cap' : 'move', from, to, slot, cap: cap ? { c: cap.c, k: cap.k } : null };
        afterAction(slot);
      }
    },
    presence() {
      if (over) return;
      const gone = fighters.find(s => !H.online(s));
      if (gone != null) end(fighters.find(s => s !== gone), '對手離開了');
    },
  };
}

function vChess(V) {
  let st = null, sel = null, targets = [], over = false, lastTurn = null;
  const boardEl = el('div', 'cboard');
  const cells = Array.from({ length: CHESS_COLS * CHESS_ROWS }, (_, i) => {
    const c = el('div', 'cell');
    c.dataset.i = i;
    boardEl.appendChild(c);
    return c;
  });
  V.pad.innerHTML = '';
  V.pad.appendChild(boardEl);
  V.stage('<div class="big">♟️</div><div>擺棋中…</div>');

  const fighting = () => st && st.fighters.includes(V.me);
  const myTurn = () => st && !over && st.turn === V.me;
  const who = s => (s === V.me ? '你' : esc(pinfo(s).name));

  function renderStage() {
    const side = s => {
      const p = pinfo(s), c = st.color[s];
      return `<div class="side${st.turn === s && !over ? ' now' : ''}" style="--c:${p.color}">
        <span>${p.emoji}</span><b>${who(s)}</b><span class="cl">${c ? COLOR_LABEL[c] + ` ×${st.left[c]}` : '❔ 未定'}</span></div>`;
    };
    let msg;
    if (myTurn()) msg = sel != null ? '選要走去哪一格 ✨' : (st.color[V.me] ? '輪到你了!翻棋或走棋' : '輪到你了!先翻一顆棋');
    else msg = (fighting() ? '' : '👀 觀戰中 — ') + `輪到 ${pinfo(st.turn).emoji} ${who(st.turn)}…`;
    let note = '';
    if (st.last && st.last.type === 'cap') note = `${pinfo(st.last.slot).emoji} ${who(st.last.slot)} 吃掉了 ${CHESS_NAME[st.last.cap.c][st.last.cap.k]}!`;
    else if (st.idle >= 40) note = `再 ${50 - st.idle} 步沒吃子就平手`;
    V.stage(`<div class="sides">${st.fighters.map(side).join('<span class="vs">VS</span>')}</div>
      <div class="turn">${msg}</div>${note ? `<div class="small">${note}</div>` : ''}`);
  }
  function render() {
    targets = sel != null && myTurn() ? chessTargets(st.cells, sel) : [];
    const lastFrom = st.last ? st.last.from : -1, lastTo = st.last ? st.last.to : -1;
    cells.forEach((c, i) => {
      const x = st.cells[i];
      c.className = 'cell' + (sel === i ? ' sel' : '') + (targets.includes(i) ? ' tgt' : '')
        + (i === lastTo ? ' last' : '') + (i === lastFrom ? ' from' : '')
        + (i === lastTo && st.last.type === 'flip' ? ' flipped' : '');
      c.innerHTML = !x ? '' : x.h ? '<div class="pc hid">🐾</div>' : `<div class="pc ${x.c}">${CHESS_NAME[x.c][x.k]}</div>`;
    });
    V.root.classList.toggle('myturn', myTurn());
    renderStage();
  }

  V.onTap = e => {
    const c = e.target.closest('.cell');
    if (!c || !myTurn()) return;
    const i = +c.dataset.i, x = st.cells[i];
    if (sel != null && targets.includes(i)) {
      V.send({ e: 'move', from: sel, to: i });
      sel = null;
    } else if (x && x.h) {
      sel = null;
      V.send({ e: 'flip', i });
    } else if (x && x.c === st.color[V.me]) {
      sel = sel === i ? null : i;
      SFX.tap();
    } else {
      sel = null;
    }
    render();
  };
  V.on = m => {
    if (m.e === 'intro') {
      const [a, b] = m.fighters.map(s => `${pinfo(s).emoji} ${who(s)}`);
      V.stage(`<div class="small">${V.players.length > 2 ? '抽籤結果' : '對戰開始'}</div><div class="turn">${a} <span class="vs">VS</span> ${b}</div>
        ${m.fighters.includes(V.me) ? '' : '<div class="small">你這局觀戰 👀</div>'}`);
      SFX.go();
    } else if (m.e === 'board') {
      st = m;
      sel = null;
      render();
      if (m.last) {
        if (m.last.type === 'cap') {
          if (m.last.slot === V.me) SFX.good(); else if (fighting()) { SFX.bad(); buzz(80); } else SFX.tap();
        } else SFX.tap();
      }
      if (myTurn() && lastTurn !== V.me) buzz(60);
      lastTurn = m.turn;
    } else if (m.e === 'over') {
      over = true;
      sel = null;
      if (st) render();
      V.stage(m.winner == null
        ? `<div class="big">🤝</div><div>${m.reason}</div>`
        : `<div class="big">${pinfo(m.winner).emoji}</div><div>${who(m.winner)} 獲勝!</div><div class="small">${m.reason}</div>`);
    }
  };
}

/* ---------- 防止雙指縮放 / 長按選單 ---------- */
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

home();
