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

/* 8 個角色(每位玩家可以自己選):name 是預設名字、color 是隊伍色、soft 是淡色 */
const CHARS = [
  { id: 'bunny', name: '兔兔', color: '#9b7bff', soft: '#ede6ff' },
  { id: 'bear', name: '熊熊', color: '#c9854a', soft: '#f6e8d8' },
  { id: 'shiba', name: '柴柴', color: '#3fbf78', soft: '#dcf6e6' },
  { id: 'cat', name: '貓貓', color: '#4f8ef7', soft: '#e0ecff' },
  { id: 'sleepy', name: '睏睏貓', color: '#7d8aa3', soft: '#e6eaf2' },
  { id: 'redpanda', name: '小貓熊', color: '#e0572d', soft: '#fde4d9' },
  { id: 'penguin', name: '企鵝', color: '#22b5c7', soft: '#d9f3f6' },
  { id: 'otter', name: '水獺', color: '#e2b21f', soft: '#fbf0c9' },
];
const loadImg = src => { const i = new Image(); i.src = src; return i; };
const CHAR_IMGS = CHARS.map(c => ({ full: loadImg('assets/chars/' + c.id + '.png'), head: loadImg('assets/chars/head_' + c.id + '.png') }));
/* 走路圖(下樓梯用):每個角色有向左跑、向右跑各一張 */
const WALK_IMGS = CHARS.map(c => ({ l: loadImg('assets/chars/walk_' + c.id + '_l.png'), r: loadImg('assets/chars/walk_' + c.id + '_r.png') }));
const charHTML = c => '<img class="pe" src="assets/chars/head_' + c.id + '.png" alt="">';
/* PLAYERS[座位]:目前這個座位的玩家用的角色;emoji 欄位是文字裡用的小頭像(圖片),畫布遊戲用 CHAR_IMG */
const PLAYERS = [0, 1, 2, 3].map(i => ({ slot: i, ch: i, ...CHARS[i], file: CHARS[i].id, emoji: charHTML(CHARS[i]) }));
const CHAR_IMG = [0, 1, 2, 3].map(i => CHAR_IMGS[i]);
const dispName = p => { const c = CHARS[p.ch != null ? p.ch : p.slot]; return p.bot ? '🤖' + c.name : (p.name || c.name); };
function applyChars() {
  for (let s = 0; s < 4; s++) {
    const p = NET.players.find(x => x.slot === s);
    const ci = p && p.ch != null ? p.ch : s, c = CHARS[ci];
    PLAYERS[s] = { slot: s, ch: ci, ...c, file: c.id, emoji: charHTML(c), name: p ? dispName(p) : c.name };
    CHAR_IMG[s] = CHAR_IMGS[ci];
  }
}
const myChar = () => { const c = store.get('char', 0); return Number.isInteger(c) && c >= 0 && c < CHARS.length ? c : 0; };

const APP_VERSION = '2026.10.26';
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
  NET.pickerOpen = false;
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
  solo: false,       // 單人模式(不連線,只有房主 + 電腦)
  level: 1,          // 電腦強度 0 簡單 / 1 普通 / 2 困難
  introG: null,
  game: null,        // host 遊戲進行中的狀態
  hostT: null,
};

const pinfo = slot => {
  const p = NET.players.find(x => x.slot === slot);
  return { ...PLAYERS[slot], name: PLAYERS[slot].name, online: p ? p.online : false, bot: !!(p && p.bot) };
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
  const usedCh = new Set(NET.players.map(p => p.ch));
  NET.players.push({ slot, name: '', online: true, bot: true, ch: pick(CHARS.map((_, i) => i).filter(i => !usedCh.has(i))) });
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
  NET.players = [{ slot: 0, name: myName(), online: true, ch: myChar() }];
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
  NET.players = [{ slot: 0, name: myName(), online: true, ch: myChar() }];

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
      const taken = new Set(NET.players.filter(p => p.slot !== slot).map(p => p.ch));
      const want = Number.isInteger(m.ch) && m.ch >= 0 && m.ch < CHARS.length && !taken.has(m.ch) ? m.ch : CHARS.map((_, i) => i).find(i => !taken.has(i));
      NET.players.push({ slot, name: String(m.name || '').trim().slice(0, 8), online: true, ch: want });
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
    } else if (slot !== null && m.t === 'pick') {
      hostSetChar(slot, m.ch);
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

/* 選角色:房主直接改,其他人請房主改(同一個角色只能一個人用) */
function hostSetChar(slot, ci) {
  const p = NET.players.find(x => x.slot === slot);
  if (!p || NET.phase !== 'lobby' || !Number.isInteger(ci) || ci < 0 || ci >= CHARS.length) return;
  if (NET.players.some(x => x.slot !== slot && x.ch === ci)) return hostToLobby(); // 被別人選走了
  p.ch = ci;
  hostToLobby();
}
function pickChar(ci) {
  store.set('char', ci);
  if (NET.role === 'host') hostSetChar(NET.mySlot, ci);
  else if (NET.conn && NET.conn.open) NET.conn.send({ t: 'pick', ch: ci });
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
      conn.send({ t: 'hello', name: myName(), ch: myChar() });
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
      NET.players = m.players; NET.stars = m.stars; NET.code = m.code; applyChars();
      lobbyView();
      break;
    case 'presence':
      NET.players = m.players; applyChars();
      if (V) V.renderChips();
      else if ($('.intro')) introPlayers();
      break;
    case 'busy': NET.players = m.players; applyChars(); busyView(); break;
    case 'intro': NET.players = m.players; applyChars(); introView(GAME[m.g]); break;
    case 'play': playView(m); break;
    case 'cd': if (V) V.countdown(m.n); break;
    case 'score': if (V) V.setScores(m); break;
    case 'g':
      if (!V) break;
      if (m.e === 'end') { V.onTap = null; V.stage('<div class="big">🎉</div><div>結束囉!</div>'); SFX.go(); }
      else V.on(m);
      break;
    case 'results': NET.stars = m.stars; NET.players = m.pl; applyChars(); resultsView(m); break;
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
    id: 'math', emoji: '🧮', name: '算數小天才', tag: '益智', color: '#3fbf78', desc: '搶答算數題!',
    rules: ['每台手機會同時出現一道算式', '選出正確答案,最快答對的人得 1 分', '每題只能答一次,答錯就沒機會囉', '共 10 題,越後面越難:會出現乘除、先乘除後加減、括號!'],
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
    id: 'shaft', emoji: '🪜', name: '小朋友下樓梯', tag: '反應', color: '#f2994a', desc: '一直往下跳!',
    rules: ['平台會一直往上升,要往下跳到平台上,別被天花板的尖刺刺到', '在畫面任何地方按住左右滑動就能移動(沒有按鍵),角色會跟著向左或向右跑', '綠色平台回血、尖刺平台扣血;還有輸送帶、彈簧和會碎掉的平台', '血量歸零或掉出畫面就出局', '下到最深樓層的人獲勝!'],
    host: hShaft, view: vShaft,
  },
  {
    id: 'morris', emoji: '⭕', name: '九子棋', tag: '益智', color: '#a0703f', desc: '連成三顆就能吃子',
    rules: ['2 人對戰,每人 9 顆棋;房間超過 2 人時抽籤上場、其他人觀戰', '棋子顏色可以自己選(點自己卡片上的「換色」),先輪流把棋子放到交叉點上', '同一條線連成三顆(成三)就能吃掉對方一顆棋;已經成三的棋受保護,不能吃', '棋子都放完後,沿著線把棋子移到旁邊的空點;只剩 3 顆時可以飛到任何空點!', '對方剩 2 顆或被困住沒路走,你就贏了!'],
    host: hMorris, view: vMorris, noCountdown: true,
  },
  {
    id: 'heart', emoji: '❤️', name: '心臟病', tag: '撲克+反應', color: '#d63a4a', desc: '喊到一樣就快拍!',
    rules: ['2~4 人,一副 52 張撲克牌平均發給大家,牌面朝下', '輪流按「翻牌」翻開自己最上面一張,依序喊 A、2、3…10、J、Q、K,喊完 K 再從 A 開始', '翻出來的牌和喊的一樣 → 大家快拍牌桌(綠色桌布任何地方都可以)!最後拍(或沒拍)的人要把桌上整疊牌收走', '不一樣卻亂拍,也要收走整疊牌 😱', '最先把手上的牌出完的人獲勝!'],
    host: hHeart, view: vHeart, noCountdown: true,
  },
  {
    id: 'bomb', emoji: '💣', name: '轟炸超人', tag: '動作+對戰', color: '#ff7043', desc: '放炸彈炸飛對手!',
    rules: ['2~4 人對戰,手機橫著拿畫面最大!左邊方向盤移動,右邊按鈕放炸彈', '炸彈會往上下左右噴火,炸開木箱可能掉出道具;被火燒到就出局', '道具:💣 多放一顆 · 🔥 火力變長 · 👟 跑更快 · 🛡️ 擋一次爆炸 · 🦶 可以踢炸彈 · 🌋 超級火力 · 💀 詛咒(碰到別人會傳染!)', '80 秒後場地會從外圈開始縮小,快躲到中間!', '每局最後活下來的人得 1 分,先拿 2 分的人獲勝!'],
    host: hBomb, view: vBomb, noCountdown: true,
  },
  {
    id: 'checkers', emoji: '🔮', name: '跳棋', tag: '益智+對戰', color: '#b9783f', desc: '連跳過關,搶先到對面!',
    rules: ['2~4 人,每人 10 顆彈珠放在自己的三角形;手機橫著拿棋盤最大', '輪到你時:點一顆自己的彈珠,再點亮起來的洞', '可以走到旁邊的空洞,或跳過一顆彈珠(誰的都可以);跳過去後還能繼續連跳!', '最先把 10 顆彈珠全部移到「對面」三角形的人獲勝', '每回合 40 秒,時間到會自動幫你走一步'],
    host: hCheckers, view: vCheckers, noCountdown: true,
  },
  {
    id: 'flood', emoji: '🌊', name: '填色大作戰', tag: '益智+競速', color: '#3b82f6', desc: '一樣的棋盤,比誰先填滿!',
    rules: ['大家拿到一模一樣的彩色棋盤,同時開始比賽', '點下面的顏色按鈕,左上角的區域就會變成那個顏色,吞掉相連的同色格子', '在步數限制內把整個棋盤變成同一個顏色就完成了!', '最先完成得 3 分、第二名 2 分、之後 1 分;步數用完或時間到還沒完成就沒分', '共 3 局:14×14、18×18、22×22,可以看到每個人的小棋盤進度'],
    host: hFlood, view: vFlood, noCountdown: true,
  },
];
const GAME = Object.fromEntries(GAMES.map(g => [g.id, g]));

/* ---------- 戰績(只存在這支手機裡):每款遊戲的場次、勝場、平手,加上連勝與最近紀錄 ---------- */
const TIERS = [
  { n: '新手', e: '🌱', w: 0 }, { n: '銅牌', e: '🥉', w: 5 }, { n: '銀牌', e: '🥈', w: 15 }, { n: '金牌', e: '🥇', w: 30 },
  { n: '白金', e: '💠', w: 60 }, { n: '鑽石', e: '💎', w: 100 }, { n: '傳說', e: '👑', w: 200 },
];
const tierOf = w => { let k = 0; TIERS.forEach((t, i) => { if (w >= t.w) k = i; }); return k; };
const emptyStats = () => ({ g: {}, log: [], streak: 0, best: 0 });
const getStats = () => { const x = store.get('stats', null); return x && typeof x === 'object' && x.g ? x : emptyStats(); };
const pct = (w, p) => (p ? Math.round(w / p * 100) + '%' : '—');
function statsTotal(st) {
  const t = { p: 0, w: 0, d: 0 };
  Object.entries(st.g).forEach(([id, x]) => { if (GAME[id]) { t.p += x.p; t.w += x.w; t.d += x.d; } });
  return t;
}
function recordResult(m) {
  if (!m.players.includes(NET.mySlot)) return null; // 觀戰不算
  const win = m.winners.includes(NET.mySlot);
  const r = win && (m.winners.length < m.players.length || m.players.length === 1) ? 'w' : win || !m.winners.length ? 'd' : 'l';
  const st = getStats();
  const x = st.g[m.g] || (st.g[m.g] = { p: 0, w: 0, d: 0 });
  x.p++;
  if (r === 'w') x.w++; else if (r === 'd') x.d++;
  st.streak = r === 'w' ? st.streak + 1 : r === 'l' ? 0 : st.streak;
  st.best = Math.max(st.best, st.streak);
  st.log.unshift({ g: m.g, r, t: Date.now(), m: NET.solo ? 's' : 'r', n: m.players.length - 1 });
  st.log.length = Math.min(st.log.length, 20);
  store.set('stats', st);
  return { r, x };
}

/* =========================================================
   畫面:首頁(手遊風格的開始選單)
   ========================================================= */
const ribbon = (text, cls = '') => `<div class="ribbon ${cls}"><span>${text}</span></div>`;

function home() {
  resetView();
  app.innerHTML = '';
  const roomParam = new URLSearchParams(location.search).get('room') || '';
  const h = el('div', 'screen home2');
  h.innerHTML = `
    <div class="art">
      <button class="iconbtn" id="mute" aria-label="音效">${S.muted ? '🔇' : '🔊'}</button>
      <button class="coin" id="stats" title="我的戰績"><span>${TIERS[tierOf(statsTotal(getStats()).w)].e}</span><b>${statsTotal(getStats()).w}</b><i class="cgo">戰績 ›</i></button>
    </div>
    <div class="hpanel">
      <label class="profile"><span class="ava">${charHTML(CHARS[myChar()])}</span>
        <input id="name" maxlength="8" placeholder="輸入你的暱稱" value="${esc(myName())}"></label>
      <div class="hrow2">
        <button class="btn big green" id="solo"><span class="bi">▶</span><span class="bt">單人遊戲<small>對戰電腦</small></span></button>
        <button class="btn big blue" id="busg"><span class="bi">🚌</span><span class="bt">闖關模式<small>公車大塞車</small></span></button>
      </div>
      <button class="btn big orange" id="create"><span class="bi">🏠</span><span class="bt">建立房間<small>邀請朋友一起玩</small></span></button>
      <div class="joinbox">
        <input class="field" id="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="輸入房號" value="${esc(roomParam)}">
        <button class="btn blue" id="join">加入</button>
      </div>
      <p class="tip">每人一支手機 · 2~4 人連線 · 建議連同一個 Wi-Fi<br><span class="ver">版本 ${APP_VERSION} · ${GAMES.length} 款遊戲</span></p>
    </div>`;
  app.appendChild(h);

  const nameIn = $('#name', h), codeIn = $('#code', h);
  const saveName = () => store.set('name', nameIn.value.trim().slice(0, 8));
  nameIn.addEventListener('change', saveName);
  $('#create', h).addEventListener('click', () => { saveName(); createRoom(); });
  $('#solo', h).addEventListener('click', () => { saveName(); createSolo(); });
  $('#busg', h).addEventListener('click', () => { saveName(); busGame(); });
  $('#join', h).addEventListener('click', () => { saveName(); joinRoom(codeIn.value); });
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') { saveName(); joinRoom(codeIn.value); } });
  $('#stats', h).addEventListener('click', () => statsView());
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
      <span class="pemo">${P.emoji}</span><span class="pname">${esc(PLAYERS[p.slot].name)}</span>${tags}
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
  return `<div class="seat${p.online ? '' : ' off'}${slot === NET.mySlot ? ' mine' : ''}" style="--c:${P.color};--soft:${P.soft}">
    ${slot === NET.mySlot ? '<i class="swap">✎</i>' : ''}
    ${isHost && p.bot ? `<button class="kick" data-slot="${slot}" aria-label="移除電腦">✕</button>` : ''}
    <div class="ava-big">${P.emoji}</div><b class="sname">${esc(PLAYERS[slot].name)}</b>
    <div class="stags">${tags}</div><div class="sstar">⭐ ${NET.stars[slot] || 0}</div></div>`;
}

function lobbyView() {
  const reopen = NET.pickerOpen;
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
    <section class="panel seats">${[0, 1, 2, 3].map(seatHTML).join('')}<p class="seathint">👆 點自己的頭像可以換角色</p></section>
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
  $$('.seat.mine', d).forEach(s => s.addEventListener('click', openPicker));
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

  if (reopen) openPicker();

  // 內容比螢幕長時,提示「往下滑還有更多遊戲」
  const hint = el('button', 'scrollhint', '▼ 還有更多遊戲');
  d.appendChild(hint);
  const upd = () => { hint.classList.toggle('on', d.scrollHeight - d.scrollTop - d.clientHeight > 24 && !!$('.gcard', d)); };
  hint.addEventListener('click', () => d.scrollBy({ top: d.clientHeight * 0.7, behavior: 'smooth' }));
  d.addEventListener('scroll', upd);
  setTimeout(upd, 50);
}

/* 選角色面板:8 個角色,被別人選走的會變灰並標示是誰 */
function openPicker() {
  NET.pickerOpen = true;
  const old = $('.sheetbg');
  if (old) old.remove();
  const me = NET.players.find(p => p.slot === NET.mySlot);
  const bg = el('div', 'sheetbg');
  bg.innerHTML = `<div class="sheet"><h3>選擇你的角色</h3><div class="chargrid">${CHARS.map((c, i) => {
    const owner = NET.players.find(p => p.ch === i && p.slot !== NET.mySlot);
    const on = me && me.ch === i;
    return `<button class="cc${on ? ' on' : ''}${owner ? ' taken' : ''}" data-i="${i}" style="--c:${c.color};--soft:${c.soft}" ${owner ? 'disabled' : ''}>
      <span class="ci"><img src="assets/chars/${c.id}.png" alt=""></span><b>${c.name}</b>${owner ? `<i class="by">${esc(PLAYERS[owner.slot].name)}</i>` : on ? '<i class="by me">我</i>' : ''}</button>`;
  }).join('')}</div><button class="btn big green done"><span class="bt">完成</span></button></div>`;
  app.appendChild(bg);
  $$('.cc', bg).forEach(b => b.addEventListener('click', () => { SFX.tap(); pickChar(+b.dataset.i); }));
  const close = () => { NET.pickerOpen = false; bg.remove(); };
  $('.done', bg).addEventListener('click', close);
  bg.addEventListener('pointerdown', e => { if (e.target === bg) close(); });
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
  const rec = recordResult(m);
  const tb = statsTotal(getStats()).w - (rec && rec.r === 'w' ? 1 : 0);
  const tierUp = rec && rec.r === 'w' && tierOf(tb + 1) > tierOf(tb) ? TIERS[tierOf(tb + 1)] : null;
  const title = m.winners.length === 0 ? '沒有贏家 😆'
    : m.winners.length > 1 ? `平手!${m.winners.map(s => PLAYERS[s].emoji).join(' ')} 都贏了`
      : `${PLAYERS[m.winners[0]].emoji} ${esc(pinfo(m.winners[0]).name)} 獲勝!`;

  const d = el('div', 'screen result');
  d.innerHTML = `
    <div class="rhead"><div class="sunburst${iWon ? '' : ' dim'}"></div><div class="trophy">${iWon ? '🏆' : m.winners.length ? '👏' : '🤪'}</div></div>
    ${ribbon(iWon ? '勝利!' : '遊戲結束', iWon ? 'gold' : 'blue')}
    <h1 class="rtitle">${title}</h1>
    ${iWon ? '<p class="youwin">你好棒!獲得一顆 ⭐</p>' : ''}
    ${tierUp ? `<p class="tierup">🎉 升級為 ${tierUp.e} ${tierUp.n}!</p>` : ''}
    ${rec ? `<p class="myrec">我的${g.emoji}${g.name}戰績:${rec.x.w} 勝 / ${rec.x.p} 場 · 勝率 ${pct(rec.x.w, rec.x.p)}</p>` : ''}
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

function statsView() {
  resetView();
  app.innerHTML = '';
  const st = getStats(), tot = statsTotal(st), ti = tierOf(tot.w), tier = TIERS[ti], nx = TIERS[ti + 1];
  const lost = tot.p - tot.w - tot.d;
  const rows = GAMES.map(g => ({ g, x: st.g[g.id] || { p: 0, w: 0, d: 0 } }))
    .sort((a, b) => (b.x.p > 0) - (a.x.p > 0) || (b.x.w / (b.x.p || 1)) - (a.x.w / (a.x.p || 1)) || b.x.w - a.x.w);
  const medals = ['🥇', '🥈', '🥉'];
  const mark = { w: ['勝', 'w'], l: ['敗', 'l'], d: ['平', 'd'] };
  const d = el('div', 'screen stats');
  d.innerHTML = `
    ${ribbon('我的戰績', 'gold')}
    <div class="tiercard">
      <div class="tem">${tier.e}</div>
      <div class="tinfo"><b>${tier.n}</b>
        <div class="tbarx"><i style="width:${nx ? Math.min(100, (tot.w - tier.w) / (nx.w - tier.w) * 100) : 100}%"></i></div>
        <small>${nx ? `再贏 ${nx.w - tot.w} 場升 ${nx.e} ${nx.n}` : '已經是最高等級!'}</small></div>
    </div>
    <div class="sgrid">
      <div><b>${tot.p}</b><small>總場次</small></div>
      <div><b>${tot.w}</b><small>勝場</small></div>
      <div><b>${pct(tot.w, tot.p)}</b><small>勝率</small></div>
      <div><b>${st.best}</b><small>最高連勝</small></div>
    </div>
    <p class="ssub">${tot.w} 勝 · ${lost} 敗 · ${tot.d} 平手${st.streak > 1 ? ` · 目前連勝 🔥${st.streak}` : ''}</p>
    <h2 class="shead">🏆 遊戲排名(依勝率)</h2>
    <div class="glist">${rows.map(({ g, x }, k) => `
      <div class="grow${x.p ? '' : ' none'}">
        <span class="gk">${x.p ? medals[k] || k + 1 : '·'}</span>
        <span class="ge">${g.emoji}</span><span class="gn">${g.name}</span>
        <span class="gw">${x.p ? `${x.w}勝 / ${x.p}場` : '還沒玩過'}</span>
        <b class="gp">${pct(x.w, x.p)}</b>
      </div>`).join('')}</div>
    <h2 class="shead">📜 最近紀錄</h2>
    <div class="llist">${st.log.length ? st.log.slice(0, 10).map(e => {
    const g = GAME[e.g], dt = new Date(e.t);
    return `<div class="lrow"><i class="lm ${mark[e.r][1]}">${mark[e.r][0]}</i><span>${g ? g.emoji + g.name : e.g}</span>
        <small>${e.m === 's' ? '對電腦' : e.n ? `${e.n + 1} 人房` : '房間'} · ${dt.getMonth() + 1}/${dt.getDate()}</small></div>`;
  }).join('') : '<p class="lempty">還沒有紀錄,去玩一場吧!</p>'}</div>
    <p class="snote">戰績只存在這支手機裡;換手機或清除瀏覽器資料就會歸零。</p>
    <div class="sbtns"><button class="btn big blue back"><span class="bi">◀</span><span class="bt">回首頁</span></button>
      ${tot.p ? '<button class="btn white sm reset">清除戰績</button>' : ''}</div>`;
  app.appendChild(d);
  $('.back', d).addEventListener('click', () => home());
  const rs = $('.reset', d);
  if (rs) rs.addEventListener('click', () => { if (confirm('確定要清除所有戰績嗎?')) { store.set('stats', emptyStats()); store.set('wins', 0); statsView(); } });
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
   3. 算數小天才 🧮
   ========================================================= */
function genQuestion(r) { // 1~10 題,越後面越難:兩位數加減 → 乘法 → 先乘除後加減 → 括號 → 兩個乘積相減
  let text, ans;
  const t = r <= 2 ? 0 : r <= 4 ? 1 : r <= 6 ? 2 : r <= 8 ? 3 : 4;
  const kind = Math.random() < 0.5;
  if (t === 0) {
    if (kind) { const x = rand(23, 78), y = rand(14, 49); text = `${x} + ${y}`; ans = x + y; }
    else { const x = rand(52, 99), y = rand(17, x - 12); text = `${x} − ${y}`; ans = x - y; }
  } else if (t === 1) {
    if (kind) { const x = rand(6, 12), y = rand(6, 12); text = `${x} × ${y}`; ans = x * y; }
    else { const y = rand(4, 12), q = rand(6, 15); text = `${y * q} ÷ ${y}`; ans = q; }
  } else if (t === 2) {
    if (kind) { const x = rand(8, 40), y = rand(3, 9), w = rand(3, 9); text = `${x} + ${y} × ${w}`; ans = x + y * w; }
    else { const y = rand(3, 9), w = rand(3, 9), x = rand(5, y * w - 1); text = `${y} × ${w} − ${x}`; ans = y * w - x; }
  } else if (t === 3) {
    if (kind) { const x = rand(3, 15), y = rand(3, 15), w = rand(3, 9); text = `(${x} + ${y}) × ${w}`; ans = (x + y) * w; }
    else { const x = rand(12, 29), y = rand(3, 9); text = `${x} × ${y}`; ans = x * y; }
  } else if (kind) {
    const x = rand(4, 12), y = rand(4, 12), w = rand(3, 9), v = rand(3, 9);
    text = `${x} × ${y} − ${w} × ${v}`; ans = x * y - w * v;
    if (ans < 0) { text = `${w} × ${v} − ${x} × ${y}`; ans = -ans; }
  } else {
    const x = rand(6, 15), y = rand(2, 5), w = rand(3, 9), v = rand(2, 9);
    text = `(${x * v} ÷ ${v} + ${y}) × ${w}`; ans = (x + y) * w;
  }
  // 錯誤選項要「看起來很像」:差 1、差 2、差 10,或個位數一樣
  const opts = new Set([ans]);
  const near = [1, -1, 2, -2, 10, -10, 3, -3, 5, -5, 20, -20];
  let guard = 0;
  while (opts.size < 3 && guard++ < 60) {
    const v = ans + (guard < 20 ? pick(near.slice(0, 8)) : pick(near));
    if (v >= 0) opts.add(v);
  }
  while (opts.size < 3) opts.add(ans + opts.size * 7);
  return { text, ans, opts: [...opts] };
}

function hMath(H) {
  const R = 10;
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
    H.s.after(15000, live(round, () => { if (phase === 'open') decide(); }));
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
  let st = null, sel = null, targets = [], over = false, lastTurn = null, coverT = null;
  const chipsEl = $('.chips', V.root);
  chipsEl.className = 'cstatus'; // 上方只留一條狀態列,計分改由玩家卡顯示
  chipsEl.innerHTML = '<span class="cs">對局準備中…</span>';
  V.renderChips = () => {};
  const boardEl = el('div', 'cboard');
  const cells = Array.from({ length: CHESS_COLS * CHESS_ROWS }, (_, i) => {
    const c = el('div', 'cell');
    c.dataset.i = i;
    boardEl.appendChild(c);
    return c;
  });
  const cover = el('div', 'cover');
  V.pad.innerHTML = '';
  V.pad.appendChild(boardEl);
  V.pad.appendChild(cover);
  const showCover = (html, ms) => {
    cover.innerHTML = html;
    cover.classList.add('on');
    clearTimeout(coverT);
    if (ms) coverT = setTimeout(() => cover.classList.remove('on'), ms);
  };
  V.stage('<div class="cinfo"></div>');
  showCover('<div class="big">♟️</div><div>擺棋中…</div>');

  const fighting = () => st && st.fighters.includes(V.me);
  const myTurn = () => st && !over && st.turn === V.me;
  const who = s => (s === V.me ? '你' : esc(pinfo(s).name));

  function renderStage() {
    const order = fighting() ? [V.me, st.fighters.find(s => s !== V.me)] : st.fighters;
    const card = s => {
      const p = pinfo(s), c = st.color[s], oc = c ? (c === 'r' ? 'b' : 'r') : null;
      const ks = oc ? [...st.dead[oc]].sort((x, y) => CHESS_RANK[y] - CHESS_RANK[x]) : []; // 這位玩家吃掉的對方棋子
      return `<div class="pcard${st.turn === s && !over ? ' now' : ''}" style="--c:${p.color}">
        <div class="pav">${p.emoji}${c ? `<i class="pdot ${c}"></i>` : ''}</div>
        <div class="pinfo"><b>${who(s)}</b><span class="pcnt">${c ? (c === 'r' ? '紅方' : '黑方') + ' · 剩 ' + st.left[c] : '尚未定色'}</span></div>
        <div class="ptro">${ks.length ? ks.map(k => `<i class="gp ${oc}">${CHESS_NAME[oc][k]}</i>`).join('') : '<span class="gnone">吃子紀錄</span>'}</div>
      </div>`;
    };
    V.stage(`<div class="cinfo">${order.map(card).join('')}</div>`);

    let msg;
    if (over) msg = '對局結束';
    else if (myTurn()) msg = sel != null ? '選要走去哪一格' : (st.color[V.me] ? '輪到你!翻棋或走棋' : '輪到你!先翻一顆棋');
    else msg = (fighting() ? '' : '👀 觀戰 · ') + `輪到 ${pinfo(st.turn).emoji} ${who(st.turn)}…`;
    if (!over && st.idle >= 40) msg += ` · 再 ${50 - st.idle} 步平手`;
    chipsEl.innerHTML = `<span class="cs${myTurn() ? ' on' : ''}">${msg}</span>`;
  }
  function render() {
    targets = sel != null && myTurn() ? chessTargets(st.cells, sel) : [];
    const lastFrom = st.last ? st.last.from : -1, lastTo = st.last ? st.last.to : -1;
    cells.forEach((c, i) => {
      const x = st.cells[i];
      const dk = (Math.floor(i / CHESS_COLS) + (i % CHESS_COLS)) % 2;
      c.className = 'cell' + (dk ? ' dk' : '') + (sel === i ? ' sel' : '') + (targets.includes(i) ? ' tgt' : '')
        + (i === lastTo ? ' last' : '') + (i === lastFrom ? ' from' : '')
        + (i === lastTo && st.last.type === 'flip' ? ' flipped' : '');
      c.innerHTML = !x ? '' : x.h ? '<div class="pc hid"><span>❖</span></div>' : `<div class="pc ${x.c}"><span>${CHESS_NAME[x.c][x.k]}</span></div>`;
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
      const [a, b] = m.fighters.map(s => `<span class="vsp">${pinfo(s).emoji}<b>${who(s)}</b></span>`);
      showCover(`<div class="small">${V.players.length > 2 ? '抽籤結果' : '對戰開始'}</div><div class="vsrow">${a}<span class="vs">VS</span>${b}</div>
        ${m.fighters.includes(V.me) ? '' : '<div class="small">你這局觀戰 👀</div>'}`, 1700);
      SFX.go();
    } else if (m.e === 'board') {
      st = m;
      sel = null;
      cover.classList.remove('on');
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
      showCover(m.winner == null
        ? `<div class="big">🤝</div><div>${m.reason}</div>`
        : `<div class="big">🏆</div><div class="vsrow"><span class="vsp">${pinfo(m.winner).emoji}<b>${who(m.winner)} 獲勝!</b></span></div><div class="small">${m.reason}</div>`);
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
    const hudH = getComputedStyle(hud).position === 'absolute' ? 0 : hud.offsetHeight + 4; // 狀態列浮在畫布上時不佔高度
    const w = stageEl.clientWidth - 10, h = stageEl.clientHeight - 10 - hudH;
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
  C.walk = (slot, face, x, footY, h) => { // 走路圖:腳底中心對準 (x, footY)
    const im = WALK_IMGS[PLAYERS[slot].ch][face];
    if (!im.complete || !im.naturalWidth) return;
    const w = h * im.naturalWidth / im.naturalHeight, ctx = C.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(im, x * C.sc + C.ox - w * C.sc / 2, footY * C.sc + C.oy - h * C.sc, w * C.sc, h * C.sc);
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
  const faceOf = new Map(), moving = new Map(); // 每位玩家目前面向哪邊、是不是在走
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
      if (p && Math.abs(q[1] - p[1]) > 0.15) { faceOf.set(q[0], q[1] > p[1] ? 'r' : 'l'); moving.set(q[0], now); }
      const walking = now - (moving.get(q[0]) || 0) < 140;
      const bob = walking && q[2] === (p ? p[2] : q[2]) ? Math.abs(Math.sin(now / 75)) * 1.8 : 0; // 走路時輕輕跳動
      C.walk(q[0], faceOf.get(q[0]) || 'r', x + PW / 2, y + PH + 3 - bob, 33);
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
   九子棋 ⭕(2 人回合制:放子 → 走子 → 只剩 3 顆時飛子)
   24 個交叉點,座標是 7 x 7 的格子;成三(同一條線三顆)就吃對方一顆
   ========================================================= */
const NMM_XY = [[0, 0], [3, 0], [6, 0], [1, 1], [3, 1], [5, 1], [2, 2], [3, 2], [4, 2], [0, 3], [1, 3], [2, 3], [4, 3], [5, 3], [6, 3], [2, 4], [3, 4], [4, 4], [1, 5], [3, 5], [5, 5], [0, 6], [3, 6], [6, 6]];
const NMM_ADJ = [[1, 9], [0, 2, 4], [1, 14], [4, 10], [1, 3, 5, 7], [4, 13], [7, 11], [4, 6, 8], [7, 12], [0, 10, 21], [3, 9, 11, 18], [6, 10, 15], [8, 13, 17], [5, 12, 14, 20], [2, 13, 23], [11, 16], [15, 17, 19], [12, 16], [10, 19], [16, 18, 20, 22], [13, 19], [9, 22], [19, 21, 23], [14, 22]];
const NMM_MILLS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23], [0, 9, 21], [3, 10, 18], [6, 11, 15], [1, 4, 7], [16, 19, 22], [8, 12, 17], [5, 13, 20], [2, 14, 23]];
/* 九子棋的棋子顏色(玩家可以自己選;兩人不能選同一個) */
const NMM_COLORS = [
  { n: '紅', c: '#e8444f' }, { n: '藍', c: '#3f7de8' }, { n: '綠', c: '#2fb36b' }, { n: '黃', c: '#f2b800' },
  { n: '紫', c: '#8c5be8' }, { n: '橘', c: '#ff8a3d' }, { n: '黑', c: '#34344a' }, { n: '白', c: '#f4f1ea' },
];
const nmmMillsAt = i => NMM_MILLS.filter(m => m.includes(i));
const nmmInMill = (b, i) => b[i] != null && nmmMillsAt(i).some(m => m.every(k => b[k] === b[i]));
// 如果 who 把棋放到 i(i 可以是空的),會不會成三
const nmmMakesMill = (b, i, who) => nmmMillsAt(i).some(m => m.every(k => k === i || b[k] === who));
// 可以被吃的棋:不在「三」裡面的;如果全部都在三裡,就都可以吃
function nmmRemovable(b, owner) {
  const mine = b.map((x, i) => (x === owner ? i : -1)).filter(i => i >= 0);
  const free = mine.filter(i => !nmmInMill(b, i));
  return free.length ? free : mine;
}
function nmmMoves(b, who, fly) {
  const out = [];
  b.forEach((x, f) => {
    if (x !== who) return;
    (fly ? b.map((_, i) => i) : NMM_ADJ[f]).forEach(t => { if (b[t] == null) out.push([f, t]); });
  });
  return out;
}

function hMorris(H) {
  const fighters = shuffle(H.players).slice(0, 2); // 超過 2 人就抽籤
  const b = Array(24).fill(null);
  const hand = {}, lost = {}, colors = {};
  fighters.forEach((s, k) => { hand[s] = 9; lost[s] = 0; colors[s] = k; }); // 預設:先紅後藍,之後各自可以改
  let live = false;
  let turnI = 0, rm = false, last = null, over = false, idle = 0;
  const cnt = s => b.filter(x => x === s).length;
  const fly = s => hand[s] === 0 && cnt(s) === 3;
  const state = () => ({
    t: 'g', e: 'board', b, turn: fighters[turnI], fighters, hand, lost, colors,
    cnt: Object.fromEntries(fighters.map(s => [s, cnt(s)])), rm, last, idle,
  });
  const bc = () => H.bc(state());
  function end(winner, reason) {
    over = true;
    if (winner != null) H.scores[winner] = 1;
    H.bc({ t: 'score', scores: H.scores });
    H.bc({ t: 'g', e: 'over', winner, reason });
    H.s.after(3000, H.finish);
  }
  function nextTurn() {
    const prev = fighters[turnI];
    turnI = 1 - turnI;
    const s = fighters[turnI];
    bc();
    if (hand[s] === 0 && cnt(s) < 3) return end(prev, '對方只剩 2 顆棋了!');
    if (hand[s] === 0 && !fly(s) && !nmmMoves(b, s, false).length) return end(prev, '對方被困住,沒有棋可以走了!');
    if (idle >= 60) end(null, '連續 60 步沒有吃子,平手!');
  }
  function afterAction(i) {
    const o = fighters[1 - turnI];
    if (nmmInMill(b, i) && nmmRemovable(b, o).length) { // 成三:同一個人接著選要吃哪一顆
      rm = true;
      last.mill = true;
      bc();
    } else nextTurn();
  }

  return {
    start() { H.bc({ t: 'g', e: 'intro', fighters }); H.s.after(1800, () => { live = true; bc(); }); },
    input(slot, m) {
      if (m.e === 'color') { // 換棋子顏色:隨時可以換,但不能和對手同色
        const ci = +m.c;
        if (!over && Number.isInteger(ci) && ci >= 0 && ci < NMM_COLORS.length && fighters.includes(slot) && !fighters.some(s => s !== slot && colors[s] === ci)) {
          colors[slot] = ci;
          if (live) bc();
        }
        return;
      }
      if (over || slot !== fighters[turnI]) return;
      const o = fighters[1 - turnI];
      if (rm) {
        const i = +m.i;
        if (m.e !== 'remove' || !nmmRemovable(b, o).includes(i)) return;
        b[i] = null;
        lost[o]++;
        rm = false;
        idle = 0;
        last = { ...last, rm: i };
        return nextTurn();
      }
      if (hand[slot] > 0) {
        const i = +m.i;
        if (m.e !== 'place' || !(i >= 0 && i < 24) || b[i] != null) return;
        b[i] = slot;
        hand[slot]--;
        last = { type: 'place', to: i, slot };
        return afterAction(i);
      }
      const f = +m.from, t = +m.to;
      if (m.e !== 'move' || b[f] !== slot || !(t >= 0 && t < 24) || b[t] != null) return;
      if (!fly(slot) && !NMM_ADJ[f].includes(t)) return;
      b[f] = null;
      b[t] = slot;
      idle++;
      last = { type: 'move', from: f, to: t, slot };
      afterAction(t);
    },
    presence() {
      if (over) return;
      const gone = fighters.find(s => !H.online(s));
      if (gone != null) end(fighters.find(s => s !== gone), '對手離開了');
    },
  };
}

function vMorris(V) {
  let st = null, sel = null, targets = [], over = false, lastTurn = null, coverT = null;
  const me = V.me;
  const colorOf = s => NMM_COLORS[st && st.colors && st.colors[s] != null ? st.colors[s] : 0].c;
  const chipsEl = $('.chips', V.root);
  chipsEl.className = 'cstatus'; // 上方只留一條狀態列
  chipsEl.innerHTML = '<span class="cs">對局準備中…</span>';
  V.renderChips = () => {};

  // 棋盤:三個同心正方形 + 四條中線(SVG 畫刻線),24 個交叉點用 HTML 疊在上面
  const P = v => 6 + v * (88 / 6);
  const sq = [0, 1, 2].map(k => `<rect x="${P(k)}" y="${P(k)}" width="${P(6 - k) - P(k)}" height="${P(6 - k) - P(k)}" rx=".6"/>`).join('');
  const mid = `<path d="M${P(3)} ${P(0)}V${P(2)}M${P(3)} ${P(4)}V${P(6)}M${P(0)} ${P(3)}H${P(2)}M${P(4)} ${P(3)}H${P(6)}"/>`;
  const board = el('div', 'mboard');
  board.innerHTML = `<svg viewBox="0 0 100 100" class="mlines"><g class="ln-hi">${sq}${mid}</g><g class="ln">${sq}${mid}</g><g class="mills"></g></svg>`;
  const millsEl = $('.mills', board);
  const pts = NMM_XY.map(([x, y], i) => {
    const p = el('div', 'pt');
    p.dataset.i = i;
    p.style.left = P(x) + '%';
    p.style.top = P(y) + '%';
    board.appendChild(p);
    return p;
  });
  const cover = el('div', 'cover');
  board.appendChild(cover);
  V.pad.innerHTML = '';
  V.pad.appendChild(board);
  const fit = () => {
    if (!board.isConnected) { ro.disconnect(); return; }
    const s = Math.floor(Math.min(V.pad.clientWidth, V.pad.clientHeight));
    board.style.width = board.style.height = Math.max(120, s) + 'px';
  };
  const ro = new ResizeObserver(fit);
  ro.observe(V.pad);
  fit();
  const showCover = (html, ms) => {
    cover.innerHTML = html;
    cover.classList.add('on');
    clearTimeout(coverT);
    if (ms) coverT = setTimeout(() => cover.classList.remove('on'), ms);
  };
  V.stage('<div class="cinfo"></div>');
  showCover('<div class="big">⭕</div><div>擺好棋盤…</div>');

  const fighting = () => st && st.fighters.includes(me);
  const myTurn = () => st && !over && st.turn === me;
  const who = s => (s === me ? '你' : esc(pinfo(s).name));

  function renderStage() {
    const order = fighting() ? [me, st.fighters.find(s => s !== me)] : st.fighters;
    const card = s => {
      const p = pinfo(s), h = st.hand[s];
      const tray = h
        ? Array.from({ length: h }, () => `<i class="hd" style="--pc:${colorOf(s)}"></i>`).join('') + `<span class="hn">手上 ${h}</span>`
        : `<span class="gnone">${st.cnt[s] === 3 ? '只剩 3 顆:可以飛!' : '棋子都上場了'}</span>`;
      return `<div class="pcard${st.turn === s && !over ? ' now' : ''}" style="--c:${p.color}">
        <div class="pav">${p.emoji}</div>
        <div class="pinfo"><b>${who(s)}</b><span class="pcnt">場上 ${st.cnt[s]} · 被吃 ${st.lost[s]}</span></div>
        ${s === me && !over ? `<button class="cpick" style="--pc:${colorOf(s)}" aria-label="換棋子顏色"><i></i>換色</button>` : `<i class="cdot" style="--pc:${colorOf(s)}"></i>`}
        <div class="ptro mhand">${tray}</div>
      </div>`;
    };
    V.stage(`<div class="cinfo">${order.map(card).join('')}</div>`);

    let msg;
    if (over) msg = '對局結束';
    else if (myTurn()) {
      if (st.rm) msg = '成三了!點一顆對方的棋吃掉';
      else if (st.hand[me] > 0) msg = `輪到你!放一顆棋(手上 ${st.hand[me]})`;
      else if (st.cnt[me] === 3) msg = sel != null ? '飛到任何一個空位!' : '只剩 3 顆:選一顆棋,可以飛!';
      else msg = sel != null ? '選要走去哪一點' : '輪到你!選一顆棋移動';
    } else {
      msg = (fighting() ? '' : '👀 觀戰 · ') + (st.rm ? `${who(st.turn)} 成三了,正在選要吃哪顆…` : `輪到 ${pinfo(st.turn).emoji} ${who(st.turn)}…`);
    }
    if (!over && st.idle >= 50) msg += ` · 再 ${60 - st.idle} 步平手`;
    chipsEl.innerHTML = `<span class="cs${myTurn() ? ' on' : ''}">${msg}</span>`;
  }

  function render(isNew) {
    const b = st.b, myT = myTurn();
    const o = st.fighters.find(s => s !== st.turn);
    const removable = st.rm && myT ? nmmRemovable(b, o) : [];
    const fly = st.hand[me] === 0 && st.cnt[me] === 3;
    targets = [];
    if (myT && !st.rm) {
      if (st.hand[me] > 0) targets = b.map((x, i) => (x == null ? i : -1)).filter(i => i >= 0);
      else if (sel != null) targets = nmmMoves(b, me, fly).filter(([f]) => f === sel).map(([, t]) => t);
    }
    const movable = myT && !st.rm && st.hand[me] === 0 ? new Set(nmmMoves(b, me, fly).map(([f]) => f)) : new Set();
    const L = st.last || {};
    pts.forEach((p, i) => {
      const x = b[i];
      p.className = 'pt' + (targets.includes(i) ? ' tgt' : '') + (L.from === i ? ' from' : '') + (L.to === i ? ' last' : '');
      if (x == null) { p.innerHTML = ''; return; }
      const cls = 'mp' + (sel === i ? ' sel' : '') + (removable.includes(i) ? ' rmable' : '')
        + (nmmInMill(b, i) ? ' inmill' : '') + (movable.has(i) ? ' can' : '') + (isNew && L.to === i ? ' fresh' : '');
      p.innerHTML = `<div class="${cls}" style="--pc:${colorOf(x)}"></div>`;
    });
    // 已經成三的線:金色發光
    const P2 = i => NMM_XY[i].map(P);
    millsEl.innerHTML = NMM_MILLS.filter(m => b[m[0]] != null && m.every(k => b[k] === b[m[0]])).map(m => {
      const [x1, y1] = P2(m[0]), [x2, y2] = P2(m[2]);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${colorOf(b[m[0]])}"/>`;
    }).join('');
    V.root.classList.toggle('myturn', myT);
    renderStage();
  }

  function openColors() {
    if (!st || over) return;
    const old = $('.sheetbg');
    if (old) old.remove();
    const mine = st.colors[me], opp = st.fighters.find(s => s !== me);
    const bg = el('div', 'sheetbg');
    bg.innerHTML = `<div class="sheet"><h3>選擇你的棋子顏色</h3><div class="swgrid">${NMM_COLORS.map((c, i) => {
      const taken = opp != null && st.colors[opp] === i;
      return `<button class="sw${i === mine ? ' on' : ''}${taken ? ' taken' : ''}" data-i="${i}" style="--sc:${c.c}" ${taken ? 'disabled' : ''}><i></i><b>${c.n}</b>${taken ? '<em>對手</em>' : ''}</button>`;
    }).join('')}</div><button class="btn big green done"><span class="bt">完成</span></button></div>`;
    app.appendChild(bg);
    $$('.sw', bg).forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.i;
      store.set('nmmColor', i);
      SFX.tap();
      V.send({ e: 'color', c: i });
      bg.remove();
    }));
    $('.done', bg).addEventListener('click', () => bg.remove());
    bg.addEventListener('pointerdown', e => { if (e.target === bg) bg.remove(); });
  }
  $('.stage', V.root).addEventListener('pointerdown', e => {
    if (!e.target.closest('.cpick')) return;
    e.preventDefault();
    e.stopPropagation();
    openColors();
  });

  V.onTap = e => {
    const p = e.target.closest('.pt');
    if (!p || !myTurn()) return;
    const i = +p.dataset.i, b = st.b;
    if (st.rm) {
      if (b[i] != null && b[i] !== me) V.send({ e: 'remove', i });
      return;
    }
    if (st.hand[me] > 0) {
      if (b[i] == null) V.send({ e: 'place', i });
      return;
    }
    if (sel != null && targets.includes(i)) { V.send({ e: 'move', from: sel, to: i }); sel = null; }
    else if (b[i] === me) { sel = sel === i ? null : i; SFX.tap(); }
    else sel = null;
    render(false);
  };
  V.on = m => {
    if (m.e === 'intro') {
      const [a, b] = m.fighters.map(s => `<span class="vsp">${pinfo(s).emoji}<b>${who(s)}</b></span>`);
      showCover(`<div class="small">${V.players.length > 2 ? '抽籤結果' : '對戰開始'}</div><div class="vsrow">${a}<span class="vs">VS</span>${b}</div>
        ${m.fighters.includes(me) ? '<div class="small">點自己卡片上的「換色」可以選棋子顏色 🎨</div>' : '<div class="small">你這局觀戰 👀</div>'}`, 2000);
      SFX.go();
      const pref = store.get('nmmColor', null);
      if (pref != null && m.fighters.includes(me)) V.send({ e: 'color', c: pref });
    } else if (m.e === 'board') {
      const prevLast = st && st.last;
      st = m;
      sel = null;
      cover.classList.remove('on');
      render(true);
      const L = m.last;
      if (L && L !== prevLast) {
        if (m.rm) { if (L.slot === me) { SFX.good(); buzz(40); } else if (fighting()) SFX.bad(); else SFX.tap(); }
        else if (L.rm != null) { beep(220, 0.18, 'triangle', 0.12); if (fighting() && L.slot !== me) buzz(90); }
        else beep(rand(380, 460), 0.07, 'sine', 0.14);
      }
      if (myTurn() && lastTurn !== me) buzz(60);
      lastTurn = m.turn;
    } else if (m.e === 'over') {
      over = true;
      sel = null;
      if (st) render(false);
      showCover(m.winner == null
        ? `<div class="big">🤝</div><div>${m.reason}</div>`
        : `<div class="big">🏆</div><div class="vsrow"><span class="vsp">${pinfo(m.winner).emoji}<b>${who(m.winner)} 獲勝!</b></span></div><div class="small">${m.reason}</div>`);
    }
  };
}

/* =========================================================
   心臟病 ❤️(2~4 人撲克牌):輪流翻牌並依序喊 A、2、3…K,
   翻出的牌和喊的數字一樣就要拍!最後拍的人(或亂拍的人)把整疊牌收走,先把手牌出完的人獲勝
   牌的編號 0~51:點數 = id % 13 + 1,花色 = Math.floor(id / 13)(♠ ♥ ♦ ♣)
   ========================================================= */
const HEART_RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const HEART_SUIT = ['♠', '♥', '♦', '♣'];
const HEART_PIPS = { // 2~10 的花色排列位置(%),下半部的花色倒過來
  2: [[50, 16], [50, 84]],
  3: [[50, 16], [50, 50], [50, 84]],
  4: [[27, 16], [73, 16], [27, 84], [73, 84]],
  5: [[27, 16], [73, 16], [50, 50], [27, 84], [73, 84]],
  6: [[27, 16], [73, 16], [27, 50], [73, 50], [27, 84], [73, 84]],
  7: [[27, 16], [73, 16], [50, 33], [27, 50], [73, 50], [27, 84], [73, 84]],
  8: [[27, 16], [73, 16], [50, 33], [27, 50], [73, 50], [50, 67], [27, 84], [73, 84]],
  9: [[27, 16], [73, 16], [27, 39], [73, 39], [50, 50], [27, 61], [73, 61], [27, 84], [73, 84]],
  10: [[27, 16], [73, 16], [50, 28], [27, 39], [73, 39], [27, 61], [73, 61], [50, 72], [27, 84], [73, 84]],
};
const heartRank = c => c % 13 + 1;
function heartCard(c) { // 一張牌的正面
  const r = heartRank(c), su = Math.floor(c / 13), sym = HEART_SUIT[su], lab = HEART_RANK[r];
  let mid;
  if (r === 1) mid = `<span class="hace">${sym}</span>`;
  else if (r > 10) {
    const ch = CHARS[(r * 3 + su * 5) % CHARS.length];
    mid = `<span class="hface"><img src="assets/chars/${ch.id}.png" alt=""><em>${['👑', '🎀', '🎩'][13 - r]}</em></span>`;
  } else mid = `<span class="hpips">${HEART_PIPS[r].map(([x, y]) => `<i style="left:${x}%;top:${y}%"${y > 50 ? ' class="dn"' : ''}>${sym}</i>`).join('')}</span>`;
  return `<span class="hf${su === 1 || su === 2 ? ' red' : ''}"><span class="hcn">${lab}<i>${sym}</i></span>${mid}<span class="hcn br">${lab}<i>${sym}</i></span></span><span class="hb"></span>`;
}

function hHeart(H) {
  const P = shuffle(H.players.slice()); // 隨機決定座位順序
  const hand = {};
  P.forEach(s => { hand[s] = []; });
  shuffle([...Array(52).keys()]).forEach((c, i) => hand[P[i % P.length]].push(c));
  let pile = [], call = 1, turnI = 0, k = 0, phase = 'deal', flips = 0, lastAt = 0, tok = 0;
  const slaps = new Map();
  const counts = () => Object.fromEntries(P.map(s => [s, hand[s].length]));
  const bc = (ev, extra) => H.bc({ t: 'g', e: 'st', ev, order: P, hands: counts(), pile: pile.length, top: pile.slice(-5), call, turn: P[turnI], k, phase, ...(extra || {}) });

  function armTurn() { // 太久沒翻牌就自動幫他翻
    const my = ++tok;
    H.s.after(6500, () => { if (my === tok && phase === 'play') flip(P[turnI], true); });
  }
  function nextTurn() {
    for (let n = 0; n < P.length; n++) {
      turnI = (turnI + 1) % P.length;
      if (H.online(P[turnI]) && hand[P[turnI]].length) return true;
    }
    return false;
  }
  function end(reason) {
    phase = 'over';
    tok++;
    const n = P.map(s => hand[s].length);
    P.forEach(s => { H.scores[s] = P.length - n.filter(x => x < hand[s].length).length; });
    const best = Math.min(...n);
    bc('end', { winners: P.filter(s => hand[s].length === best), reason });
    H.bc({ t: 'score', scores: H.scores });
    H.s.after(3400, H.finish);
  }
  function flip(s, auto) {
    if (phase !== 'play' || s !== P[turnI] || !hand[s].length) return;
    if (!auto && performance.now() - lastAt < 380) return; // 給大家一點時間看清楚上一張
    lastAt = performance.now();
    const card = hand[s].shift(), said = call;
    pile.push(card);
    k++; flips++;
    call = call % 13 + 1;
    if (heartRank(card) === said) {
      phase = 'match';
      slaps.clear();
      tok++;
      bc('flip', { by: s, card, said, auto: !!auto });
      const my = k;
      H.s.after(2600, () => { if (k === my && phase === 'match') resolve(); });
      return;
    }
    if (!hand[s].length) { bc('flip', { by: s, card, said, auto: !!auto }); return end('out'); }
    if (flips >= 360) { bc('flip', { by: s, card, said, auto: !!auto }); return end('long'); }
    if (!nextTurn()) return end('alone');
    bc('flip', { by: s, card, said, auto: !!auto });
    armTurn();
  }
  function resolve() {
    const act = H.active();
    const miss = act.filter(s => !slaps.has(s));
    const order = [...slaps].sort((a, b) => a[1] - b[1]).map(x => x[0]);
    if (!order.length) { // 大家都沒發現,就當沒事繼續
      phase = 'play';
      if (!hand[P[turnI]].length) return end('out');
      if (!nextTurn()) return end('alone');
      bc('miss');
      return armTurn();
    }
    take(miss.length ? pick(miss) : order[order.length - 1], 'slow', order, miss);
  }
  function take(s, reason, order, miss) {
    const n = pile.length;
    hand[s].push(...pile);
    pile = [];
    call = 1;
    phase = 'take';
    tok++;
    bc('take', { who: s, n, reason, order: order || [], miss: miss || [] });
    H.s.after(2100, () => {
      if (phase !== 'take') return;
      const done = P.find(x => x !== s && !hand[x].length);
      if (done != null) return end('out');
      phase = 'play';
      turnI = P.indexOf(s);
      if (!H.online(s) && !nextTurn()) return end('alone');
      bc('turn');
      armTurn();
    });
  }

  return {
    start() {
      bc('deal');
      H.s.after(2200, () => { phase = 'play'; bc('turn'); armTurn(); });
    },
    input(slot, m) {
      if (phase === 'over' || +m.k !== k) return;
      if (m.e === 'flip') flip(slot);
      else if (m.e === 'slap') {
        if (phase === 'match') {
          if (slaps.has(slot) || !P.includes(slot)) return;
          slaps.set(slot, Math.max(0, Math.min(9999, +m.rt || 9999)));
          H.bc({ t: 'g', e: 'hit', who: slot, k, n: slaps.size });
          if (H.active().every(s => slaps.has(s))) H.s.after(350, () => { if (phase === 'match' && k === +m.k) resolve(); });
        } else if (phase === 'play' && pile.length && P.includes(slot)) take(slot, 'wrong', [slot], []);
      }
    },
    presence() {
      if (phase === 'over') return;
      if (H.active().length < 2) return end('alone');
      if (phase === 'match' && H.active().every(s => slaps.has(s))) resolve();
      else if (phase === 'play' && !H.online(P[turnI])) { if (!nextTurn()) return end('alone'); bc('turn'); armTurn(); }
    },
  };
}

function vHeart(V) {
  const me = V.me;
  let st = null, slapK = -1, shownAt = 0, over = false, lastEv = null, turnT = null;
  const chipsEl = $('.chips', V.root);
  chipsEl.className = 'cstatus';
  chipsEl.innerHTML = '<span class="cs">洗牌中…</span>';
  V.renderChips = () => {};
  V.stage('<div class="hseats"></div>');

  V.pad.innerHTML = `
    <div class="hx">
      <div class="htable">
        <div class="hcall"><small>喊</small><b>—</b></div>
        <div class="hpile"></div>
        <div class="hhits"></div>
        <div class="hnext"></div>
        <div class="hmsg"></div>
        <div class="htip">🖐️ 拍桌面任何地方</div>
        <div class="cover"></div>
      </div>
      <div class="hctl">
        <button class="hdeck"><span class="hstack"></span><span class="hdl"><b>0</b><small>翻牌</small></span><i class="htime"></i></button>
      </div>
    </div>`;
  const hx = $('.hx', V.pad), table = $('.htable', hx), pileEl = $('.hpile', hx), hitsEl = $('.hhits', hx);
  const callEl = $('.hcall b', hx), nextEl = $('.hnext', hx), msgEl = $('.hmsg', hx), cover = $('.cover', hx);
  const deckEl = $('.hdeck', hx);
  const fit = () => {
    if (!hx.isConnected) { ro.disconnect(); return; }
    const cw = Math.max(54, Math.min(table.clientWidth * 0.42, (table.clientHeight - 90) / 1.4 * 0.8));
    hx.style.setProperty('--cw', Math.round(cw) + 'px');
  };
  const ro = new ResizeObserver(fit);
  ro.observe(V.pad);
  fit();

  const who = s => (s === me ? '你' : esc(pinfo(s).name));
  const myTurn = () => st && st.phase === 'play' && st.turn === me && !over;
  const rot = (c, i) => ((c * 37 + i * 53) % 25) - 12;
  const say = (html, cls) => { msgEl.className = 'hmsg on ' + (cls || ''); msgEl.innerHTML = html; };

  function renderSeats() {
    $('.hseats', V.root).innerHTML = st.order.map(s => {
      const p = pinfo(s), n = st.hands[s];
      return `<div class="hseat${st.turn === s && (st.phase === 'play') ? ' now' : ''}${p.online ? '' : ' off'}${s === me ? ' me' : ''}" data-s="${s}" style="--pc:${p.color}">
        <span class="hav">${p.emoji}</span><b>${who(s)}</b>
        <span class="hcnt"><i></i><i></i><i></i><em>${n}</em></span></div>`;
    }).join('');
  }
  function renderPile(fresh) {
    pileEl.innerHTML = st.top.map((c, i) => {
      const last = i === st.top.length - 1;
      const from = fresh && last ? (fresh === me ? ' fromme' : ' fromop') : '';
      return `<span class="pc${from}" style="--r:${rot(c, st.k - st.top.length + i)}deg;--i:${i}">${heartCard(c)}</span>`;
    }).join('') + (st.pile > 5 ? `<span class="hpn">${st.pile}</span>` : '');
  }
  function renderCtl() {
    const n = st.hands[me] || 0, mine = st.order.includes(me);
    deckEl.classList.toggle('on', myTurn());
    deckEl.classList.toggle('empty', !n);
    $('.hdl b', deckEl).textContent = n;
    $('.hstack', deckEl).innerHTML = '<span class="pc back"><span class="hb"></span></span>'.repeat(Math.min(3, n));
    deckEl.hidden = !mine;
    clearTimeout(turnT);
    const tm = $('.htime', deckEl);
    tm.classList.remove('run');
    if (myTurn()) { void tm.offsetWidth; tm.classList.add('run'); }
    let msg;
    if (over) msg = '這局結束了';
    else if (st.phase === 'deal') msg = '發牌中…';
    else if (st.phase === 'match') msg = '🖐️ 拍!拍!拍!';
    else if (st.phase === 'take') msg = '收牌中…';
    else if (myTurn()) msg = `輪到你翻牌!這張要喊 <b>${HEART_RANK[st.call]}</b>`;
    else msg = (mine ? '' : '👀 觀戰 · ') + `${pinfo(st.turn).emoji} ${who(st.turn)} 翻牌,喊 <b>${HEART_RANK[st.call]}</b>`;
    chipsEl.innerHTML = `<span class="cs${myTurn() ? ' on' : ''}">${msg}</span>`;
  }

  function slap(e) { // 拍在牌桌上任何地方都算,拍下去的位置留一個手印
    if (!st || over || slapK === st.k || !st.order.includes(me) || (st.phase !== 'play' && st.phase !== 'match')) return;
    slapK = st.k;
    V.send({ e: 'slap', k: st.k, rt: Math.round(performance.now() - shownAt) });
    const r = table.getBoundingClientRect();
    const mark = el('span', 'hprint', '🖐️');
    mark.style.left = (e.clientX - r.left) + 'px';
    mark.style.top = (e.clientY - r.top) + 'px';
    table.appendChild(mark);
    setTimeout(() => mark.remove(), 700);
    table.classList.remove('thump');
    void table.offsetWidth;
    table.classList.add('thump');
    beep(140, 0.09, 'square', 0.12);
    buzz(30);
  }
  V.onTap = e => {
    if (e.target.closest('.hdeck')) {
      if (myTurn() && st.hands[me]) { V.send({ e: 'flip', k: st.k }); deckEl.classList.add('press'); setTimeout(() => deckEl.classList.remove('press'), 120); }
    } else if (e.target.closest('.htable')) slap(e);
  };

  V.on = m => {
    if (m.e === 'hit') {
      if (!st || m.k !== st.k) return;
      const p = pinfo(m.who);
      hitsEl.insertAdjacentHTML('beforeend', `<span class="hh${m.n === 1 ? ' first' : ''}" style="--pc:${p.color};--i:${m.n - 1};--r:${(m.who * 29 % 30) - 15}deg"><i>🖐️</i><span class="hav">${p.emoji}</span><em>${m.n}</em></span>`);
      beep(90 + m.n * 15, 0.12, 'square', 0.1);
      table.classList.remove('thump');
      void table.offsetWidth;
      table.classList.add('thump');
      return;
    }
    if (m.e !== 'st') return;
    const prev = st;
    st = m;
    lastEv = m.ev;
    if (m.ev === 'deal') {
      cover.innerHTML = `<div class="big">🃏</div><div>發牌!每人 ${Math.floor(52 / m.order.length)} 張左右</div><div class="small">翻出來的牌 = 喊的數字,就快拍桌面!</div>`;
      cover.classList.add('on');
      SFX.go();
      setTimeout(() => cover.classList.remove('on'), 2000);
    }
    if (m.ev === 'flip') {
      callEl.textContent = HEART_RANK[m.said];
      callEl.parentElement.classList.remove('pop');
      void callEl.offsetWidth;
      callEl.parentElement.classList.add('pop');
      hitsEl.innerHTML = '';
      msgEl.className = 'hmsg';
      renderPile(m.by);
      beep(1300, 0.03, 'triangle', 0.08);
      beep(700, 0.05, 'triangle', 0.06, 0.03);
      shownAt = performance.now() + 130; // 牌翻過來大約要 0.13 秒
      if (m.auto && m.by === me) toast('時間到,幫你自動翻了一張');
    } else if (m.ev === 'take') {
      const p = pinfo(m.who);
      const why = m.reason === 'wrong' ? `${who(m.who)} 亂拍!` : m.miss.includes(m.who) ? `${who(m.who)} 沒拍到!` : `${who(m.who)} 是最後一名!`;
      say(`<span class="hav">${p.emoji}</span><b>${why}</b><small>收走 ${m.n} 張牌</small>`, m.who === me ? 'bad' : '');
      if (m.reason !== 'wrong') { // 依實際反應速度重新排名,最後一名(或沒拍的人)標出來
        const row = [...m.order.map((s, i) => [s, i + 1]), ...m.miss.map(s => [s, 0])];
        hitsEl.innerHTML = row.map(([s, rk], i) => {
          const q = pinfo(s);
          return `<span class="hh${rk === 1 ? ' first' : ''}${s === m.who ? ' last' : ''}" style="--pc:${q.color};--i:${i};--r:${(s * 29 % 30) - 15}deg"><i>${rk ? '🖐️' : '💤'}</i><span class="hav">${q.emoji}</span><em>${rk || '✕'}</em></span>`;
        }).join('');
      }
      pileEl.classList.add(m.who === me ? 'tome' : 'toop');
      setTimeout(() => { pileEl.classList.remove('tome', 'toop'); pileEl.innerHTML = ''; }, 1250);
      setTimeout(() => { hitsEl.innerHTML = ''; }, 1700);
      if (m.who === me) { SFX.bad(); buzz([80, 60, 120]); V.fx('bad'); } else if (st.order.includes(me)) SFX.good();
      callEl.textContent = '—';
    } else if (m.ev === 'miss') {
      say('<b>大家都沒發現!</b><small>繼續翻牌</small>');
    } else if (m.ev === 'turn') {
      msgEl.className = 'hmsg';
      if (!st.top.length) pileEl.innerHTML = '';
    } else if (m.ev === 'end') {
      over = true;
      const ws = m.winners;
      setTimeout(() => {
        cover.innerHTML = `<div class="big">${ws.includes(me) ? '🏆' : '🃏'}</div>
          <div class="vsrow">${ws.map(s => `<span class="vsp">${pinfo(s).emoji}<b>${who(s)}</b></span>`).join('')}</div>
          <div>${m.reason === 'out' ? '最先把牌出完,獲勝!' : m.reason === 'long' ? '玩太久了!手牌最少的獲勝' : '其他人都離開了'}</div>`;
        cover.classList.add('on');
      }, 900);
      if (ws.includes(me)) SFX.win(); else SFX.bad();
    }
    nextEl.innerHTML = st.phase === 'play' || st.phase === 'match' ? `下一張喊 <b>${HEART_RANK[st.call]}</b>` : '';
    if (m.ev === 'turn' && myTurn() && (!prev || prev.turn !== me || prev.phase !== 'play')) buzz(50);
    renderSeats();
    renderCtl();
  };
}

/* =========================================================
   轟炸超人 💣(2~4 人即時對戰,手機橫著玩):放炸彈炸開木箱撿道具,炸到別人!
   棋盤 15 x 11 格,座標單位是「格」;格子代碼 0 空地 1 石牆 2 木箱,'a'+k 是道具 k
   每局最後存活的人得 1 分,先拿 2 分(或 3 局後分數最高)的人獲勝;80 秒後場地會從外圈開始縮小
   ========================================================= */
const BOMB = { W: 15, H: 11, TICK: 40, FUSE: 2.5, FLAME: 0.55, SD: 80, CAP: 150, R: 3, WIN: 2 };
const BOMB_ITEMS = [
  { k: 'bomb', e: '💣', n: '炸彈 +1', c: '#5c6bc0', w: 27 },
  { k: 'fire', e: '🔥', n: '火力 +1', c: '#f57c00', w: 27 },
  { k: 'speed', e: '👟', n: '速度 +1', c: '#26a69a', w: 18 },
  { k: 'shield', e: '🛡️', n: '防護罩', c: '#42a5f5', w: 8 },
  { k: 'kick', e: '🦶', n: '踢炸彈', c: '#8d6e63', w: 9 },
  { k: 'skull', e: '💀', n: '詛咒!', c: '#6a1b9a', w: 7 },
  { k: 'max', e: '🌋', n: '超級火力', c: '#d32f2f', w: 4 },
];
const BOMB_CURSE = { slow: '🐢 變超慢', fast: '⚡ 停不下來', rev: '🔄 方向顛倒', auto: '💣 一直放炸彈', nob: '🚫 不能放炸彈' };
const BOMB_DX = [0, 0, 1, 0, -1], BOMB_DY = [0, -1, 0, 1, 0]; // 方向:0 停 1 上 2 右 3 下 4 左
const BOMB_SPAWN = [[1, 1], [13, 9], [13, 1], [1, 9]];

function hBomb(H) {
  const GW = BOMB.W, GH = BOMB.H, dt = BOMB.TICK / 1000;
  const r2 = v => Math.round(v * 100) / 100;
  let round = 0, phase = 'idle', grid = [], hid = [], ps = [], bombs = [], flames = new Map(), t = 0, fx = [];
  let gdirty = true, sdOrder = [], sdI = 0, sdAcc = 0, endAt = 0, nextId = 1, tick = 0;
  const wins = {};
  H.players.forEach(s => { wins[s] = 0; });

  const idx = (c, r) => r * GW + c;
  const bombAt = (c, r) => bombs.find(b => Math.floor(b.x) === c && Math.floor(b.y) === r);
  function newMap() {
    grid = []; hid = [];
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
      grid.push(r === 0 || c === 0 || r === GH - 1 || c === GW - 1 || (r % 2 === 0 && c % 2 === 0) ? 1 : 0);
      hid.push(-1);
    }
    const safe = new Set();
    BOMB_SPAWN.forEach(([c, r]) => {
      safe.add(idx(c, r));
      safe.add(idx(c + (c < 7 ? 1 : -1), r));
      safe.add(idx(c, r + (r < 5 ? 1 : -1)));
    });
    const total = BOMB_ITEMS.reduce((a, b) => a + b.w, 0);
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] || safe.has(i) || Math.random() > 0.74) continue;
      grid[i] = 2;
      if (Math.random() < 0.4) {
        let v = Math.random() * total, k = 0;
        while ((v -= BOMB_ITEMS[k].w) > 0) k++;
        hid[i] = k;
      }
    }
    sdOrder = []; // 場地縮小的順序:從最外圈繞進來
    for (let k = 1; k <= 5; k++) {
      const top = k, bot = GH - 1 - k, lef = k, rig = GW - 1 - k;
      if (top > bot || lef > rig) break;
      const ring = [];
      for (let c = lef; c <= rig; c++) ring.push(idx(c, top));
      for (let r = top + 1; r <= bot; r++) ring.push(idx(rig, r));
      if (bot > top) for (let c = rig - 1; c >= lef; c--) ring.push(idx(c, bot));
      if (rig > lef) for (let r = bot - 1; r > top; r--) ring.push(idx(lef, r));
      ring.forEach(i => { if (grid[i] !== 1 && !sdOrder.includes(i)) sdOrder.push(i); });
    }
    gdirty = true;
  }
  function newRound() {
    round++;
    newMap();
    bombs = []; flames = new Map(); t = 0; sdI = 0; sdAcc = 0; endAt = 0;
    ps = H.players.map((s, i) => {
      const [c, r] = BOMB_SPAWN[H.players.length === 2 ? i : i % 4];
      return { s, x: c + 0.5, y: r + 0.5, alive: H.online(s), dir: 0, mv: false, cap: 1, fire: 2, spd: 3, shield: 0, kick: false, curse: null, curseT: 0, inv: 0 };
    });
  }
  const gridStr = () => grid.map(v => (v >= 10 ? String.fromCharCode(97 + v - 10) : v)).join('');
  const flags = p => (p.shield ? 1 : 0) | (p.curse ? 2 : 0) | (p.kick ? 4 : 0) | (p.inv > 0 ? 8 : 0) | (p.mv ? 16 : 0);
  function send() {
    const m = {
      t: 'g', e: 's', rd: round, R: BOMB.R, tl: Math.max(0, Math.ceil(BOMB.CAP - t)), sd: t >= BOMB.SD ? 1 : 0, ph: phase,
      ps: ps.map(p => [p.s, r2(p.x), r2(p.y), p.alive ? 1 : 0, p.dir, flags(p), p.cap, p.fire, Math.round(p.spd * 10), p.curse || '']),
      bm: bombs.map(b => [b.id, r2(b.x), r2(b.y), Math.round(b.t * 10), b.range, b.own]),
      fl: [...flames].map(([i, f]) => [i, f.k]),
      fx,
    };
    if (gdirty || tick % 25 === 0) { m.gd = gridStr(); gdirty = false; }
    H.bc(m);
    fx = [];
  }

  function free(c, r, p) {
    if (c < 0 || r < 0 || c >= GW || r >= GH) return false;
    const g = grid[idx(c, r)];
    if (g === 1 || g === 2) return false;
    const b = bombAt(c, r);
    return !b || (p && b.pass.has(p.s));
  }
  function tryKick(p, c, r, dx, dy) {
    const b = bombAt(c, r);
    if (b && p.kick && !b.vx && !b.vy && bombFree(c + dx, r + dy, b)) { b.vx = dx; b.vy = dy; fx.push(['k', c, r]); }
  }
  function bombFree(c, r, self) {
    if (c < 0 || r < 0 || c >= GW || r >= GH || grid[idx(c, r)] !== 0) return false;
    if (bombs.some(o => o !== self && Math.floor(o.x) === c && Math.floor(o.y) === r)) return false;
    return !ps.some(p => p.alive && Math.floor(p.x) === c && Math.floor(p.y) === r);
  }
  function move(p, d, dist) { // 沿著格子走;偏離中線時自動對齊(轉角輔助)
    const dx = BOMB_DX[d], dy = BOMB_DY[d];
    const c = Math.floor(p.x), r = Math.floor(p.y);
    if (dx) {
      const off = p.y - (r + 0.5);
      if (Math.abs(off) > 0.001) {
        let tr = r;
        if (!free(c + dx, r, p) && Math.abs(off) > 0.12) { const r2_ = r + Math.sign(off); if (free(c + dx, r2_, p) && free(c, r2_, p)) tr = r2_; }
        const ty = tr + 0.5, s = Math.min(Math.abs(ty - p.y), dist);
        p.y += Math.sign(ty - p.y) * s; dist -= s;
        if (Math.abs(p.y - ty) > 0.001) return;
        p.y = ty;
      }
      if (dist <= 0) return;
      const cc = Math.floor(p.x), rr = Math.floor(p.y);
      let nx = p.x + dx * dist;
      if (dx > 0 && nx > cc + 0.5 && !free(cc + 1, rr, p)) { tryKick(p, cc + 1, rr, 1, 0); nx = Math.max(p.x, cc + 0.5); }
      if (dx < 0 && nx < cc + 0.5 && !free(cc - 1, rr, p)) { tryKick(p, cc - 1, rr, -1, 0); nx = Math.min(p.x, cc + 0.5); }
      p.x = nx;
    } else {
      const off = p.x - (c + 0.5);
      if (Math.abs(off) > 0.001) {
        let tc = c;
        if (!free(c, r + dy, p) && Math.abs(off) > 0.12) { const c2 = c + Math.sign(off); if (free(c2, r + dy, p) && free(c2, r, p)) tc = c2; }
        const tx = tc + 0.5, s = Math.min(Math.abs(tx - p.x), dist);
        p.x += Math.sign(tx - p.x) * s; dist -= s;
        if (Math.abs(p.x - tx) > 0.001) return;
        p.x = tx;
      }
      if (dist <= 0) return;
      const cc = Math.floor(p.x), rr = Math.floor(p.y);
      let ny = p.y + dy * dist;
      if (dy > 0 && ny > rr + 0.5 && !free(cc, rr + 1, p)) { tryKick(p, cc, rr + 1, 0, 1); ny = Math.max(p.y, rr + 0.5); }
      if (dy < 0 && ny < rr + 0.5 && !free(cc, rr - 1, p)) { tryKick(p, cc, rr - 1, 0, -1); ny = Math.min(p.y, rr + 0.5); }
      p.y = ny;
    }
  }
  function place(p) {
    if (!p.alive || p.curse === 'nob' || (phase !== 'play' && phase !== 'ending')) return;
    const c = Math.floor(p.x), r = Math.floor(p.y);
    if (bombAt(c, r) || bombs.filter(b => b.own === p.s).length >= p.cap || grid[idx(c, r)] !== 0) return;
    const pass = new Set(ps.filter(q => q.alive && Math.floor(q.x) === c && Math.floor(q.y) === r).map(q => q.s));
    bombs.push({ id: nextId++, x: c + 0.5, y: r + 0.5, t: BOMB.FUSE, own: p.s, range: p.fire, pass, vx: 0, vy: 0 });
    fx.push(['p', c, r]);
  }
  function explode(b0) {
    const queue = [b0];
    while (queue.length) {
      const b = queue.shift();
      if (!bombs.includes(b)) continue;
      bombs = bombs.filter(o => o !== b);
      const c = Math.floor(b.x), r = Math.floor(b.y);
      const put = (i, k) => { const f = flames.get(i); flames.set(i, { t: BOMB.FLAME, k: f && f.k !== k ? 0 : k }); };
      put(idx(c, r), 0);
      fx.push(['b', c, r]);
      for (let d = 1; d <= 4; d++) {
        for (let k = 1; k <= b.range; k++) {
          const cc = c + BOMB_DX[d] * k, rr = r + BOMB_DY[d] * k, i = idx(cc, rr), g = grid[i];
          if (g === 1) break;
          put(i, d % 2 ? 2 : 1);
          if (g === 2) { grid[i] = hid[i] >= 0 ? 10 + hid[i] : 0; hid[i] = -1; gdirty = true; fx.push(['c', cc, rr]); break; }
          if (g >= 10) { grid[i] = 0; gdirty = true; fx.push(['i', cc, rr]); break; }
          const ob = bombAt(cc, rr);
          if (ob) { ob.t = 0; queue.push(ob); }
        }
      }
    }
  }
  function hurt(p) {
    if (!p.alive || p.inv > 0) return;
    if (p.shield) { p.shield = 0; p.inv = 1.3; fx.push(['sh', r2(p.x), r2(p.y), p.s]); return; }
    p.alive = false; p.dir = 0;
    fx.push(['d', r2(p.x), r2(p.y), p.s]);
  }
  function pickup(p) {
    const i = idx(Math.floor(p.x), Math.floor(p.y)), g = grid[i];
    if (g < 10) return;
    const it = BOMB_ITEMS[g - 10];
    grid[i] = 0; gdirty = true;
    if (it.k === 'bomb') p.cap = Math.min(8, p.cap + 1);
    else if (it.k === 'fire') p.fire = Math.min(8, p.fire + 1);
    else if (it.k === 'max') p.fire = 8;
    else if (it.k === 'speed') p.spd = Math.min(6, p.spd + 0.5);
    else if (it.k === 'shield') p.shield = 1;
    else if (it.k === 'kick') p.kick = true;
    else if (it.k === 'skull') { p.curse = pick(Object.keys(BOMB_CURSE)); p.curseT = 10; }
    fx.push(['g', r2(p.x), r2(p.y), p.s, g - 10, p.curse || '']);
  }

  function step() {
    tick++;
    if (phase !== 'play' && phase !== 'ending') return;
    t += dt;
    // 炸彈:倒數、被踢的滑行、離開自己炸彈的人之後就不能再穿過
    for (const b of bombs) {
      const c = Math.floor(b.x), r = Math.floor(b.y);
      b.pass.forEach(s => { const q = ps.find(p => p.s === s); if (!q || !q.alive || Math.floor(q.x) !== c || Math.floor(q.y) !== r) b.pass.delete(s); });
      if (b.vx || b.vy) {
        const sp = 9 * dt;
        if (b.vx) {
          let nx = b.x + b.vx * sp;
          if (((b.vx > 0 && nx > c + 0.5) || (b.vx < 0 && nx < c + 0.5)) && !bombFree(c + b.vx, r, b)) { nx = c + 0.5; b.vx = 0; }
          b.x = nx;
        } else {
          let ny = b.y + b.vy * sp;
          if (((b.vy > 0 && ny > r + 0.5) || (b.vy < 0 && ny < r + 0.5)) && !bombFree(c, r + b.vy, b)) { ny = r + 0.5; b.vy = 0; }
          b.y = ny;
        }
      }
      b.t -= dt;
    }
    bombs.filter(b => b.t <= 0).forEach(explode);
    flames.forEach((f, i) => { if ((f.t -= dt) <= 0) flames.delete(i); });

    for (const p of ps) {
      if (!p.alive) continue;
      if (!H.online(p.s)) { hurt(p); p.alive = false; continue; }
      if (p.inv > 0) p.inv -= dt;
      if (p.curse && (p.curseT -= dt) <= 0) p.curse = null;
      let d = p.dir;
      if (p.curse === 'rev') d = [0, 3, 4, 1, 2][d];
      if (p.curse === 'fast' && !d) d = p.last || 3;
      if (d) p.last = d;
      const spd = p.curse === 'slow' ? 1.6 : p.curse === 'fast' ? 7.5 : p.spd;
      p.mv = !!d;
      if (d) move(p, d, spd * dt);
      if (p.curse === 'auto') place(p);
      pickup(p);
      if (flames.has(idx(Math.floor(p.x), Math.floor(p.y)))) hurt(p);
    }
    // 詛咒會傳染:碰到別人就把詛咒傳過去
    ps.forEach(p => {
      if (!p.alive || !p.curse) return;
      ps.forEach(q => { if (q !== p && q.alive && !q.curse && Math.abs(q.x - p.x) < 0.6 && Math.abs(q.y - p.y) < 0.6) { q.curse = p.curse; q.curseT = p.curseT; fx.push(['cu', r2(q.x), r2(q.y), q.s]); } });
    });
    // 時間到了:場地從外圈開始縮小
    if (phase === 'play' && t >= BOMB.SD && sdI < sdOrder.length) {
      sdAcc += dt;
      while (sdAcc >= 0.3 && sdI < sdOrder.length) {
        sdAcc -= 0.3;
        const i = sdOrder[sdI++], c = i % GW, r = Math.floor(i / GW);
        grid[i] = 1; hid[i] = -1; gdirty = true;
        bombs = bombs.filter(b => Math.floor(b.x) !== c || Math.floor(b.y) !== r);
        ps.forEach(p => { if (p.alive && Math.floor(p.x) === c && Math.floor(p.y) === r) { p.inv = 0; p.shield = 0; hurt(p); } });
        fx.push(['w', c, r]);
      }
    }
    const alive = ps.filter(p => p.alive);
    if (phase === 'play' && (alive.length <= 1 || t >= BOMB.CAP)) { phase = 'ending'; endAt = t + 1.1; }
    send();
    if (phase === 'ending' && t >= endAt) endRound();
  }
  function endRound() {
    phase = 'rend';
    const alive = ps.filter(p => p.alive);
    const w = alive.length === 1 ? alive[0].s : null;
    if (w != null) { wins[w]++; H.scores[w] = wins[w]; H.bc({ t: 'score', scores: H.scores, pop: { slot: w, v: 1 } }); }
    const done = round >= BOMB.R || H.players.some(s => wins[s] >= BOMB.WIN) || H.active().length < 2;
    H.bc({ t: 'g', e: 'rend', w, rd: round, done: done ? 1 : 0, wins });
    H.s.after(3200, () => {
      if (done) return H.finish();
      startRound();
    });
  }
  function startRound() {
    newRound();
    phase = 'cd';
    send();
    H.countdown(() => { phase = 'play'; });
  }

  return {
    start() {
      H.loop(BOMB.TICK, step);
      startRound();
    },
    input(slot, m) {
      const p = ps.find(x => x.s === slot);
      if (!p) return;
      if (m.e === 'mv') p.dir = [0, 1, 2, 3, 4].includes(m.d) ? m.d : 0;
      else if (m.e === 'bomb') place(p);
    },
    presence() {},
  };
}

function vBomb(V) {
  const GW = BOMB.W, GH = BOMB.H, me = V.me;
  const C = canvasStage(V, GW / GH), ctx = C.ctx;
  V.root.classList.add('bombui');
  V.pad.innerHTML = `
    <div class="bdpad"><i class="u">▲</i><i class="r">▶</i><i class="d">▼</i><i class="l">◀</i><b class="knob"></b></div>
    <div class="bside"><div class="bstats"></div><button class="bbomb"><span>💣</span><small>放炸彈</small></button></div>`;
  const dpad = $('.bdpad', V.pad), knob = $('.knob', dpad), bombBtn = $('.bbomb', V.pad), statsEl = $('.bstats', V.pad);
  // 直的拿手機時提醒轉成橫的
  let rotHidden = false;
  const rot = el('div', 'brot', `<div class="bphone">📱</div><b>把手機轉成橫的,畫面更大!</b><small>如果轉不過來,請先關掉手機的「螢幕方向鎖定」</small>
    <div class="brbtns"><button class="btn green sm bfull">全螢幕橫向</button><button class="btn white sm bskip">直的也能玩</button></div>`);
  V.root.appendChild(rot);
  $('.bskip', rot).addEventListener('pointerdown', e => { e.stopPropagation(); rot.classList.add('hide'); rotHidden = true; });
  $('.bfull', rot).addEventListener('pointerdown', async e => {
    e.stopPropagation();
    try {
      await document.documentElement.requestFullscreen();
      await screen.orientation.lock('landscape');
    } catch (err) { toast('這支手機不支援自動轉向,請直接把手機轉橫'); }
    rot.classList.add('hide');
  });

  // 方向:按住方向盤,依手指相對中心的位置決定上下左右
  let dir = 0;
  const setDir = d => {
    if (d === dir) return;
    dir = d;
    V.send({ e: 'mv', d });
    dpad.dataset.d = d;
  };
  let padId = null;
  const padMove = e => {
    const r = dpad.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const lim = r.width * 0.3, len = Math.hypot(dx, dy), k = len > lim ? lim / len : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    if (len < r.width * 0.1) return setDir(0);
    setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : (dy > 0 ? 3 : 1));
  };
  dpad.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    padId = e.pointerId;
    try { dpad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    dpad.classList.add('on');
    padMove(e);
  });
  dpad.addEventListener('pointermove', e => { if (e.pointerId === padId) padMove(e); });
  const padEnd = e => {
    if (e.pointerId !== padId) return;
    padId = null;
    dpad.classList.remove('on');
    knob.style.transform = '';
    setDir(0);
  };
  dpad.addEventListener('pointerup', padEnd);
  dpad.addEventListener('pointercancel', padEnd);
  const dropBomb = () => {
    V.send({ e: 'bomb' });
    bombBtn.classList.remove('hit'); void bombBtn.offsetWidth; bombBtn.classList.add('hit');
    buzz(15);
  };
  bombBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); dropBomb(); });
  const keys = [];
  const kd = d => [() => { keys.push(d); setDir(d); }, () => { const i = keys.lastIndexOf(d); if (i >= 0) keys.splice(i, 1); setDir(keys[keys.length - 1] || 0); }];
  keyCtl(C.cv, { ArrowUp: kd(1), ArrowRight: kd(2), ArrowDown: kd(3), ArrowLeft: kd(4), w: kd(1), d: kd(2), s: kd(3), a: kd(4), ' ': [dropBomb, null], Enter: [dropBomb, null] });

  // 隱藏按鍵:戰場放到最大;螢幕左半邊按住滑動 = 方向盤(跟著手指出現),右半邊點一下 = 放炸彈
  const toggle = el('button', 'btoggle');
  const zl = el('div', 'bzone bzl', '👆 左半邊<br>按住滑動 = 移動'), zr = el('div', 'bzone bzr', '👆 右半邊<br>點一下 = 放炸彈');
  const ring = el('div', 'bring', '<b></b>');
  [toggle, zl, zr, ring].forEach(x => V.root.appendChild(x));
  const setHide = h => {
    V.root.classList.toggle('bhide', h);
    requestAnimationFrame(C.fit);
    toggle.innerHTML = h ? '🎮 顯示按鍵' : '🙈 隱藏按鍵';
    store.set('bombHide', h);
    if (h) { V.root.classList.remove('zused'); clearTimeout(setHide.t); setHide.t = setTimeout(() => V.root.classList.add('zused'), 4000); }
  };
  setHide(!!store.get('bombHide', false));
  toggle.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); setHide(!V.root.classList.contains('bhide')); SFX.tap(); });
  let zId = null, zx = 0, zy = 0;
  V.root.addEventListener('pointerdown', e => {
    if (!V.root.classList.contains('bhide') || e.target.closest('.exit, .btoggle, .brot, button')) return;
    e.preventDefault();
    const r = V.root.getBoundingClientRect();
    if (e.clientX - r.left > r.width / 2) { dropBomb(); return; }
    if (zId != null) return;
    zId = e.pointerId; zx = e.clientX; zy = e.clientY;
    try { V.root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    ring.style.left = (zx - r.left) + 'px'; ring.style.top = (zy - r.top) + 'px';
    $('b', ring).style.transform = '';
    ring.classList.add('on');
  });
  V.root.addEventListener('pointermove', e => {
    if (e.pointerId !== zId) return;
    let dx = e.clientX - zx, dy = e.clientY - zy;
    const len = Math.hypot(dx, dy);
    if (len > 50) { zx = e.clientX - dx / len * 50; zy = e.clientY - dy / len * 50; dx = e.clientX - zx; dy = e.clientY - zy; } // 手指拉太遠時,搖桿中心跟著移過去
    const r = V.root.getBoundingClientRect();
    ring.style.left = (zx - r.left) + 'px'; ring.style.top = (zy - r.top) + 'px';
    const k = Math.min(1, 34 / (Math.hypot(dx, dy) || 1));
    $('b', ring).style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    if (Math.hypot(dx, dy) < 10) return setDir(0);
    setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : (dy > 0 ? 3 : 1));
  });
  const zEnd = e => {
    if (e.pointerId !== zId) return;
    zId = null;
    ring.classList.remove('on');
    setDir(0);
  };
  V.root.addEventListener('pointerup', zEnd);
  V.root.addEventListener('pointercancel', zEnd);

  let st = null, prevP = new Map(), prevB = new Map(), curAt = 0, grid = '', hudTxt = '', statTxt = '';
  const fxs = [], crumbs = [];
  const deadAt = new Map();

  function drawCell(c, r, g, now) {
    if (g === '1') {
      const edge = c === 0 || r === 0 || c === GW - 1 || r === GH - 1;
      ctx.fillStyle = edge ? '#4a5470' : '#5d6984';
      C.rr(c + 0.02, r + 0.02, 0.96, 0.96, 0.14);
      ctx.fillStyle = edge ? '#7a86a3' : '#a3afc8';
      C.rr(c + 0.02, r + 0.02, 0.96, 0.8, 0.14);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fillRect(c + 0.14, r + 0.1, 0.5, 0.07);
    } else if (g === '2') {
      ctx.fillStyle = '#9a5a2a';
      C.rr(c + 0.04, r + 0.04, 0.92, 0.92, 0.1);
      ctx.fillStyle = '#e09a55';
      C.rr(c + 0.04, r + 0.04, 0.92, 0.82, 0.1);
      ctx.fillStyle = '#c47a3a';
      ctx.fillRect(c + 0.04, r + 0.3, 0.92, 0.05);
      ctx.fillRect(c + 0.04, r + 0.58, 0.92, 0.05);
      ctx.fillRect(c + 0.48, r + 0.04, 0.05, 0.26);
      ctx.fillRect(c + 0.26, r + 0.35, 0.05, 0.23);
      ctx.fillRect(c + 0.7, r + 0.35, 0.05, 0.23);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.fillRect(c + 0.1, r + 0.09, 0.32, 0.05);
    } else if (g >= 'a') {
      const it = BOMB_ITEMS[g.charCodeAt(0) - 97], bob = Math.sin(now / 220 + c + r) * 0.04;
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.beginPath(); ctx.ellipse(c + 0.5, r + 0.86, 0.3, 0.08, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      C.rr(c + 0.12, r + 0.1 + bob, 0.76, 0.72, 0.18);
      ctx.fillStyle = it.c;
      C.rr(c + 0.17, r + 0.15 + bob, 0.66, 0.62, 0.14);
      C.emoji(it.e, c + 0.5, r + 0.47 + bob, 0.48);
    }
  }
  function drawBomb(x, y, fuse, now) {
    const hurry = fuse < 0.8, pul = 1 + Math.sin(now / (hurry ? 50 : 130)) * (hurry ? 0.1 : 0.05);
    const rad = 0.36 * pul;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 0.34, 0.3, 0.08, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(x - 0.12, y - 0.12, 0.03, x, y, rad);
    g.addColorStop(0, hurry && Math.floor(now / 90) % 2 ? '#ff6b6b' : '#6a6f80');
    g.addColorStop(1, '#14161f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y + 0.04, rad, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a3f52';
    ctx.fillRect(x - 0.07, y - rad - 0.04, 0.14, 0.1);
    ctx.strokeStyle = '#c9a26a'; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(x, y - rad - 0.03); ctx.quadraticCurveTo(x + 0.12, y - rad - 0.16, x + 0.2, y - rad - 0.12); ctx.stroke();
    const sp = 0.07 + Math.random() * 0.06;
    ctx.fillStyle = Math.random() < 0.5 ? '#ffd23f' : '#ff7a1a';
    ctx.beginPath(); ctx.arc(x + 0.2, y - rad - 0.12, sp, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.arc(x - 0.12, y - 0.08, 0.07, 0, Math.PI * 2); ctx.fill();
  }
  function drawFlame(i, k, now) {
    const c = i % GW, r = Math.floor(i / GW), fl = 0.9 + Math.sin(now / 40 + i) * 0.08;
    const outer = '#ff6d1f', mid = '#ffb52e', core = '#fff6c2';
    const layer = (col, w) => {
      ctx.fillStyle = col;
      if (k === 1) C.rr(c - 0.02, r + 0.5 - w / 2, 1.04, w, w / 2);
      else if (k === 2) C.rr(c + 0.5 - w / 2, r - 0.02, w, 1.04, w / 2);
      else { ctx.beginPath(); ctx.arc(c + 0.5, r + 0.5, w * 0.62, 0, Math.PI * 2); ctx.fill(); }
    };
    ctx.save();
    ctx.shadowColor = '#ff9a2e'; ctx.shadowBlur = 12;
    layer(outer, 0.86 * fl);
    ctx.restore();
    layer(mid, 0.6 * fl);
    layer(core, 0.3 * fl);
  }
  function drawPlayer(q, x, y, now) {
    const s = q[0], f = q[5], P = PLAYERS[s];
    const bob = f & 16 ? Math.abs(Math.sin(now / 80)) * 0.08 : 0;
    if (f & 8 && Math.floor(now / 80) % 2) return; // 剛被防護罩救一命:閃爍
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 0.36, 0.3, 0.09, 0, 0, Math.PI * 2); ctx.fill();
    if (s === me) {
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 0.08;
      ctx.beginPath(); ctx.ellipse(x, y + 0.36, 0.38, 0.13, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = P.color;
    ctx.beginPath(); ctx.arc(x, y + 0.1 - bob, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1f3864'; ctx.lineWidth = 0.05; ctx.stroke();
    C.char(s, x, y - 0.12 - bob, 0.92, true);
    if (f & 1) {
      ctx.strokeStyle = `rgba(90,180,255,${0.6 + Math.sin(now / 150) * 0.25})`; ctx.lineWidth = 0.07;
      ctx.beginPath(); ctx.arc(x, y - 0.05, 0.55, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(120,200,255,.15)'; ctx.fill();
    }
    if (f & 2) {
      ctx.fillStyle = `rgba(140,40,200,${0.25 + Math.sin(now / 90) * 0.15})`;
      ctx.beginPath(); ctx.arc(x, y - 0.05, 0.55, 0, Math.PI * 2); ctx.fill();
      C.emoji('💀', x + 0.34, y - 0.5, 0.32);
    }
  }
  function draw() {
    C.size(GW);
    const now = performance.now();
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#86d36f' : '#7bc964';
      ctx.fillRect(c, r, 1.01, 1.01);
    }
    if (!st || !grid) return;
    const a = Math.min(1, (now - curAt) / BOMB.TICK);
    for (let i = 0; i < grid.length; i++) {
      const g = grid[i];
      if (g === '1' || g === '2') {
        ctx.fillStyle = 'rgba(0,0,0,.16)';
        ctx.fillRect(i % GW + 0.06, Math.floor(i / GW) + 0.9, 0.94, 0.14);
      }
    }
    for (let i = 0; i < grid.length; i++) if (grid[i] !== '0') drawCell(i % GW, Math.floor(i / GW), grid[i], now);
    for (let i = crumbs.length - 1; i >= 0; i--) { // 木箱被炸碎的碎片
      const k = crumbs[i], age = (now - k.t) / 450;
      if (age >= 1) { crumbs.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = '#c47a3a';
      for (let j = 0; j < 5; j++) {
        const ang = j * 1.3 + k.c, d = age * 0.6;
        ctx.fillRect(k.c + 0.5 + Math.cos(ang) * d - 0.08, k.r + 0.5 + Math.sin(ang) * d - 0.08 + age * age * 0.3, 0.16, 0.16);
      }
      ctx.globalAlpha = 1;
    }
    st.bm.forEach(b => {
      const p = prevB.get(b[0]);
      const x = p ? p[1] + (b[1] - p[1]) * a : b[1], y = p ? p[2] + (b[2] - p[2]) * a : b[2];
      drawBomb(x, y, b[3] / 10, now);
    });
    st.fl.forEach(([i, k]) => drawFlame(i, k, now));
    st.ps.slice().sort((p, q) => p[2] - q[2]).forEach(q => {
      if (!q[3]) return;
      const p = prevP.get(q[0]);
      let x = q[1], y = q[2];
      if (p && Math.abs(p[1] - x) + Math.abs(p[2] - y) < 1.5) { x = p[1] + (x - p[1]) * a; y = p[2] + (y - p[2]) * a; }
      drawPlayer(q, x, y, now);
    });
    for (let i = fxs.length - 1; i >= 0; i--) {
      const f = fxs[i], age = now - f.t;
      if (age > f.life) { fxs.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = 1 - age / f.life;
      if (f.text) {
        ctx.font = `900 ${0.42}px "Fredoka","Noto Sans TC",sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 0.1; ctx.strokeStyle = '#1f3864'; ctx.fillStyle = '#fff';
        ctx.strokeText(f.text, f.x, f.y - age / 900);
        ctx.fillText(f.text, f.x, f.y - age / 900);
      } else C.emoji(f.e, f.x, f.y - age / 700, f.size + age / 2000);
      ctx.restore();
    }
    if (st.sd) { // 場地縮小中:畫面邊緣紅光
      ctx.strokeStyle = `rgba(255,40,60,${0.35 + Math.sin(now / 160) * 0.2})`;
      ctx.lineWidth = 0.18;
      ctx.strokeRect(0.09, 0.09, GW - 0.18, GH - 0.18);
    }
  }
  const loop = () => { if (!C.alive()) return; draw(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  function updateHud() {
    const mm = Math.floor(st.tl / 60), ss = String(st.tl % 60).padStart(2, '0');
    const alive = st.ps.filter(p => p[3]).length;
    const meP = st.ps.find(p => p[0] === me);
    let txt = `<span>第 <b>${st.rd}</b> / ${st.R} 局</span><span>⏱ ${mm}:${ss}</span><span>存活 ${alive}/${st.ps.length}</span>`;
    if (st.sd) txt += '<span class="bwarn">⚠️ 場地縮小中!</span>';
    if (meP && !meP[3]) txt += '<span class="dead">👻 你被炸飛了,看大家對決!</span>';
    if (txt !== hudTxt) { hudTxt = txt; C.hud.innerHTML = txt; }
    let s2 = '';
    if (meP) {
      const f = meP[5];
      s2 = `<span>💣<b>${meP[6]}</b></span><span>🔥<b>${meP[7]}</b></span><span>👟<b>${Math.round((meP[8] - 30) / 5) + 1}</b></span>`
        + (f & 1 ? '<span class="on">🛡️</span>' : '') + (f & 4 ? '<span class="on">🦶</span>' : '')
        + (meP[9] ? `<span class="cur">${BOMB_CURSE[meP[9]]}</span>` : '');
    }
    if (s2 !== statTxt) { statTxt = s2; statsEl.innerHTML = s2; }
  }

  V.on = m => {
    if (m.e === 's') {
      if (m.gd) {
        if (grid && m.gd.length === grid.length) for (let i = 0; i < grid.length; i++) if (grid[i] === '2' && m.gd[i] !== '2' && m.gd[i] !== '1') crumbs.push({ c: i % GW, r: Math.floor(i / GW), t: performance.now() });
        grid = m.gd;
      }
      prevP = st ? new Map(st.ps.map(p => [p[0], p])) : new Map();
      prevB = st ? new Map(st.bm.map(b => [b[0], b])) : new Map();
      if (st && m.rd !== st.rd) { prevP = new Map(); prevB = new Map(); crumbs.length = 0; }
      st = m;
      curAt = performance.now();
      const now = performance.now();
      m.fx.forEach(f => {
        const k = f[0];
        if (k === 'b') { beep(70, 0.35, 'sawtooth', 0.12); beep(45, 0.4, 'square', 0.08, 0.02); }
        else if (k === 'p') beep(240, 0.06, 'square', 0.05);
        else if (k === 'k') beep(420, 0.08, 'triangle', 0.1);
        else if (k === 'g') {
          const it = BOMB_ITEMS[f[4]];
          fxs.push({ text: f[3] === me && f[5] ? BOMB_CURSE[f[5]] : it.n, x: f[1], y: f[2] - 0.6, t: now, life: 1100 });
          if (f[3] === me) { if (it.k === 'skull') SFX.bad(); else SFX.good(); buzz(25); }
        } else if (k === 'd') {
          fxs.push({ e: '👻', x: f[1], y: f[2] - 0.2, size: 0.8, t: now, life: 1400 });
          fxs.push({ e: '💥', x: f[1], y: f[2], size: 1, t: now, life: 500 });
          if (f[3] === me) { SFX.bad(); buzz([120, 60, 200]); }
        } else if (k === 'sh') {
          fxs.push({ e: '🛡️', x: f[1], y: f[2] - 0.4, size: 0.7, t: now, life: 800 });
          beep(990, 0.12, 'sine', 0.12);
        } else if (k === 'cu') fxs.push({ e: '💀', x: f[1], y: f[2] - 0.5, size: 0.6, t: now, life: 900 });
        else if (k === 'w') beep(150, 0.05, 'square', 0.04);
      });
      updateHud();
    } else if (m.e === 'rend') {
      setDir(0);
      const w = m.w;
      const board = st ? st.ps.map(p => `<span class="vsp">${pinfo(p[0]).emoji}<b>${'⭐'.repeat(m.wins[p[0]] || 0) || '·'}</b></span>`).join('') : '';
      C.overlay(`<div class="big">${w == null ? '🤝' : w === me ? '🏆' : '💥'}</div>
        <div>${w == null ? '同歸於盡,這局平手!' : `${w === me ? '你' : esc(pinfo(w).name)} 贏了第 ${m.rd} 局!`}</div>
        <div class="vsrow">${board}</div><div class="small">${m.done ? '比賽結束!' : '下一局馬上開始…'}</div>`, 3000);
      if (w === me) SFX.win(); else SFX.tick();
    }
  };
}

/* =========================================================
   跳棋(中國跳棋)🔮:2~4 人,121 個洞的六角星棋盤,每人 10 顆彈珠
   每回合走一步到旁邊的空洞,或連續跳過別的彈珠;最先把 10 顆全部移到對面三角形的人獲勝
   座標用立方座標 (q, r, s),q + r + s = 0;畫面上 r 方向是左右,所以橫著看最舒服
   ========================================================= */
const CHK = (() => {
  const cells = [], at = new Map();
  for (let q = -8; q <= 8; q++) for (let r = -8; r <= 8; r++) {
    const s = -q - r;
    const t1 = q <= 4 && r <= 4 && s <= 4, t2 = q >= -4 && r >= -4 && s >= -4;
    if (!(t1 || t2) || Math.abs(s) > 8) continue;
    at.set(q + ',' + r, cells.length);
    cells.push({ q, r, s, x: r * 1.5, y: Math.sqrt(3) * (q + r / 2) });
  }
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const nb = cells.map(c => DIRS.map(([dq, dr]) => { const j = at.get((c.q + dq) + ',' + (c.r + dr)); return j == null ? -1 : j; }));
  // 六個角的三角形,依順時針排;第 k 個的對面是 (k + 3) % 6
  const TRI = [['s', -1], ['q', 1], ['r', -1], ['s', 1], ['q', -1], ['r', 1]];
  const tri = TRI.map(([ax, sg]) => cells.map((c, i) => (sg * c[ax] >= 5 ? i : -1)).filter(i => i >= 0));
  return { cells, nb, TRI, tri, N: cells.length };
})();
const CHK_HOMES = { 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 5] };
const chkGoal = k => (k + 3) % 6;
const chkProg = (k, i) => -CHK.TRI[k][1] * CHK.cells[i][CHK.TRI[k][0]]; // 離自己家越遠(越靠近終點)越大:-8 ~ 8
function chkReach(occ, from) { // 從 from 出發能到的所有洞,以及走法(連續跳的每一站)
  const out = new Map();
  CHK.nb[from].forEach(j => { if (j >= 0 && occ[j] < 0) out.set(j, [from, j]); });
  const seen = new Set([from]), q = [[from, [from]]];
  while (q.length) {
    const [i, path] = q.shift();
    for (let d = 0; d < 6; d++) {
      const m = CHK.nb[i][d];
      if (m < 0 || occ[m] < 0) continue;
      const j = CHK.nb[m][d];
      if (j < 0 || occ[j] >= 0 || seen.has(j)) continue;
      seen.add(j);
      const p = path.concat(j);
      if (!out.has(j)) out.set(j, p);
      q.push([j, p]);
    }
  }
  return out;
}
// 電腦(也用在時間到時幫人自動走一步):往終點前進最多、優先移動最後面的彈珠、盡量走中線
function chkBestMove(occ, s, k, noise) {
  const goal = new Set(CHK.tri[chkGoal(k)]);
  const ax = CHK.TRI[k][0], others = ['q', 'r', 's'].filter(a => a !== ax);
  const lat = i => Math.abs(CHK.cells[i][others[0]] - CHK.cells[i][others[1]]);
  const mine = [];
  occ.forEach((o, i) => { if (o === s) mine.push(i); });
  const back = Math.min(...mine.map(i => chkProg(k, i)));
  let best = null;
  for (const f of mine) {
    chkReach(occ, f).forEach((path, t) => {
      const gain = chkProg(k, t) - chkProg(k, f);
      let sc = gain * 10 - (lat(t) - lat(f)) * 1.2;
      if (gain > 0 && chkProg(k, f) === back) sc += 4; // 落後的先走,別留尾巴
      if (goal.has(t) && !goal.has(f)) sc += 6;
      if (goal.has(f) && !goal.has(t)) sc -= 30;
      if (gain < 0) sc -= 8;
      sc += (Math.random() - 0.5) * noise;
      if (!best || sc > best.sc) best = { sc, f, t, path };
    });
  }
  return best;
}

function hCheckers(H) {
  const n = Math.min(4, H.players.length), P = shuffle(H.players.slice()).slice(0, n);
  const homes = {};
  P.forEach((s, i) => { homes[s] = CHK_HOMES[n][i]; });
  const occ = new Array(CHK.N).fill(-1);
  P.forEach(s => CHK.tri[homes[s]].forEach(i => { occ[i] = s; }));
  let turnI = 0, turns = 0, last = null, over = false, tok = 0, moveId = 0;
  const MAX = 70 * n, TURN_MS = 40000;
  const inGoal = s => CHK.tri[chkGoal(homes[s])].filter(i => occ[i] === s).length;
  const pct = s => { let t = 0; occ.forEach((o, i) => { if (o === s) t += (chkProg(homes[s], i) + 8) / 16; }); return Math.round(t * 10); };
  const bc = extra => H.bc({ t: 'g', e: 'st', occ, order: P, homes, turn: P[turnI], last, turns, max: MAX, goal: Object.fromEntries(P.map(s => [s, inGoal(s)])), left: TURN_MS, ...(extra || {}) });
  function arm() {
    const my = ++tok, s = P[turnI];
    H.s.after(TURN_MS, () => { if (my === tok && !over) { const b = chkBestMove(occ, s, homes[s], 2); if (b) apply(s, b.f, b.t, b.path, true); } });
  }
  function end(winner, reason) {
    over = true; tok++;
    P.forEach(s => { H.scores[s] = s === winner ? 100 : Math.min(99, pct(s)); });
    bc({ done: 1, winner, reason });
    H.bc({ t: 'score', scores: H.scores });
    H.s.after(3600, H.finish);
  }
  function next() {
    for (let k = 0; k < P.length; k++) {
      turnI = (turnI + 1) % P.length;
      if (H.online(P[turnI])) { bc(); return arm(); }
    }
    end(null, '大家都離開了');
  }
  function apply(s, f, t, path, auto) {
    occ[f] = -1; occ[t] = s;
    turns++;
    last = { s, path, id: ++moveId, auto: !!auto };
    if (inGoal(s) === 10) return end(s, '10 顆彈珠全部到達終點!');
    if (turns >= MAX) {
      const best = P.slice().sort((a, b) => inGoal(b) - inGoal(a) || pct(b) - pct(a))[0];
      return end(best, '下太久了!比誰最接近終點');
    }
    next();
  }
  return {
    start() { bc({ intro: 1 }); H.s.after(1800, () => { bc(); arm(); }); },
    input(slot, m) {
      if (over || m.e !== 'move' || slot !== P[turnI]) return;
      const f = +m.from, t = +m.to;
      if (!(f >= 0 && f < CHK.N) || occ[f] !== slot) return;
      const path = chkReach(occ, f).get(t);
      if (!path) return;
      tok++;
      apply(slot, f, t, path);
    },
    presence() {
      if (over) return;
      if (P.filter(H.online).length < 2) return end(P.find(H.online), '其他人都離開了');
      if (!H.online(P[turnI])) { tok++; next(); }
    },
  };
}

function vCheckers(V) {
  const me = V.me;
  let st = null, sel = -1, dests = new Map(), animating = false, over = false, lastId = 0, timerT = null;
  const chipsEl = $('.chips', V.root);
  chipsEl.className = 'cstatus';
  chipsEl.innerHTML = '<span class="cs">擺好彈珠…</span>';
  V.renderChips = () => {};
  V.root.classList.add('chkui');

  const xs = CHK.cells.map(c => c.x), ys = CHK.cells.map(c => c.y);
  const minX = Math.min(...xs) - 1.8, maxX = Math.max(...xs) + 1.8, minY = Math.min(...ys) - 1.5, maxY = Math.max(...ys) + 1.5;
  const SQ3 = Math.sqrt(3);
  // 棋盤外框:六角形,頂點對準六個角
  const hexPts = [0, 1, 2, 3, 4, 5].map(k => { const a = Math.PI / 3 * k; return [Math.cos(a) * 13.7, Math.sin(a) * 13.7]; });
  const edges = [];
  CHK.nb.forEach((ns, i) => ns.forEach(j => { if (j > i) edges.push(`M${CHK.cells[i].x.toFixed(2)} ${CHK.cells[i].y.toFixed(2)}L${CHK.cells[j].x.toFixed(2)} ${CHK.cells[j].y.toFixed(2)}`); }));
  const triPoly = k => { // 三角形的三個角(在三角形裡只有 2 個鄰居的洞),往外撐一點
    const set = new Set(CHK.tri[k]);
    const corners = CHK.tri[k].filter(i => CHK.nb[i].filter(j => set.has(j)).length === 2);
    const cx = corners.reduce((a, i) => a + CHK.cells[i].x, 0) / 3, cy = corners.reduce((a, i) => a + CHK.cells[i].y, 0) / 3;
    return corners.map(i => `${(cx + (CHK.cells[i].x - cx) * 1.5).toFixed(2)},${(cy + (CHK.cells[i].y - cy) * 1.5).toFixed(2)}`).join(' ');
  };

  V.stage('<div class="chseats"></div>');
  V.pad.innerHTML = `
    <div class="chwrap">
      <svg class="chsvg" viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${(maxX - minX).toFixed(2)} ${(maxY - minY).toFixed(2)}">
        <defs>
          <radialGradient id="chWood" cx="50%" cy="42%" r="65%"><stop offset="0" stop-color="#d9a56a"/><stop offset=".6" stop-color="#b9783f"/><stop offset="1" stop-color="#7a4a22"/></radialGradient>
          <filter id="chGrain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.035 0.6" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .35  0 0 0 0 .2  0 0 0 0 .08  0 0 0 .55 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
          <radialGradient id="chGlass" cx="36%" cy="30%" r="72%"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".32" stop-color="#fff" stop-opacity=".06"/><stop offset=".78" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
          <radialGradient id="chHole" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#2b1606"/><stop offset=".75" stop-color="#4a2a10"/><stop offset="1" stop-color="#8a5a2c"/></radialGradient>
          <filter id="chShadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx=".12" dy=".22" stdDeviation=".14" flood-color="#000" flood-opacity=".55"/></filter>
          <filter id="chLift" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx=".35" dy=".7" stdDeviation=".3" flood-color="#000" flood-opacity=".45"/></filter>
        </defs>
        <polygon class="chrim" points="${hexPts.map(p => p.join(',')).join(' ')}"/>
        <polygon class="chbase" points="${hexPts.map(p => p.join(',')).join(' ')}"/>
        <polygon class="chgrain" points="${hexPts.map(p => p.join(',')).join(' ')}" filter="url(#chGrain)"/>
        <g class="chtris">${[0, 1, 2, 3, 4, 5].map(k => `<polygon data-k="${k}" points="${triPoly(k)}"/>`).join('')}</g>
        <path class="chlines" d="${edges.join('')}"/>
        <g class="chholes">${CHK.cells.map((c, i) => `<circle data-i="${i}" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r=".46"/>`).join('')}</g>
        <path class="chtrail" d=""/>
        <g class="chdests"></g>
        <g class="chballs"></g>
      </svg>
      <div class="cover"></div>
    </div>
    <div class="chinfo"><div class="chturn"></div><div class="chtip">點自己的彈珠,再點亮起來的洞</div></div>`;
  const svg = $('.chsvg', V.pad), ballsG = $('.chballs', svg), destsG = $('.chdests', svg), trail = $('.chtrail', svg), cover = $('.cover', V.pad);
  const turnEl = $('.chturn', V.pad), tipEl = $('.chtip', V.pad);
  const balls = new Map(); // 洞的編號 → 彈珠元素

  // 直的拿手機時提醒轉成橫的(也可以直接玩)
  const rot = el('div', 'brot', `<div class="bphone">📱</div><b>把手機轉成橫的,棋盤更大!</b><small>如果轉不過來,請先關掉手機的「螢幕方向鎖定」</small>
    <div class="brbtns"><button class="btn green sm bfull">全螢幕橫向</button><button class="btn white sm bskip">直的也能玩</button></div>`);
  if (store.get('chkPortrait', false)) rot.classList.add('hide');
  V.root.appendChild(rot);
  $('.bskip', rot).addEventListener('pointerdown', e => { e.stopPropagation(); rot.classList.add('hide'); store.set('chkPortrait', true); });
  $('.bfull', rot).addEventListener('pointerdown', async e => {
    e.stopPropagation();
    try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } catch (err) { toast('這支手機不支援自動轉向,請直接把手機轉橫'); }
    rot.classList.add('hide');
  });

  const who = s => (s === me ? '你' : esc(pinfo(s).name));
  const myTurn = () => st && !over && !animating && st.turn === me;
  const ballEl = (s, i) => {
    const c = CHK.cells[i];
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'chball');
    g.dataset.s = s;
    g.innerHTML = `<circle class="b0" r=".7" style="fill:${pinfo(s).color}"/><circle class="b1" r=".7"/><ellipse class="b2" cx="-.22" cy="-.27" rx=".24" ry=".15"/>`;
    g.setAttribute('transform', `translate(${c.x.toFixed(3)} ${c.y.toFixed(3)})`);
    g.dataset.i = i;
    return g;
  };
  function rebuild() {
    ballsG.innerHTML = '';
    balls.clear();
    st.occ.forEach((s, i) => { if (s >= 0) { const b = ballEl(s, i); ballsG.appendChild(b); balls.set(i, b); } });
  }
  function paintTris() {
    $$('.chtris polygon', svg).forEach(p => {
      const k = +p.dataset.k;
      const owner = st.order.find(s => st.homes[s] === k), target = st.order.find(s => chkGoal(st.homes[s]) === k);
      const s = owner != null ? owner : target;
      p.style.fill = s != null ? pinfo(s).color : '#c99a63';
      p.style.opacity = owner != null ? 0.5 : target != null ? 0.32 : 0.18;
    });
  }
  function renderSeats() {
    $('.chseats', V.root).innerHTML = st.order.map(s => {
      const p = pinfo(s), g = st.goal[s] || 0;
      return `<div class="chseat${st.turn === s && !over ? ' now' : ''}${s === me ? ' me' : ''}${p.online ? '' : ' off'}" style="--pc:${p.color}">
        <span class="chav">${p.emoji}</span><b>${who(s)}</b><i class="chdot"></i>
        <span class="chprog"><i style="width:${g * 10}%"></i></span><small>終點 ${g}/10</small></div>`;
    }).join('');
  }
  function renderStatus() {
    clearInterval(timerT);
    const s = st.turn, upd = () => {
      const left = Math.max(0, Math.ceil((st.deadline - Date.now()) / 1000));
      let msg;
      if (over) msg = '這局結束了';
      else if (myTurn()) msg = sel >= 0 ? '點亮起來的洞移動過去(可以連跳!)' : `輪到你了!選一顆彈珠${left <= 15 ? ` ⏰${left}` : ''}`;
      else msg = (st.order.includes(me) ? '' : '👀 觀戰 · ') + `${pinfo(s).emoji} ${who(s)} 思考中…${left <= 15 ? ` ⏰${left}` : ''}`;
      chipsEl.innerHTML = `<span class="cs${myTurn() ? ' on' : ''}">${msg}</span>`;
    };
    upd();
    if (!over) timerT = setInterval(() => { if (!svg.isConnected) return clearInterval(timerT); upd(); }, 1000);
    turnEl.innerHTML = over ? '' : `<span class="chav big" style="--pc:${pinfo(s).color}">${pinfo(s).emoji}</span><b>${s === me ? '輪到你!' : who(s) + ' 的回合'}</b><small>第 ${Math.floor(st.turns / st.order.length) + 1} 輪</small>`;
    V.root.classList.toggle('myturn', myTurn());
  }
  function showDests() {
    destsG.innerHTML = '';
    $$('.chball', ballsG).forEach(b => b.classList.toggle('sel', +b.dataset.i === sel));
    $$('.chball', ballsG).forEach(b => b.classList.toggle('can', myTurn() && sel < 0 && +b.dataset.s === me && chkReach(st.occ, +b.dataset.i).size > 0));
    if (sel < 0) return;
    dests.forEach((path, t) => {
      const c = CHK.cells[t];
      destsG.insertAdjacentHTML('beforeend', `<g class="chdest${path.length > 2 || chkJump(path) ? ' jump' : ''}" data-i="${t}" transform="translate(${c.x.toFixed(3)} ${c.y.toFixed(3)})"><circle r=".62"/><circle class="in" r=".28"/></g>`);
    });
  }
  const chkJump = path => path.length === 2 && !CHK.nb[path[0]].includes(path[1]);
  function drawTrail(path) {
    trail.setAttribute('d', path ? 'M' + path.map(i => `${CHK.cells[i].x.toFixed(2)} ${CHK.cells[i].y.toFixed(2)}`).join('L') : '');
    trail.style.stroke = path ? pinfo(st.last.s).color : '';
  }
  let finishAnim = null; // 正在跑的動畫:新的一步來了就直接跳到結尾
  function animate(path, done) {
    if (finishAnim) finishAnim();
    const b = balls.get(path[0]);
    if (!b) return done();
    animating = true;
    balls.delete(path[0]);
    b.classList.add('lift');
    ballsG.appendChild(b);
    let k = 1, ended = false;
    const end = () => {
      if (ended) return;
      ended = true; finishAnim = null; clearTimeout(safety);
      const t = path[path.length - 1], c = CHK.cells[t];
      b.setAttribute('transform', `translate(${c.x.toFixed(3)} ${c.y.toFixed(3)})`);
      b.classList.remove('lift'); balls.set(t, b); b.dataset.i = t; animating = false;
      done();
    };
    finishAnim = end;
    // 手機螢幕變暗或切到別的 App 時 requestAnimationFrame 會暫停,用計時器保證動畫一定會結束
    const total = path.slice(1).reduce((t, j, n) => t + (chkJumpStep(path[n], j) ? 260 : 180), 0);
    const safety = setTimeout(end, total + 400);
    const hop = () => {
      if (ended) return;
      if (k >= path.length) return end();
      const a = CHK.cells[path[k - 1]], z = CHK.cells[path[k]], t0 = performance.now(), dur = chkJumpStep(path[k - 1], path[k]) ? 260 : 180;
      const fr = now => {
        if (ended || !svg.isConnected) return;
        const u = Math.min(1, (now - t0) / dur), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        const lift = Math.sin(u * Math.PI) * (dur > 200 ? 0.22 : 0.08);
        b.setAttribute('transform', `translate(${(a.x + (z.x - a.x) * e).toFixed(3)} ${(a.y + (z.y - a.y) * e).toFixed(3)}) scale(${(1 + lift).toFixed(3)})`);
        if (u < 1) requestAnimationFrame(fr);
        else { beep(dur > 200 ? 520 + k * 60 : 440, 0.05, 'triangle', 0.12); k++; hop(); }
      };
      requestAnimationFrame(fr);
    };
    hop();
  }
  const chkJumpStep = (a, b) => !CHK.nb[a].includes(b);

  V.onTap = e => {
    if (!myTurn()) return;
    const d = e.target.closest('.chdest');
    if (d) {
      const t = +d.dataset.i;
      V.send({ e: 'move', from: sel, to: t });
      sel = -1; dests = new Map(); destsG.innerHTML = '';
      SFX.tap();
      return;
    }
    const b = e.target.closest('.chball, .chholes circle');
    const i = b ? +b.dataset.i : -1;
    if (i >= 0 && st.occ[i] === me) {
      sel = sel === i ? -1 : i;
      dests = sel >= 0 ? chkReach(st.occ, sel) : new Map();
      if (sel >= 0 && !dests.size) toast('這顆現在走不動喔');
      SFX.tap();
    } else { sel = -1; dests = new Map(); }
    showDests();
    renderStatus();
  };

  V.on = m => {
    if (m.e !== 'st') return;
    const prev = st;
    st = m;
    st.deadline = Date.now() + (m.left || 0); // 用自己的時鐘倒數,不受各手機時間不同影響
    if (m.intro) {
      paintTris(); rebuild(); renderSeats();
      const mine = m.order.includes(me);
      cover.innerHTML = `<div class="big">🔮</div><div>${mine ? '把你的彈珠全部移到<b>對面</b>的三角形!' : '觀戰中'}</div><div class="small">可以一次連續跳過好幾顆彈珠</div>`;
      cover.classList.add('on');
      SFX.go();
      setTimeout(() => cover.classList.remove('on'), 2200);
      renderStatus();
      return;
    }
    if (!prev || !balls.size) { paintTris(); rebuild(); }
    sel = -1; dests = new Map(); destsG.innerHTML = '';
    const fin = () => {
      if (!st) return;
      if (balls.size !== st.occ.filter(o => o >= 0).length || [...balls].some(([i, b]) => st.occ[i] !== +b.dataset.s)) rebuild();
      drawTrail(st.last && st.last.path);
      renderSeats(); showDests(); renderStatus();
      if (st.turn === me && !over && (!prev || prev.turn !== me)) { buzz(50); SFX.join(); }
    };
    if (m.last && m.last.id !== lastId) {
      lastId = m.last.id;
      if (m.last.auto && m.last.s === me) toast('時間到,幫你自動走了一步');
      drawTrail(null);
      animate(m.last.path, fin);
    } else fin();
    renderSeats();
    if (m.done) {
      over = true;
      setTimeout(() => {
        const w = m.winner;
        cover.innerHTML = `<div class="big">${w === me ? '🏆' : '🔮'}</div>
          <div class="vsrow">${w != null ? `<span class="vsp">${pinfo(w).emoji}<b>${who(w)} 獲勝!</b></span>` : ''}</div><div class="small">${esc(m.reason)}</div>`;
        cover.classList.add('on');
        if (w === me) SFX.win(); else SFX.bad();
      }, 1200);
    }
  };
}

/* =========================================================
   填色大作戰 🌊(Flood-It 競速):大家拿到一模一樣的棋盤,
   每一步選一個顏色,把左上角的區域塗成那個顏色、吞掉相連的同色格子;
   在步數限制內把整個棋盤變成同一色,最快完成的人得分最多。3 局,棋盤一局比一局大
   ========================================================= */
const FLOOD = { SIZES: [14, 18, 22], PTS: [3, 2, 1, 1] };
const floodTime = n => 60 + n * 4; // 每局秒數:棋盤越大給越久(14×14 116 秒、22×22 148 秒)
const FLOOD_COLORS = ['#dc4820', '#f0f41c', '#7c9c1c', '#44b0e0', '#605ca8', '#ec70a0'];
const FLOOD_NAMES = ['紅', '黃', '綠', '藍', '紫', '粉'];
// 純黑底、一格一格平面方塊(格子之間只有細細一條縫);剛吞進來的格子會閃白光再縮回來
function floodPaint(ctx, g, n, W, anim, now) {
  const cs = W / n, gap = Math.max(0.6, cs * 0.045);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, W);
  let busy = false;
  for (let i = 0; i < n * n; i++) {
    const x = (i % n) * cs, y = ((i / n) | 0) * cs;
    let sc = 1, flash = 0;
    const t0 = anim && anim.get(i);
    if (t0 != null) {
      const u = (now - t0) / 260;
      if (u < 0) busy = true;
      else if (u < 1) { busy = true; sc = 0.6 + 0.4 * (1 - (1 - u) ** 3); flash = 1 - u; }
      else anim.delete(i);
    }
    const w = (cs - gap) * sc, ox = x + (cs - w) / 2, oy = y + (cs - w) / 2;
    ctx.fillStyle = FLOOD_COLORS[g[i]];
    ctx.fillRect(ox, oy, w, w);
    if (flash) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.55})`; ctx.fillRect(ox, oy, w, w); }
  }
  return busy;
}
function floodRegion(g, n) { // 跟左上角相連、同顏色的格子
  const c0 = g[0], seen = new Uint8Array(n * n), q = [0];
  seen[0] = 1;
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % n, y = (i / n) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1]) {
      if (j >= 0 && !seen[j] && g[j] === c0) { seen[j] = 1; q.push(j); }
    }
  }
  return q;
}
function floodApply(g, n, c) { // 回傳這一步新吞進來的格子(依距離排好,畫漣漪動畫用)
  const before = new Set(floodRegion(g, n));
  before.forEach(i => { g[i] = c; });
  return floodRegion(g, n).filter(i => !before.has(i));
}
const floodDone = (g, n) => floodRegion(g, n).length === n * n;
function floodGreedy(g0, n) { // 貪心解:每步選吞最多格的顏色(也是電腦的走法、步數限制的基準)
  const g = g0.slice(), seq = [];
  while (!floodDone(g, n) && seq.length < 200) {
    let best = -1, bc = 0;
    for (let c = 0; c < FLOOD_COLORS.length; c++) {
      if (c === g[0]) continue;
      const t = g.slice();
      floodApply(t, n, c);
      const sz = floodRegion(t, n).length;
      if (sz > best) { best = sz; bc = c; }
    }
    floodApply(g, n, bc);
    seq.push(bc);
  }
  return seq;
}

function hFlood(H) {
  let round = 0, phase = 'idle', n = 10, grid = null, limit = 0, t0 = 0, tok = 0;
  const tot = {}, ps = {};
  H.players.forEach(s => { tot[s] = 0; });
  function startRound() {
    round++;
    n = FLOOD.SIZES[round - 1];
    grid = Array.from({ length: n * n }, () => rand(0, FLOOD_COLORS.length - 1));
    limit = floodGreedy(grid, n).length + 1;
    H.players.forEach(s => { ps[s] = { g: grid.slice(), steps: 0, done: 0, fail: false, ms: 0 }; });
    phase = 'cd';
    H.bc({ t: 'g', e: 'prep', rd: round, R: FLOOD.SIZES.length, n });
    H.countdown(() => {
      phase = 'play';
      t0 = Date.now();
      H.bc({ t: 'g', e: 'round', rd: round, R: FLOOD.SIZES.length, n, grid: grid.join(''), limit, T: floodTime(n), order: H.players });
      const my = ++tok;
      H.s.after(floodTime(n) * 1000, () => { if (my === tok && phase === 'play') endRound(); });
    });
  }
  const finishers = () => H.players.filter(s => ps[s].done).sort((a, b) => ps[a].done - ps[b].done);
  function endRound() {
    phase = 'rend'; tok++;
    const fin = finishers(), pts = {};
    fin.forEach((s, k) => { pts[s] = FLOOD.PTS[k] || 1; tot[s] += pts[s]; });
    H.players.forEach(s => { H.scores[s] = tot[s]; });
    H.bc({ t: 'score', scores: H.scores });
    H.bc({ t: 'g', e: 'rend', rd: round, fin, pts, tot, ms: Object.fromEntries(fin.map(s => [s, ps[s].ms])), steps: Object.fromEntries(H.players.map(s => [s, ps[s].steps])), last: round >= FLOOD.SIZES.length });
    H.s.after(4200, () => (round >= FLOOD.SIZES.length ? H.finish() : startRound()));
  }
  const allDone = () => H.active().every(s => ps[s].done || ps[s].fail);
  return {
    start() { startRound(); },
    input(slot, m) {
      const p = ps[slot];
      if (phase !== 'play' || !p || p.done || p.fail || m.e !== 'mv') return;
      const c = +m.c;
      if (!(c >= 0 && c < FLOOD_COLORS.length) || c === p.g[0] || +m.i !== p.steps) return;
      floodApply(p.g, n, c);
      p.steps++;
      const pct = Math.round(floodRegion(p.g, n).length / (n * n) * 100);
      if (pct === 100) { p.done = Date.now(); p.ms = p.done - t0; }
      else if (p.steps >= limit) p.fail = true;
      H.bc({ t: 'g', e: 'mv', s: slot, c, i: p.steps, pct, done: p.done ? finishers().indexOf(slot) + 1 : 0, ms: p.ms, fail: p.fail });
      if (allDone()) H.s.after(900, () => { if (phase === 'play') endRound(); });
    },
    presence() { if (phase === 'play' && allDone()) endRound(); },
  };
}

function vFlood(V) {
  const me = V.me;
  let n = 10, g = null, base = null, limit = 0, steps = 0, live = false, myRank = 0, failed = false, endAt = 0, others = {}, timerT = null;
  const anim = new Map(); // 格子 → 開始放大的時間(漣漪)
  V.stage('<div class="fseats"></div>');
  V.pad.innerHTML = `
    <div class="fwrap">
      <div class="fhead"><span class="fstep">步數 <b>0</b> / <i>-</i></span><span class="ftime">⏱ --</span></div>
      <div class="fboard"><canvas class="fcv"></canvas><div class="cover"></div></div>
      <div class="fpal">${FLOOD_COLORS.map((c, k) => `<button class="fc" data-c="${k}" style="--fc:${c}" aria-label="${FLOOD_NAMES[k]}"></button>`).join('')}</div>
    </div>`;
  const board = $('.fboard', V.pad), cv = $('.fcv', board), ctx = cv.getContext('2d'), cover = $('.cover', board);
  const stepEl = $('.fstep', V.pad), timeEl = $('.ftime', V.pad), palEl = $('.fpal', V.pad);
  const fit = () => {
    if (!board.isConnected) { ro.disconnect(); return; }
    const w = $('.fwrap', V.pad), avail = w.clientHeight - $('.fhead', w).offsetHeight - palEl.offsetHeight - 16;
    const s = Math.max(160, Math.floor(Math.min(w.clientWidth, avail)));
    board.style.width = board.style.height = s + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.height = Math.round((cv.clientWidth || s) * dpr);
    draw();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(V.pad);

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!g) { ctx.fillStyle = '#1a1930'; ctx.fillRect(0, 0, cv.width, cv.width); return; }
    if (floodPaint(ctx, g, n, cv.width, anim, performance.now())) requestAnimationFrame(draw);
  }
  function drawMini(s) {
    const o = others[s], c = $(`.fseat[data-s="${s}"] canvas`, V.root);
    if (!o || !c) return;
    floodPaint(c.getContext('2d'), o.g, n, c.width, null, 0);
  }
  function renderSeats(order) {
    $('.fseats', V.root).innerHTML = order.map(s => {
      const p = pinfo(s), o = others[s] || {};
      const tag = o.done ? `<em class="fwin">${['🥇', '🥈', '🥉', '🎀'][o.done - 1]}</em>` : o.fail ? '<em class="ffail">💥</em>' : '';
      return `<div class="fseat${s === me ? ' me' : ''}${p.online ? '' : ' off'}" data-s="${s}" style="--pc:${p.color}">
        <canvas width="144" height="144"></canvas>${tag}
        <span class="fnm">${p.emoji}<b>${s === me ? '你' : esc(p.name)}</b></span>
        <span class="fpg"><i style="width:${o.pct || 0}%"></i></span><small>${o.steps || 0} 步 · ${o.pct || 0}%</small></div>`;
    }).join('');
    order.forEach(drawMini);
  }
  function updSeat(s) {
    const seat = $(`.fseat[data-s="${s}"]`, V.root), o = others[s];
    if (!seat || !o) return;
    $('.fpg i', seat).style.width = o.pct + '%';
    $('small', seat).textContent = `${o.steps} 步 · ${o.pct}%`;
    const old = $('em', seat);
    if (old) old.remove();
    if (o.done) seat.insertAdjacentHTML('beforeend', `<em class="fwin">${['🥇', '🥈', '🥉', '🎀'][o.done - 1]}</em>`);
    else if (o.fail) seat.insertAdjacentHTML('beforeend', '<em class="ffail">💥</em>');
    drawMini(s);
  }
  function updHead() {
    $('b', stepEl).textContent = steps;
    $('i', stepEl).textContent = limit || '-';
    stepEl.classList.toggle('warn', limit && limit - steps <= 2 && !myRank);
    palEl.classList.toggle('off', !live);
    $$('.fc', palEl).forEach(b => b.classList.toggle('cur', g && +b.dataset.c === g[0]));
  }
  function pickColor(c) {
    if (!live || !g || c === g[0]) return;
    const added = floodApply(g, n, c);
    const now = performance.now();
    added.forEach((i, k) => anim.set(i, now + Math.min(k, 60) * 12));
    steps++;
    V.send({ e: 'mv', c, i: steps - 1 });
    others[me] = { g: g.slice(), steps, pct: Math.round(floodRegion(g, n).length / (n * n) * 100), done: 0, fail: false };
    updSeat(me);
    beep(330 + c * 70 + Math.min(added.length, 20) * 12, 0.07, 'triangle', 0.1);
    if (floodDone(g, n)) { live = false; SFX.good(); buzz([40, 40, 80]); }
    else if (steps >= limit) { live = false; failed = true; cover.innerHTML = '<div class="big">💥</div><div>步數用完了!</div><div class="small">看看其他人吧</div>'; cover.classList.add('on'); SFX.bad(); }
    updHead();
    draw();
  }
  palEl.addEventListener('pointerdown', e => { const b = e.target.closest('.fc'); if (b) { e.preventDefault(); pickColor(+b.dataset.c); } });

  V.countdown = k => { // 倒數顯示在棋盤上,不要蓋掉上面的對手區
    cover.innerHTML = k > 0 ? `<div class="big cdn pulse">${k}</div>` : '<div class="big cdn go">GO!</div>';
    cover.classList.add('on');
    if (k > 0) SFX.tick(); else SFX.go();
  };
  V.on = m => {
    if (m.e === 'prep') {
      n = m.n; g = null; live = false; myRank = 0; failed = false; steps = 0; limit = 0;
      cover.innerHTML = `<div class="big">🌊</div><div>第 ${m.rd} / ${m.R} 局 · ${m.n}×${m.n}</div><div class="small">大家拿到一樣的棋盤,看誰最快填滿!</div>`;
      cover.classList.add('on');
      updHead(); draw();
    } else if (m.e === 'round') {
      n = m.n; base = [...m.grid].map(Number); g = base.slice(); limit = m.limit; steps = 0;
      live = m.order.includes(me);
      others = Object.fromEntries(m.order.map(s => [s, { g: base.slice(), steps: 0, pct: Math.round(floodRegion(base, n).length / (n * n) * 100), done: 0, fail: false }]));
      cover.classList.remove('on');
      anim.clear();
      const now = performance.now();
      for (let i = 0; i < n * n; i++) anim.set(i, now + ((i % n) + ((i / n) | 0)) * 22); // 開場:棋盤從左上角一格一格長出來
      endAt = Date.now() + m.T * 1000;
      clearInterval(timerT);
      timerT = setInterval(() => {
        if (!board.isConnected) return clearInterval(timerT);
        const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
        timeEl.textContent = '⏱ ' + left;
        timeEl.classList.toggle('warn', left <= 10);
      }, 250);
      renderSeats(m.order);
      fit(); updHead();
      if (!live) toast('觀戰中');
    } else if (m.e === 'mv') {
      const o = others[m.s];
      if (!o) return;
      if (m.s !== me) { floodApply(o.g, n, m.c); o.steps = m.i; o.pct = m.pct; }
      o.done = m.done; o.fail = m.fail;
      if (m.s === me && m.done) {
        myRank = m.done;
        cover.innerHTML = `<div class="big">${['🥇', '🥈', '🥉', '🎀'][m.done - 1]}</div><div>完成!第 ${m.done} 名</div><div class="small">${steps} 步 · ${(m.ms / 1000).toFixed(1)} 秒</div>`;
        setTimeout(() => cover.classList.add('on'), 700);
        if (m.done === 1) SFX.win();
      } else if (m.s !== me && m.done) { beep(990, 0.1, 'sine', 0.1); }
      updSeat(m.s);
      updHead();
    } else if (m.e === 'rend') {
      live = false; clearInterval(timerT); timeEl.textContent = '⏱ 0';
      const rows = Object.keys(m.tot).map(Number).sort((a, b) => m.tot[b] - m.tot[a]).map(s => {
        const k = m.fin.indexOf(s);
        return `<span>${k >= 0 ? ['🥇', '🥈', '🥉', '🎀'][k] : '💤'} ${pinfo(s).emoji} ${s === me ? '你' : esc(pinfo(s).name)} <b>${k >= 0 ? `+${m.pts[s]}` : '+0'}</b><i>共 ${m.tot[s]} 分</i></span>`;
      }).join('');
      cover.innerHTML = `<div class="small">第 ${m.rd} 局結果</div><div class="ffinal">${rows}</div><div class="small">${m.last ? '比賽結束!' : '下一局棋盤更大…'}</div>`;
      cover.classList.add('on');
      updHead();
    }
  };
}

/* =========================================================
   公車大塞車 🚌(單人闖關):停車場塞滿公車,車頂箭頭是它能開出去的方向。
   點公車 → 前面沒擋住就開出停車場、繞到上方的候車格;排隊的乘客會上同顏色的公車,坐滿就開走。
   候車格全部停滿、排頭的乘客又沒有車可以上就輸了;所有乘客都上車就過關。
   關卡用固定種子產生(第 N 關永遠一樣),而且是倒著排出來的,保證一定有解
   ========================================================= */
const BUS_COLORS = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#a855f7', '#f97316', '#ec4899'];
const BUS_DIRS = { R: [1, 0], L: [-1, 0], D: [0, 1], U: [0, -1] };
const busRng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const busCells = b => Array.from({ length: b.len }, (_, i) => (b.dir === 'L' || b.dir === 'R' ? [b.x + i, b.y] : [b.x, b.y + i]));
function busFront(b) {
  if (b.dir === 'R') return [b.x + b.len - 1, b.y];
  if (b.dir === 'D') return [b.x, b.y + b.len - 1];
  return [b.x, b.y];
}
function busPath(b, W, H) { // 從車頭往前一直到停車場邊緣的格子
  const [dx, dy] = BUS_DIRS[b.dir], out = [];
  let [x, y] = busFront(b);
  for (x += dx, y += dy; x >= 0 && y >= 0 && x < W && y < H; x += dx, y += dy) out.push([x, y]);
  return out;
}
function busLevel(L) {
  const rnd = busRng(L * 7919 + 13), ri = n => Math.floor(rnd() * n);
  const nColors = Math.min(BUS_COLORS.length, 2 + Math.floor((L - 1) / 3));
  const W = Math.min(9, 5 + Math.floor(L / 5)), H = Math.min(12, 6 + Math.floor(L / 3));
  const want = Math.min(48, 5 + Math.floor((L - 1) * 1.1));
  const occ = Array.from({ length: H }, () => new Array(W).fill(-1));
  const placed = [];
  // 一台一台放進去:新放的車,前方的路不能被已經放好的車擋住(這樣倒過來開出去一定可行);
  // 盡量挑會擋住別台車的位置,關卡才有難度
  for (let k = 0; k < want; k++) {
    let best = null;
    for (let t = 0; t < 150; t++) {
      const len = rnd() < Math.min(0.6, 0.15 + L * 0.02) ? 3 : 2, horiz = rnd() < 0.5;
      const dir = horiz ? (rnd() < 0.5 ? 'L' : 'R') : (rnd() < 0.5 ? 'U' : 'D');
      const b = { len, dir, x: ri(W - (horiz ? len : 1) + 1), y: ri(H - (horiz ? 1 : len) + 1) };
      const cells = busCells(b);
      if (cells.some(([x, y]) => occ[y][x] >= 0)) continue;
      if (busPath(b, W, H).some(([x, y]) => occ[y][x] >= 0)) continue;
      const blocks = placed.filter(p => busPath(p, W, H).some(([x, y]) => cells.some(([cx, cy]) => cx === x && cy === y))).length;
      const sc = blocks * (1 + L * 0.06) + rnd() * 0.9; // 關卡越後面,越偏好會擋住別台車的位置(連鎖更長)
      if (!best || sc > best.sc) best = { b, sc };
    }
    if (!best) break;
    best.b.id = placed.length;
    busCells(best.b).forEach(([x, y]) => { occ[y][x] = best.b.id; });
    placed.push(best.b);
  }
  // 顏色:每種顏色至少一台
  const order = placed.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = ri(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  order.forEach((id, k) => { placed[id].c = k < nColors ? k : ri(nColors); placed[id].cap = placed[id].len === 3 ? 6 : 4; });
  // 第 16 關起:有些公車是「?」神秘車,開出停車場才知道是什麼顏色
  const hidP = L >= 16 ? Math.min(0.45, (L - 15) * 0.03) : 0;
  placed.forEach(b => { b.hid = rnd() < hidP; });
  // 乘客排隊:照「開出去的順序」(倒過來),同時最多 win 台車在接客,把它們的乘客混在一起
  const slots = 5, win = Math.min(slots - 1, 1 + Math.ceil(L / 3));
  const exitOrder = placed.slice().reverse(), rem = new Map(placed.map(b => [b.id, b.cap]));
  const queue = [], open = [];
  let nx = 0;
  while (queue.length < placed.reduce((t, b) => t + b.cap, 0)) {
    while (open.length < win && nx < exitOrder.length) open.push(exitOrder[nx++]);
    const b = open[ri(open.length)];
    queue.push(b.c);
    rem.set(b.id, rem.get(b.id) - 1);
    if (!rem.get(b.id)) open.splice(open.indexOf(b), 1);
  }
  const tier = L <= 5 ? '簡單' : L <= 12 ? '普通' : L <= 25 ? '困難' : L <= 45 ? '超難' : '地獄';
  return { W, H, slots, buses: placed, queue, nColors, tier };
}

function busGame() {
  resetView();
  app.innerHTML = '';
  let level = Math.max(1, store.get('busLevel', 1) | 0);
  const maxLv = () => Math.max(1, store.get('busMax', 1) | 0);
  const scr = el('div', 'screen busg');
  scr.innerHTML = `
    <div class="bgtop">
      <button class="iconbtn bgback" aria-label="回首頁">✕</button>
      <div class="bglv">第 <b>1</b> 關<i class="bgtier"></i></div>
      <button class="iconbtn bgretry" aria-label="重來">↻</button>
    </div>
    <div class="bgstage"><canvas class="bgcv"></canvas><div class="bgov"></div></div>
    <div class="bgbar"><span class="bgleft">🧍 <b>0</b> 人等車</span><button class="bgplus">🅿️ +1 候車格</button></div>`;
  app.appendChild(scr);
  const stage = $('.bgstage', scr), cv = $('.bgcv', scr), ctx = cv.getContext('2d'), ov = $('.bgov', scr);
  const leftEl = $('.bgleft b', scr), plusBtn = $('.bgplus', scr), lvEl = $('.bglv b', scr), tierEl = $('.bgtier', scr);
  let G = null, sc = 1, ox = 0, oy = 0, raf = 0, last = 0;

  // ---------- 版面(世界座標的單位是「一格」) ----------
  const QH = 2.9, SH = 2.7, M = 0.7; // 上方排隊區、候車格區的高度;M 是左右下方的草地寬
  function layout() {
    const TW = G.W + 2 + M * 2, TH = QH + SH + 1 + G.H + 1 + M;
    const r = stage.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    sc = Math.min(cv.width / TW, cv.height / TH);
    ox = (cv.width - TW * sc) / 2; oy = (cv.height - TH * sc) / 2;
    G.TW = TW; G.TH = TH; G.LX = 1 + M; G.LY = QH + SH + 1;
  }
  const slotX = k => M + (k + 0.5) * (G.TW - M * 2) / G.slots;
  const slotY = () => QH + SH / 2 + 0.05;
  const roadT = () => G.LY - 0.5, roadB = () => G.LY + G.H + 0.5, roadL = () => M + 0.5, roadR = () => G.LX + G.W + 0.5;
  function busCenter(b) { const cs = busCells(b); return [G.LX + cs.reduce((t, c) => t + c[0], 0) / b.len + 0.5, G.LY + cs.reduce((t, c) => t + c[1], 0) / b.len + 0.5]; }
  const ANG = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 };

  // ---------- 開始一關 ----------
  function start(L) {
    level = L;
    store.set('busLevel', L);
    const lv = busLevel(L);
    G = { ...lv, level: L, queue: lv.queue.slice(), state: 'play', walkers: [], slotOf: new Array(7).fill(null), plusUsed: false, boardCd: 0.6, endT: 0, moves: 0 };
    G.buses = lv.buses.map(b => { const o = { ...b, st: 'lot', boarded: 0, incoming: 0, anim: null, shake: 0 }; return o; });
    layout();
    G.buses.forEach(b => { const [x, y] = busCenter(b); b.px = x; b.py = y; b.ang = ANG[b.dir]; b.scale = 1; });
    G.deco = makeDeco(L);
    lvEl.textContent = L;
    tierEl.textContent = lv.tier;
    tierEl.dataset.t = lv.tier;
    plusBtn.disabled = false;
    plusBtn.classList.remove('used');
    ov.className = 'bgov';
    updBar();
  }
  const updBar = () => { leftEl.textContent = G.queue.length + G.walkers.length; };

  // ---------- 動畫:沿著幾個路徑點開車 ----------
  function drive(b, pts, speed, onEnd, endScale) {
    b.anim = { pts, i: 0, speed, onEnd, endScale: endScale == null ? b.scale : endScale, startScale: b.scale, total: 0, done: 0 };
    let px = b.px, py = b.py;
    pts.forEach(([x, y]) => { b.anim.total += Math.hypot(x - px, y - py); px = x; py = y; });
  }
  function stepAnim(b, dt) {
    const a = b.anim;
    let move = a.speed * dt;
    while (a && move > 0 && a.i < a.pts.length) {
      const [tx, ty] = a.pts[a.i], dx = tx - b.px, dy = ty - b.py, d = Math.hypot(dx, dy);
      if (d > 0.001 && !a.keepAng) b.ang = lerpAng(b.ang, Math.atan2(dy, dx), Math.min(1, dt * 14));
      if (d <= move) { b.px = tx; b.py = ty; move -= d; a.done += d; a.i++; }
      else { b.px += dx / d * move; b.py += dy / d * move; a.done += move; move = 0; }
    }
    b.scale = a.startScale + (a.endScale - a.startScale) * Math.min(1, a.done / Math.max(0.001, a.total));
    if (a.i >= a.pts.length) { b.anim = null; if (a.onEnd) a.onEnd(); }
  }
  const lerpAng = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

  // ---------- 點公車 ----------
  function tap(b) {
    if (G.state !== 'play' || b.st !== 'lot' || b.anim) return;
    const path = busPath(b, G.W, G.H);
    const blocker = path.findIndex(([x, y]) => G.buses.some(o => o !== b && o.st === 'lot' && busCells(o).some(c => c[0] === x && c[1] === y)));
    const [dx, dy] = BUS_DIRS[b.dir], [cx, cy] = busCenter(b);
    if (blocker >= 0) { // 被擋住:往前撞一下再退回來
      const d = blocker + 0.18;
      const hit = G.buses.find(o => o !== b && o.st === 'lot' && busCells(o).some(c => c[0] === path[blocker][0] && c[1] === path[blocker][1]));
      drive(b, [[cx + dx * d, cy + dy * d], [cx, cy]], 11, null);
      b.anim.keepAng = true;
      setTimeout(() => { if (hit) hit.shake = 0.35; beep(140, 0.12, 'square', 0.1); buzz(30); }, d / 11 * 1000);
      return;
    }
    const k = G.slotOf.findIndex((s, i) => i < G.slots && s == null);
    if (k < 0) { b.shake = 0.35; toast('候車格滿了!等公車載滿開走'); beep(180, 0.15, 'square', 0.08); return; }
    G.slotOf[k] = b;
    b.st = 'go';
    if (b.hid) { b.hid = false; b.reveal = 0.6; }
    b.slot = k;
    G.moves++;
    SFX.tap();
    beep(330, 0.12, 'sawtooth', 0.05);
    // 開出停車場 → 沿著外圍道路 → 從上面的路開進候車格
    const pts = [];
    const sx = slotX(k), sy = slotY();
    if (b.dir === 'U') pts.push([cx, roadT()]);
    else if (b.dir === 'L') pts.push([roadL(), cy], [roadL(), roadT()]);
    else if (b.dir === 'R') pts.push([roadR(), cy], [roadR(), roadT()]);
    else {
      const side = cx < G.LX + G.W / 2 ? roadL() : roadR();
      pts.push([cx, roadB()], [side, roadB()], [side, roadT()]);
    }
    pts.push([sx, roadT()], [sx, sy]);
    drive(b, pts, 13, () => { b.st = 'slot'; b.ang = -Math.PI / 2; beep(520, 0.08, 'triangle', 0.08); }, 0.74);
  }

  // ---------- 每一幀 ----------
  function update(dt) {
    G.buses.forEach(b => {
      if (b.anim) stepAnim(b, dt);
      else if (b.st === 'slot') b.px += (slotX(b.slot) - b.px) * Math.min(1, dt * 8); // 候車格數量變了就滑到新位置
      if (b.shake > 0) b.shake = Math.max(0, b.shake - dt);
      if (b.reveal > 0) b.reveal = Math.max(0, b.reveal - dt);
    });
    // 乘客上車
    G.walkers = G.walkers.filter(w => {
      w.t += dt / 0.3;
      if (w.t < 1) return true;
      w.bus.incoming--; w.bus.boarded++;
      beep(700 + w.bus.boarded * 40, 0.04, 'sine', 0.05);
      return false;
    });
    updBar();
    if (G.state === 'play' && G.queue.length) {
      G.boardCd -= dt;
      if (G.boardCd <= 0) {
        const c = G.queue[0];
        const bus = G.slotOf.find((b, i) => i < G.slots && b && b.st === 'slot' && b.c === c && b.boarded + b.incoming < b.cap);
        if (bus) {
          G.queue.shift();
          bus.incoming++;
          const [qx, qy] = queuePos(0);
          G.walkers.push({ c, bus, t: 0, fx: qx, fy: qy });
          G.boardCd = 0.12;
          updBar();
        }
      }
    }
    // 坐滿就開走
    G.buses.forEach(b => {
      if (b.st === 'slot' && b.boarded >= b.cap && !b.incoming) {
        b.st = 'leave';
        G.slotOf[b.slot] = null;
        beep(260, 0.25, 'sawtooth', 0.05); beep(390, 0.2, 'triangle', 0.08, 0.1);
        drive(b, [[b.px, b.py - 0.6], [b.px + (b.slot < G.slots / 2 ? -1 : 1) * (G.TW + 2), b.py - 0.6]], 12, () => { b.st = 'gone'; });
      }
    });
    // 勝負
    if (G.state === 'play') {
      if (!G.queue.length && !G.walkers.length && G.buses.every(b => b.st === 'gone')) end(true);
      else if (G.queue.length && !G.walkers.length) {
        const parked = G.slotOf.slice(0, G.slots);
        const stuck = parked.every(b => b && b.st === 'slot') && !parked.some(b => b.c === G.queue[0] && b.boarded + b.incoming < b.cap);
        G.endT = stuck ? G.endT + dt : 0;
        if (G.endT > 0.7) end(false);
      }
    }
  }
  function end(win) {
    G.state = win ? 'win' : 'lose';
    if (win) {
      store.set('busMax', Math.max(maxLv(), level + 1));
      SFX.win(); confetti(); buzz([60, 60, 120]);
      ov.innerHTML = `<div class="bgcard"><div class="bgbig">🎉</div><h2>第 ${level} 關 過關!</h2><p>開走了 ${G.buses.length} 台公車 · 載了 ${G.buses.reduce((t, b) => t + b.cap, 0)} 位乘客</p>
        <button class="btn big green bgnext"><span class="bi">▶</span><span class="bt">下一關</span></button><button class="btn white sm bgagain">再玩一次</button></div>`;
    } else {
      SFX.bad(); buzz([100, 60, 160]);
      ov.innerHTML = `<div class="bgcard lose"><div class="bgbig">😵</div><h2>候車格塞滿了!</h2><p>排頭的乘客沒有車可以上。想想哪台公車要先開出來</p>
        ${G.plusUsed ? '' : '<button class="btn big blue bgrescue"><span class="bi">🅿️</span><span class="bt">加一個候車格繼續</span></button>'}
        <button class="btn big orange bgagain"><span class="bi">↻</span><span class="bt">重新挑戰</span></button></div>`;
    }
    setTimeout(() => ov.classList.add('on'), win ? 700 : 300);
  }
  function addSlot() {
    if (G.plusUsed || G.slots >= 7) return false;
    G.plusUsed = true;
    G.slots++;
    plusBtn.disabled = true;
    plusBtn.classList.add('used');
    SFX.good();
    return true;
  }

  // ---------- 畫面:假 3D(鏡頭稍微從前方往下看:東西越高,畫得越往上;車身用一層層疊出厚度) ----------
  function queuePos(i) { // 排隊路線:從候車區正上方往右、再一排排繞上去
    const sp = 0.46, rowH = 0.62, y0 = QH - 0.45, left = M + 0.35, right = G.TW - M - 0.35, perRow = Math.floor((right - left) / sp) + 1;
    const startX = G.TW / 2;
    const first = Math.floor((right - startX) / sp) + 1;
    if (i < first) return [startX + i * sp, y0];
    i -= first;
    const row = 1 + Math.floor(i / perRow), k = i % perRow;
    return [row % 2 ? right - k * sp : left + k * sp, y0 - row * rowH];
  }
  function makeDeco(L) { // 草地上的樹和草叢(每一關固定)
    const r = busRng(L * 31 + 7), out = [], TW = G.TW, TH = G.TH;
    for (let y = QH + 0.6; y < TH - 0.3; y += 0.9 + r() * 0.6) {
      out.push({ t: r() < 0.45 ? 'tree' : 'bush', x: 0.35 + r() * 0.1, y, s: 0.75 + r() * 0.35 });
      out.push({ t: r() < 0.45 ? 'tree' : 'bush', x: TW - 0.35 - r() * 0.1, y: y + r() * 0.4, s: 0.75 + r() * 0.35 });
    }
    for (let x = M + 0.4; x < TW - M; x += 1 + r() * 0.8) out.push({ t: r() < 0.5 ? 'bush' : 'flower', x, y: TH - 0.32, s: 0.7 + r() * 0.3 });
    return out.sort((p, q) => p.y - q.y);
  }
  const rr = (x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
  function shade(hex, f) { const v = parseInt(hex.slice(1), 16), ch = k => { const x = (v >> k) & 255; return Math.round(f > 0 ? x + (255 - x) * f : x * (1 + f)); }; return `rgb(${ch(16)},${ch(8)},${ch(0)})`; }
  const blob = (x, y, rx, ry, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
  function ball(x, y, r, col) { // 有光影的球(樹冠、草叢、人頭)
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, shade(col, 0.35)); g.addColorStop(0.7, col); g.addColorStop(1, shade(col, -0.3));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  function drawTree(d) {
    const { x, y, s } = d;
    blob(x + 0.08 * s, y + 0.06 * s, 0.34 * s, 0.13 * s, 'rgba(0,0,0,.22)');
    ctx.fillStyle = '#7a5230'; rr(x - 0.05 * s, y - 0.32 * s, 0.1 * s, 0.34 * s, 0.03); ctx.fill();
    ball(x - 0.13 * s, y - 0.42 * s, 0.22 * s, '#3f9a45');
    ball(x + 0.14 * s, y - 0.45 * s, 0.21 * s, '#3f9a45');
    ball(x, y - 0.62 * s, 0.25 * s, '#4cae4f');
  }
  function drawBush(d) {
    const { x, y, s } = d;
    blob(x + 0.05, y + 0.05, 0.3 * s, 0.1 * s, 'rgba(0,0,0,.2)');
    ball(x - 0.13 * s, y - 0.08 * s, 0.15 * s, '#4aa64c'); ball(x + 0.13 * s, y - 0.08 * s, 0.15 * s, '#4aa64c'); ball(x, y - 0.16 * s, 0.18 * s, '#58b85a');
  }
  function drawFlower(d) {
    drawBush(d);
    [[-0.1, -0.2, '#ff6b9a'], [0.08, -0.25, '#ffd23f'], [0.14, -0.12, '#ffffff']].forEach(([dx, dy, c]) => blob(d.x + dx * d.s, d.y + dy * d.s, 0.04, 0.04, c));
  }
  function drawShelter(x, y, w) { // 公車候車亭
    const hgt = 0.5;
    blob(x + w / 2 + 0.1, y + 0.32, w / 2 + 0.15, 0.14, 'rgba(0,0,0,.22)');
    ctx.fillStyle = '#5b6372';
    [0.08, w - 0.14].forEach(px => { ctx.fillRect(x + px, y - hgt + 0.1, 0.06, hgt + 0.15); });
    ctx.fillStyle = 'rgba(160,215,255,.45)'; ctx.fillRect(x + 0.14, y - hgt + 0.2, w - 0.28, hgt - 0.05); // 背板玻璃
    ctx.fillStyle = '#8d6b4a'; rr(x + 0.3, y - 0.02, w - 0.6, 0.1, 0.03); ctx.fill(); // 椅子
    ctx.fillStyle = '#6d7686'; rr(x - 0.05, y - hgt - 0.06, w + 0.1, 0.12, 0.05); ctx.fill(); // 屋頂側面
    ctx.fillStyle = '#c9e9ff'; rr(x - 0.05, y - hgt - 0.34, w + 0.1, 0.3, 0.06); ctx.fill(); // 屋頂
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(x + 0.05, y - hgt - 0.3, w - 0.1, 0.05);
    ctx.fillStyle = '#ffd23f'; rr(x + w - 0.42, y - hgt - 0.3, 0.34, 0.22, 0.05); ctx.fill();
    ctx.fillStyle = '#1f3864'; ctx.font = '900 0.17px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('BUS', x + w - 0.25, y - hgt - 0.19);
  }
  function drawPost(x, y) {
    blob(x + 0.04, y + 0.03, 0.07, 0.03, 'rgba(0,0,0,.25)');
    ctx.fillStyle = '#8b93a3'; ctx.fillRect(x - 0.025, y - 0.3, 0.05, 0.3);
    ball(x, y - 0.32, 0.05, '#c8ced9');
  }
  function drawPerson(x, y, c, s, now, k) {
    const bob = Math.abs(Math.sin(now / 260 + k * 0.7)) * 0.025, col = BUS_COLORS[c];
    blob(x + 0.03 * s, y + 0.02 * s, 0.13 * s, 0.05 * s, 'rgba(0,0,0,.25)');
    ctx.fillStyle = shade(col, -0.45);
    rr(x - 0.08 * s, y - 0.12 * s, 0.06 * s, 0.13 * s, 0.03 * s); ctx.fill();
    rr(x + 0.02 * s, y - 0.12 * s, 0.06 * s, 0.13 * s, 0.03 * s); ctx.fill();
    const g = ctx.createLinearGradient(x - 0.13 * s, 0, x + 0.13 * s, 0);
    g.addColorStop(0, shade(col, 0.25)); g.addColorStop(0.6, col); g.addColorStop(1, shade(col, -0.3));
    ctx.fillStyle = g;
    rr(x - 0.12 * s, y - 0.36 * s - bob, 0.24 * s, 0.28 * s, 0.1 * s); ctx.fill();
    ball(x, y - 0.46 * s - bob, 0.1 * s, '#ffd9b3');
    ctx.fillStyle = shade(col, -0.2); // 帽子
    ctx.beginPath(); ctx.arc(x, y - 0.48 * s - bob, 0.1 * s, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  }
  function foot(b, lift, grow) { // 公車的底面(在 lift 高度),用目前的位置、角度、縮放
    const L = b.len * 0.94 + grow * 2, Wd = 0.8 + grow * 2, sh = b.shake ? Math.sin(performance.now() / 18) * 0.06 * (b.shake / 0.35) : 0;
    ctx.save();
    ctx.translate(b.px + sh, b.py - lift * b.scale);
    ctx.rotate(b.ang);
    ctx.scale(b.scale, b.scale);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-L / 2, -Wd / 2, L, Wd, 0.2); else ctx.rect(-L / 2, -Wd / 2, L, Wd);
    return [L, Wd];
  }
  function drawBus(b, now) {
    const col = b.hid ? '#9aa1ad' : BUS_COLORS[b.c], H3 = 0.5;
    // 影子
    ctx.save(); ctx.translate(0.1 * b.scale, 0.14 * b.scale); foot(b, 0, 0.05); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill(); ctx.restore(); ctx.restore();
    // 輪子
    const [L, Wd] = foot(b, 0, 0); ctx.restore();
    foot(b, 0.02, 0);
    ctx.fillStyle = '#1c1f26';
    [[-L / 2 + 0.28, -Wd / 2 - 0.02], [L / 2 - 0.36, -Wd / 2 - 0.02], [-L / 2 + 0.28, Wd / 2 - 0.08], [L / 2 - 0.36, Wd / 2 - 0.08]].forEach(([x, y]) => { rr(x, y, 0.2, 0.1, 0.04); ctx.fill(); });
    ctx.restore();
    // 車身:一層一層往上疊(下裙 → 車身 → 車窗玻璃 → 車身上緣)
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      foot(b, f * H3, 0);
      ctx.fillStyle = f < 0.14 ? shade(col, -0.55) : f < 0.42 ? shade(col, -0.2) : f < 0.82 ? (f < 0.5 ? '#1b2735' : '#26384c') : shade(col, -0.08);
      ctx.fill();
      ctx.restore();
    }
    // 車頂
    foot(b, H3, 0);
    const rg = ctx.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
    rg.addColorStop(0, shade(col, 0.28)); rg.addColorStop(1, shade(col, 0.02));
    ctx.fillStyle = rg; ctx.fill();
    if (b.reveal) { ctx.fillStyle = `rgba(255,255,255,${b.reveal})`; ctx.fill(); }
    ctx.fillStyle = '#1b2735'; // 前擋風玻璃、後窗
    rr(L / 2 - 0.2, -Wd / 2 + 0.08, 0.15, Wd - 0.16, 0.06); ctx.fill();
    rr(-L / 2 + 0.05, -Wd / 2 + 0.12, 0.08, Wd - 0.24, 0.04); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(L / 2 - 0.17, -Wd / 2 + 0.12, 0.03, Wd - 0.24);
    ctx.fillStyle = 'rgba(255,255,255,.4)'; // 車頂邊的亮線
    rr(-L / 2 + 0.18, -Wd / 2 + 0.06, L - 0.42, 0.05, 0.02); ctx.fill();
    if (b.st === 'lot' || b.st === 'go') {
      if (b.hid) { // 神秘車
        ctx.fillStyle = '#fff'; ctx.font = '900 0.5px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.rotate(-b.ang); ctx.fillText('?', 0, 0.02); ctx.restore();
      } else { // 車頂的方向箭頭
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = shade(col, -0.4); ctx.lineWidth = 0.035;
        const ax = b.len === 3 ? 0.05 : 0.0;
        ctx.beginPath(); ctx.moveTo(ax + 0.26, 0); ctx.lineTo(ax - 0.04, -0.22); ctx.lineTo(ax - 0.04, -0.08); ctx.lineTo(ax - 0.26, -0.08); ctx.lineTo(ax - 0.26, 0.08); ctx.lineTo(ax - 0.04, 0.08); ctx.lineTo(ax - 0.04, 0.22); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    } else { // 候車中:車頂的冷氣機 + 座位
      const n = b.cap, cols = n / 2, gx = (L - 0.6) / cols;
      for (let i = 0; i < n; i++) {
        const sx = -L / 2 + 0.3 + (i % cols) * gx + gx / 2, sy = i < cols ? -0.15 : 0.15;
        ctx.fillStyle = i < b.boarded ? '#fff' : 'rgba(0,0,0,.28)';
        ctx.beginPath(); ctx.arc(sx, sy, 0.08, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#5fae4c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(sc, 0, 0, sc, ox, oy);
    const { TW, TH, LX, LY, W, H } = G;
    // 草地(割草的條紋)
    for (let y = 0; y < TH; y += 0.8) { ctx.fillStyle = (y / 0.8) % 2 < 1 ? '#63b34f' : '#5aa948'; ctx.fillRect(-1, y, TW + 2, 0.8); }
    // 排隊廣場:地磚 + 路緣
    ctx.fillStyle = '#c9b58d'; rr(0.12, 0.12, TW - 0.24, QH - 0.04, 0.25); ctx.fill();
    ctx.fillStyle = '#f1e2bf'; rr(0.12, 0.08, TW - 0.24, QH - 0.08, 0.25); ctx.fill();
    ctx.strokeStyle = 'rgba(160,125,70,.18)'; ctx.lineWidth = 0.02;
    for (let x = 0.5; x < TW - 0.2; x += 0.5) { ctx.beginPath(); ctx.moveTo(x, 0.1); ctx.lineTo(x, QH - 0.05); ctx.stroke(); }
    for (let y = 0.5; y < QH; y += 0.5) { ctx.beginPath(); ctx.moveTo(0.15, y); ctx.lineTo(TW - 0.15, y); ctx.stroke(); }
    // 排隊的欄杆(繞行的路線之間)
    const rowH = 0.62, y0 = QH - 0.45, left = M + 0.35, right = TW - M - 0.35;
    for (let r = 0; r < 3; r++) {
      const ys = y0 - (r + 0.5) * rowH + 0.18, gapR = r % 2 === 0;
      const xa = gapR ? left - 0.15 : left + 0.75, xb = gapR ? right - 0.75 : right + 0.15;
      ctx.strokeStyle = '#7f8796'; ctx.lineWidth = 0.035;
      ctx.beginPath(); ctx.moveTo(xa, ys - 0.24); ctx.lineTo(xb, ys - 0.24); ctx.stroke();
      for (let x = xa; x <= xb + 0.01; x += (xb - xa) / Math.max(1, Math.round((xb - xa) / 1.4))) drawPost(x, ys);
    }
    drawShelter(TW - M - 2.1, 0.75, 1.75);
    // 候車格
    ctx.fillStyle = '#9aa0aa'; ctx.fillRect(0, QH, TW, 0.1);
    ctx.fillStyle = '#3c4049'; ctx.fillRect(0, QH + 0.1, TW, SH);
    for (let k = 0; k < G.slots; k++) {
      const x = slotX(k), w = (TW - M * 2) / G.slots;
      ctx.fillStyle = '#353941'; rr(x - w / 2 + 0.07, QH + 0.22, w - 0.14, SH - 0.3, 0.12); ctx.fill();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 0.05; ctx.setLineDash([0.16, 0.1]);
      rr(x - w / 2 + 0.07, QH + 0.22, w - 0.14, SH - 0.3, 0.12); ctx.stroke(); ctx.setLineDash([]);
      if (!G.slotOf[k]) { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.font = '900 0.46px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('P', x, QH + SH / 2 + 0.05); }
    }
    // 道路 + 路緣
    ctx.fillStyle = '#b8bec8'; rr(M - 0.08, LY - 1, TW - M * 2 + 0.16, H + 2.08, 0.2); ctx.fill();
    ctx.fillStyle = '#33363d'; rr(M, LY - 1, TW - M * 2, H + 2, 0.15); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 0.05; ctx.setLineDash([0.3, 0.25]);
    ctx.beginPath(); ctx.moveTo(M + 0.5, LY - 0.5); ctx.lineTo(TW - M - 0.5, LY - 0.5); ctx.lineTo(TW - M - 0.5, LY + H + 0.5); ctx.lineTo(M + 0.5, LY + H + 0.5); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    // 停車場
    ctx.fillStyle = '#41454e'; rr(LX - 0.1, LY - 0.1, W + 0.2, H + 0.2, 0.12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 0.04; ctx.setLineDash([0.14, 0.1]);
    rr(LX - 0.1, LY - 0.1, W + 0.2, H + 0.2, 0.12); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 0.025;
    for (let x = 1; x < W; x++) { ctx.beginPath(); ctx.moveTo(LX + x, LY); ctx.lineTo(LX + x, LY + H); ctx.stroke(); }
    for (let y = 1; y < H; y++) { ctx.beginPath(); ctx.moveTo(LX, LY + y); ctx.lineTo(LX + W, LY + y); ctx.stroke(); }
    // 草地上的裝飾
    G.deco.forEach(d => (d.t === 'tree' ? drawTree : d.t === 'flower' ? drawFlower : drawBush)(d));
    // 排隊的乘客(最多畫 64 個,後面的先畫)
    const vis = Math.min(G.queue.length, 64);
    const ppl = [];
    for (let i = 0; i < vis; i++) ppl.push([i, ...queuePos(i)]);
    ppl.sort((p, q) => p[2] - q[2]).forEach(([i, x, y]) => drawPerson(x, y + 0.12, G.queue[i], 1, now, i));
    if (G.queue.length > vis) { ctx.fillStyle = '#6b4a14'; ctx.font = '900 0.34px Fredoka, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`+${G.queue.length - vis}`, 0.35, 0.4); }
    // 公車:由遠到近畫(y 小的先畫),疊起來才自然
    G.buses.filter(b => b.st !== 'gone').sort((p, q) => p.py - q.py).forEach(b => drawBus(b, now));
    G.walkers.forEach((w, k) => {
      const tx = w.bus.px, ty = w.bus.py - 0.15, u = w.t;
      drawPerson(w.fx + (tx - w.fx) * u, w.fy + 0.12 + (ty - w.fy) * u - Math.sin(u * Math.PI) * 0.3, w.c, 1 - u * 0.35, now, k);
    });
  }
  function frame(now) {
    if (!cv.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (G) { update(dt); draw(now); }
    raf = requestAnimationFrame(frame);
  }

  // ---------- 操作 ----------
  cv.addEventListener('pointerdown', e => {
    if (!G) return;
    e.preventDefault();
    const r = cv.getBoundingClientRect(), dpr = cv.width / r.width;
    const wx = ((e.clientX - r.left) * dpr - ox) / sc - G.LX, wy = ((e.clientY - r.top) * dpr - oy) / sc - G.LY;
    // 車有高度、車頂畫得比較上面:先找「車頂」在手指下的車,找不到再看地面那一格
    const hit = dy => { const cx = Math.floor(wx), cy = Math.floor(wy + dy); return G.buses.find(o => o.st === 'lot' && busCells(o).some(c => c[0] === cx && c[1] === cy)); };
    const b = hit(0.45) || hit(0);
    if (b) tap(b);
  });
  plusBtn.addEventListener('click', () => { if (G && G.state === 'play') addSlot(); });
  $('.bgback', scr).addEventListener('click', () => { cancelAnimationFrame(raf); home(); });
  $('.bgretry', scr).addEventListener('click', () => { if (G) start(level); });
  ov.addEventListener('click', e => {
    if (e.target.closest('.bgnext')) start(level + 1);
    else if (e.target.closest('.bgagain')) start(level);
    else if (e.target.closest('.bgrescue')) { if (addSlot()) { G.state = 'play'; G.endT = 0; ov.className = 'bgov'; } }
    else if (e.target.closest('.bgprev')) { level = Math.max(1, level - 1); showMenu(); }
    else if (e.target.closest('.bgnextlv')) { level = Math.min(maxLv(), level + 1); showMenu(); }
    else if (e.target.closest('.bggo')) start(level);
  });
  const ro = new ResizeObserver(() => { if (!cv.isConnected) return ro.disconnect(); if (G) { layout(); G.buses.forEach(b => { if (b.st === 'lot' && !b.anim) { const [x, y] = busCenter(b); b.px = x; b.py = y; } }); } });
  ro.observe(stage);

  function showMenu() { // 選關畫面:可以回去玩已經過的關卡
    level = Math.min(level, maxLv());
    if (!G || G.level !== level) start(level);
    G.state = 'menu';
    lvEl.textContent = level;
    ov.innerHTML = `<div class="bgcard"><div class="bgbig">🚌</div><h2>公車大塞車</h2>
      <p>點公車把它開出停車場,讓排隊的乘客坐上<b>同顏色</b>的公車!<br>候車格塞滿、又沒人能上車就輸了</p>
      <div class="bglvsel"><button class="bgprev" ${level <= 1 ? 'disabled' : ''}>‹</button><span>第 <b>${level}</b> 關<i class="bgtier" data-t="${G.tier}">${G.tier}</i></span><button class="bgnextlv" ${level >= maxLv() ? 'disabled' : ''}>›</button></div>
      <button class="btn big green bggo"><span class="bi">▶</span><span class="bt">開始</span></button></div>`;
    ov.classList.add('on');
  }
  showMenu(); // 直接開選關畫面(不要等 requestAnimationFrame,背景分頁時它會暫停)
  raf = requestAnimationFrame(t => { last = t; frame(t); });
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

  math(H, s, m, k) {
    if (m.t !== 'g' || m.e !== 'q') return;
    const ans = Function('"use strict";return (' + m.text.replace(/×/g, '*').replace(/−/g, '-').replace(/÷/g, '/') + ')')();
    const v = Math.random() < k.sk ? ans : pick(m.opts.filter(x => x !== ans));
    const rt = Math.round(rand(2500, 6000) * k.spd + m.round * 350);
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

/* 九子棋的電腦:能成三就成三、擋住對方快成三的點、吃對方最有威脅的棋 */
BOTS.morris = (H, s, m, k) => {
  if (m.t !== 'g' || m.e !== 'board' || m.turn !== s) return;
  H.s.after(rand(700, 1300) * k.spd, () => {
    const b = m.b, o = m.fighters.find(x => x !== s), sk = k.sk;
    const act = obj => botSend(H, s, obj);
    const noise = () => Math.random() * (1 - sk) * 120;
    const oFly = m.hand[o] === 0 && m.cnt[o] === 3;
    // 對方下一步能不能走到 i(擺子階段或飛子時任何空點都可以)
    const oReach = (bb, i) => m.hand[o] > 0 || oFly || NMM_ADJ[i].some(n => bb[n] === o);
    const best = list => list.sort((x, y) => y.sc - x.sc)[0];
    if (m.rm) {
      const cand = nmmRemovable(b, o).map(i => {
        let sc = noise() + NMM_ADJ[i].filter(n => b[n] == null).length * 3;
        nmmMillsAt(i).forEach(ml => { if (ml.filter(q => b[q] === o).length === 2 && ml.some(q => b[q] == null)) sc += 40; });
        return { i, sc };
      });
      if (cand.length) act({ e: 'remove', i: best(cand).i });
      return;
    }
    const empties = b.map((x, i) => (x == null ? i : -1)).filter(i => i >= 0);
    if (m.hand[s] > 0) {
      const cand = empties.map(i => ({
        i,
        sc: (nmmMakesMill(b, i, s) ? 100 : 0) + (nmmMakesMill(b, i, o) ? 60 : 0) + NMM_ADJ[i].length * 4
          + nmmMillsAt(i).filter(ml => ml.every(q => q === i || b[q] == null || b[q] === s)).length * 6 + noise(),
      }));
      act({ e: 'place', i: best(cand).i });
      return;
    }
    const fly = m.cnt[s] === 3;
    const cand = nmmMoves(b, s, fly).map(([f, t]) => {
      const bb = b.slice(); bb[f] = null;
      let sc = noise();
      if (nmmMakesMill(bb, t, s)) sc += 100;
      if (nmmMakesMill(b, t, o) && oReach(b, t)) sc += 55; // 擋住對方
      bb[t] = s;
      if (nmmMakesMill(bb, f, o) && oReach(bb, f)) sc -= 45; // 走開會讓對方成三
      sc += NMM_ADJ[t].filter(n => bb[n] == null).length * 2;
      return { f, t, sc };
    });
    if (cand.length) { const c = best(cand); act({ e: 'move', from: c.f, to: c.t }); }
  });
};

/* 心臟病的電腦:看到一樣就拍(越強越快、越少漏拍),偶爾會被很像的數字騙到 */
BOTS.heart = (H, s, m, k) => {
  if (m.t !== 'g' || m.e !== 'st' || !m.order.includes(s)) return;
  if (m.ev === 'flip' && m.phase === 'match') {
    if (Math.random() < (1 - k.sk) * 0.2) return;
    const rt = Math.round((rand(320, 680) + rand(0, 220)) * k.spd);
    H.s.after(rt, () => botSend(H, s, { e: 'slap', k: m.k, rt }));
  } else if (m.ev === 'flip' && Math.abs(heartRank(m.card) - m.said) === 1 && Math.random() < (1 - k.sk) * 0.12) {
    H.s.after(rand(350, 700), () => botSend(H, s, { e: 'slap', k: m.k, rt: 500 }));
  }
  if (m.phase === 'play' && m.turn === s && (m.ev === 'flip' || m.ev === 'turn' || m.ev === 'miss')) {
    H.s.after(Math.round(rand(700, 1300) * k.spd), () => botSend(H, s, { e: 'flip', k: m.k }));
  }
};

/* 轟炸超人的電腦:先算出每一格多久後會被炸到;危險就逃到安全的格子,
   安全時去撿道具、炸木箱、靠近對手;放炸彈前一定先確認有路可以逃(越弱越常判斷失誤) */
BOTS.bomb = (H, s, m, k) => {
  if (m.t !== 'g' || m.e !== 's') return;
  const st = H.bs[s] || (H.bs[s] = { t: 0, d: -1, g: '', last: 0, rd: 0 });
  if (m.gd) st.g = m.gd;
  if (m.rd !== st.rd) { st.rd = m.rd; st.d = -1; st.last = 0; }
  const now = Date.now();
  if (now - st.t < [150, 100, 70][NET.level] || m.ph !== 'play' || !st.g) return;
  st.t = now;
  const me = m.ps.find(p => p[0] === s);
  if (!me || !me[3]) return;
  const GW = BOMB.W, GH = BOMB.H, g = st.g;
  const mc = Math.floor(me[1]), mr = Math.floor(me[2]), myI = mr * GW + mc;
  const spd = me[9] === 'slow' ? 1.6 : me[8] / 10;
  const bombCell = new Map(m.bm.map(b => [Math.floor(b[2]) * GW + Math.floor(b[1]), b]));
  const solid = i => g[i] === '1' || g[i] === '2';
  // 每一格多久後會有火焰(秒);連鎖爆炸:被炸到的炸彈會提早爆
  function dangerMap(extra) {
    const dg = new Array(GW * GH).fill(Infinity);
    m.fl.forEach(([i]) => { dg[i] = 0; });
    const bs = m.bm.map(b => ({ i: Math.floor(b[2]) * GW + Math.floor(b[1]), t: b[3] / 10, r: b[4] }));
    if (extra) bs.push(extra);
    bs.sort((a, b) => a.t - b.t);
    for (let pass = 0; pass < 2; pass++) {
      for (const b of bs) {
        const c = b.i % GW, r = Math.floor(b.i / GW);
        b.t = Math.min(b.t, dg[b.i]);
        dg[b.i] = Math.min(dg[b.i], b.t);
        for (let d = 1; d <= 4; d++) {
          for (let q = 1; q <= b.r; q++) {
            const i = (r + BOMB_DY[d] * q) * GW + c + BOMB_DX[d] * q;
            if (g[i] === '1') break;
            dg[i] = Math.min(dg[i], b.t);
            if (g[i] === '2') break;
          }
        }
      }
    }
    return dg;
  }
  // 從我現在的格子往外找路(不能穿過牆、木箱、別的炸彈、正在燒的火)
  function bfs(dg, from) {
    const dist = new Array(GW * GH).fill(-1), prev = new Array(GW * GH).fill(-1), q = [from];
    dist[from] = 0;
    while (q.length) {
      const i = q.shift(), c = i % GW, r = Math.floor(i / GW);
      for (let d = 1; d <= 4; d++) {
        const j = (r + BOMB_DY[d]) * GW + c + BOMB_DX[d];
        if (dist[j] >= 0 || solid(j) || (bombCell.has(j) && j !== from)) continue;
        const arrive = (dist[i] + 1) / spd;
        if (dg[j] <= arrive + 0.35 && dg[j] >= arrive - 0.6) continue; // 走到那裡時剛好在燒
        dist[j] = dist[i] + 1; prev[j] = i; q.push(j);
      }
    }
    return { dist, prev };
  }
  const firstStep = (prev, to, from) => { let i = to; while (prev[i] !== from && prev[i] >= 0) i = prev[i]; return i; };
  const sloppy = Math.random() > k.sk + 0.04;
  const dg = dangerMap();
  let target = -1;

  if (dg[myI] < Infinity && !(sloppy && Math.random() < 0.3)) { // 我站的地方會被炸到:逃!
    const { dist, prev } = bfs(dg, myI);
    let best = Infinity;
    dist.forEach((dd, i) => { if (dd >= 0 && dg[i] === Infinity && dd < best) { best = dd; target = firstStep(prev, i, myI); } });
    if (target < 0) target = myI;
  } else {
    const myBombs = m.bm.filter(b => b[5] === s).length;
    const enemies = m.ps.filter(p => p[0] !== s && p[3]);
    // 要不要在這裡放炸彈?旁邊有木箱,或對手在炸得到的直線上
    let worth = 0;
    for (let d = 1; d <= 4; d++) {
      for (let q = 1; q <= me[7]; q++) {
        const c = mc + BOMB_DX[d] * q, r = mr + BOMB_DY[d] * q, i = r * GW + c;
        if (g[i] === '1') break;
        if (g[i] === '2') { worth += q === 1 ? 2 : 1; break; }
        if (enemies.some(p => Math.floor(p[1]) === c && Math.floor(p[2]) === r)) worth += 4;
      }
    }
    if (worth >= 2 && myBombs < me[6] && me[9] !== 'nob' && !bombCell.has(myI) && now - st.last > 600) {
      const dg2 = dangerMap({ i: myI, t: 2.5, r: me[7] });
      const { dist } = bfs(dg2, myI);
      const canFlee = dist.some((dd, i) => dd > 0 && dg2[i] === Infinity && dd / spd < 2.0);
      if (canFlee || (sloppy && Math.random() < 0.25)) { st.last = now; botSend(H, s, { e: 'bomb' }); return; }
    }
    const { dist, prev } = bfs(dg, myI);
    let best = Infinity, goal = -1;
    dist.forEach((dd, i) => {
      if (dd < 0 || dg[i] < Infinity) return;
      let sc = Infinity;
      if (g[i] === 'f') return; // 詛咒不撿
      if (g[i] >= 'a') sc = dd - 6; // 道具優先
      else {
        const c = i % GW, r = Math.floor(i / GW);
        const nearBox = [1, 2, 3, 4].some(d => g[(r + BOMB_DY[d]) * GW + c + BOMB_DX[d]] === '2');
        const nearFoe = enemies.some(p => Math.abs(Math.floor(p[1]) - c) + Math.abs(Math.floor(p[2]) - r) <= 2);
        if (nearBox) sc = dd + 1;
        if (nearFoe) sc = Math.min(sc, dd + 2);
      }
      if (sc < best) { best = sc; goal = i; }
    });
    if (goal >= 0 && goal !== myI) target = firstStep(prev, goal, myI);
    else target = myI;
  }
  // 朝目標格子的中心走
  const tx = target % GW + 0.5, ty = Math.floor(target / GW) + 0.5, dx = tx - me[1], dy = ty - me[2];
  let d = 0;
  if (Math.abs(dx) > 0.08 || Math.abs(dy) > 0.08) d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : (dy > 0 ? 3 : 1);
  if (me[9] === 'rev') d = [0, 3, 4, 1, 2][d];
  if (d !== st.d) { st.d = d; botSend(H, s, { e: 'mv', d }); }
};

/* 跳棋的電腦:用跟「時間到自動走」一樣的評分,越弱隨機性越大 */
BOTS.checkers = (H, s, m, k) => {
  if (m.t !== 'g' || m.e !== 'st' || m.turn !== s || m.done || m.intro) return;
  const st = H.bs[s] || (H.bs[s] = { turns: -1 });
  if (st.turns === m.turns) return;
  st.turns = m.turns;
  const occ = m.occ.slice();
  H.s.after(Math.round(rand(900, 1700) * k.spd), () => {
    const b = chkBestMove(occ, s, m.homes[s], (1 - k.sk) * 40);
    if (b) botSend(H, s, { e: 'move', from: b.f, to: b.t });
  });
};

/* 填色大作戰的電腦:每步選吞最多格的顏色;越弱越常選錯、想越久 */
BOTS.flood = (H, s, m, k) => {
  if (m.t !== 'g' || m.e !== 'round' || !m.order.includes(s)) return;
  const n = m.n, g = [...m.grid].map(Number), rd = m.rd;
  const st = H.bs[s] = { rd };
  let i = 0;
  const step = () => {
    if (H.bs[s] !== st || floodDone(g, n) || i >= m.limit) return;
    let c;
    if (Math.random() < (1 - k.sk) * 0.45) c = pick(FLOOD_COLORS.map((_, k) => k).filter(x => x !== g[0]));
    else c = floodGreedy(g, n)[0];
    floodApply(g, n, c);
    botSend(H, s, { e: 'mv', c, i: i++ });
    H.s.after(Math.round(rand(900, 1900) * k.spd * (0.7 + n / 30)), step);
  };
  H.s.after(Math.round(rand(1200, 2200) * k.spd), step);
};

/* ---------- 防止雙指縮放 / 長按選單 ---------- */
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

home();
