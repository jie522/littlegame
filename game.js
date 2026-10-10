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
  { name: '兔兔', file: 'bunny', color: '#9b7bff', soft: '#ede6ff' },
  { name: '熊熊', file: 'bear', color: '#ffa04d', soft: '#fff0dc' },
  { name: '柴柴', file: 'shiba', color: '#3fbf78', soft: '#dcf6e6' },
  { name: '貓貓', file: 'cat', color: '#5b9bff', soft: '#e0ecff' },
];
/* emoji 欄位:文字裡用的小頭像(圖片);畫布遊戲用 CHAR_IMG 直接畫圖 */
PLAYERS.forEach(p => { p.emoji = '<img class="pe" src="assets/chars/head_' + p.file + '.png" alt="">'; });
const loadImg = src => { const i = new Image(); i.src = src; return i; };
const CHAR_IMG = PLAYERS.map(p => ({ full: loadImg('assets/chars/' + p.file + '.png'), head: loadImg('assets/chars/head_' + p.file + '.png') }));

const APP_VERSION = '2026.10.11';
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
  document.body.classList.remove('wide');
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
  solo: false,       // 單人模式(不連線,只有房主 + 電腦)
  level: 1,          // 電腦強度 0 簡單 / 1 普通 / 2 困難
  introG: null,
  game: null,        // host 遊戲進行中的狀態
  hostT: null,
};

const pinfo = slot => {
  const p = NET.players.find(x => x.slot === slot);
  return { ...PLAYERS[slot], name: p ? p.name : PLAYERS[slot].name, online: p ? p.online : false, bot: !!(p && p.bot) };
};
const myName = () => (store.get('name', '') || '').trim().slice(0, 8);

function leaveRoom(msg) {
  const old = NET;
  const peer = old.peer, conn = old.conn, conns = [...old.conns.values()];
  if (old.hostT) old.hostT.stop();
  Object.assign(NET, {
    role: null, peer: null, code: null, conn: null, conns: new Map(), mySlot: 0,
    players: [], stars: [0, 0, 0, 0], phase: 'lobby', introG: null, game: null, hostT: null, solo: false,
  });
  releaseWake();
  try { conns.forEach(c => c.close()); if (conn) conn.close(); if (peer) peer.destroy(); } catch (e) { /* ignore */ }
  home();
  if (msg) toast(msg);
}

/* =========================================================
   電腦玩家:由房主手機扮演
   ========================================================= */
const BOT_LEVELS = ['簡單', '普通', '困難'];
const botSkill = () => [{ sk: 0.6, spd: 1.5 }, { sk: 0.8, spd: 1 }, { sk: 0.95, spd: 0.7 }][NET.level];

function addBot() {
  if (NET.players.length >= 4) return;
  const used = new Set(NET.players.map(p => p.slot));
  const slot = [1, 2, 3].find(s => !used.has(s));
  if (slot == null) return;
  NET.players.push({ slot, name: '🤖' + PLAYERS[slot].name, online: true, bot: true });
  NET.players.sort((a, b) => a.slot - b.slot);
  NET.stars[slot] = 0;
}
function removeBot() {
  const b = NET.players.filter(p => p.bot).pop();
  if (b) NET.players = NET.players.filter(p => p !== b);
}

function createSolo() {
  resetView();
  Object.assign(NET, { role: 'host', peer: null, code: '單人', solo: true, mySlot: 0, phase: 'lobby', stars: [0, 0, 0, 0] });
  NET.players = [{ slot: 0, name: myName() || PLAYERS[0].name, online: true }];
  addBot();
  requestWake();
  hostToLobby();
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
      let free = [1, 2, 3].find(s => !used.has(s));
      if (free == null) { // 滿了的話,讓真人把電腦的位置換掉
        const b = NET.players.filter(p => p.bot).pop();
        if (b) { NET.players = NET.players.filter(p => p !== b); free = b.slot; }
      }
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
  {
    id: 'tank', emoji: '🪖', name: '坦克大戰', tag: '反應+合作', color: '#4f9d69', desc: '一起守護基地!',
    rules: ['大家同一隊!一起保護地圖下方的基地 🦅', '左邊方向鍵移動(可以滑動),右邊按鈕發射砲彈', '磚牆打得破、鐵牆打不破、水過不去、草叢可以躲', '打倒敵人得分:👾 1 分、👻 2 分、🤖 3 分(要打 3 下)', '每人 3 條命;打到隊友會讓他暫停一下,也別打到自己的基地喔!'],
    host: hTank, view: vTank,
  },
  {
    id: 'shaft', emoji: '🪜', name: '小朋友下樓梯', tag: '反應', color: '#f2994a', desc: '一直往下跳!',
    rules: ['平台會一直往上升,要往下跳到平台上,別被天花板的尖刺刺到', '在畫面任何地方按住左右滑動就能移動(沒有按鍵)', '綠色平台回血、尖刺平台扣血;還有輸送帶、彈簧和會碎掉的平台', '血量歸零或掉出畫面就出局', '下到最深樓層的人獲勝!'],
    host: hShaft, view: vShaft,
  },
  {
    id: 'volley', emoji: '🏐', name: '萌寵打排球', tag: '反應+對戰', color: '#f6c445', desc: '橫向畫面大對決!',
    rules: ['手機橫著拿!(直拿時畫面會自動轉向)', '左半邊螢幕按住左右滑動 = 移動;右下角按「跳」跳起來,在空中靠近球時按「殺」可以殺球', '球落在哪一邊的地上,另一邊就得 1 分', '2 人是 1 對 1,3~4 人分成左右兩隊', '先拿到 9 分的一隊獲勝!'],
    host: hVolley, view: vVolley,
  },
];
const GAME = Object.fromEntries(GAMES.map(g => [g.id, g]));

/* =========================================================
   畫面:首頁(手遊風格的開始選單)
   ========================================================= */
const ribbon = (text, cls = '') => `<div class="ribbon ${cls}"><span>${text}</span></div>`;

function home() {
  resetView();
  app.innerHTML = '';
  const roomParam = new URLSearchParams(location.search).get('room') || '';
  const h = el('div', 'screen home');
  h.innerHTML = `
    <div class="hbar">
      <label class="profile"><span class="ava">🐣</span>
        <input id="name" maxlength="8" placeholder="輸入你的暱稱" value="${esc(myName())}"></label>
      <div class="coin" title="累計勝場"><span>⭐</span><b>${store.get('wins', 0)}</b></div>
      <button class="iconbtn" id="mute" aria-label="音效">${S.muted ? '🔇' : '🔊'}</button>
    </div>
    <header class="logo">
      <div class="logo-t"><span class="l1">萌萌</span><span class="l2">派對</span></div>
      ${ribbon('PARTY GAMES')}
    </header>
    <div class="mascots">${PLAYERS.map(p => `<img class="mimg" src="assets/chars/${p.file}.png" alt="">`).join('')}</div>
    <nav class="menu">
      <button class="btn big green" id="solo"><span class="bi">▶</span><span class="bt">單人遊戲<small>對戰電腦</small></span></button>
      <button class="btn big yellow" id="create"><span class="bi">🏠</span><span class="bt">建立房間<small>邀請朋友一起玩</small></span></button>
      <div class="joinbox">
        <input class="field" id="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="輸入房號" value="${esc(roomParam)}">
        <button class="btn blue" id="join">加入</button>
      </div>
    </nav>
    <section class="gstrip">
      <div class="gs-t">🎮 ${GAMES.length} 款小遊戲</div>
      <div class="gs-row">${GAMES.map(g => `<div class="gs-i" style="--g:${g.color}"><span>${g.emoji}</span><b>${g.name}</b></div>`).join('')}</div>
    </section>
    <p class="tip">每人一支手機 · 2~4 人連線 · 建議連同一個 Wi-Fi<br><span class="ver">版本 ${APP_VERSION} · ${GAMES.length} 款遊戲</span></p>`;
  app.appendChild(h);

  const nameIn = $('#name', h), codeIn = $('#code', h);
  const saveName = () => store.set('name', nameIn.value.trim().slice(0, 8));
  nameIn.addEventListener('change', saveName);
  $('#create', h).addEventListener('click', () => { saveName(); createRoom(); });
  $('#solo', h).addEventListener('click', () => { saveName(); createSolo(); });
  $('#join', h).addEventListener('click', () => { saveName(); joinRoom(codeIn.value); });
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') { saveName(); joinRoom(codeIn.value); } });
  $('#mute', h).addEventListener('click', e => {
    S.muted = !S.muted;
    store.set('muted', S.muted);
    e.currentTarget.textContent = S.muted ? '🔇' : '🔊';
  });
}

function waitCard(icon, html, btnText) {
  resetView();
  app.innerHTML = '';
  const d = el('div', 'screen wait', `<div class="panel wcard"><div class="spin">${icon}</div><p>${html}</p><button class="btn white sm">${btnText}</button></div>`);
  app.appendChild(d);
  $('button', d).addEventListener('click', () => leaveRoom());
}
function showWait(msg) { waitCard('🐾', esc(msg), '取消'); }

function playerChipsHTML(withStars) {
  return NET.players.map(p => {
    const P = PLAYERS[p.slot];
    const tags = (p.bot ? '<span class="ptag">電腦</span>' : '') + (p.slot === 0 ? '<span class="ptag">房主</span>' : '') + (p.slot === NET.mySlot ? '<span class="ptag me">我</span>' : '');
    return `<div class="pchip${p.online ? '' : ' off'}" style="--c:${P.color};--soft:${P.soft}">
      <span class="pemo">${P.emoji}</span><span class="pname">${esc(p.name)}</span>${tags}
      ${withStars ? `<span class="pstar">⭐ ${NET.stars[p.slot] || 0}</span>` : ''}</div>`;
  }).join('');
}

/* ---------- 房間大廳:四個座位 + 關卡選擇 ---------- */
function seatHTML(slot) {
  const isHost = NET.role === 'host';
  const p = NET.players.find(x => x.slot === slot);
  if (!p) {
    return `<div class="seat empty${isHost ? ' can' : ''}" data-slot="${slot}">
      <div class="ava-big">${isHost ? '➕' : '💤'}</div><b class="sname">${isHost ? '加電腦' : '等待中'}</b></div>`;
  }
  const P = PLAYERS[slot];
  const tags = (p.bot ? '<span class="ptag">電腦</span>' : '') + (slot === 0 ? '<span class="ptag">房主</span>' : '') + (slot === NET.mySlot ? '<span class="ptag me">我</span>' : '');
  return `<div class="seat${p.online ? '' : ' off'}" style="--c:${P.color};--soft:${P.soft}">
    ${isHost && p.bot ? `<button class="kick" data-slot="${slot}" aria-label="移除電腦">✕</button>` : ''}
    <div class="ava-big">${P.emoji}</div><b class="sname">${esc(p.name)}</b>
    <div class="stags">${tags}</div><div class="sstar">⭐ ${NET.stars[slot] || 0}</div></div>`;
}

function lobbyView() {
  resetView();
  app.innerHTML = '';
  const isHost = NET.role === 'host';
  const enough = NET.players.filter(p => p.online).length >= 2;
  const hasBot = NET.players.some(p => p.bot);
  const d = el('div', 'screen lobby');
  d.innerHTML = `
    <div class="lbar">
      <button class="iconbtn" id="leave" aria-label="離開房間">◀</button>
      <div class="roomtag">${NET.solo ? '🤖 單人模式' : `房號<b>${esc(NET.code)}</b>`}</div>
      ${NET.solo ? '<span class="iconbtn ghost"></span>' : '<button class="iconbtn" id="share" aria-label="邀請朋友">📤</button>'}
    </div>
    <section class="panel seats">${[0, 1, 2, 3].map(seatHTML).join('')}</section>
    ${isHost && hasBot ? `<div class="lvl">電腦強度<div class="seg">${BOT_LEVELS.map((n, i) => `<button class="lv${i === NET.level ? ' on' : ''}" data-l="${i}">${n}</button>`).join('')}</div></div>` : ''}
    ${isHost ? `${ribbon(enough ? '選擇遊戲' : '至少 2 人才能開始', 'blue')}
      <section class="games">${GAMES.map(g => `
        <button class="gcard" data-g="${g.id}" style="--g:${g.color}" ${enough ? '' : 'disabled'}>
          <span class="gico">${g.emoji}</span><b>${g.name}</b><span class="tag">${g.tag}</span>
        </button>`).join('')}
      </section>` : `
      <section class="panel waiting"><div class="spin">🎲</div><p>等房主選遊戲…</p></section>`}
    ${!NET.solo && NET.players.length < 4 ? '<p class="tip">把房號告訴朋友,或按 📤 分享邀請連結</p>' : ''}`;
  app.appendChild(d);

  const sh = $('#share', d);
  if (sh) sh.addEventListener('click', shareRoom);
  $$('.seat.can', d).forEach(s => s.addEventListener('click', () => { addBot(); hostToLobby(); }));
  $$('.kick', d).forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    NET.players = NET.players.filter(p => !(p.bot && p.slot === +b.dataset.slot));
    hostToLobby();
  }));
  $$('.lv', d).forEach(b => b.addEventListener('click', () => { NET.level = +b.dataset.l; hostToLobby(); }));
  $('#leave', d).addEventListener('click', () => {
    if (!isHost || NET.solo || confirm('你是房主,離開後房間會解散,確定嗎?')) leaveRoom();
  });
  $$('.gcard', d).forEach(b => b.addEventListener('click', () => hostPickGame(b.dataset.g)));

  // 內容比螢幕長時,提示「往下滑還有更多遊戲」
  const hint = el('button', 'scrollhint', '▼ 還有更多遊戲');
  d.appendChild(hint);
  const upd = () => { hint.classList.toggle('on', d.scrollHeight - d.scrollTop - d.clientHeight > 24 && !!$('.gcard', d)); };
  hint.addEventListener('click', () => d.scrollBy({ top: d.clientHeight * 0.7, behavior: 'smooth' }));
  d.addEventListener('scroll', upd);
  setTimeout(upd, 50);
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

function busyView() { waitCard('🎮', '大家正在玩一局<br>下一局就能一起玩囉!', '🚪 離開房間'); }

/* ---------- 規則說明 ---------- */
function introView(g) {
  resetView();
  app.innerHTML = '';
  const isHost = NET.role === 'host';
  const d = el('div', 'screen intro');
  d.style.setProperty('--g', g.color);
  d.innerHTML = `
    <div class="icard">
      ${ribbon(g.name)}
      <div class="iico"><span>${g.emoji}</span></div>
      <span class="tag">${g.tag}</span>
      <ol class="rules">${g.rules.map((r, i) => `<li><i>${i + 1}</i><span>${r}</span></li>`).join('')}</ol>
      <div class="players small-chips"></div>
      ${isHost ? '<button class="btn big green go"><span class="bi">▶</span><span class="bt">開始遊戲</span></button><button class="btn white sm toback">◀ 換遊戲</button>'
    : '<p class="waittxt"><span class="spin-s">⏳</span> 等房主按開始…</p>'}
    </div>`;
  app.appendChild(d);
  introPlayers();
  if (isHost) {
    $('.go', d).addEventListener('click', () => hostStartGame(g));
    $('.toback', d).addEventListener('click', hostToLobby);
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
      v.stage(n > 0 ? `<div class="big cdn pulse">${n}</div>` : '<div class="big cdn go">GO!</div>');
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
  if (iWon) store.set('wins', store.get('wins', 0) + 1);
  const title = m.winners.length === 0 ? '沒有贏家 😆'
    : m.winners.length > 1 ? `平手!${m.winners.map(s => PLAYERS[s].emoji).join(' ')} 都贏了`
      : `${PLAYERS[m.winners[0]].emoji} ${esc(pinfo(m.winners[0]).name)} 獲勝!`;

  const d = el('div', 'screen result');
  d.innerHTML = `
    <div class="rhead"><div class="sunburst${iWon ? '' : ' dim'}"></div><div class="trophy">${iWon ? '🏆' : m.winners.length ? '👏' : '🤪'}</div></div>
    ${ribbon(iWon ? '勝利!' : '遊戲結束', iWon ? 'gold' : 'blue')}
    <h1 class="rtitle">${title}</h1>
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
      <button class="btn big green again"><span class="bi">🔁</span><span class="bt">再玩一次</span></button>
      <button class="btn big blue other"><span class="bi">🎲</span><span class="bt">選其他遊戲</span></button>` : `
      <p class="waittxt"><span class="spin-s">⏳</span> 等房主決定下一局…</p>
      <button class="btn white sm leave">🚪 離開房間</button>`}
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
  const bits = ['🎉', '⭐', '💙', '🍀', '🍬', '✨', '🎈'];
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
  H.bs = {};
  H.bc = m => { hostBroadcast(m); botsHear(H, m); };
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

  // 即時遊戲的主迴圈:依真實經過的時間補跑物理,手機卡頓時速度也不會變慢
  H.loop = (ms, fn) => {
    let acc = 0, last = performance.now();
    T.every(ms, () => {
      const now = performance.now();
      acc += Math.min(1500, now - last);
      last = now;
      for (let n = 0; acc >= ms && n < 40; n++) { fn(); acc -= ms; }
    });
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
  const color = {}, dead = { r: [], b: [] };
  let turnI = 0, idle = 0, last = null, over = false;

  const view = () => board.map(p => (!p ? null : p.up ? { c: p.c, k: p.k } : { h: 1 }));
  const left = c => board.filter(p => p && p.c === c).length;
  const bc = () => H.bc({
    t: 'g', e: 'board', cells: view(), turn: fighters[turnI], fighters, color, last,
    left: { r: left('r'), b: left('b') }, dead, idle,
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
        if (cap) dead[cap.c].push(cap.k);
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
    const grave = c => {
      const ks = [...st.dead[c]].sort((a, b) => CHESS_RANK[b] - CHESS_RANK[a]);
      return `<div class="grave"><span class="gl ${c}">${c === 'r' ? '🔴' : '⚫'} 被吃掉</span>${ks.length ? ks.map(k => `<i class="gp ${c}">${CHESS_NAME[c][k]}</i>`).join('') : '<span class="gnone">還沒有</span>'}</div>`;
    };
    V.stage(`<div class="sides">${st.fighters.map(side).join('<span class="vs">VS</span>')}</div>
      <div class="turn">${msg}</div>${note ? `<div class="small">${note}</div>` : ''}
      <div class="graves">${grave('r')}${grave('b')}</div>`);
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

/* =========================================================
   7. 坦克大戰 🪖(合作模式:大家一起守護基地 🦅)
   座標單位:地圖 208 x 208,磚塊格 8 x 8(26 x 26 格),坦克 16 x 16
   格子代碼:0 空地、1 磚牆、2 鐵牆、3 水、4 草叢、5 基地
   ========================================================= */
const TANK = { N: 26, U: 8, W: 208, S: 16, TICK: 40 };
const TANK_MAP = [
  '.............',
  '.b.b.b.b.b.b.',
  '.b.b.b.b.b.b.',
  '.b.b.bsb.b.b.',
  '.b.b.b.b.b.b.',
  'gg...b.b...gg',
  's.bb.....bb.s',
  '..ww.b.b.ww..',
  '.b.b.bbb.b.b.',
  '.b.b.b.b.b.b.',
  '.b.b.....b.b.',
  '.b.b.....b.b.',
  '.............',
];
const TDIR = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // 上 右 下 左
const ENEMY_KINDS = [
  { speed: 1.0, hp: 1, pts: 1, bullet: 4.5, color: '#8d94b8', emoji: '👾' },
  { speed: 1.9, hp: 1, pts: 2, bullet: 5.5, color: '#5fc4c9', emoji: '👻' },
  { speed: 0.75, hp: 3, pts: 3, bullet: 4.5, color: '#8b6fc4', emoji: '🤖' },
];

function tankBuildMap() {
  const N = TANK.N, c = new Uint8Array(N * N), code = { '.': 0, b: 1, s: 2, w: 3, g: 4 };
  TANK_MAP.forEach((row, r) => [...row].forEach((ch, col) => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) c[(r * 2 + dy) * N + col * 2 + dx] = code[ch] || 0;
  }));
  for (let x = 11; x <= 14; x++) c[23 * N + x] = 1; // 基地外圍的磚牆
  for (const y of [24, 25]) { c[y * N + 11] = 1; c[y * N + 14] = 1; c[y * N + 12] = 5; c[y * N + 13] = 5; }
  return c;
}

function hTank(H) {
  const { N, U, S } = TANK, MAX = TANK.W - S;
  const cells = tankBuildMap();
  const n = H.players.length;
  const P_SPAWN = [64, 128, 32, 160], E_SPAWN = [0, 96, 192];
  const maxOn = Math.min(6, 2 + n);
  let tanks = [], bullets = [], nextId = 1, tick = 0, over = false, baseAlive = true;
  let toSpawn = 6 + 4 * n, spawnI = 0, spawnCd = 20, brk = [], fx = [];
  const lives = {}, respawnAt = {}, ctrl = {};
  H.players.forEach(s => { lives[s] = 3; respawnAt[s] = 0; ctrl[s] = { dir: -1, fire: false }; });
  const startAt = Date.now();
  const r1 = v => Math.round(v * 10) / 10;

  const cellAt = (cx, cy) => (cx < 0 || cy < 0 || cx >= N || cy >= N ? -1 : cells[cy * N + cx]);
  const overlap = (a, b, as, bs) => a.x < b.x + bs && b.x < a.x + as && a.y < b.y + bs && b.y < a.y + as;
  function rectHits(x, y, w, h, fn) {
    for (let cy = Math.floor(y / U); cy <= Math.floor((y + h - 0.01) / U); cy++)
      for (let cx = Math.floor(x / U); cx <= Math.floor((x + w - 0.01) / U); cx++) fn(cx, cy, cellAt(cx, cy));
  }
  function freeFor(t, x, y) {
    if (x < 0 || y < 0 || x > MAX || y > MAX) return false;
    let ok = true;
    rectHits(x, y, S, S, (cx, cy, v) => { if (v === 1 || v === 2 || v === 3 || v === 5) ok = false; });
    if (!ok) return false;
    // 已經重疊的坦克(例如剛出生)允許分開
    return !tanks.some(o => o !== t && !o.dead && overlap({ x, y }, o, S, S) && !overlap(t, o, S, S));
  }
  const spawnFree = (x, y) => !tanks.some(o => !o.dead && overlap({ x, y }, o, S, S));
  function addTank(o) {
    const t = { id: nextId++, d: 0, bullet: null, cd: 0, shield: 0, stun: 0, hit: 0, ai: 0, blocked: false, dead: false, ...o };
    tanks.push(t);
    return t;
  }
  function spawnPlayer(s) {
    const x = P_SPAWN[H.players.indexOf(s)];
    if (!spawnFree(x, 192)) return;
    addTank({ x, y: 192, slot: s, kind: -1, speed: 1.5, hp: 1, shield: 75, bspeed: 5 });
  }
  function move(t, d) {
    if (d !== t.d) {
      const vert = d % 2 === 0;
      if (vert !== (t.d % 2 === 0)) {
        // 轉彎時對齊格線,才鑽得進 16 寬的走道
        const sx = vert ? Math.round(t.x / U) * U : t.x, sy = vert ? t.y : Math.round(t.y / U) * U;
        if (freeFor(t, sx, sy)) { t.x = sx; t.y = sy; }
      }
      t.d = d;
    }
    const [dx, dy] = TDIR[d];
    let moved = false;
    for (let s = 0; s < t.speed - 1e-6; s += 0.5) {
      const step = Math.min(0.5, t.speed - s);
      const nx = t.x + dx * step, ny = t.y + dy * step;
      if (!freeFor(t, nx, ny)) break;
      t.x = nx; t.y = ny; moved = true;
    }
    return moved;
  }
  function fire(t) {
    if (t.bullet || t.cd > 0) return;
    const [dx, dy] = TDIR[t.d];
    const b = { x: t.x + S / 2 - 2 + dx * 8, y: t.y + S / 2 - 2 + dy * 8, d: t.d, v: t.bspeed, owner: t, dead: false };
    bullets.push(b);
    t.bullet = b;
    t.cd = t.slot != null ? 6 : 20;
  }
  function killBullet(b, pop) {
    b.dead = true;
    if (b.owner.bullet === b) b.owner.bullet = null;
    if (pop) fx.push(['p', r1(b.x + 2), r1(b.y + 2)]);
  }
  function breakCell(cx, cy) {
    if (cellAt(cx, cy) === 1) { cells[cy * N + cx] = 0; brk.push(cy * N + cx); }
  }
  function hitWalls(b) {
    let hit = false, base = false;
    const bricks = [];
    rectHits(b.x, b.y, 4, 4, (cx, cy, v) => {
      if (v === -1 || v === 2) hit = true;
      else if (v === 1) { hit = true; bricks.push([cx, cy]); }
      else if (v === 5) { hit = true; base = true; }
    });
    if (base && baseAlive) { baseAlive = false; fx.push(['b', 104, 200]); }
    const vert = b.d % 2 === 0, mx = b.x + 2, my = b.y + 2;
    bricks.forEach(([cx, cy]) => {
      // 一發砲彈打掉約一個坦克寬的磚
      if (vert) for (let x = Math.floor((mx - 7) / U); x <= Math.floor((mx + 7) / U); x++) breakCell(x, cy);
      else for (let y = Math.floor((my - 7) / U); y <= Math.floor((my + 7) / U); y++) breakCell(cx, y);
    });
    return hit;
  }
  function killTank(t) {
    t.dead = true;
    fx.push(['x', r1(t.x + 8), r1(t.y + 8)]);
    if (t.slot != null) { lives[t.slot]--; respawnAt[t.slot] = tick + 40; }
  }
  function hitTanks(b) {
    const o = b.owner, fromP = o.slot != null;
    for (const t of tanks) {
      if (t === o || t.dead || !overlap(b, t, 4, S)) continue;
      const toP = t.slot != null;
      if (!fromP && !toP) continue; // 敵人不會打到自己人
      if (fromP && toP) { if (!t.shield) t.stun = 40; return true; } // 打到隊友:暫停一下
      if (fromP) {
        t.hp--;
        if (t.hp <= 0) { killTank(t); H.add(o.slot, ENEMY_KINDS[t.kind].pts); }
        else t.hit = 4;
        return true;
      }
      if (!t.shield) killTank(t);
      return true;
    }
    return false;
  }
  function chooseDir(t) {
    const r = Math.random();
    if (r < 0.35) return 2;
    if (r < 0.55) return t.x < 96 ? 1 : 3;
    if (r < 0.7) {
      const ps = tanks.filter(o => o.slot != null && !o.dead);
      if (ps.length) {
        const p = pick(ps), dx = p.x - t.x, dy = p.y - t.y;
        return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
      }
    }
    return rand(0, 3);
  }
  function ai(t) {
    if (--t.ai <= 0 || t.blocked) { t.goal = chooseDir(t); t.ai = rand(15, 50); }
    t.blocked = !move(t, t.goal == null ? 2 : t.goal);
    if (!t.bullet && Math.random() < 0.035) fire(t);
  }

  const state = () => ({
    t: 'g', e: 's',
    tk: tanks.map(t => [t.id, r1(t.x), r1(t.y), t.d, t.slot == null ? -1 : t.slot, t.kind, (t.shield ? 1 : 0) | (t.stun ? 2 : 0) | (t.hit ? 4 : 0)]),
    bl: bullets.map(b => [r1(b.x), r1(b.y)]),
    br: brk, fx,
    en: toSpawn + tanks.filter(t => t.slot == null).length,
    lv: lives, base: baseAlive ? 1 : 0,
  });

  function checkEnd() {
    let res = null;
    if (!baseAlive) res = { win: false, reason: '基地被攻破了!' };
    else if (toSpawn === 0 && !tanks.some(t => t.slot == null)) res = { win: true, reason: '打倒所有敵人,守住基地了!' };
    else if (H.players.every(s => !H.online(s) || lives[s] <= 0) && !tanks.some(t => t.slot != null)) res = { win: false, reason: '大家都被打倒了…' };
    else if (Date.now() - startAt > 300000) res = { win: false, reason: '時間到!' };
    if (res) {
      over = true;
      H.bc({ t: 'g', e: 'over', ...res });
      H.s.after(3000, H.finish);
    }
  }

  function step() {
    if (over) return;
    tick++;
    brk = [];
    fx = [];
    H.players.forEach(s => {
      if (H.online(s) && lives[s] > 0 && tick >= respawnAt[s] && !tanks.some(t => t.slot === s)) spawnPlayer(s);
    });
    if (--spawnCd <= 0 && toSpawn > 0 && tanks.filter(t => t.slot == null).length < maxOn) {
      const x = E_SPAWN[spawnI++ % 3];
      if (spawnFree(x, 0)) {
        const kind = Math.random() < 0.6 ? 0 : Math.random() < 0.6 ? 1 : 2, K = ENEMY_KINDS[kind];
        addTank({ x, y: 0, d: 2, slot: null, kind, speed: K.speed, hp: K.hp, bspeed: K.bullet });
        toSpawn--;
        spawnCd = 55;
      } else spawnCd = 10;
    }
    for (const t of tanks) {
      if (t.cd > 0) t.cd--;
      if (t.shield > 0) t.shield--;
      if (t.hit > 0) t.hit--;
      if (t.slot == null) { ai(t); continue; }
      if (t.stun > 0) { t.stun--; continue; }
      const c = ctrl[t.slot];
      if (c.dir >= 0) move(t, c.dir);
      if (c.fire) fire(t);
    }
    for (const b of bullets) {
      if (b.dead) continue;
      const k = Math.ceil(b.v / 2), st = b.v / k, [dx, dy] = TDIR[b.d];
      for (let i = 0; i < k; i++) {
        b.x += dx * st;
        b.y += dy * st;
        if (hitWalls(b)) { killBullet(b, true); break; }
        if (hitTanks(b)) { killBullet(b, false); break; }
      }
    }
    for (let i = 0; i < bullets.length; i++) for (let j = i + 1; j < bullets.length; j++) {
      const a = bullets[i], c = bullets[j];
      if (!a.dead && !c.dead && a.owner !== c.owner && overlap(a, c, 4, 4)) { killBullet(a, true); killBullet(c, false); }
    }
    bullets = bullets.filter(b => !b.dead);
    tanks = tanks.filter(t => !t.dead);
    H.bc(state());
    checkEnd();
  }

  H.bc({ t: 'g', e: 'map', cells: cells.join('') });
  H.players.forEach(spawnPlayer);
  H.bc(state());

  return {
    start() { H.loop(TANK.TICK, step); },
    input(slot, m) {
      if (m.e === 'dir') ctrl[slot].dir = [0, 1, 2, 3].includes(m.d) ? m.d : -1;
      else if (m.e === 'f') ctrl[slot].fire = !!m.on;
    },
    presence() {
      H.players.forEach(s => {
        if (H.online(s)) return;
        lives[s] = 0;
        tanks.forEach(t => { if (t.slot === s) t.dead = true; });
      });
      tanks = tanks.filter(t => !t.dead);
    },
  };
}

function vTank(V) {
  const sin = $('.sin', V.root);
  sin.innerHTML = '<div class="twrap"><canvas class="tcv"></canvas><div class="tov"></div></div><div class="hud"></div>';
  const wrap = $('.twrap', sin), cv = $('.tcv', sin), ov = $('.tov', sin), hud = $('.hud', sin);
  const ctx = cv.getContext('2d');
  V.pad.innerHTML = `
    <div class="dpad">${['up', 'right', 'down', 'left'].map((c, i) => `<div class="dp ${c}" data-d="${i}">${'▲▶▼◀'[i]}</div>`).join('')}<div class="dpc"></div></div>
    <button class="firebtn">💥<span>發射</span></button>
    <button class="hidebtn"></button>
    <div class="zhint zl">⬅ 左半邊按住滑動<br>上下左右移動</div>
    <div class="zhint zr">右半邊按住<br>發射 💥</div>`;
  const dpad = $('.dpad', V.pad), fireBtn = $('.firebtn', V.pad), hideBtn = $('.hidebtn', V.pad);
  const stageEl = $('.stage', V.root);

  let cells = null, prev = new Map(), cur = new Map(), curAt = 0, bl = [], st = null, hudTxt = '';
  const fxs = [];

  /* 隱藏按鈕:左半邊滑動 = 方向,右半邊按住 = 發射 */
  let hidden = store.get('tankHide', false);
  function applyHide() {
    V.root.classList.toggle('hideCtl', hidden);
    hideBtn.textContent = hidden ? '👁 顯示按鈕' : '🙈 隱藏按鈕';
    if (!hidden) { setDir(-1); setFire(false); }
    fit();
  }
  hideBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    hidden = !hidden;
    store.set('tankHide', hidden);
    applyHide();
  });

  /* 依舞台大小調整成正方形畫布 */
  function fit() {
    const top = $('.topbar', V.root).offsetHeight;
    if (hidden) { // 隱藏按鈕:整張地圖貼齊螢幕左右邊緣,盡量放大
      const size = Math.max(100, Math.floor(Math.min(V.root.clientWidth - 14, V.root.clientHeight - top - 116 - hud.offsetHeight)));
      wrap.style.width = wrap.style.height = size + 'px';
      return;
    }
    // 先決定地圖大小,剩下的高度都給操作區
    const h = V.root.clientHeight - top - V.root.clientHeight * (hidden ? 0.16 : 0.26) - 50 - hud.offsetHeight;
    const size = Math.max(100, Math.floor(Math.min(stageEl.clientWidth - 12, h)));
    wrap.style.width = wrap.style.height = size + 'px';
  }
  const ro = new ResizeObserver(fit);
  ro.observe(V.root);
  fit();

  V.countdown = n => {
    ov.innerHTML = n > 0 ? `<div class="big cdn pulse">${n}</div>` : '<div class="big cdn">出發!</div>';
    ov.classList.add('on');
    if (n > 0) SFX.tick();
    else { SFX.go(); setTimeout(() => ov.classList.remove('on'), 700); }
  };

  /* ---- 操作:方向鍵(可滑動)+ 發射鈕 ---- */
  let dir = -1, dpId = null;
  function setDir(d) {
    if (d === dir) return;
    dir = d;
    $$('.dp', dpad).forEach(x => x.classList.toggle('on', +x.dataset.d === d));
    V.send({ e: 'dir', d });
  }
  function dirFrom(e) {
    const r = dpad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.12) return setDir(-1);
    setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  }
  dpad.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    dpId = e.pointerId;
    try { dpad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    dirFrom(e);
  });
  dpad.addEventListener('pointermove', e => { if (e.pointerId === dpId) dirFrom(e); });
  const dpEnd = e => { if (e.pointerId === dpId) { dpId = null; setDir(-1); } };
  dpad.addEventListener('pointerup', dpEnd);
  dpad.addEventListener('pointercancel', dpEnd);

  let firing = false;
  function setFire(on) {
    if (on === firing) return;
    firing = on;
    fireBtn.classList.toggle('on', on);
    V.send({ e: 'f', on });
    if (on) SFX.tap();
  }
  fireBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    try { fireBtn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    setFire(true);
  });
  fireBtn.addEventListener('pointerup', () => setFire(false));
  fireBtn.addEventListener('pointercancel', () => setFire(false));

  /* 隱藏模式的觸控:整個畫面分左右兩半 */
  let stickId = null, stickX = 0, stickY = 0, fireId = null;
  V.root.addEventListener('pointerdown', e => {
    if (!hidden || e.target.closest('.exit, .hidebtn, .chips')) return;
    e.preventDefault();
    try { V.root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const rr = V.root.getBoundingClientRect();
    if (e.clientX < rr.left + rr.width / 2) {
      if (stickId == null) { stickId = e.pointerId; stickX = e.clientX; stickY = e.clientY; }
    } else if (fireId == null) { fireId = e.pointerId; setFire(true); }
  });
  V.root.addEventListener('pointermove', e => {
    if (!hidden || e.pointerId !== stickId) return;
    const dx = e.clientX - stickX, dy = e.clientY - stickY, d = Math.hypot(dx, dy);
    if (d > 70) { // 搖桿跟著手指走,不用回到原點就能換方向
      stickX += dx / d * (d - 70);
      stickY += dy / d * (d - 70);
    }
    if (d < 14) return setDir(-1);
    setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  });
  const rootEnd = e => {
    if (e.pointerId === stickId) { stickId = null; setDir(-1); }
    if (e.pointerId === fireId) { fireId = null; setFire(false); }
  };
  V.root.addEventListener('pointerup', rootEnd);
  V.root.addEventListener('pointercancel', rootEnd);
  applyHide();

  /* 電腦也能玩:方向鍵 + 空白鍵 */
  const KEYS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 };
  const onKey = e => {
    if (!cv.isConnected) { removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); return; }
    const down = e.type === 'keydown';
    if (e.key === ' ') { e.preventDefault(); setFire(down); }
    else if (e.key in KEYS) { e.preventDefault(); if (down) setDir(KEYS[e.key]); else if (dir === KEYS[e.key]) setDir(-1); }
  };
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKey);

  /* ---- 繪圖 ---- */
  let sc = 1, ox = 0, oy = 0, camX = 104, camY = 104;
  const ZOOM = 1; // 1 = 看得到整張地圖
  function emoji(ch, x, y, size) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${Math.round(size * sc)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillStyle = '#000'; // 彩色 emoji 會吃到填色的透明度,先設成不透明
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x * sc + ox, y * sc + oy);
    ctx.restore();
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fill();
  }
  function drawCell(v, x, y, now) {
    if (v === 1) {
      ctx.fillStyle = '#eba36f';
      ctx.fillRect(x, y, 8, 8);
      ctx.fillStyle = '#c47a4a';
      const odd = (y / 8) % 2;
      ctx.fillRect(x, y + 3.6, 8, 0.8);
      ctx.fillRect(x + (odd ? 2 : 5), y, 0.8, 3.6);
      ctx.fillRect(x + (odd ? 5 : 2), y + 4.4, 0.8, 3.6);
    } else if (v === 2) {
      ctx.fillStyle = '#a9b4c9';
      ctx.fillRect(x, y, 8, 8);
      ctx.fillStyle = '#e4eaf4';
      ctx.fillRect(x + 1.5, y + 1.5, 5, 5);
    } else if (v === 3) {
      ctx.fillStyle = '#4ea8e6';
      ctx.fillRect(x, y, 8, 8);
      ctx.fillStyle = '#a5d8ff';
      ctx.fillRect(x + 1 + Math.sin(now / 400 + x) * 1.2, y + 2.5, 4, 0.9);
      ctx.fillRect(x + 3 + Math.cos(now / 400 + y) * 1.2, y + 5.5, 3, 0.9);
    }
  }
  function drawTank(x, y, d, color, face, flags, isMe, now) {
    ctx.save();
    ctx.translate(x + 8, y + 8);
    if ((flags & 2) && Math.floor(now / 120) % 2) ctx.globalAlpha = 0.35;
    if (isMe) {
      ctx.fillStyle = 'rgba(255,230,90,.35)';
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.rotate(d * Math.PI / 2);
    ctx.fillStyle = '#3d4258';
    rr(-8, -7.5, 4, 15, 1.5);
    rr(4, -7.5, 4, 15, 1.5);
    ctx.fillStyle = '#6b7190';
    for (let i = -6; i < 7; i += 3) { ctx.fillRect(-7.5, i, 3, 0.7); ctx.fillRect(4.5, i, 3, 0.7); }
    ctx.fillStyle = (flags & 4) ? '#ffffff' : color;
    rr(-5, -6, 10, 12, 3);
    ctx.fillStyle = '#4a4f68';
    rr(-1.3, -9.5, 2.6, 7, 1);
    ctx.restore();
    if (typeof face === 'number') {
      const im = CHAR_IMG[face].head;
      if (im.complete && im.naturalWidth) { const hh = 11.5, ww = hh * im.naturalWidth / im.naturalHeight; ctx.drawImage(im, x + 8 - ww / 2, y + 8.6 - hh / 2, ww, hh); }
    } else emoji(face, x + 8, y + 8.6, 8.5);
    if (flags & 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.lineDashOffset = -now / 60;
      ctx.beginPath();
      ctx.arc(x + 8, y + 8, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  function draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(cv.clientWidth * dpr), ph = Math.round(cv.clientHeight * dpr);
    if (pw && ph && (cv.width !== pw || cv.height !== ph)) { cv.width = pw; cv.height = ph; }
    const now = performance.now();
    if (hidden) {
      sc = cv.width / (TANK.W / ZOOM);
      const mine = cur.get([...cur.keys()].find(id => cur.get(id)[4] === V.me));
      const tx = mine ? mine[1] + 8 : 104, ty = mine ? mine[2] + 8 : 140;
      camX += (tx - camX) * 0.25;
      camY += (ty - camY) * 0.25;
      const vw = cv.width / sc, vh = cv.height / sc;
      const cx = vw >= TANK.W ? TANK.W / 2 : Math.max(vw / 2, Math.min(TANK.W - vw / 2, camX));
      const cy = vh >= TANK.W ? TANK.W / 2 : Math.max(vh / 2, Math.min(TANK.W - vh / 2, camY));
      ox = cv.width / 2 - cx * sc;
      oy = cv.height / 2 - cy * sc;
    } else {
      sc = cv.width / TANK.W;
      ox = oy = 0;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1e2338';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(sc, 0, 0, sc, ox, oy);
    ctx.fillStyle = '#2f3550';
    ctx.fillRect(0, 0, TANK.W, TANK.W);
    if (!cells) return;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (v && v !== 4 && v !== 5) drawCell(v, (i % TANK.N) * 8, Math.floor(i / TANK.N) * 8, now);
    }
    emoji(st && !st.base ? '💀' : '🦅', 104, 200.5, 14);

    const a = Math.min(1, (now - curAt) / TANK.TICK);
    cur.forEach(t => {
      const [id, x, y, d, slot, kind, flags] = t;
      const p = prev.get(id);
      let dx = x, dy = y;
      if (p && Math.abs(p[1] - x) + Math.abs(p[2] - y) < 12) { dx = p[1] + (x - p[1]) * a; dy = p[2] + (y - p[2]) * a; }
      if (slot >= 0) drawTank(dx, dy, d, PLAYERS[slot].color, slot, flags, slot === V.me, now);
      else drawTank(dx, dy, d, ENEMY_KINDS[kind].color, ENEMY_KINDS[kind].emoji, flags, false, now);
    });
    ctx.fillStyle = '#fff6b0';
    ctx.strokeStyle = '#e0a400';
    ctx.lineWidth = 0.6;
    bl.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x + 2, y + 2, 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });

    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== 4) continue;
      const x = (i % TANK.N) * 8, y = Math.floor(i / TANK.N) * 8;
      ctx.fillStyle = '#4fbf73';
      ctx.beginPath();
      ctx.arc(x + 4, y + 4, 4.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7fdc98';
      ctx.beginPath();
      ctx.arc(x + 3, y + 3, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = fxs.length - 1; i >= 0; i--) {
      const f = fxs[i], age = now - f.t;
      const life = f.k === 'p' ? 220 : f.k === 'x' ? 450 : 900;
      if (age > life) { fxs.splice(i, 1); continue; }
      if (f.k === 'p') {
        ctx.fillStyle = `rgba(255,200,80,${1 - age / life})`;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 2 + age / 40, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.globalAlpha = 1 - age / life;
        emoji('💥', f.x, f.y, (f.k === 'x' ? 12 : 22) + age / 30);
        ctx.restore();
      }
    }
  }
  const loop = () => {
    if (!cv.isConnected) { ro.disconnect(); return; }
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  function updateHud() {
    const meAlive = st.tk.some(t => t[4] === V.me);
    const parts = V.players.map(s => `<span style="--c:${PLAYERS[s].color}">${PLAYERS[s].emoji}❤️${Math.max(0, st.lv[s] || 0)}</span>`);
    let txt = `<span>👾 ×${st.en}</span>${parts.join('')}`;
    if (!meAlive && (st.lv[V.me] || 0) <= 0) txt += '<span class="dead">👻 你陣亡了,幫隊友加油!</span>';
    if (txt !== hudTxt) { hudTxt = txt; hud.innerHTML = txt; fit(); }
  }

  V.on = m => {
    if (m.e === 'map') {
      cells = Uint8Array.from(m.cells, ch => +ch);
    } else if (m.e === 's') {
      prev = cur;
      cur = new Map(m.tk.map(t => [t[0], t]));
      curAt = performance.now();
      bl = m.bl;
      st = m;
      if (cells) m.br.forEach(i => { cells[i] = 0; });
      m.fx.forEach(f => {
        fxs.push({ k: f[0], x: f[1], y: f[2], t: performance.now() });
        if (f[0] !== 'p') { beep(110, 0.3, 'sawtooth', 0.07); beep(60, 0.4, 'square', 0.05, 0.05); }
      });
      updateHud();
    } else if (m.e === 'over') {
      ov.innerHTML = `<div class="big">${m.win ? '🏆' : '💔'}</div><div>${m.reason}</div>`;
      ov.classList.add('on');
      if (m.win) SFX.win(); else SFX.bad();
      setDir(-1);
      setFire(false);
    }
  };
}

/* =========================================================
   共用:畫布遊戲的舞台(依比例縮放、倒數蓋板、按住按鈕、鍵盤)
   ========================================================= */
function canvasStage(V, aspect, fill) {
  const sin = $('.sin', V.root), stageEl = $('.stage', V.root);
  sin.innerHTML = '<div class="twrap"><canvas class="tcv"></canvas><div class="tov"></div></div><div class="hud"></div>';
  const wrap = $('.twrap', sin), cv = $('.tcv', sin), ov = $('.tov', sin), hud = $('.hud', sin);
  const C = { cv, ctx: cv.getContext('2d'), ov, hud, sc: 1, ox: 0, oy: 0 };
  C.fit = () => {
    const w = stageEl.clientWidth - 10, h = stageEl.clientHeight - 10 - hud.offsetHeight - 4;
    if (fill) { // 撐滿整個舞台(畫面比例不同時,背景往兩側延伸)
      wrap.style.width = Math.max(60, Math.floor(w)) + 'px';
      wrap.style.height = Math.max(40, Math.floor(h)) + 'px';
      return;
    }
    let cw = w, ch = w / aspect;
    if (ch > h) { ch = h; cw = h * aspect; }
    wrap.style.width = Math.max(60, Math.floor(cw)) + 'px';
    wrap.style.height = Math.max(40, Math.floor(ch)) + 'px';
  };
  const ro = new ResizeObserver(C.fit);
  ro.observe(stageEl);
  C.fit();
  C.alive = () => { if (cv.isConnected) return true; ro.disconnect(); return false; };
  C.size = worldW => { // 依實際像素調整畫布大小,之後用世界座標畫圖
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(cv.clientWidth * dpr), ph = Math.round(cv.clientHeight * dpr);
    if (pw && ph && (cv.width !== pw || cv.height !== ph)) { cv.width = pw; cv.height = ph; }
    C.sc = cv.width / worldW;
    C.ox = C.oy = 0;
    C.ctx.setTransform(C.sc, 0, 0, C.sc, 0, 0);
  };
  C.emoji = (ch, x, y, size, rot) => {
    const ctx = C.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, x * C.sc + C.ox, y * C.sc + C.oy);
    if (rot) ctx.rotate(rot);
    ctx.font = `${Math.round(size * C.sc)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillStyle = '#000'; // 彩色 emoji 會吃到填色的透明度,先設成不透明
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  };
  C.char = (slot, x, y, h, head, bottom) => { // 畫角色圖片:(x, y) 是中心,bottom 時 y 是腳底
    const im = CHAR_IMG[slot][head ? 'head' : 'full'];
    if (!im.complete || !im.naturalWidth) return;
    const w = h * im.naturalWidth / im.naturalHeight, ctx = C.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(im, x * C.sc + C.ox - w * C.sc / 2, y * C.sc + C.oy - (bottom ? h * C.sc : h * C.sc / 2), w * C.sc, h * C.sc);
    ctx.restore();
  };
  C.rr = (x, y, w, h, r) => {
    const ctx = C.ctx;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fill();
  };
  let ovTok = 0;
  C.overlay = (html, ms) => {
    const tok = ++ovTok;
    ov.innerHTML = html;
    ov.classList.add('on');
    if (ms) setTimeout(() => { if (tok === ovTok) ov.classList.remove('on'); }, ms);
  };
  V.countdown = n => {
    C.overlay(n > 0 ? `<div class="big cdn pulse">${n}</div>` : '<div class="big cdn go">GO!</div>', n > 0 ? 0 : 700);
    if (n > 0) SFX.tick(); else SFX.go();
  };
  return C;
}

function holdBtn(btn, on, off) {
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    btn.classList.add('on');
    on();
  });
  const up = () => {
    if (!btn.classList.contains('on')) return;
    btn.classList.remove('on');
    if (off) off();
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
}

function keyCtl(cv, map) {
  const h = e => {
    if (!cv.isConnected) { removeEventListener('keydown', h); removeEventListener('keyup', h); return; }
    const f = map[e.key];
    if (!f) return;
    e.preventDefault();
    if (e.repeat) return;
    const fn = e.type === 'keydown' ? f[0] : f[1];
    if (fn) fn();
  };
  addEventListener('keydown', h);
  addEventListener('keyup', h);
}

/* 橫向遊戲:手機直拿時把整個遊戲畫面轉 90 度,撐滿螢幕 */
function landscape(V) {
  document.body.classList.add('wide');
  const apply = () => {
    if (!V.root.isConnected) { removeEventListener('resize', apply); return; }
    const portrait = innerHeight > innerWidth;
    V.root.classList.toggle('rot', portrait);
    V.root.style.width = portrait ? innerHeight + 'px' : '';
    V.root.style.height = portrait ? innerWidth + 'px' : '';
  };
  addEventListener('resize', apply);
  apply();
}

/* =========================================================
   8. 小朋友下樓梯 🪜(大家在同一個豎井裡往下跳)
   座標:寬 240 x 高 320;平台種類 0 一般 1 尖刺 2 左輸送帶 3 右輸送帶 4 彈簧 5 會碎
   ========================================================= */
const SHAFT = { W: 240, H: 320, PW: 16, PH: 20, LW: 60, LH: 8, TICK: 40 };

function hShaft(H) {
  const { W, PW, PH, LW, LH } = SHAFT, VH = SHAFT.H, dt = SHAFT.TICK / 1000;
  const r1 = v => Math.round(v * 10) / 10;
  let plats = [], nextId = 1, t = 0, dist = 0, over = false, lastY = 0, fx = [];

  function addPlat(y, type) {
    if (type == null) {
      const r = Math.random();
      type = r < 0.45 ? 0 : r < 0.6 ? 1 : r < 0.7 ? 2 : r < 0.8 ? 3 : r < 0.9 ? 4 : 5;
    }
    plats.push({ id: nextId++, x: rand(0, W - LW), y, w: LW, type, broke: false });
    lastY = y;
  }
  plats.push({ id: nextId++, x: W / 2 - LW, y: 150, w: LW * 2, type: 0, broke: false }); // 起點
  lastY = 150;
  while (lastY < VH + 20) addPlat(lastY + rand(48, 66), Math.random() < 0.7 ? 0 : undefined);

  const ps = H.players.map((s, i) => ({ s, x: W / 2 - LW + 8 + i * 30, y: 150 - PH, vy: 0, hp: 10, alive: true, on: null, drop: 0, stand: 0, ctl: 0 }));
  ps.forEach(p => { p.on = plats[0]; });
  const floorNow = () => Math.floor(dist / 55);

  function kill(p) {
    p.alive = false;
    H.scores[p.s] = floorNow();
    fx.push(['x', r1(p.x + PW / 2), r1(Math.min(VH - 12, Math.max(12, p.y + PH / 2)))]);
  }
  const state = () => ({
    t: 'g', e: 's',
    pl: plats.map(q => [q.id, r1(q.x), r1(q.y), q.type, q.w]),
    ps: ps.map(p => [p.s, r1(p.x), r1(p.y), Math.max(0, p.hp), p.alive ? 1 : 0]),
    fl: floorNow(), fx,
  });
  function end(reason) {
    over = true;
    ps.forEach(p => { if (p.alive) H.scores[p.s] = floorNow(); });
    H.bc({ t: 'score', scores: H.scores });
    H.bc({ t: 'g', e: 'over', reason, fl: floorNow() });
    H.s.after(2800, H.finish);
  }

  function step() {
    if (over) return;
    fx = [];
    t += dt;
    const rise = Math.min(100, 42 + t * 0.7) * dt; // 越來越快
    dist += rise;
    plats.forEach(q => { q.y -= rise; });
    lastY -= rise;
    plats = plats.filter(q => !q.broke && q.y > -LH);
    while (lastY < VH + 20) addPlat(lastY + rand(48, 68));

    for (const p of ps) {
      if (!p.alive) continue;
      if (!H.online(p.s)) { kill(p); continue; }
      let push = 0;
      if (p.on && (p.on.broke || !plats.includes(p.on) || p.x + PW <= p.on.x || p.x >= p.on.x + p.on.w)) p.on = null;
      if (p.on) {
        p.y = p.on.y - PH;
        p.vy = 0;
        if (p.on.type === 2) push = -55;
        else if (p.on.type === 3) push = 55;
        else if (p.on.type === 5 && (p.stand += dt) > 0.35) {
          p.on.broke = true;
          fx.push(['c', r1(p.on.x + p.on.w / 2), r1(p.on.y)]);
          p.on = null;
        }
      } else {
        p.vy = Math.min(380, p.vy + 900 * dt);
        let ny = p.y + p.vy * dt;
        if (p.drop <= 0 && p.vy >= 0) {
          for (const q of plats) {
            if (q.broke || p.x + PW <= q.x + 2 || p.x >= q.x + q.w - 2) continue;
            if (p.y + PH <= q.y + rise + 1 && ny + PH >= q.y) { // 這一步剛好落到平台上
              ny = q.y - PH;
              p.vy = 0;
              p.on = q;
              p.stand = 0;
              if (q.type === 1) { p.hp -= 4; fx.push(['h', r1(p.x + PW / 2), r1(q.y)]); }
              else p.hp = Math.min(10, p.hp + 1);
              if (q.type === 4) { p.vy = -310; p.on = null; fx.push(['s', r1(p.x + PW / 2), r1(q.y)]); }
              break;
            }
          }
        }
        p.y = ny;
      }
      p.x = Math.max(0, Math.min(W - PW, p.x + (p.ctl * 130 + push) * dt));
      if (p.drop > 0) p.drop -= dt;
      if (p.y < 14) { // 撞到天花板的尖刺,會從平台上掉下去
        p.hp -= 4;
        p.y = 16;
        p.vy = 60;
        p.on = null;
        p.drop = 0.35;
        fx.push(['h', r1(p.x + PW / 2), 16]);
      }
      if (p.hp <= 0 || p.y > VH) kill(p);
    }
    H.bc(state());
    if (ps.every(p => !p.alive)) end('大家都掉下去了!');
    else if (t > 180) end('時間到!');
  }

  H.bc(state());
  return {
    start() {
      H.loop(SHAFT.TICK, step);
      H.s.every(1000, () => {
        if (over) return;
        ps.forEach(p => { if (p.alive) H.scores[p.s] = floorNow(); });
        H.bc({ t: 'score', scores: H.scores });
      });
    },
    input(slot, m) {
      const p = ps.find(x => x.s === slot);
      if (p && m.e === 'mv') p.ctl = [-1, 0, 1].includes(m.d) ? m.d : 0;
    },
  };
}

function vShaft(V) {
  const { W, PW, PH, TICK } = SHAFT, VH = SHAFT.H;
  const C = canvasStage(V, W / VH), ctx = C.ctx;
  V.pad.innerHTML = '';
  const held = new Set();
  let dir = 0;
  const upd = () => {
    const d = (held.has(1) ? 1 : 0) - (held.has(-1) ? 1 : 0);
    if (d !== dir) { dir = d; V.send({ e: 'mv', d }); }
  };
  // 沒有實體按鍵:在畫面任何地方按住左右滑動就會移動(虛擬搖桿跟著手指走)
  const hint = el('div', 'shint', '👆 在畫面上左右滑動 = 移動');
  const ring = el('div', 'vring', '<i></i>');
  V.root.appendChild(hint);
  V.root.appendChild(ring);
  let stickId = null, sx0 = 0;
  V.root.addEventListener('pointerdown', e => {
    if (stickId != null || e.target.closest('.exit')) return;
    e.preventDefault();
    try { V.root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const r = V.root.getBoundingClientRect();
    stickId = e.pointerId; sx0 = e.clientX;
    ring.style.left = (e.clientX - r.left) + 'px'; ring.style.top = (e.clientY - r.top) + 'px';
    ring.style.setProperty('--dx', '0px');
    ring.classList.add('on');
    V.root.classList.add('used');
  });
  V.root.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return;
    if (Math.abs(e.clientX - sx0) > 46) sx0 = e.clientX - Math.sign(e.clientX - sx0) * 46;
    const dx = e.clientX - sx0;
    ring.style.setProperty('--dx', Math.max(-26, Math.min(26, dx * 0.6)) + 'px');
    const d = dx > 8 ? 1 : dx < -8 ? -1 : 0;
    held.clear();
    if (d) held.add(d);
    upd();
  });
  const stickEnd = e => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    ring.classList.remove('on');
    held.clear();
    upd();
  };
  V.root.addEventListener('pointerup', stickEnd);
  V.root.addEventListener('pointercancel', stickEnd);
  const k = d => [() => { held.add(d); upd(); }, () => { held.delete(d); upd(); }];
  keyCtl(C.cv, { ArrowLeft: k(-1), ArrowRight: k(1), a: k(-1), d: k(1) });

  let prev = new Map(), cur = new Map(), prevP = new Map(), st = null, curAt = 0, hudTxt = '';
  const fxs = [];

  function drawPlat(x, y, w, type, now) {
    if (type === 0) {
      ctx.fillStyle = '#5fc46a'; C.rr(x, y, w, 8, 3);
      ctx.fillStyle = '#a5ec9b'; ctx.fillRect(x + 3, y + 1.5, w - 6, 2);
    } else if (type === 1) {
      ctx.fillStyle = '#9aa3b8'; C.rr(x, y + 2, w, 6, 2);
      ctx.fillStyle = '#e8ecf5'; ctx.strokeStyle = '#1f3864'; ctx.lineWidth = 0.8;
      for (let i = 0; i + 6 <= w; i += 6) {
        ctx.beginPath(); ctx.moveTo(x + i, y + 3); ctx.lineTo(x + i + 3, y - 5); ctx.lineTo(x + i + 6, y + 3); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    } else if (type === 2 || type === 3) {
      ctx.fillStyle = '#4f5a78'; C.rr(x, y, w, 8, 4);
      ctx.fillStyle = '#ffd23f';
      const s = type === 2 ? -1 : 1, off = ((now / 25) % 10) * s;
      ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y, w - 4, 8); ctx.clip();
      for (let i = -10; i < w + 10; i += 10) {
        const cx = x + i + off;
        ctx.beginPath(); ctx.moveTo(cx - 2 * s, y + 1.5); ctx.lineTo(cx + 2 * s, y + 4); ctx.lineTo(cx - 2 * s, y + 6.5); ctx.lineTo(cx - 0.5 * s, y + 4); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    } else if (type === 4) {
      ctx.strokeStyle = '#c47400'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i <= w; i += 6) { ctx.moveTo(x + i, y + 4); ctx.lineTo(x + i + 3, y + 10); ctx.lineTo(x + i + 6, y + 4); }
      ctx.stroke();
      ctx.fillStyle = '#ffd23f'; C.rr(x, y, w, 5, 2);
    } else {
      ctx.fillStyle = '#d9a066'; C.rr(x, y, w, 8, 2);
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.38, y + 4); ctx.lineTo(x + w * 0.3, y + 8);
      ctx.moveTo(x + w * 0.7, y); ctx.lineTo(x + w * 0.62, y + 4); ctx.lineTo(x + w * 0.7, y + 8); ctx.stroke();
    }
  }
  function draw() {
    C.size(W);
    const now = performance.now();
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#ffeacc'); g.addColorStop(1, '#ffd9a8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, VH);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (let y = 0; y < VH; y += 24) for (let x = (y / 24) % 2 ? 0 : 20; x < W; x += 40) ctx.fillRect(x, y, 18, 10);
    if (!st) return;
    const a = Math.min(1, (now - curAt) / TICK);
    cur.forEach(q => {
      const p = prev.get(q[0]);
      const y = p ? p[2] + (q[2] - p[2]) * a : q[2];
      drawPlat(q[1], y, q[4], q[3], now);
    });
    st.ps.forEach(q => {
      if (!q[4]) return;
      const p = prevP.get(q[0]);
      let x = q[1], y = q[2];
      if (p && Math.abs(p[1] - x) + Math.abs(p[2] - y) < 30) { x = p[1] + (x - p[1]) * a; y = p[2] + (y - p[2]) * a; }
      const P = PLAYERS[q[0]];
      if (q[0] === V.me) {
        ctx.fillStyle = 'rgba(255,214,60,.45)';
        ctx.beginPath(); ctx.arc(x + PW / 2, y + PH / 2, 14, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = P.color;
      ctx.beginPath(); ctx.ellipse(x + PW / 2, y + PH - 1, 8, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      C.char(q[0], x + PW / 2, y + PH / 2 - 2, 25, true);
    });
    // 天花板尖刺
    ctx.fillStyle = '#7d879f';
    ctx.fillRect(0, 0, W, 5);
    ctx.fillStyle = '#c7cfde'; ctx.strokeStyle = '#1f3864'; ctx.lineWidth = 0.8;
    for (let x = 0; x < W; x += 10) {
      ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x + 5, 14); ctx.lineTo(x + 10, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    for (let i = fxs.length - 1; i >= 0; i--) {
      const f = fxs[i], age = now - f.t;
      if (age > 600) { fxs.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = 1 - age / 600;
      C.emoji({ x: '💫', h: '💢', s: '✨', c: '💨' }[f.k] || '✨', f.x, f.y - age / 30, 14 + age / 60);
      ctx.restore();
    }
  }
  const loop = () => { if (!C.alive()) return; draw(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  function updateHud() {
    const me = st.ps.find(p => p[0] === V.me);
    let txt = `<span class="floor">B${st.fl}</span>`;
    if (me && me[4]) txt += `<span>${PLAYERS[V.me].emoji}<span class="hpbar"><i style="width:${me[3] * 10}%"></i></span></span>`;
    else if (me) txt += '<span class="dead">👻 你掉下去了,幫大家加油!</span>';
    const alive = st.ps.filter(p => p[4]).length;
    if (st.ps.length > 1) txt += `<span>存活 ${alive}/${st.ps.length}</span>`;
    if (txt !== hudTxt) { hudTxt = txt; C.hud.innerHTML = txt; }
  }

  let wasAlive = true;
  V.on = m => {
    if (m.e === 's') {
      prev = cur;
      cur = new Map(m.pl.map(q => [q[0], q]));
      prevP = st ? new Map(st.ps.map(p => [p[0], p])) : new Map();
      st = m;
      curAt = performance.now();
      m.fx.forEach(f => {
        fxs.push({ k: f[0], x: f[1], y: f[2], t: performance.now() });
        if (f[0] === 'h') { beep(200, 0.15, 'square', 0.06); }
        else if (f[0] === 's') beep(880, 0.12, 'sine', 0.1);
      });
      const me = m.ps.find(p => p[0] === V.me);
      if (me && wasAlive && !me[4]) { wasAlive = false; SFX.bad(); buzz(200); }
      updateHud();
    } else if (m.e === 'over') {
      C.overlay(`<div class="big">🏁</div><div>${m.reason}</div><div class="small">最深到 B${m.fl}</div>`);
      held.clear(); upd();
    }
  };
}

/* =========================================================
   9. 萌寵打排球 🏐(橫向畫面;靈感來自經典排球小遊戲,角色是我們自己的萌寵)
   座標:寬 432 x 高 304,地面 y = 262,網子在正中間
   ========================================================= */
const VB = { W: 432, H: 304, G: 262, NET_X: 216, NET_TOP: 172, NET_W: 10, PR: 30, BR: 18, TICK: 40, WIN: 9 };

function hVolley(H) {
  const { W, G, NET_X, NET_TOP, NET_W, PR, BR, WIN } = VB, dt = VB.TICK / 1000;
  const r1 = v => Math.round(v * 10) / 10;
  const nx0 = NET_X - NET_W / 2, nx1 = NET_X + NET_W / 2;
  const ps = H.players.map((s, i) => ({ s, side: i % 2, x: 0, y: G, vy: 0, mv: 0, jumpQ: false, spikeT: 0, hitCd: 0 }));
  const homeX = p => {
    const mates = ps.filter(q => q.side === p.side), k = mates.indexOf(p);
    const d = mates.length > 1 ? [60, 150][k] : 100;
    return p.side === 0 ? d : W - d;
  };
  const ball = { x: 0, y: 0, vx: 0, vy: 0, rot: 0 };
  const score = [0, 0];
  let phase = 'ready', over = false, fx = [], serveTok = 0;
  const startAt = Date.now();

  function reset(side) {
    ps.forEach(p => { p.x = homeX(p); p.y = G; p.vy = 0; p.spikeT = 0; });
    const server = ps.find(p => p.side === side) || ps[0];
    Object.assign(ball, { x: server.x, y: 70, vx: 0, vy: 0 });
    phase = 'ready';
    const tok = ++serveTok;
    H.s.after(900, () => { if (tok === serveTok && phase === 'ready') phase = 'play'; });
  }
  const state = () => ({
    t: 'g', e: 's',
    p: ps.map(p => [p.s, r1(p.x), r1(p.y), p.spikeT > 0 ? 1 : 0, p.side]),
    b: [r1(ball.x), r1(ball.y), Math.round(ball.rot * 100) / 100],
    sc: score, ph: phase, fx,
  });
  function end(side, reason) {
    over = true;
    H.bc(state());
    H.bc({ t: 'g', e: 'over', side, reason, sc: score });
    H.s.after(2800, H.finish);
  }
  function point(winSide) {
    phase = 'point';
    score[winSide]++;
    ps.filter(p => p.side === winSide).forEach(p => H.add(p.s, 1));
    fx.push(['pt', winSide]);
    if (score[winSide] >= WIN) return end(winSide, `${winSide === 0 ? '左隊' : '右隊'}先拿到 ${WIN} 分!`);
    H.s.after(1600, () => { if (!over) reset(winSide); });
  }

  function physics(sdt) {
    for (const p of ps) {
      if (p.jumpQ && p.y >= G - 0.5) p.vy = -470;
      p.jumpQ = false;
      p.vy += 1350 * sdt;
      p.y += p.vy * sdt;
      if (p.y > G) { p.y = G; p.vy = 0; }
      p.x += p.mv * 240 * sdt;
      p.x = p.side === 0 ? Math.max(PR, Math.min(nx0 - PR, p.x)) : Math.max(nx1 + PR, Math.min(W - PR, p.x));
      if (p.hitCd > 0) p.hitCd -= sdt;
      if (p.spikeT > 0) p.spikeT -= sdt;
    }
    if (phase !== 'play') return;
    ball.vy += 560 * sdt;
    ball.x += ball.vx * sdt;
    ball.y += ball.vy * sdt;
    ball.rot += ball.vx * sdt * 0.04;
    if (ball.x < BR) { ball.x = BR; ball.vx = Math.abs(ball.vx); }
    if (ball.x > W - BR) { ball.x = W - BR; ball.vx = -Math.abs(ball.vx); }
    if (ball.y < BR) { ball.y = BR; ball.vy = Math.abs(ball.vy) * 0.6; }
    if (ball.x + BR > nx0 && ball.x - BR < nx1 && ball.y + BR > NET_TOP) { // 網子
      if (ball.y < NET_TOP) {
        if (ball.vy > 0) { ball.y = NET_TOP - BR; ball.vy = -Math.abs(ball.vy) * 0.75; }
      } else if (ball.x < NET_X) { ball.x = nx0 - BR; ball.vx = -Math.abs(ball.vx) * 0.75; }
      else { ball.x = nx1 + BR; ball.vx = Math.abs(ball.vx) * 0.75; }
    }
    for (const p of ps) {
      if (p.hitCd > 0 || !H.online(p.s)) continue;
      const cx = p.x, cy = p.y - PR, dx = ball.x - cx, dy = ball.y - cy, d = Math.hypot(dx, dy);
      if (d >= PR + BR) continue;
      const dir = p.side === 0 ? 1 : -1;
      if (p.y < G - 8 && p.spikeT > 0) { // 在空中殺球
        ball.vx = dir * 600;
        ball.vy = 260;
        fx.push(['spike', r1(ball.x), r1(ball.y)]);
      } else {
        ball.vx = Math.max(-330, Math.min(330, dx * 8 + dir * 110));
        ball.vy = -540;
        fx.push(['hit', r1(ball.x), r1(ball.y)]);
      }
      const k = (PR + BR + 1) / (d || 1);
      ball.x = cx + dx * k;
      ball.y = Math.min(G - BR - 2, cy + dy * k);
      p.hitCd = 0.22;
      p.spikeT = 0;
    }
    if (ball.y + BR >= G) { ball.y = G - BR; point(ball.x < NET_X ? 1 : 0); }
  }

  function step() {
    if (over) return;
    fx = [];
    physics(dt / 2);
    physics(dt / 2);
    H.bc(state());
    if (!over && Date.now() - startAt > 300000) end(score[0] === score[1] ? -1 : score[0] > score[1] ? 0 : 1, '時間到!');
  }

  reset(0);
  H.bc(state());
  return {
    start() { reset(0); H.loop(VB.TICK, step); },
    input(slot, m) {
      const p = ps.find(x => x.s === slot);
      if (!p) return;
      if (m.e === 'mv') p.mv = [-1, 0, 1].includes(m.d) ? m.d : 0;
      else if (m.e === 'jump') p.jumpQ = true;
      else if (m.e === 'spike') p.spikeT = 0.35;
    },
  };
}

function vVolley(V) {
  const { W, G, NET_X, NET_TOP, NET_W, PR, BR, TICK } = VB, VH = VB.H;
  landscape(V);
  const C = canvasStage(V, W / VH, true), ctx = C.ctx;
  V.pad.innerHTML = `
    <div class="vhint">👈 左半邊螢幕左右滑動 = 移動</div>
    <div class="vgrp"><button class="vb jump">跳</button><button class="vb spike">殺</button></div>`;
  const held = new Set();
  let dir = 0;
  const upd = () => {
    const d = (held.has(1) ? 1 : 0) - (held.has(-1) ? 1 : 0);
    if (d !== dir) { dir = d; V.send({ e: 'mv', d }); }
  };
  // 左半邊螢幕:按住後左右滑動就會移動(虛擬搖桿跟著手指走,不用回到原點就能換方向)
  let stickId = null, sx0 = 0;
  const ring = el('div', 'vring', '<i></i>');
  V.root.appendChild(ring);
  const gpos = e => { // 手機直拿時畫面轉了 90 度,要換算回遊戲座標
    const r = V.root.getBoundingClientRect(), rot = V.root.classList.contains('rot');
    return rot ? { x: e.clientY - r.top, y: r.right - e.clientX } : { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  V.root.addEventListener('pointerdown', e => {
    if (stickId != null || e.target.closest('.exit, .vb')) return;
    const p = gpos(e);
    if (p.x >= V.root.clientWidth / 2) return;
    e.preventDefault();
    try { V.root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    stickId = e.pointerId; sx0 = p.x;
    ring.style.left = p.x + 'px'; ring.style.top = p.y + 'px';
    ring.style.setProperty('--dx', '0px');
    ring.classList.add('on');
    V.root.classList.add('used');
  });
  V.root.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return;
    const x = gpos(e).x;
    if (Math.abs(x - sx0) > 46) sx0 = x - Math.sign(x - sx0) * 46;
    const dx = x - sx0;
    ring.style.setProperty('--dx', Math.max(-26, Math.min(26, dx * 0.6)) + 'px');
    const d = dx > 10 ? 1 : dx < -10 ? -1 : 0;
    held.clear();
    if (d) held.add(d);
    upd();
  });
  const stickEnd = e => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    ring.classList.remove('on');
    held.clear();
    upd();
  };
  V.root.addEventListener('pointerup', stickEnd);
  V.root.addEventListener('pointercancel', stickEnd);
  holdBtn($('.vb.jump', V.pad), () => V.send({ e: 'jump' }));
  holdBtn($('.vb.spike', V.pad), () => V.send({ e: 'spike' }));
  const k = d => [() => { held.add(d); upd(); }, () => { held.delete(d); upd(); }];
  const jump = [() => V.send({ e: 'jump' })], spike = [() => V.send({ e: 'spike' })];
  keyCtl(C.cv, { ArrowLeft: k(-1), ArrowRight: k(1), a: k(-1), d: k(1), ArrowUp: jump, w: jump, ' ': spike, Enter: spike, z: spike });

  let st = null, prevSt = null, curAt = 0;
  const fxs = [];
  const mySide = () => (st ? (st.p.find(p => p[0] === V.me) || [])[4] : 0);

  function draw() {
    C.size(W);
    const now = performance.now(), cv = C.cv;
    // 球場依高度放到最大、水平置中,多出來的部分畫天空和沙灘
    const sc = Math.min(cv.width / W, cv.height / VH);
    C.sc = sc; C.ox = (cv.width - W * sc) / 2; C.oy = cv.height - VH * sc;
    const gy = C.oy + G * sc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, gy);
    g.addColorStop(0, '#3e6fb8'); g.addColorStop(0.75, '#6d9bd6'); g.addColorStop(1, '#a9c8ec');
    ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, gy);
    // 地面:紅色場邊 + 沙色球場(延伸到整個畫面寬度)
    ctx.fillStyle = '#c95f6a'; ctx.fillRect(0, gy - 10 * sc, cv.width, 10 * sc);
    ctx.fillStyle = '#8f3a45'; ctx.fillRect(0, gy - 10 * sc, cv.width, 2 * sc);
    ctx.fillStyle = '#f7e7a6'; ctx.fillRect(0, gy, cv.width, cv.height - gy);
    ctx.setTransform(sc, 0, 0, sc, C.ox, C.oy);
    const ex = C.ox / sc; // 球場兩側多出來的寬度(世界座標)
    // 遠方白雲帶 + 綠色山丘
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let x = -ex - 20; x < W + ex + 20; x += 34) {
      ctx.beginPath(); ctx.ellipse(x, G - 34 + Math.sin(x * 0.07) * 4, 26, 12, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#4f9a4a';
    ctx.beginPath(); ctx.moveTo(-ex, G - 10);
    for (let x = -ex; x <= W + ex; x += 8) ctx.lineTo(x, G - 22 - Math.max(0, Math.sin((x + 40) / 70) * 16) - Math.max(0, Math.sin((x - 120) / 45) * 9));
    ctx.lineTo(W + ex, G - 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3d8040';
    for (let x = -ex; x < W + ex; x += 13) ctx.fillRect(x, G - 18 + (x % 3), 3, 2);
    // 黑邊灰白雲朵(會慢慢飄)
    const drift = (now / 120) % (W + 2 * ex + 120);
    [[40, 26, 1], [160, 8, .8], [240, 60, 1.1], [330, 40, .9], [110, 100, .8], [380, 112, .7], [270, 120, .7]].forEach(([x, y, s], i) => {
      let cx = x + (i % 2 ? drift * 0.5 : drift * 0.3);
      cx = ((cx + ex + 60) % (W + 2 * ex + 120)) - ex - 60;
      ctx.lineWidth = 1.4; ctx.strokeStyle = '#2a3550'; ctx.fillStyle = '#e4e8f0';
      ctx.beginPath();
      ctx.ellipse(cx, y, 26 * s, 9 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 10 * s, y - 6 * s, 12 * s, 8 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 9 * s, y - 7 * s, 14 * s, 9 * s, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c9d0de';
      ctx.beginPath(); ctx.ellipse(cx, y + 3 * s, 22 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
    });
    // 白色球場框線
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(14, G + 8); ctx.lineTo(W - 14, G + 8); ctx.lineTo(W - 2, G + 30); ctx.lineTo(2, G + 30); ctx.closePath(); ctx.stroke();
    if (!st) return;
    const a = Math.min(1, (now - curAt) / TICK);
    const lerp = (p, c, i) => (p ? p[i] + (c[i] - p[i]) * a : c[i]);

    // 網子(細桿 + 頂端圓球)
    ctx.fillStyle = '#8a6a5a'; ctx.fillRect(NET_X - 2.5, NET_TOP, 5, G + 18 - NET_TOP);
    ctx.fillStyle = '#c99c86'; ctx.fillRect(NET_X - 2.5, NET_TOP, 1.6, G + 18 - NET_TOP);
    ctx.fillStyle = '#fff3d6'; ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(NET_X, NET_TOP - 2, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // 影子
    const bx = lerp(prevSt && prevSt.b, st.b, 0), by = lerp(prevSt && prevSt.b, st.b, 1);
    ctx.fillStyle = 'rgba(31,56,100,.18)';
    st.p.forEach(q => {
      const p = prevSt && prevSt.p.find(x => x[0] === q[0]);
      ctx.beginPath(); ctx.ellipse(lerp(p, q, 1), G + 4, 22, 5, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.beginPath(); ctx.ellipse(bx, G + 4, 14 * Math.max(.4, by / G), 4, 0, 0, Math.PI * 2); ctx.fill();

    // 角色
    st.p.forEach(q => {
      const p = prevSt && prevSt.p.find(x => x[0] === q[0]);
      const x = lerp(p, q, 1), y = lerp(p, q, 2);
      const P = PLAYERS[q[0]];
      ctx.strokeStyle = P.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(x, y + 2, 20, 5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.save();
      ctx.shadowColor = 'rgba(20,30,60,.95)';
      ctx.shadowBlur = 4 * C.sc;
      C.char(q[0], x, y + 3, PR * 2.5, false, true);
      ctx.restore();
      if (q[3]) C.emoji('💢', x + 18, y - PR * 2 + 4, 16);
      if (q[0] === V.me) {
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.moveTo(x - 7, y - PR * 2 - 14); ctx.lineTo(x + 7, y - PR * 2 - 14); ctx.lineTo(x, y - PR * 2 - 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    });
    // 球
    C.emoji('🏐', bx, by, BR * 2.2, lerp(prevSt && prevSt.b, st.b, 2));

    // 比分(紅色斜體、黑邊)
    ctx.save();
    ctx.font = 'italic 900 40px Fredoka, "Noto Sans TC", sans-serif';
    ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    [[34, st.sc[0], 'left', 0], [W - 34, st.sc[1], 'right', 1]].forEach(([x, s, al, side]) => {
      ctx.textAlign = al;
      ctx.lineWidth = 7; ctx.strokeStyle = '#1b1b2b'; ctx.strokeText(s, x, 4);
      ctx.fillStyle = side === mySide() ? '#ff3b30' : '#e0303a';
      ctx.fillText(s, x, 4);
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffd9d9'; ctx.strokeText(s, x, 4);
    });
    ctx.restore();

    for (let i = fxs.length - 1; i >= 0; i--) {
      const f = fxs[i], age = now - f.t;
      if (age > 350) { fxs.splice(i, 1); continue; }
      ctx.save(); ctx.globalAlpha = 1 - age / 350;
      C.emoji(f.k === 'spike' ? '💥' : '✨', f.x, f.y, (f.k === 'spike' ? 30 : 18) + age / 20);
      ctx.restore();
    }
  }
  const loop = () => { if (!C.alive()) return; draw(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  let hudDone = false;
  V.on = m => {
    if (m.e === 's') {
      prevSt = st;
      st = m;
      curAt = performance.now();
      if (!hudDone) {
        hudDone = true;
        const team = side => m.p.filter(p => p[4] === side).map(p => PLAYERS[p[0]].emoji).join('');
        C.overlay(`<div class="vsline">${team(0)} <span class="vs">VS</span> ${team(1)}</div><div>你在${mySide() === 0 ? '左' : '右'}隊 · 先拿 ${VB.WIN} 分獲勝</div>`, 2200);
      }
      m.fx.forEach(f => {
        if (f[0] === 'pt') {
          const mine = f[1] === mySide();
          C.overlay(`<div class="big">${mine ? '🎉' : '😣'}</div><div>${mine ? '得分!' : '失分…'}</div>`, 1100);
          if (mine) { SFX.good(); buzz(40); } else { SFX.bad(); }
          return;
        }
        fxs.push({ k: f[0], x: f[1], y: f[2], t: performance.now() });
        if (f[0] === 'spike') { beep(140, 0.2, 'sawtooth', 0.08); buzz(30); } else beep(520, 0.06, 'triangle', 0.1);
      });
    } else if (m.e === 'over') {
      const win = m.side === mySide();
      C.overlay(`<div class="big">${m.side < 0 ? '🤝' : win ? '🏆' : '👏'}</div><div>${m.reason}</div><div class="small">${m.sc[0]} : ${m.sc[1]}</div>`);
      held.clear(); upd();
    }
  };
}

/* =========================================================
   電腦玩家的行為:聽到房主的廣播,就像真人一樣送出操作
   ========================================================= */
function botsHear(H, m) {
  const fn = BOTS[H.g.id];
  if (!fn) return;
  H.players.forEach(s => {
    const p = NET.players.find(x => x.slot === s);
    if (p && p.bot) fn(H, s, m, botSkill());
  });
}
function botSend(H, s, o) {
  if (H.logic && !H.done && NET.game === H) H.logic.input(s, { t: 'in', ...o });
}

const BOTS = {
  reaction(H, s, m, k) {
    if (m.t !== 'g') return;
    const st = H.bs[s] || (H.bs[s] = { phase: 'idle', round: 0 });
    const slip = (1 - k.sk) * 0.25;
    if (m.e === 'wait') {
      const first = st.round !== m.round;
      st.round = m.round;
      st.phase = 'wait';
      if (first && Math.random() < slip) {
        const r = m.round;
        H.s.after(rand(600, 1400), () => { if (st.round === r && st.phase === 'wait') botSend(H, s, { e: 'early' }); });
      }
    } else if (m.e === 'bomb') {
      st.phase = 'bomb';
      const r = st.round;
      if (Math.random() < slip) H.s.after(rand(300, 800), () => { if (st.round === r && st.phase === 'bomb') botSend(H, s, { e: 'bomb' }); });
    } else if (m.e === 'go') {
      st.phase = 'go';
      const rt = Math.round(rand(250, 520) * k.spd + Math.random() * 120);
      H.s.after(rt, () => botSend(H, s, { e: 'rt', rt }));
    } else st.phase = 'done';
  },

  tap(H, s, m) {
    if (m.t !== 'g' || m.e !== 'start') return;
    const rate = [4.5, 6, 8][NET.level] * (0.9 + Math.random() * 0.2);
    const t0 = Date.now() + 2600;
    const iv = H.s.every(250, () => {
      const el = (Date.now() - t0) / 1000;
      if (el < 0) return;
      const fin = el >= m.T;
      botSend(H, s, { e: 'count', n: Math.floor(Math.min(el, m.T) * rate), final: fin });
      if (fin) clearInterval(iv);
    });
  },

  math(H, s, m, k) {
    if (m.t !== 'g' || m.e !== 'q') return;
    const mm = m.text.match(/(\d+) (\S) (\d+)/);
    const a = +mm[1], b = +mm[3], op = mm[2];
    const ans = op === '+' ? a + b : op === '×' ? a * b : a - b;
    const v = Math.random() < k.sk ? ans : pick(m.opts.filter(x => x !== ans));
    const rt = Math.round(rand(1800, 4800) * k.spd + m.round * 150);
    H.s.after(rt, () => botSend(H, s, { e: 'ans', v, rt, round: m.round }));
  },

  color(H, s, m, k) {
    if (m.t !== 'g' || m.e !== 'p') return;
    const match = COLORS.find(c => c.n === m.w).c === m.c;
    if (!(match ? Math.random() < 0.5 + k.sk / 2 : Math.random() < (1 - k.sk) * 0.3)) return;
    const rt = Math.round(rand(450, 1100) * k.spd);
    H.s.after(rt, () => botSend(H, s, { e: 'tap', i: m.i, rt }));
  },

  memory(H, s, m, k) {
    if (m.t !== 'g' || m.e !== 'board') return;
    const st = H.bs[s] || (H.bs[s] = { seen: {} });
    m.cells.forEach((c, i) => {
      if (c.m != null) delete st.seen[i];
      else if (c.f && !(i in st.seen) && Math.random() < k.sk + 0.1) st.seen[i] = c.f; // 偶爾「忘記」
    });
    if (m.turn !== s) return;
    const open = m.cells.map((c, i) => (c.f && c.m == null ? i : -1)).filter(i => i >= 0);
    if (open.length >= 2) return;
    clearTimeout(st.timer);
    st.timer = H.s.after(rand(700, 1300) * k.spd, () => {
      let idx = -1;
      const known = Object.keys(st.seen).map(Number).filter(j => !m.cells[j].f);
      if (open.length === 1) {
        const face = m.cells[open[0]].f;
        const j = known.find(x => st.seen[x] === face);
        if (j != null) idx = j;
      } else {
        const byFace = {};
        known.forEach(j => { (byFace[st.seen[j]] = byFace[st.seen[j]] || []).push(j); });
        const pair = Object.values(byFace).find(a => a.length >= 2);
        if (pair) idx = pair[0];
      }
      if (idx < 0) {
        let c = m.cells.map((x, i) => (!x.f && x.m == null && !(i in st.seen) ? i : -1)).filter(i => i >= 0);
        if (!c.length) c = m.cells.map((x, i) => (!x.f && x.m == null ? i : -1)).filter(i => i >= 0);
        if (!c.length) return;
        idx = pick(c);
      }
      botSend(H, s, { e: 'flip', i: idx });
    });
  },

  chess(H, s, m, k) {
    if (m.t !== 'g' || m.e !== 'board' || m.turn !== s) return;
    H.s.after(rand(900, 1700) * k.spd, () => {
      const cells = m.cells, col = m.color[s];
      const hid = cells.map((x, i) => (x && x.h ? i : -1)).filter(i => i >= 0);
      const act = o => botSend(H, s, o);
      if (!col) return act({ e: 'flip', i: pick(hid) });
      const moves = [];
      cells.forEach((x, i) => { if (x && !x.h && x.c === col) chessTargets(cells, i).forEach(t => moves.push([i, t])); });
      const caps = moves.filter(([, t]) => cells[t]).sort((a, b) => CHESS_RANK[cells[b[1]].k] - CHESS_RANK[cells[a[1]].k]);
      if (caps.length && Math.random() < 0.5 + k.sk / 2) {
        const [f, t] = NET.level === 0 && caps.length > 1 ? pick(caps.slice(0, 2)) : caps[0];
        return act({ e: 'move', from: f, to: t });
      }
      if (hid.length && (Math.random() < 0.55 || !moves.length)) return act({ e: 'flip', i: pick(hid) });
      if (!moves.length) return;
      if (Math.random() > k.sk) { const [f, t] = pick(moves); return act({ e: 'move', from: f, to: t }); }
      // 往打得贏的敵棋靠近,並避開會被吃掉的位置
      const enemies = [];
      cells.forEach((x, i) => { if (x && !x.h && x.c !== col) enemies.push([i, x.k]); });
      const dist = (a, b) => Math.abs(Math.floor(a / CHESS_COLS) - Math.floor(b / CHESS_COLS)) + Math.abs((a % CHESS_COLS) - (b % CHESS_COLS));
      const beats = (a, d) => (a === 'K' && d === 'P' ? false : a === 'P' && d === 'K' ? true : CHESS_RANK[a] >= CHESS_RANK[d]);
      let best = null;
      moves.forEach(([f, t]) => {
        const me = cells[f].k;
        let sc = 6 + Math.random();
        enemies.forEach(([ei, ek]) => {
          if (beats(me, ek)) sc = Math.min(sc, dist(t, ei) + Math.random());
          if (dist(t, ei) === 1 && beats(ek, me)) sc += 4;
        });
        if (!best || sc < best.sc) best = { sc, f, t };
      });
      act({ e: 'move', from: best.f, to: best.t });
    });
  },

  tank(H, s, m) {
    if (m.t !== 'g' || m.e !== 's') return;
    const st = H.bs[s] || (H.bs[s] = { t: 0, dir: -1, fire: false });
    const now = Date.now();
    if (now - st.t < [500, 350, 250][NET.level]) return;
    st.t = now;
    const me = m.tk.find(t => t[4] === s);
    if (!me) return;
    const x = me[1], y = me[2];
    let dir = rand(0, 3), fire = true;
    const en = m.tk.filter(t => t[4] < 0).sort((a, b) => Math.hypot(a[1] - x, a[2] - y) - Math.hypot(b[1] - x, b[2] - y));
    if (en.length) {
      const dx = en[0][1] - x, dy = en[0][2] - y;
      if (Math.abs(dx) < 10) dir = dy > 0 ? 2 : 0;
      else if (Math.abs(dy) < 10) dir = dx > 0 ? 1 : 3;
      else dir = Math.abs(dx) < Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    }
    if (Math.random() > botSkill().sk) dir = rand(0, 3);
    // 別打到自己的基地(基地在 x 96~112、y 192~208):砲口朝向基地的那條線上就不開火
    const nearRow = y >= 168, nearCol = x >= 72 && x <= 136;
    if ((dir === 2 && nearCol && y >= 100) || (dir === 3 && nearRow && x > 100) || (dir === 1 && nearRow && x < 108)) fire = false;
    if (dir !== st.dir) { st.dir = dir; botSend(H, s, { e: 'dir', d: dir }); }
    if (fire !== st.fire) { st.fire = fire; botSend(H, s, { e: 'f', on: fire }); }
  },
};

/* 下樓梯的電腦:找下面安全的平台跳下去,站太高就趕快離開 */
BOTS.shaft = (H, s, m) => {
  if (m.t !== 'g' || m.e !== 's') return;
  const st = H.bs[s] || (H.bs[s] = { t: 0, d: 0 });
  const now = Date.now();
  if (now - st.t < [260, 160, 90][NET.level]) return;
  st.t = now;
  const me = m.ps.find(p => p[0] === s);
  if (!me || !me[4]) return;
  const { PW, PH } = SHAFT;
  const x = me[1], cx = x + PW / 2, foot = me[2] + PH;
  const plats = m.pl.map(q => ({ x: q[1], y: q[2], t: q[3], w: q[4] }));
  const on = plats.find(q => Math.abs(q.y - foot) < 3 && x + PW > q.x && x < q.x + q.w);
  let target = null;
  if (on && on.y > 110 && on.t !== 1 && on.t !== 5) target = on;
  else {
    let best = Infinity;
    plats.forEach(q => {
      if (q === on || q.y <= foot + 4 || q.y > foot + 220) return;
      const sc = (q.y - foot) * 0.4 + Math.abs(q.x + q.w / 2 - cx) + (q.t === 1 ? 400 : 0) + (q.t === 5 ? 60 : 0);
      if (sc < best) { best = sc; target = q; }
    });
  }
  let d = 0;
  if (target) {
    const tc = target.x + target.w / 2;
    if (Math.abs(tc - cx) > 6) d = Math.sign(tc - cx);
    if (target !== on && on && Math.abs(tc - cx) <= 6) d = cx < on.x + on.w / 2 ? -1 : 1; // 目標在正下方:先走到邊緣
  }
  if (Math.random() > botSkill().sk) d = rand(-1, 1);
  if (d !== st.d) { st.d = d; botSend(H, s, { e: 'mv', d }); }
};

/* 排球的電腦:預測球的落點跑過去,球下來時跳起來,在空中靠近球就殺球 */
BOTS.volley = (H, s, m) => {
  if (m.t !== 'g' || m.e !== 's') return;
  const st = H.bs[s] || (H.bs[s] = { t: 0, d: 0, pb: null });
  const now = Date.now();
  const pb = st.pb;
  st.pb = { x: m.b[0], y: m.b[1], at: now };
  if (now - st.t < [140, 90, 50][NET.level]) return;
  st.t = now;
  const me = m.p.find(p => p[0] === s);
  if (!me) return;
  const { W, G, NET_X, PR, BR } = VB;
  const side = me[4], x = me[1], y = me[2], dir = side === 0 ? 1 : -1;
  const sk = botSkill().sk;
  const bx = m.b[0], by = m.b[1];
  let vx = 0, vy = 0;
  if (pb && now > pb.at) { const dtt = (now - pb.at) / 1000; vx = (bx - pb.x) / dtt; vy = (by - pb.y) / dtt; }
  let px = bx, py = by, pvx = vx, pvy = vy;
  for (let i = 0; i < 150 && py < G - PR * 1.6; i++) {
    pvy += 560 * 0.02; px += pvx * 0.02; py += pvy * 0.02;
    if (px < BR) { px = BR; pvx = -pvx; }
    if (px > W - BR) { px = W - BR; pvx = -pvx; }
  }
  const home = side === 0 ? 100 : W - 100;
  const onMine = v => (side === 0 ? v < NET_X : v > NET_X);
  let tx = home;
  if (m.ph === 'play' && onMine(px)) tx = px - dir * 16;
  else if (m.ph === 'ready' && onMine(bx)) tx = bx - dir * 6;
  if (Math.random() > sk) tx += rand(-40, 40);
  const d = Math.abs(tx - x) > 6 ? Math.sign(tx - x) : 0;
  if (d !== st.d) { st.d = d; botSend(H, s, { e: 'mv', d }); }
  if (m.ph !== 'play') return;
  if (onMine(bx) && Math.abs(bx - x) < 46 && y >= G - 1 && by < G - 120 && by > G - 230 && vy > 0 && Math.random() < 0.5 + sk / 2) botSend(H, s, { e: 'jump' });
  if (y < G - 20 && Math.hypot(bx - x, by - (y - PR)) < 80 && Math.random() < sk * 0.7) botSend(H, s, { e: 'spike' });
};

/* ---------- 防止雙指縮放 / 長按選單 ---------- */
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

home();
