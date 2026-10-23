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

const APP_VERSION = '2026.11.15';
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
  {
    id: 'parking', emoji: '🅿️', name: '停車大對決', tag: '競速+3D', color: '#ff7a1a', desc: '3 局停車比賽,誰停得又快又準!',
    rules: ['大家拿到同一個停車場,倒數完一起出發', '左邊搖桿指向要去的方向(上下左右是畫面上的方向),右邊按「前進」或「倒車」', '把車停進發光的格子,停穩就完成;撞車 +2 秒、撞鴨子 +3 秒、撞飛三角錐 +1 秒', '香蕉皮會讓車子轉圈圈,按「叭」可以催鴨子快走', '有些關卡會停電、方向盤裝反、或有阿姨來搶車位!', '3 局越來越難,時間最短的拿最多分'],
    host: hParking, view: vParking, noCountdown: true,
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
        <button class="btn big blue" id="busg"><span class="bi">🚌</span><span class="bt">闖關模式<small>公車 · 停車</small></span></button>
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
  $('#busg', h).addEventListener('click', () => { // 闖關模式:選要玩哪一個
    saveName();
    const m = el('div', 'qmenu');
    m.innerHTML = `<div class="qcard"><button class="iconbtn qx" aria-label="關閉">✕</button><h2>🏁 闖關模式</h2>
      <button class="qopt" data-q="bus"><span class="qe">🚌</span><span><b>公車大塞車</b><small>點公車開出停車場、載乘客</small></span></button>
      <button class="qopt" data-q="park"><span class="qe">🅿️</span><span><b>停車大師</b><small>3D 開車停進格子 · ${PK_PLAN.length} 關</small></span></button></div>`;
    m.addEventListener('click', e => {
      const o = e.target.closest('.qopt');
      if (o) { m.remove(); if (o.dataset.q === 'bus') busGame(); else parkGame(); }
      else if (e.target === m || e.target.closest('.qx')) m.remove();
    });
    app.appendChild(m);
    SFX.tap();
  });
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

/* ---------- 暗棋的 3D 畫面:Blender 做的木頭棋盤和棋子(assets/chess.glb),翻棋、走棋、吃子都有動畫 ----------
   three.js 座標:棋盤中心在原點,第 c 欄在 x = c - 1.5、第 r 列在 z = r - 3.5(上面是第 0 列),Y 朝上 */
function chess3D(LD, host) {
  const { THREE, gltf } = LD;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // 不壓縮顏色,木頭和紅黑字最鮮明
  const cvs = renderer.domElement;
  cvs.className = 'c3d';
  host.appendChild(cvs);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff3e0', '#3a2414', 0.3));
  const sun = new THREE.DirectionalLight('#fff0d4', 1.2);
  sun.position.set(-3, 9, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 7, bottom: -7, near: 1, far: 25 });
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.28); // 右前方的補光,棋子邊緣比較立體
  fill.position.set(5, 4, 8);
  scene.add(fill);
  // 木紋(棋盤用):一條條深淺不一的紋路
  const grain = (base, dark, light) => {
    const c = document.createElement('canvas'), g = c.getContext('2d'), rnd = busRng(base.length * 31 + dark.length);
    c.width = c.height = 512;
    g.fillStyle = base; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 140; i++) {
      const y = rnd() * 512;
      g.strokeStyle = rnd() < 0.55 ? dark : light; g.globalAlpha = 0.12 + rnd() * 0.22; g.lineWidth = 0.8 + rnd() * 3;
      g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 70 + i) * 3 + Math.sin(x / 23 + i * 2) * 1.2); g.stroke();
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  };
  const GRAIN = { BoardFrame: grain('#5c3518', '#2e1608', '#8a5530'), BoardWood: grain('#e8c883', '#a87a3c', '#f6dca0'), BoardWoodDk: grain('#c08d4a', '#8a5a26', '#d9a866') };
  // 木頭桌面
  const tcv = document.createElement('canvas');
  tcv.width = 512; tcv.height = 1024;
  { const g = tcv.getContext('2d'), rnd = busRng(77); g.fillStyle = '#6b4226'; g.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 90; i++) { const x = rnd() * 512; g.strokeStyle = `rgba(${rnd() < 0.5 ? '40,20,8' : '150,95,55'},${0.08 + rnd() * 0.12})`; g.lineWidth = 1 + rnd() * 4; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= 1024; y += 64) g.lineTo(x + Math.sin(y / 90 + i) * 6, y); g.stroke(); } }
  const ttex = new THREE.CanvasTexture(tcv);
  ttex.colorSpace = THREE.SRGBColorSpace;
  const table = new THREE.Mesh(new THREE.PlaneGeometry(16, 24), new THREE.MeshStandardMaterial({ map: ttex, roughness: 0.75 }));
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.33;
  table.receiveShadow = true;
  scene.add(table);
  // 棋盤
  gltf.scene.updateMatrixWorld(true);
  const board = new THREE.Group();
  glbMergeByMat(THREE, gltf.scene.getObjectByName('Board')).forEach(({ mat, geo }) => {
    const tex = GRAIN[mat.name];
    if (tex) { // Blender 的方塊沒有 UV,用俯視的位置當貼圖座標
      const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * 0.35; uv[i * 2 + 1] = p.getZ(i) * 0.12 + p.getY(i) * 0.35; }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      mat = mat.clone(); mat.map = tex; mat.color.set('#ffffff'); mat.roughness = 0.5;
    }
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = mat.name === 'BoardFrame'; board.add(m);
  });
  scene.add(board);
  // 棋子:木頭本體(Blender)+ 上下兩面貼字/花紋
  const bodyParts = glbMergeByMat(THREE, gltf.scene.getObjectByName('Piece'));
  const TOP = 0.028, PH = 0.22, BY = TOP + PH / 2;
  const tex = new Map();
  function faceTex(c, k) { // 正面:象牙色、雙圈、紅/黑字
    const key = c ? c + k : 'back';
    if (tex.has(key)) return tex.get(key);
    const cv = document.createElement('canvas'), g = cv.getContext('2d'), S = 256;
    cv.width = cv.height = S;
    const bg = g.createRadialGradient(S * 0.42, S * 0.38, 10, S / 2, S / 2, S / 2);
    bg.addColorStop(0, c ? '#f8eed8' : '#8a5430'); bg.addColorStop(1, c ? '#e6d2a4' : '#5a331a');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    const ink = !c ? '#e8c36e' : c === 'r' ? '#b80d18' : '#0f0e14';
    g.strokeStyle = ink; g.lineWidth = 9; g.beginPath(); g.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3.5; g.beginPath(); g.arc(S / 2, S / 2, S * 0.38, 0, Math.PI * 2); g.stroke();
    if (c) {
      g.font = `900 ${S * 0.5}px "Noto Serif TC", "Songti TC", "PMingLiU", "MingLiU", serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText(CHESS_NAME[c][k], S / 2 + 2, S / 2 + 6);
      g.fillStyle = ink; g.fillText(CHESS_NAME[c][k], S / 2, S / 2 + 4);
    } else { // 背面:刻花
      g.lineWidth = 5;
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.ellipse(S / 2 + Math.cos(a) * 30, S / 2 + Math.sin(a) * 30, 26, 11, a, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.arc(S / 2, S / 2, 12, 0, Math.PI * 2); g.fillStyle = ink; g.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    tex.set(key, t);
    return t;
  }
  const discGeo = new THREE.CircleGeometry(0.355, 48);
  const backMat = new THREE.MeshStandardMaterial({ map: faceTex(null), roughness: 0.45 });
  const blankMat = new THREE.MeshStandardMaterial({ map: faceTex(null), roughness: 0.45 });
  const faceMats = new Map();
  const faceMat = (c, k) => { const key = c + k; if (!faceMats.has(key)) faceMats.set(key, new THREE.MeshStandardMaterial({ map: faceTex(c, k), roughness: 0.4 })); return faceMats.get(key); };
  function makePiece() {
    const g = new THREE.Group(), inner = new THREE.Group();
    bodyParts.forEach(({ mat, geo }) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; inner.add(m); });
    inner.position.y = -PH / 2; // 讓棋子繞著自己的中心翻面
    const top = new THREE.Mesh(discGeo, blankMat), bot = new THREE.Mesh(discGeo, backMat);
    top.rotation.x = -Math.PI / 2; top.position.y = PH / 2 + 0.002;
    bot.rotation.x = Math.PI / 2; bot.position.y = -PH / 2 - 0.002;
    g.add(inner, top, bot);
    g.userData = { top, key: null, anim: null, lift: 0 };
    scene.add(g);
    return g;
  }
  const pos = i => new THREE.Vector3((i % CHESS_COLS) - 1.5, BY, Math.floor(i / CHESS_COLS) - 3.5);
  // 提示:選到的棋(金圈)、可以走的空格(綠點)、可以吃的棋(紅圈)、上一步(橘色格子)
  const ringGeo = new THREE.RingGeometry(0.4, 0.47, 48).rotateX(-Math.PI / 2);
  const mk = (geo, color, op) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false })); m.renderOrder = 2; m.visible = false; scene.add(m); return m; };
  const selRing = mk(ringGeo, '#ffd23f', 0.95);
  const dots = [], caps = [], lastSq = [mk(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), '#ff9f43', 0.35), mk(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), '#ff9f43', 0.2)];
  const dotGeo = new THREE.CircleGeometry(0.13, 24).rotateX(-Math.PI / 2);
  const pool = (arr, geo, color, op) => i => arr[i] || (arr[i] = mk(geo, color, op));

  const objs = new Array(32).fill(null), flying = [];
  let lastKey = '', selI = null, w = 0, h = 0, raf = 0;
  const camera = new THREE.PerspectiveCamera(26, 1, 0.5, 100);
  const fitCam = () => { // 斜斜看下去,整個棋盤剛好塞進畫面
    const TILT = 0.4, v = new THREE.Vector3(), corners = [];
    for (const x of [-2.3, 2.3]) for (const z of [-4.36, 4.36]) for (const y of [0, 0.25]) corners.push(new THREE.Vector3(x, y, z));
    let tz = 0, d = 10;
    for (let pass = 0; pass < 6; pass++) {
      let lo = 2, hi = 80;
      for (let k = 0; k < 28; k++) {
        d = (lo + hi) / 2;
        camera.position.set(0, Math.cos(TILT) * d, tz + Math.sin(TILT) * d); camera.lookAt(0, 0, tz); camera.updateMatrixWorld();
        if (corners.every(c => { v.copy(c).project(camera); return Math.abs(v.x) <= 0.99 && Math.abs(v.y) <= 0.985; })) hi = d; else lo = d;
      }
      d = hi;
      camera.position.set(0, Math.cos(TILT) * d, tz + Math.sin(TILT) * d); camera.lookAt(0, 0, tz); camera.updateMatrixWorld();
      let y0 = 9, y1 = -9;
      corners.forEach(c => { v.copy(c).project(camera); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
      tz -= (y0 + y1) / 2 * 4.5;
    }
  };
  const fit = () => { // 畫布往左右延伸到整個螢幕寬、往下到螢幕底,棋盤才能放到最大
    const r = host.getBoundingClientRect(), k = r.width / (host.offsetWidth || r.width) || 1; // 外層有縮放動畫時,換算回自己的座標
    const nw = Math.round(document.documentElement.clientWidth / k), nh = Math.round(Math.max(r.height, window.innerHeight - r.top) / k);
    if (!r.width || (nw === w && nh === h)) return;
    w = nw; h = nh;
    Object.assign(cvs.style, { left: -Math.round(r.left / k) + 'px', width: w + 'px', height: h + 'px' });
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fitCam();
  };
  const ease = u => 1 - Math.pow(1 - Math.min(1, u), 3);
  function frame(now) {
    if (!cvs.isConnected) { renderer.dispose(); renderer.forceContextLoss(); return; }
    fit();
    objs.forEach((o, i) => {
      if (!o) return;
      const ud = o.userData, a = ud.anim, p = pos(i);
      ud.lift += ((selI === i ? 0.18 : 0) - ud.lift) * 0.25;
      if (a) {
        const u = (now - a.t0) / a.dur;
        if (a.type === 'flip') { o.rotation.x = Math.PI * (1 - ease(u)); o.position.set(p.x, BY + Math.sin(Math.min(1, u) * Math.PI) * 0.7, p.z); }
        else { const f = ease(u), A = a.from; o.position.set(A.x + (p.x - A.x) * f, BY + Math.sin(Math.min(1, u) * Math.PI) * 0.45, A.z + (p.z - A.z) * f); }
        if (u >= 1) ud.anim = null;
      } else { o.position.set(p.x, BY + ud.lift, p.z); o.rotation.x = ud.hid ? Math.PI : 0; }
    });
    for (let k = flying.length - 1; k >= 0; k--) { // 被吃掉的棋子飛出棋盤
      const f = flying[k], u = (now - f.t0) / 900;
      if (u > 1) { scene.remove(f.o); flying.splice(k, 1); continue; }
      f.o.position.set(f.x + f.vx * u, BY + 2.2 * u - 2.6 * u * u + 0.3, f.z + f.vz * u);
      f.o.rotation.x += 0.25; f.o.rotation.z += 0.18;
    }
    selRing.position.y = BY + PH / 2 + 0.05 + (selI != null && objs[selI] ? objs[selI].userData.lift : 0);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(BY + PH / 2)), hit = new THREE.Vector3();
  return {
    sync(st, sel, targets) {
      const now = performance.now(), L = st.last, key = L ? JSON.stringify(L) : '';
      if (key !== lastKey && L) { // 新的一步:做動畫
        if (L.type === 'flip' && objs[L.to] && st.cells[L.to] && !st.cells[L.to].h) {
          const o = objs[L.to], x = st.cells[L.to];
          o.userData.top.material = faceMat(x.c, x.k); o.userData.key = x.c + x.k; o.userData.hid = false;
          o.userData.anim = { type: 'flip', t0: now, dur: 520 };
        } else if ((L.type === 'move' || L.type === 'cap') && objs[L.from]) {
          const o = objs[L.from];
          if (objs[L.to]) { const v = objs[L.to], p = pos(L.to); flying.push({ o: v, t0: now, x: p.x, z: p.z, vx: (p.x >= 0 ? 1 : -1) * 3.2, vz: (Math.random() - 0.5) * 2 }); }
          o.userData.anim = { type: 'move', t0: now, dur: 420, from: pos(L.from) };
          objs[L.to] = o; objs[L.from] = null;
        }
      }
      lastKey = key;
      // 對齊伺服器的棋盤(第一次進來、或漏掉訊息時)
      st.cells.forEach((x, i) => {
        if (!x) { if (objs[i]) { scene.remove(objs[i]); objs[i] = null; } return; }
        if (!objs[i]) { objs[i] = makePiece(); objs[i].position.copy(pos(i)); }
        const ud = objs[i].userData;
        if (x.h) { ud.hid = true; if (!ud.anim) objs[i].rotation.x = Math.PI; }
        else { ud.hid = false; if (ud.key !== x.c + x.k) { ud.top.material = faceMat(x.c, x.k); ud.key = x.c + x.k; } }
      });
      // 提示
      selI = sel;
      selRing.visible = sel != null;
      if (sel != null) { const p = pos(sel); selRing.position.x = p.x; selRing.position.z = p.z; }
      const dotAt = pool(dots, dotGeo, '#2fb36b', 0.9), capAt = pool(caps, ringGeo, '#ee4b4b', 0.95);
      let nd = 0, nc = 0;
      (targets || []).forEach(i => { const p = pos(i); if (st.cells[i]) { const m = capAt(nc++); m.position.set(p.x, BY + PH / 2 + 0.03, p.z); m.visible = true; } else { const m = dotAt(nd++); m.position.set(p.x, TOP + 0.01, p.z); m.visible = true; } });
      for (let i = nd; i < dots.length; i++) dots[i].visible = false;
      for (let i = nc; i < caps.length; i++) caps[i].visible = false;
      [L && L.to, L && L.type !== 'flip' ? L.from : null].forEach((i, k) => { const m = lastSq[k]; m.visible = i != null && i >= 0; if (m.visible) { const p = pos(i); m.position.set(p.x, TOP + 0.004, p.z); } });
    },
    pick(cx, cy) { // 點的位置是哪一格(-1 = 棋盤外)
      const r = cvs.getBoundingClientRect();
      camera.updateMatrixWorld();
      ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      if (!ray.ray.intersectPlane(plane, hit)) return -1;
      const c = Math.floor(hit.x + 2), rr = Math.floor(hit.z + 4);
      return c >= 0 && c < CHESS_COLS && rr >= 0 && rr < CHESS_ROWS ? rr * CHESS_COLS + c : -1;
    },
  };
}

function vChess(V) {
  let st = null, sel = null, targets = [], over = false, lastTurn = null, coverT = null;
  const chipsEl = $('.chips', V.root);
  chipsEl.className = 'cstatus'; // 狀態列藏起來(輪到誰看玩家卡的光框),棋盤才能更大
  const exitB = $('.exit', V.root);
  exitB.classList.add('cexit');
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
  V.pad.appendChild(exitB);
  const showCover = (html, ms) => {
    cover.innerHTML = html;
    cover.classList.add('on');
    clearTimeout(coverT);
    if (ms) coverT = setTimeout(() => cover.classList.remove('on'), ms);
  };
  V.stage('<div class="cinfo"></div>');
  showCover('<div class="big">♟️</div><div>擺棋中…</div>');
  let g3 = null; // 3D 棋盤(載入失敗就用平面的)
  glbLoad('assets/chess.glb').then(L => {
    if (!boardEl.isConnected) return;
    g3 = chess3D(L, V.pad);
    V.root.classList.add('c3');
    if (st) render();
  }).catch(e => console.warn('暗棋 3D 載入失敗,改用平面棋盤', e));

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
    if (g3) g3.sync(st, sel, targets);
    renderStage();
  }

  V.onTap = e => {
    if (!myTurn()) return;
    const c = e.target.closest('.cell'), i = g3 ? g3.pick(e.clientX, e.clientY) : c ? +c.dataset.i : -1;
    if (i < 0) return;
    const x = st.cells[i];
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
      if (myTurn() && lastTurn !== V.me) { buzz(60); if (m.turn !== lastTurn) SFX.tick(); }
      if (m.idle >= 40 && m.idle % 3 === 1 && m.last && m.last.type === 'move') toast(`再 ${50 - m.idle} 步沒有翻棋或吃子就平手`);
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

/* ---------- 跳棋的 3D 畫面:Blender 做的六角星木頭棋盤(assets/checkers.glb)+ 玻璃彈珠,three.js 即時畫 ----------
   洞的位置:three.js 的 (x, 0, -y)(跟 Blender 匯出的棋盤一致);遊戲邏輯(選棋、走棋、連跳動畫)還是用原本的 SVG 那套,
   3D 這邊每一幀把 SVG 裡的狀態(彈珠的位置、選到哪顆、可以走的洞)畫成 3D */
function chk3D(LD, host, RoomEnv, getState) {
  const { THREE, gltf } = LD;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const cvs = renderer.domElement;
  cvs.className = 'k3d';
  host.appendChild(cvs);
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnv(), 0.04).texture; // 玻璃彈珠的反光
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight('#fff3e0', '#3a2414', 0.4));
  const sun = new THREE.DirectionalLight('#fff0d4', 2.3);
  sun.position.set(-8, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 5, far: 60 });
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.5);
  fill.position.set(10, 8, -10);
  scene.add(fill);
  // 木頭桌面
  const tcv = document.createElement('canvas');
  tcv.width = tcv.height = 512;
  { const g = tcv.getContext('2d'), rnd = busRng(91); g.fillStyle = '#6b4226'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 110; i++) { const x = rnd() * 512; g.strokeStyle = `rgba(${rnd() < 0.5 ? '40,20,8' : '150,95,55'},${0.08 + rnd() * 0.12})`; g.lineWidth = 1 + rnd() * 4; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= 512; y += 64) g.lineTo(x + Math.sin(y / 90 + i) * 6, y); g.stroke(); } }
  const ttex = new THREE.CanvasTexture(tcv);
  ttex.colorSpace = THREE.SRGBColorSpace; ttex.wrapS = ttex.wrapT = THREE.RepeatWrapping; ttex.repeat.set(4, 4);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: ttex, roughness: 0.75 }));
  table.rotation.x = -Math.PI / 2; table.position.y = -0.72; table.receiveShadow = true;
  scene.add(table);
  // 棋盤(Blender)
  gltf.scene.updateMatrixWorld(true);
  const board = new THREE.Group();
  glbMergeByMat(THREE, gltf.scene.getObjectByName('Board')).forEach(({ mat, geo }) => {
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = mat.name === 'BoardFrame' || mat.name === 'HoleRing'; board.add(m);
  });
  scene.add(board);
  const pos = i => new THREE.Vector3(CHK.cells[i].x, 0, -CHK.cells[i].y);
  // 家的三角形、對面終點的三角形:在洞底下鋪一圈玩家顏色
  const discGeo = new THREE.CircleGeometry(0.56, 24).rotateX(-Math.PI / 2);
  let triKey = '', triGroup = new THREE.Group();
  scene.add(triGroup);
  function paintTris(st) {
    const key = st ? JSON.stringify([st.order, st.homes]) : '';
    if (key === triKey) return;
    triKey = key;
    triGroup.clear();
    if (!st) return;
    for (let k = 0; k < 6; k++) {
      const owner = st.order.find(p => st.homes[p] === k), target = st.order.find(p => chkGoal(st.homes[p]) === k), p = owner != null ? owner : target;
      if (p == null) continue;
      const mat = new THREE.MeshBasicMaterial({ color: pinfo(p).color, transparent: true, opacity: owner != null ? 0.62 : 0.34, depthWrite: false });
      CHK.tri[k].forEach(i => { const m = new THREE.Mesh(discGeo, mat); m.position.copy(pos(i)); m.position.y = 0.2; m.renderOrder = 1; triGroup.add(m); });
    }
  }
  // 玻璃彈珠:每個玩家一種材質,一次畫完(InstancedMesh 不好跟著動畫,所以每顆一個 Mesh,最多 40 顆)
  const marbleGeo = new THREE.SphereGeometry(0.6, 32, 20);
  const mats = new Map();
  const marbleMat = col => { if (!mats.has(col)) mats.set(col, new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.08, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04, emissive: col, emissiveIntensity: 0.18 })); return mats.get(col); };
  const marbles = [];
  const hlRing = new THREE.RingGeometry(0.55, 0.72, 32).rotateX(-Math.PI / 2);
  const mk = (geo, color, op) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false })); m.renderOrder = 3; m.visible = false; scene.add(m); return m; };
  const selRing = mk(hlRing, '#ffd23f', 0.95), destPool = [], lastPool = [];
  const dotGeo = new THREE.CircleGeometry(0.34, 24).rotateX(-Math.PI / 2);

  let w = 0, h = 0, raf = 0;
  const camera = new THREE.PerspectiveCamera(24, 1, 1, 200);
  const fitCam = () => { // 斜斜看下去,整個六角形剛好塞進畫面
    const TILT = 0.5, v = new THREE.Vector3(), corners = [];
    const portrait = camera.aspect < 1.05; // 直的螢幕:鏡頭轉 90 度,六角形的長邊對著螢幕的高度,棋盤才放得大
    const bx = portrait ? 1 : 0, bz = portrait ? 0 : 1; // 鏡頭在棋盤的哪一側
    const put = (tz, d) => { camera.position.set(bx * (tz + Math.sin(TILT) * d), Math.cos(TILT) * d, bz * (tz + Math.sin(TILT) * d)); camera.lookAt(bx * tz, 0, bz * tz); camera.updateMatrixWorld(); };
    for (let k = 0; k < 6; k++) for (const y of [-0.7, 0.4]) corners.push(new THREE.Vector3(Math.cos(Math.PI / 3 * k) * 14.5, y, -Math.sin(Math.PI / 3 * k) * 14.5));
    let tz = 0, d = 40;
    for (let pass = 0; pass < 6; pass++) {
      let lo = 8, hi = 200;
      for (let k = 0; k < 28; k++) {
        d = (lo + hi) / 2;
        put(tz, d);
        if (corners.every(c => { v.copy(c).project(camera); return Math.abs(v.x) <= 0.99 && Math.abs(v.y) <= 0.985; })) hi = d; else lo = d;
      }
      d = hi;
      put(tz, d);
      let y0 = 9, y1 = -9;
      corners.forEach(c => { v.copy(c).project(camera); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
      tz -= (y0 + y1) / 2 * 14; // 上下留白平均一點
    }
  };
  const fit = () => {
    const r = host.getBoundingClientRect(), k = r.width / (host.offsetWidth || r.width) || 1;
    const nw = Math.round(r.width / k), nh = Math.round(r.height / k);
    if (!nw || (nw === w && nh === h)) return;
    w = nw; h = nh;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fitCam();
  };
  const poolAt = (arr, i, geo, color, op) => arr[i] || (arr[i] = mk(geo, color, op));
  function frame(now) {
    if (!cvs.isConnected) { renderer.dispose(); renderer.forceContextLoss(); return; }
    fit();
    const S = getState();
    paintTris(S.st);
    // 彈珠:跟著 SVG 裡彈珠的位置(動畫中也會動)
    let n = 0;
    S.balls.forEach(b => {
      let m = marbles[n];
      if (!m) { m = marbles[n] = new THREE.Mesh(marbleGeo, marbleMat(b.color)); m.castShadow = true; scene.add(m); }
      m.material = marbleMat(b.color);
      m.visible = true;
      const lift = b.sel ? 0.5 + Math.sin(now / 160) * 0.06 : Math.max(0, (b.scale - 1) * 6);
      m.position.set(b.x, 0.6 + 0.12 + lift + 0.06, -b.y);
      n++;
    });
    for (let i = n; i < marbles.length; i++) marbles[i].visible = false;
    selRing.visible = S.sel != null;
    if (S.sel != null) { selRing.position.set(CHK.cells[S.sel].x, 0.24, -CHK.cells[S.sel].y); }
    const pulse = 0.55 + Math.abs(Math.sin(now / 280)) * 0.45;
    S.dests.forEach(([i, jump], k) => { const m = poolAt(destPool, k, dotGeo, '#2fe08a', 1); m.material.color.set(jump ? '#ffd23f' : '#2fe08a'); m.material.opacity = pulse; m.position.set(CHK.cells[i].x, 0.26, -CHK.cells[i].y); m.visible = true; });
    for (let i = S.dests.length; i < destPool.length; i++) destPool[i].visible = false;
    S.lastPath.forEach((i, k) => { const m = poolAt(lastPool, k, hlRing, '#ffffff', 0.55); m.material.color.set(S.lastColor); m.position.set(CHK.cells[i].x, 0.22, -CHK.cells[i].y); m.scale.setScalar(k === 0 || k === S.lastPath.length - 1 ? 1 : 0.6); m.visible = true; });
    for (let i = S.lastPath.length; i < lastPool.length; i++) lastPool[i].visible = false;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.7), hit = new THREE.Vector3();
  return {
    pick(cx, cy) { // 點的位置是哪個洞(-1 = 沒點到)
      const r = cvs.getBoundingClientRect();
      camera.updateMatrixWorld();
      ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      if (!ray.ray.intersectPlane(plane, hit)) return -1;
      let best = -1, bd = 1.0;
      CHK.cells.forEach((c, i) => { const d = Math.hypot(c.x - hit.x, -c.y - hit.z); if (d < bd) { bd = d; best = i; } });
      return best;
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
  let g3 = null; // 3D 棋盤(載入失敗就用 SVG 的)
  const wrapEl = $('.chwrap', V.pad);
  Promise.all([glbLoad('assets/checkers.glb'), import('three/addons/environments/RoomEnvironment.js')]).then(([L, env]) => {
    if (!svg.isConnected) return;
    g3 = chk3D(L, wrapEl, env.RoomEnvironment, () => {
      const out = [];
      balls.forEach((b, i) => {
        const m = /translate\(([-\d.]+) ([-\d.]+)\)(?: scale\(([\d.]+)\))?/.exec(b.getAttribute('transform') || '');
        if (m) out.push({ x: +m[1], y: +m[2], scale: m[3] ? +m[3] : 1, color: pinfo(+b.dataset.s).color, sel: b.classList.contains('sel') });
      });
      return {
        st, balls: out, sel: sel >= 0 ? sel : null,
        dests: sel >= 0 ? [...dests].map(([t, path]) => [t, path.length > 2 || chkJump(path)]) : [],
        lastPath: st && st.last && st.last.path && !animating ? st.last.path : [], lastColor: st && st.last ? pinfo(st.last.s).color : '#fff',
      };
    });
    V.root.classList.add('chk3');
  }).catch(e => console.warn('跳棋 3D 載入失敗,改用平面棋盤', e));

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
    const pk = g3 ? g3.pick(e.clientX, e.clientY) : -2;
    const d = g3 ? (pk >= 0 && sel >= 0 && dests.has(pk) ? { dataset: { i: pk } } : null) : e.target.closest('.chdest');
    if (d) {
      const t = +d.dataset.i;
      V.send({ e: 'move', from: sel, to: t });
      sel = -1; dests = new Map(); destsG.innerHTML = '';
      SFX.tap();
      return;
    }
    const b = g3 ? null : e.target.closest('.chball, .chholes circle');
    const i = g3 ? pk : b ? +b.dataset.i : -1;
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
const BUS_COLORS = ['#e53935', '#1e6fe0', '#fbc02d', '#2eaa4f', '#8e44c8', '#12b5cb', '#ff6fae']; // 紅 藍 黃 綠 紫 青 粉
const busRng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
// 停車場的大小(世界座標,單位約等於一台車的寬)
const BUS_LW = 9.6, BUS_LH = 11, BUS_WID = 0.72;
const busLenOf = cap => (cap === 6 ? 2.05 : 1.45); // 4 人座短車、6 人座長車
// 兩個旋轉的長方形有沒有重疊(分離軸定理);中心 (x, y)、角度 a、半長 hl、半寬 hw
function busObbHit(ax, ay, aa, ahl, ahw, bx, by, ba, bhl, bhw) {
  const dx = bx - ax, dy = by - ay;
  for (const u of [aa, aa + Math.PI / 2, ba, ba + Math.PI / 2]) {
    const cu = Math.cos(u), su = Math.sin(u);
    const ra = ahl * Math.abs(Math.cos(aa - u)) + ahw * Math.abs(Math.sin(aa - u));
    const rb = bhl * Math.abs(Math.cos(ba - u)) + bhw * Math.abs(Math.sin(ba - u));
    if (Math.abs(dx * cu + dy * su) > ra + rb) return false;
  }
  return true;
}
const busHit = (p, q, m) => busObbHit(p.x, p.y, p.a, p.len / 2 + (m || 0), BUS_WID / 2 + (m || 0), q.x, q.y, q.a, q.len / 2, BUS_WID / 2);
const busOutside = (x, y, r) => x < -r || y < -r || x > BUS_LW + r || y > BUS_LH + r;
// 公車往 a 方向一直開,會不會撞到 others 裡的車:回傳撞到之前能走的距離,沒撞到就回傳 -1
function busSweep(b, a, others) { const h = busFirstHit(b, a, others); return h ? h.d : -1; }
function busFirstHit(b, a, others) { // 撞到的第一台車與距離,沒撞到回傳 null
  const ca = Math.cos(a), sa = Math.sin(a), r0 = Math.hypot(b.len / 2, BUS_WID / 2), far = BUS_LW + BUS_LH;
  const near = others.filter(o => { // 先用「圓 vs 線段」快速過濾,只留下可能撞到的車
    if (o === b) return false;
    const t = Math.max(0, Math.min(far, (o.x - b.x) * ca + (o.y - b.y) * sa));
    return Math.hypot(b.x + ca * t - o.x, b.y + sa * t - o.y) < r0 + Math.hypot(o.len / 2, BUS_WID / 2);
  });
  const hl = b.len / 2 - 0.02, hw = BUS_WID / 2 - 0.02;
  for (let s = 0.12; s < far; s += 0.12) {
    const x = b.x + ca * s, y = b.y + sa * s;
    if (busOutside(x, y, r0 + 0.1)) return null;
    for (const o of near) if (busObbHit(x, y, a, hl, hw, o.x, o.y, o.a, o.len / 2, BUS_WID / 2)) return { d: Math.max(0, s - 0.12), o };
  }
  return null;
}
// 擺法:跟原版遊戲一樣有各種圖案(幾塊一排一排的、整片斜的、一圈一圈的、螺旋、亂堆)
function busPattern(kind, rnd, longP) {
  const out = [], cx = BUS_LW / 2, cy = BUS_LH / 2, cap = () => (rnd() < longP ? 6 : 4);
  const push = (x, y, axis) => { const c = cap(); out.push({ x, y, a: axis, cap: c, len: busLenOf(c) }); };
  if (kind === 'blocks' || kind === 'tilt') { // 分成幾塊,每一塊裡面的車方向一樣,排成一排一排
    const rot = kind === 'tilt' ? [Math.PI / 6, Math.PI / 4, -Math.PI / 6][Math.floor(rnd() * 3)] : 0;
    const cols = 2 + Math.floor(rnd() * 2), rows = 2 + Math.floor(rnd() * 2), bw = 12 / cols, bh = 13 / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const vert = rnd() < 0.5, x0 = -1.2 + i * bw, y0 = -1 + j * bh;
      if (vert) for (let x = x0 + 0.5; x < x0 + bw - 0.4; x += 0.86) for (let y = y0 + 1.1; y < y0 + bh - 1; y += 2.25) push(x, y, Math.PI / 2);
      else for (let y = y0 + 0.5; y < y0 + bh - 0.4; y += 0.86) for (let x = x0 + 1.1; x < x0 + bw - 1; x += 2.25) push(x, y, 0);
    }
    if (rot) out.forEach(p => { const dx = p.x - cx, dy = p.y - cy; p.x = cx + dx * Math.cos(rot) - dy * Math.sin(rot); p.y = cy + dx * Math.sin(rot) + dy * Math.cos(rot); p.a += rot; });
  } else if (kind === 'rings') { // 一圈一圈的同心圓,車沿著圓排
    const off = rnd() * Math.PI;
    for (let r = 1.25; r < 5.2; r += 1.05) {
      const n = Math.floor(2 * Math.PI * r / 2.15);
      for (let k = 0; k < n; k++) { const t = off + k / n * Math.PI * 2 + r; push(cx + Math.cos(t) * r, cy + Math.sin(t) * r * 1.1, t + Math.PI / 2); }
    }
    push(cx, cy, rnd() * Math.PI);
  } else if (kind === 'spiral') { // 螺旋
    let t = 0.8;
    while (true) {
      const r = 0.55 + 0.33 * t;
      if (r > 5.3) break;
      push(cx + Math.cos(t) * r, cy + Math.sin(t) * r * 1.12, t + Math.PI / 2);
      t += 2.1 / r;
    }
  } else { // 'pile' 亂堆:隨便擺、角度每 15 度一格
    for (let k = 0; k < 900 && out.length < 80; k++) {
      const c = cap(), b = { x: 0.8 + rnd() * (BUS_LW - 1.6), y: 0.8 + rnd() * (BUS_LH - 1.6), a: Math.floor(rnd() * 12) * Math.PI / 12, cap: c, len: busLenOf(c) };
      if (!out.some(o => busHit(b, o, 0.07))) out.push(b);
    }
  }
  return out;
}
function busLevel(L) {
  const rnd = busRng(L * 7919 + 13), ri = n => Math.floor(rnd() * n);
  const nColors = Math.min(BUS_COLORS.length, 2 + Math.floor((L - 1) / 3));
  const want = Math.min(46, 6 + Math.floor((L - 1) * 1.2));
  const longP = Math.min(0.55, 0.2 + L * 0.02);
  const kinds = L <= 3 ? ['blocks'] : ['blocks', 'tilt', 'rings', 'spiral', 'pile', 'blocks', 'pile'];
  let placed = [];
  const pBlock = Math.min(0.92, 0.35 + L * 0.03); // 越後面越常故意讓車子被「先開走的車」擋住
  for (let attempt = 0; attempt < 4 && placed.length < want * 0.75; attempt++) {
    // 1) 依圖案產生位置,留下在停車場裡、而且不互相重疊的
    const cand = busPattern(kinds[ri(kinds.length)], rnd, longP);
    const keep = [];
    cand.forEach(b => {
      const r = Math.hypot(b.len / 2, BUS_WID / 2);
      if (b.x < r * 0.6 || b.y < r * 0.6 || b.x > BUS_LW - r * 0.6 || b.y > BUS_LH - r * 0.6) return;
      if (!keep.some(o => busHit(b, o, 0.06))) keep.push(b);
    });
    // 數量太多就隨機拿掉一些(圖案還是看得出來)
    while (keep.length > want) keep.splice(ri(keep.length), 1);
    // 2) 決定每台車的方向:一直找「現在開得出去」的車把它移走,移走的順序就是保證有解的順序
    const rest = keep.slice(), order = [], gone = [];
    const memo = new Map(); // 「公車+方向」→ 擋住它的車(null 代表一路暢通)
    const inRest = new Set(rest);
    while (rest.length) {
      const opts = [];
      rest.forEach(b => [0, Math.PI].forEach(f => {
        const key = b, k2 = f ? 1 : 0;
        let m = memo.get(key);
        if (!m) { m = [undefined, undefined]; memo.set(key, m); }
        if (m[k2] === undefined || (m[k2] && !inRest.has(m[k2]))) { const h = busFirstHit(b, b.a + f, rest); m[k2] = h ? h.o : null; }
        if (m[k2] === null) opts.push([b, b.a + f, busSweep(b, b.a + f, gone) >= 0 ? 1 : 0]);
      }));
      if (!opts.length) { const dead = rest.splice(ri(rest.length), 1)[0]; inRest.delete(dead); continue; } // 卡死了:拿掉一台車
      const blocked = opts.filter(o => o[2]); // 會被先開走的車擋住 = 一開始開不出去,要先解開
      const pool = blocked.length && rnd() < pBlock ? blocked : opts;
      const [b, a] = pool[ri(pool.length)];
      b.a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      order.push(b);
      gone.push({ ...b });
      rest.splice(rest.indexOf(b), 1);
      inRest.delete(b);
    }
    if (order.length > placed.length) placed = order;
  }
  placed.forEach((b, i) => { b.id = i; });
  // 顏色:每種顏色至少一台
  const ids = placed.map((_, i) => i);
  for (let i = ids.length - 1; i > 0; i--) { const j = ri(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  ids.forEach((id, k) => { placed[id].c = k < nColors ? k : ri(nColors); });
  // 第 16 關起:有些公車是「?」神秘車,前面被擋住的時候看不到顏色,路一通就會顯示出來
  const hidP = L >= 16 ? Math.min(0.45, (L - 15) * 0.03) : 0;
  placed.forEach(b => { b.hid = rnd() < hidP; });
  // 乘客排隊:照「開出去的順序」,同時最多 win 台車在接客,把它們的乘客混在一起
  const slots = 5, win = Math.min(slots - 1, 1 + Math.ceil(L / 3));
  const rem = new Map(placed.map(b => [b.id, b.cap]));
  const queue = [], open = [];
  let nx = 0;
  const total = placed.reduce((t, b) => t + b.cap, 0);
  while (queue.length < total) {
    while (open.length < win && nx < placed.length) open.push(placed[nx++]);
    const b = open[ri(open.length)];
    queue.push(b.c);
    rem.set(b.id, rem.get(b.id) - 1);
    if (!rem.get(b.id)) open.splice(open.indexOf(b), 1);
  }
  const tier = L <= 5 ? '簡單' : L <= 12 ? '普通' : L <= 25 ? '困難' : L <= 45 ? '超難' : '地獄';
  return { slots, buses: placed, queue, nColors, tier };
}

/* ---------- 乘客角色:用附件的立體小人圖(戴帽子的 T 恤小人),切下來之後把衣服和帽子換成各種公車的顏色 ---------- */
const BUS_HUES = [2, 214, 46, 138, 280, 188, 332]; // 跟 BUS_COLORS 一一對應的色相
const BUS_TONE = [[1, 1], [1, 1], [1.05, 1.22], [1, 1], [1, 1.08], [1, 1.1], [0.9, 1.22]]; // 各顏色的 [飽和度, 亮度] 倍率
const BUS_PEOPLE = { ready: false, sheet: null, base: [], v: [] };
(() => {
  const im = new Image();
  im.onload = () => {
    try { busCutPeople(im); BUS_PEOPLE.ready = true; } catch (e) { /* 失敗就用程式畫的小人 */ }
  };
  im.src = 'assets/people.png';
})();
function busRgb2Hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function busHsl2Rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function busCutPeople(im) {
  const W = im.width, H = im.height, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  const src = x.getImageData(0, 0, W, H).data, BG = 235;
  const alpha = new Float32Array(W * H), mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2], mx = Math.max(r, g, b) / 255, ch = (mx * 255 - Math.min(r, g, b)) / 255;
    alpha[i] = Math.max(0, Math.min(1, Math.max((ch - 0.09) / 0.1, (0.42 - mx) / 0.12)));
    mask[i] = alpha[i] > 0.5 ? 1 : 0;
  }
  // 附件是 8 欄 x 4 排的格子:先找出所有相連的色塊,再依位置歸到各自的格子(一個小人可能被切成頭和身體兩塊)
  const lab = new Int32Array(W * H).fill(-1), comps = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    const q = [i], id = comps.length;
    lab[i] = id;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let k = 0; k < q.length; k++) {
      const p = q[k], px = p % W, py = (p / W) | 0;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx;
        if (mask[np] && lab[np] < 0) { lab[np] = id; q.push(np); }
      }
    }
    comps.push({ n: q.length, x0, y0, x1, y1 });
  }
  const cellW = W / 8, cellH = H / 4, cells = new Map(), cellOf = new Int32Array(comps.length).fill(-1);
  comps.forEach((p, id) => {
    if (p.n < 40) return;
    const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2, key = Math.min(3, Math.floor(cy / cellH)) * 8 + Math.min(7, Math.floor(cx / cellW));
    cellOf[id] = key;
    const m = cells.get(key) || { key, x0: W, y0: H, x1: 0, y1: 0, n: 0 };
    m.x0 = Math.min(m.x0, p.x0); m.y0 = Math.min(m.y0, p.y0); m.x1 = Math.max(m.x1, p.x1); m.y1 = Math.max(m.y1, p.y1); m.n += p.n;
    cells.set(key, m);
  });
  const people = [...cells.values()].filter(p => p.n > 800).sort((p, q) => p.key - q.key);
  // 每個小人切成透明背景的小圖(邊緣的灰色底要扣掉,不然會有一圈白邊)
  BUS_PEOPLE.base = people.map(p => {
    const w = p.x1 - p.x0 + 5, h = p.y1 - p.y0 + 5, oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    const ox = oc.getContext('2d'), out = ox.createImageData(w, h);
    const mine = i => lab[i] >= 0 && cellOf[lab[i]] === p.key;
    const outside = new Uint8Array(w * h), st = [];
    const solid = (xx, yy) => { const sx = p.x0 - 2 + xx, sy = p.y0 - 2 + yy; return sx >= 0 && sy >= 0 && sx < W && sy < H && mine(sy * W + sx); };
    for (let xx = 0; xx < w; xx++) { st.push(xx, (h - 1) * w + xx); }
    for (let yy = 0; yy < h; yy++) { st.push(yy * w, yy * w + w - 1); }
    while (st.length) { // 小人裡面的白色反光不能變成洞:從邊框往內淹,淹不到的就是小人內部
      const q = st.pop();
      if (outside[q]) continue;
      const qx = q % w, qy = (q / w) | 0;
      if (solid(qx, qy)) continue;
      outside[q] = 1;
      if (qx > 0) st.push(q - 1); if (qx < w - 1) st.push(q + 1); if (qy > 0) st.push(q - w); if (qy < h - 1) st.push(q + w);
    }
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const sx = p.x0 - 2 + xx, sy = p.y0 - 2 + yy;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const i = sy * W + sx;
      let a = alpha[i];
      if (!outside[yy * w + xx]) a = 1; // 小人裡面(含白色反光)
      else if (a > 0 && !mine(i)) {
        let near = false; // 只保留這個小人旁邊的像素,不要把隔壁的小人帶進來
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const j = i + dy * W + dx; if (j >= 0 && j < W * H && mine(j)) { near = true; break; } }
        if (!near) a = 0;
      }
      if (a <= 0.02) continue;
      const o = (yy * w + xx) * 4, ea = a < 1 ? a * a : 1; // 邊緣的半透明收緊一點,看起來不會有一圈淡淡的白邊
      for (let k = 0; k < 3; k++) out.data[o + k] = Math.max(0, Math.min(255, (src[i * 4 + k] - (1 - a) * BG) / a));
      out.data[o + 3] = Math.round(ea * 255);
    }
    ox.putImageData(out, 0, 0);
    return oc;
  });
}
// 取得一個小人的圖:衣服和帽子換成公車的顏色,再依 hv(髮色)、sv(膚色)、pv(褲子)微調;做好就記起來
const BUS_HAIR = [null, [null, 0.35, 0.5], [44, 1.1, 2.1], [16, 1.4, 1.5], [null, 0.06, 2.2]]; // 原本的棕、黑、金、紅棕、灰白:[色相, 飽和度倍率, 亮度倍率]
const BUS_SKIN = [null, [24, 1.05, 0.84], [22, 0.85, 0.62], [null, 0.75, 1.06]]; // 原本、小麥色、深棕、白皙
const BUS_PANT = [null, [null, 0.08, 0.8], [42, 0, 1.45], [8, 0, 1.1]]; // 牛仔藍、深灰、卡其、暗紅(色相有給的話,飽和度直接用固定值 0.38/0.45)
BUS_PEOPLE.cache = new Map();
function busPerson(ci, pose, hv, sv, pv) {
  const key = ci + ',' + pose + ',' + hv + ',' + sv + ',' + pv;
  let out = BUS_PEOPLE.cache.get(key);
  if (out) return out;
  const b = BUS_PEOPLE.base[pose], oc = document.createElement('canvas');
  oc.width = b.width; oc.height = b.height;
  const ox = oc.getContext('2d');
  ox.drawImage(b, 0, 0);
  const img = ox.getImageData(0, 0, b.width, b.height), d = img.data, hue = BUS_HUES[ci], tone = BUS_TONE[ci];
  const hair = BUS_HAIR[hv], skin = BUS_SKIN[sv], pant = BUS_PANT[pv];
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const [h, s, l] = busRgb2Hsl(d[i], d[i + 1], d[i + 2]);
    let nh = null, ns = s, nl = l;
    const blue = h > 195 && h < 240, red = h > 345 || h < 10;
    if ((blue || red) && ((l > 0.42 && s > 0.3) || (s > 0.55 && l > 0.25))) { // 帽子和衣服
      nh = hue; ns = Math.min(1, s * tone[0]); nl = Math.min(0.92, l * tone[1]);
    } else if (blue && l < 0.42 && s > 0.12) { // 褲子
      if (pant) { if (pant[0] != null) { nh = pant[0]; ns = pv === 2 ? 0.38 : 0.45; nl = Math.min(0.55, l * pant[2]); } else { ns = s * pant[1]; nl = l * pant[2]; } }
    } else if (h > 5 && h < 45 && l < 0.45 && s > 0.18) { // 頭髮
      if (hair) { if (hair[0] != null) nh = hair[0]; ns = Math.min(0.95, s * hair[1]); nl = Math.min(0.72, l * hair[2]); }
    } else if (h > 5 && h < 45 && l >= 0.5 && s > 0.22) { // 皮膚
      if (skin) { if (skin[0] != null) nh = skin[0]; ns = Math.min(0.95, s * skin[1]); nl = Math.min(0.94, l * skin[2]); }
    }
    if (nh == null && ns === s && nl === l) continue;
    const [r, g, bb] = busHsl2Rgb(nh == null ? h : nh, ns, nl);
    d[i] = r; d[i + 1] = g; d[i + 2] = bb;
  }
  ox.putImageData(img, 0, 0);
  let cur = oc; // 縮小成遊戲裡的大小(一次縮一半比較平滑)
  while (cur.height > 52) {
    const n = document.createElement('canvas');
    n.width = Math.max(1, Math.round(cur.width / 2)); n.height = Math.max(1, Math.round(cur.height / 2));
    const nx = n.getContext('2d');
    nx.imageSmoothingQuality = 'high';
    nx.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
  }
  BUS_PEOPLE.cache.set(key, cur);
  return cur;
}
// 每個乘客有固定的長相(依編號決定),隊伍移動時不會變來變去:髮色、膚色、褲子、身高(朝向一律是正面)
const BUS_LOOK = new Map();
function busLook(id) {
  let o = BUS_LOOK.get(id);
  if (o) return o;
  const r = busRng(id * 97 + 13), pick = a => a[Math.floor(r() * a.length)];
  const pose = pick([0, 1]); // 大家都面向前方(看著畫面),兩個正面姿勢輪流出現
  o = { pose, flip: false, hv: pick([0, 0, 1, 1, 2, 3, 4]), sv: pick([0, 0, 1, 2, 3]), pv: pick([0, 0, 1, 2, 3]), sz: 0.93 + r() * 0.14 };
  BUS_LOOK.set(id, o);
  return o;
}
/* 3D 模型:three.js 和每個 glb 都只載入一次 */
const GLB = new Map();
function glbLoad(url) {
  if (!GLB.has(url)) {
    const p = (async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(url);
      return { THREE, gltf };
    })();
    p.catch(() => GLB.delete(url));
    GLB.set(url, p);
  }
  return GLB.get(url);
}
function glbMergeByMat(THREE, root) { // 把模型裡同一種材質的零件合成一個網格(一台公車從三十幾次繪製變九次,手機才跑得動)
  const inv = root.matrixWorld.clone().invert(), groups = {};
  root.traverse(m => {
    if (!m.isMesh) return;
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    (groups[m.material.name] = groups[m.material.name] || { mat: m.material, gs: [] }).gs.push(g);
  });
  return Object.entries(groups).map(([name, { mat, gs }]) => {
    const total = gs.reduce((t, g) => t + g.attributes.position.array.length, 0), pos = new Float32Array(total), nor = new Float32Array(total); // 大模型用 push(...陣列) 會爆堆疊,改成直接填進去
    let o = 0;
    gs.forEach(g => { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.array.length; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return { name, mat, geo };
  });
}
/* ---------- 公車大塞車的 3D 畫面:Blender 做的公車、路燈、樹(assets/bus.glb),用 three.js 即時畫 ----------
   遊戲的世界座標(x 往右、y 往下)對到 three.js 的 X、Z,Y 朝上;整個場地的中心放在原點 */
function busCreate3D(L, stage, B) {
  const { THREE, gltf } = L, { TW, TH } = B;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const cvs = renderer.domElement;
  cvs.className = 'bg3d';
  stage.prepend(cvs);
  const P = (x, y, h) => new THREE.Vector3(x - TW / 2, h || 0, y - TH / 2);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8c2d4', 1.25));
  const sun = new THREE.DirectionalLight('#fff6e6', 2.1);
  sun.position.set(-6, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 40 });
  scene.add(sun, sun.target);

  // 地面:條紋草皮、繞著遊戲台的馬路(白色虛線)、人行道、草地上的小花;中間是有厚度的遊戲台
  const M = 0.35, PX = 56; // 遊戲台四周多出來的邊、每單位幾個像素
  const GE = 18, GPX = 22, RW = 1.7, RM = M + 0.3; // 草地往外延伸多少、每單位幾個像素、馬路寬、馬路離遊戲台多遠
  const road = { x: -RM - RW / 2, y: -RM - RW / 2, w: TW + (RM + RW / 2) * 2, h: TH + (RM + RW / 2) * 2 }; // 馬路的中心線
  {
    const gcv = document.createElement('canvas');
    gcv.width = Math.round((TW + GE * 2) * GPX); gcv.height = Math.round((TH + GE * 2) * GPX);
    const g = gcv.getContext('2d'), rr2 = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
    g.scale(GPX, GPX); g.translate(GE, GE);
    for (let i = 0, x = -GE; x < TW + GE; i++, x += 1.4) { g.fillStyle = i % 2 ? '#a6d78b' : '#b2de98'; g.fillRect(x, -GE, 1.4, TH + GE * 2); }
    const fr = busRng(99);
    for (let i = 0; i < 900; i++) { // 小花
      const x = -GE + fr() * (TW + GE * 2), y = -GE + fr() * (TH + GE * 2);
      if (x > road.x - RW && x < road.x + road.w + RW && y > road.y - RW && y < road.y + road.h + RW) continue;
      g.fillStyle = ['#ff8fb1', '#ffe066', '#ffffff', '#c49bff', '#ffb36b'][i % 5];
      g.beginPath(); g.arc(x, y, 0.05 + fr() * 0.05, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#eef1f5'; rr2(road.x - RW / 2 - 0.22, road.y - RW / 2 - 0.22, road.w + RW + 0.44, road.h + RW + 0.44, 1.5); g.fill(); // 人行道
    g.fillStyle = '#d5dbe4'; rr2(road.x - RW / 2 - 0.22, road.y - RW / 2 - 0.08, road.w + RW + 0.44, road.h + RW + 0.3, 1.5); g.fill();
    g.fillStyle = '#5f6a7d'; rr2(road.x - RW / 2, road.y - RW / 2, road.w + RW, road.h + RW, 1.3); g.fill(); // 馬路
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 0.08; g.setLineDash([0.55, 0.45]);
    rr2(road.x, road.y, road.w, road.h, 0.6); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#e8ecf2'; g.fillRect(-RM, -RM, TW + RM * 2, TH + RM * 2); // 遊戲台旁邊的空地
    const tex = new THREE.CanvasTexture(gcv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(TW + GE * 2, TH + GE * 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.3;
    ground.receiveShadow = true;
    scene.add(ground);
    scene.background = new THREE.Color('#a6d78b');
  }
  const boardCv = document.createElement('canvas');
  boardCv.width = Math.round((TW + M * 2) * PX); boardCv.height = Math.round((TH + M * 2) * PX);
  const boardTex = new THREE.CanvasTexture(boardCv);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = 4;
  const side = new THREE.MeshStandardMaterial({ color: '#f3f5f8', roughness: 0.8 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(TW + M * 2, 0.3, TH + M * 2), [side, side, new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.95 }), side, side, side]);
  board.position.y = -0.15;
  board.receiveShadow = true;
  scene.add(board);
  let boardKey = '';
  function paintBoard() {
    const key = B.boardKey();
    if (key === boardKey) return;
    boardKey = key;
    const c = boardCv.getContext('2d');
    c.setTransform(PX, 0, 0, PX, M * PX, M * PX);
    B.paintGround(c, -M, -M, TW + M * 2, TH + M * 2);
    boardTex.needsUpdate = true;
  }

  // Blender 的模型
  gltf.scene.updateMatrixWorld(true);
  const mergeByMat = root => glbMergeByMat(THREE, root);
  const merged = new Map();
  const tpl = n => {
    if (!merged.has(n)) { const grp = new THREE.Group(); mergeByMat(gltf.scene.getObjectByName(n)).forEach(({ mat, geo }) => grp.add(new THREE.Mesh(geo, mat))); merged.set(n, grp); }
    return merged.get(n);
  };
  const place = (name, x, y, rot, s, h) => {
    const o = tpl(name).clone(true);
    o.position.copy(P(x, y, h));
    o.rotation.y = rot || 0;
    if (s) o.scale.setScalar(s);
    o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(o);
    return o;
  };
  B.lamps.forEach(([x, y]) => place('Lamp', x, y + 0.05, 0, 1));
  // 遊戲台四周的樹和樹叢(固定的亂數,每次都一樣)
  const rnd = busRng(4242);
  const out = RM + RW + 0.6; // 樹種在馬路外面
  for (let i = 0; i < 64; i++) {
    const band = i % 4; // 上、下、左、右
    let x, y;
    if (band < 2) { x = -out - 2 + rnd() * (TW + out * 2 + 4); y = band ? TH + out + rnd() * 6 : -out - rnd() * 6; }
    else { x = band === 2 ? -out - rnd() * 3 : TW + out + rnd() * 3; y = rnd() * TH; }
    place(rnd() < 0.6 ? 'Tree' : 'Bush', x, y, rnd() * 6, 0.9 + rnd() * 0.5, -0.3);
  }
  // 馬路上跑來跑去的小公車
  const roadLen = (road.w + road.h) * 2;
  const roadAt = d => { // 沿著馬路中心線(順時針)走 d 的位置和方向
    d = ((d % roadLen) + roadLen) % roadLen;
    const { x, y, w, h } = road;
    if (d < w) return [x + d, y - 0.4, 0];
    if ((d -= w) < h) return [x + w + 0.4, y + d, Math.PI / 2];
    if ((d -= h) < w) return [x + w - d, y + h + 0.4, Math.PI];
    d -= w; return [x - 0.4, y + h - d, -Math.PI / 2];
  };
  const cars = [0, 1, 2, 3].map(k => {
    const o = tpl('Bus4').clone(true);
    o.scale.setScalar(0.7);
    const m = new THREE.MeshStandardMaterial({ color: ['#ffb300', '#26a69a', '#ef5350', '#5c6bc0'][k], roughness: 0.35 });
    o.traverse(x => { if (x.isMesh) { x.castShadow = true; if (x.material.name === 'BusPaint' || x.material.name === 'BusRoof') x.material = m; } });
    scene.add(o);
    return { o, d: k * roadLen / 4, v: 1.6 + k * 0.25 };
  });
  [[0.1, B.LY - 0.15], [TW - 0.1, B.LY - 0.15]].forEach(([x, y]) => place('Cone', x, y, 0, 1.1));

  // 公車:每種顏色共用材質;「?」車是灰色
  const mats = new Map();
  function busMats(key) {
    if (!mats.has(key)) {
      const col = key === 'hid' ? '#a3a9b5' : BUS_COLORS[key];
      mats.set(key, {
        BusPaint: new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.05 }),
        BusRoof: new THREE.MeshStandardMaterial({ color: B.shade(col, 0.22), roughness: 0.4 }),
        head: new THREE.MeshStandardMaterial({ color: B.shade(col, 0.45), roughness: 0.5 }),
      });
    }
    return mats.get(key);
  }
  const arrowShape = new THREE.Shape();
  [[0.27, 0], [-0.02, -0.21], [-0.02, -0.08], [-0.26, -0.08], [-0.26, 0.08], [-0.02, 0.08], [-0.02, 0.21]].forEach(([x, y], i) => (i ? arrowShape.lineTo(x - 0.05, y) : arrowShape.moveTo(x - 0.05, y)));
  const arrowGeo = new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2);
  const arrowMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -2 });
  const qCv = document.createElement('canvas');
  qCv.width = qCv.height = 64;
  { const q = qCv.getContext('2d'); q.font = '900 54px Fredoka, sans-serif'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.lineWidth = 8; q.strokeStyle = '#5a6170'; q.strokeText('?', 32, 35); q.fillStyle = '#fff'; q.fillText('?', 32, 35); }
  const qMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(qCv), depthTest: false });
  const seatGeo = new THREE.SphereGeometry(0.095, 14, 10), emptyGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.02, 14);
  const emptyMat = new THREE.MeshStandardMaterial({ color: '#3a4150', roughness: 0.8 });
  let objs = new Map(), objsFor = null;
  function makeBus(b) {
    const o = tpl(b.cap === 6 ? 'Bus6' : 'Bus4').clone(true);
    o.position.set(0, 0, 0);
    o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; if (m.material.name === 'BusPaint' || m.material.name === 'BusRoof') m.userData.paint = m.material.name; } });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.y = 0.652;
    arrow.scale.setScalar(b.len > 1.8 ? 1.1 : 0.95);
    o.add(arrow);
    const q = new THREE.Sprite(qMat);
    q.scale.set(0.5, 0.5, 1);
    q.position.y = 0.95;
    o.add(q);
    const n = b.cap, cols = n / 2, gx = (b.len - 0.55) / cols, seats = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(seatGeo, emptyMat);
      s.position.set(-b.len / 2 + 0.25 + (i % cols) * gx + gx / 2, 0.69, i < cols ? -0.15 : 0.15);
      s.castShadow = true;
      o.add(s);
      seats.push(s);
    }
    o.userData = { arrow, q, seats, key: null };
    scene.add(o);
    return o;
  }
  function syncBus(b, o) {
    const key = b.hid ? 'hid' : b.c, u = o.userData;
    if (u.key !== key) { u.key = key; const m = busMats(key); o.traverse(x => { if (x.userData.paint) x.material = m[x.userData.paint]; }); }
    const sh = b.shake ? Math.sin(performance.now() / 18) * 0.06 * (b.shake / 0.35) : 0;
    const pop = (b.pop ? 1 + b.pop * 0.25 : 1) * (b.reveal ? 1 + b.reveal * 0.25 : 1);
    o.visible = b.st !== 'gone';
    o.position.copy(P(b.px + sh, b.py));
    o.rotation.y = -b.ang;
    o.scale.setScalar(b.scale * pop);
    const parked = b.st === 'lot' || b.st === 'go';
    u.arrow.visible = parked && !b.hid;
    u.q.visible = parked && b.hid;
    u.seats.forEach((s, i) => {
      s.visible = !parked;
      const full = i < b.boarded;
      s.geometry = full ? seatGeo : emptyGeo;
      s.material = full ? busMats(b.c).head : emptyMat;
    });
  }

  // 乘客:Blender 做的 Q 版小人(臉朝鏡頭),用 InstancedMesh 一次畫全部;衣服和帽子是乘客要坐的公車顏色
  const MAXP = 420, cols = a => a.map(c => new THREE.Color(c));
  const SHIRT = cols(BUS_COLORS), SKIN = cols(['#f5d0b0', '#d9a77a', '#8d5a3b', '#fbe3d0']), HAIR = cols(['#5a3a22', '#1d1d1f', '#e0b84a', '#8a3b1e', '#d9d9d9']), PANT = cols(['#3b5b8c', '#3a3f4a', '#b59a6a', '#7a2f2f']);
  const crowd = (() => {
    return mergeByMat(gltf.scene.getObjectByName('Person')).map(({ name, geo }) => {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: name === 'PEye' ? '#1d2129' : '#ffffff', roughness: name === 'PSkin' ? 0.7 : 0.5 }), MAXP);
      im.castShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      scene.add(im);
      return { im, key: { PShirt: 'c', PCap: 'c', PSkin: 's', PHair: 'h', PPants: 'p' }[name] };
    });
  })();
  const mtx = new THREE.Matrix4(), qt = new THREE.Quaternion(), sv = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function person(i, x, y, h, c, id, s, rot) {
    if (i >= MAXP) return;
    const lk = busLook(id), k = 1.12 * s * lk.sz;
    qt.setFromAxisAngle(UP, rot || 0);
    mtx.compose(P(x, y, h), qt, sv.set(k, k, k));
    crowd.forEach(({ im, key }) => {
      im.setMatrixAt(i, mtx);
      if (key) im.setColorAt(i, key === 'c' ? SHIRT[c] : key === 's' ? SKIN[lk.sv % 4] : key === 'h' ? HAIR[lk.hv % 5] : PANT[lk.pv % 4]);
    });
  }

  // 鏡頭:斜斜往下看,整個遊戲台剛好塞進畫面
  const camera = new THREE.PerspectiveCamera(20, 1, 0.5, 300);
  const TILT = 0.85; // 跟垂直方向的夾角(弧度)
  let w = 0, h = 0;
  const fitCam = () => {
    const corners = [];
    for (const x of [-TW / 2 - 0.15, TW / 2 + 0.15]) for (const z of [-TH / 2 - 0.15, TH / 2 + 0.15]) for (const y of [0, 0.7]) corners.push(new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    let tz = 0, d = 30;
    for (let pass = 0; pass < 6; pass++) {
      let lo = 5, hi = 250;
      for (let k = 0; k < 30; k++) {
        d = (lo + hi) / 2;
        camera.position.set(0, Math.cos(TILT) * d, tz + Math.sin(TILT) * d);
        camera.lookAt(0, 0, tz);
        camera.updateMatrixWorld();
        const ok = corners.every(c => { v.copy(c).project(camera); return Math.abs(v.x) <= 0.985 && Math.abs(v.y) <= 0.985; });
        if (ok) hi = d; else lo = d;
      }
      d = hi;
      camera.position.set(0, Math.cos(TILT) * d, tz + Math.sin(TILT) * d);
      camera.lookAt(0, 0, tz);
      camera.updateMatrixWorld();
      let y0 = 9, y1 = -9;
      corners.forEach(c => { v.copy(c).project(camera); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
      tz -= (y0 + y1) / 2 * TH * 0.5; // 上下留白平均一點
    }
  };
  const fit = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || (r.width === w && r.height === h)) return;
    w = r.width; h = r.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCam();
  };
  const ray = new THREE.Raycaster(), hit = new THREE.Vector3();

  return {
    render(now) {
      fit();
      const G = B.G();
      if (!G) return;
      paintBoard();
      if (objsFor !== G) { objs.forEach(o => scene.remove(o)); objs = new Map(); objsFor = G; G.buses.forEach(b => objs.set(b, makeBus(b))); }
      G.buses.forEach(b => syncBus(b, objs.get(b)));
      // 排隊的人、上車中的人
      let n = 0;
      const vis = Math.min(G.queue.length, B.laneCap);
      for (let i = 0; i < vis; i++) {
        const [x, y] = B.queuePos(i), bob = Math.abs(Math.sin(now / 260 + i * 0.7)) * 0.04;
        person(n++, x, y, bob, G.queue[i], G.qid[i], 1);
      }
      G.walkers.forEach(wk => {
        const u = wk.t, tx = wk.bus.px, ty = wk.bus.py;
        person(n++, wk.fx + (tx - wk.fx) * u, wk.fy + (ty - wk.fy) * u, Math.sin(u * Math.PI) * 0.6 + u * 0.4, wk.c, wk.id, 1 - u * 0.35, Math.atan2(tx - wk.fx, ty - wk.fy));
      });
      crowd.forEach(({ im }) => { im.count = Math.min(n, MAXP); im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
      // 馬路上的小公車
      const dt = Math.min(0.05, (now - (this.t || now)) / 1000);
      this.t = now;
      cars.forEach(car => { car.d += car.v * dt; const [x, y, a] = roadAt(car.d); car.o.position.copy(P(x, y, -0.3)); car.o.rotation.y = -a; });
      renderer.render(scene, camera);
    },
    probes(cx, cy) { // 點的位置往下穿過車頂、車身中間、地面三個高度,換成遊戲座標
      const r = cvs.getBoundingClientRect();
      camera.updateMatrixWorld();
      ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      return [0.65, 0.33, 0].map(y => (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit) ? [hit.x + TW / 2, hit.z + TH / 2] : [-99, -99]));
    },
    dispose() { renderer.dispose(); renderer.forceContextLoss(); cvs.remove(); },
  };
}
function busGame() {
  resetView();
  app.innerHTML = '';
  let level = Math.max(1, store.get('busLevel', 1) | 0);
  const realMax = () => Math.max(1, store.get('busMax', 1) | 0);
  const unlocked = () => !!store.get('busKey', false); // 輸入密碼 0522 後可以跳到任何一關
  const maxLv = () => (unlocked() ? 999 : realMax());
  const scr = el('div', 'screen busg');
  scr.innerHTML = `
    <div class="bgtop">
      <button class="iconbtn bgback" aria-label="回首頁">✕</button>
      <div class="bglv">第 <b>1</b> 關<i class="bgtier"></i></div>
      <button class="iconbtn bgretry" aria-label="重來">↻</button>
    </div>
    <div class="bgstage"><canvas class="bgcv"></canvas><div class="bgov"></div></div>
    <div class="bgbar"><span class="bgleft" title="還在排隊的乘客">🧍 <b>0</b></span>
      <div class="bgtools"><button class="bgturn" aria-label="轉向"><span>🔄</span><b>2</b><small>轉向</small></button><button class="bgplus" aria-label="加一個候車格"><span>🅿️</span><b>1</b><small>加格</small></button></div></div>`;
  app.appendChild(scr);
  const stage = $('.bgstage', scr), cv = $('.bgcv', scr), ov = $('.bgov', scr);
  let ctx = cv.getContext('2d');
  const leftEl = $('.bgleft b', scr), plusBtn = $('.bgplus', scr), turnBtn = $('.bgturn', scr), lvEl = $('.bglv b', scr), tierEl = $('.bgtier', scr);
  let G = null, sc = 1, ox = 0, oy = 0, raf = 0, last = 0;

  // ---------- 版面(世界座標):上面排隊的人龍、中間候車格、下面停車場 ----------
  const TW = BUS_LW + 1.4, QH = 4.5, SH = 2.4, LX = 0.7, LY = QH + SH + 0.55, TH = LY + BUS_LH + 0.5, SLOTS_MAX = 7;
  function layout() {
    const r = stage.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    sc = Math.min(cv.width / TW, cv.height / TH);
    ox = (cv.width - TW * sc) / 2; oy = (cv.height - TH * sc) / 2;
  }
  const slotX = k => 0.55 + (k + 0.5) * (TW - 1.1) / SLOTS_MAX;
  const slotY = () => QH + SH / 2 + 0.05;
  const ringL = 0.33, ringR = TW - 0.33, ringT = LY - 0.3, ringB = LY + BUS_LH + 0.3;
  const wx = b => LX + b.x, wy = b => LY + b.y; // 停車場座標 → 世界座標

  // 排隊的人龍:倒過來的 U 字形走道,排頭在左下角(靠近候車格)
  const lane = (() => {
    const pts = [], x0 = 1.05, x1 = TW - 1.05, yB = QH - 0.35, yA = 1.55, rx = (x1 - x0) / 2, ry = 1.15, cx = (x0 + x1) / 2;
    for (let y = yB; y > yA; y -= 0.1) pts.push([x0, y]);
    for (let t = Math.PI; t <= Math.PI * 2 + 0.001; t += 0.03) pts.push([cx + Math.cos(t) * rx, yA + Math.sin(t) * ry]);
    for (let y = yA; y <= yB; y += 0.1) pts.push([x1, y]);
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, acc, len: acc[acc.length - 1] };
  })();
  function laneAt(s) { // 走道上距離起點 s 的位置與方向
    const { pts, acc } = lane;
    let i = 1;
    while (i < acc.length - 1 && acc[i] < s) i++;
    const u = (s - acc[i - 1]) / Math.max(1e-6, acc[i] - acc[i - 1]), [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    return [ax + (bx - ax) * u, ay + (by - ay) * u, Math.atan2(by - ay, bx - ax)];
  }
  const PER_ROW = 3, ROW_GAP = 0.3;
  function queuePos(i) { // 第 i 個排隊的人站在哪裡(走道上三個人並排)
    const row = Math.floor(i / PER_ROW), k = i % PER_ROW, [x, y, a] = laneAt(Math.min(lane.len, 0.15 + row * ROW_GAP));
    const side = (k - 1) * 0.29 + (((i * 37) % 7) - 3) * 0.012;
    return [x - Math.sin(a) * side, y + Math.cos(a) * side];
  }
  const laneCap = Math.floor(lane.len / ROW_GAP) * PER_ROW;

  // ---------- 開始一關 ----------
  function start(L) {
    level = L;
    store.set('busLevel', L);
    const lv = busLevel(L);
    G = { ...lv, level: L, queue: lv.queue.slice(), qid: lv.queue.map((_, i) => L * 1000 + i), state: 'play', walkers: [], slotOf: new Array(SLOTS_MAX).fill(null), plusUsed: false, boardCd: 0.6, endT: 0, turns: 2, turning: false, revealT: 0 };
    G.buses = lv.buses.map(b => ({ ...b, st: 'lot', boarded: 0, incoming: 0, anim: null, shake: 0, px: LX + b.x, py: LY + b.y, ang: b.a, scale: 1 }));
    layout();
    revealFree(false); // 一開始就沒被擋住的神秘車,直接顯示顏色
    lvEl.textContent = L;
    tierEl.textContent = lv.tier;
    tierEl.dataset.t = lv.tier;
    updTools();
    ov.className = 'bgov';
    updBar();
  }
  const updBar = () => { leftEl.textContent = G.queue.length + G.walkers.length; };
  const lotBuses = () => G.buses.filter(o => o.st === 'lot');

  // ---------- 動畫:沿著路徑點開車 ----------
  function drive(b, pts, speed, onEnd, endScale) {
    b.anim = { pts, i: 0, speed, onEnd, endScale: endScale == null ? b.scale : endScale, startScale: b.scale, total: 0, done: 0 };
    let px = b.px, py = b.py;
    pts.forEach(([x, y]) => { b.anim.total += Math.hypot(x - px, y - py); px = x; py = y; });
  }
  const lerpAng = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
  function stepAnim(b, dt) {
    const a = b.anim;
    let move = a.speed * dt;
    while (move > 0 && a.i < a.pts.length) {
      const [tx, ty] = a.pts[a.i], dx = tx - b.px, dy = ty - b.py, d = Math.hypot(dx, dy);
      if (d > 0.001 && !a.keepAng) b.ang = lerpAng(b.ang, Math.atan2(dy, dx), Math.min(1, dt * 12));
      if (d <= move) { b.px = tx; b.py = ty; move -= d; a.done += d; a.i++; }
      else { b.px += dx / d * move; b.py += dy / d * move; a.done += move; move = 0; }
    }
    b.scale = a.startScale + (a.endScale - a.startScale) * Math.min(1, a.done / Math.max(0.001, a.total));
    if (a.i >= a.pts.length) { b.anim = null; if (a.onEnd) a.onEnd(); }
  }

  // ---------- 點公車:往箭頭方向直直開;撞到車就彈回來 ----------
  function tap(b) {
    if (G.state !== 'play' || b.st !== 'lot' || b.anim || b.spin) return;
    const hit = busFirstHit(b, b.a, lotBuses());
    const ca = Math.cos(b.a), sa = Math.sin(b.a), x0 = b.px, y0 = b.py;
    if (hit) {
      const d = hit.d + 0.06;
      drive(b, [[x0 + ca * d, y0 + sa * d], [x0, y0]], 12, null);
      b.anim.keepAng = true;
      setTimeout(() => { hit.o.shake = 0.35; beep(140, 0.12, 'square', 0.1); buzz(30); }, d / 12 * 1000);
      return;
    }
    const k = G.slotOf.findIndex((s, i) => i < G.slots && s == null);
    if (k < 0) { b.shake = 0.35; toast('候車格滿了!等公車載滿開走'); beep(180, 0.15, 'square', 0.08); return; }
    G.slotOf[k] = b;
    b.st = 'go';
    b.slot = k;
    if (b.hid) { b.hid = false; b.reveal = 0.6; }
    SFX.tap();
    beep(330, 0.12, 'sawtooth', 0.05);
    // 先直直開出停車場,再沿著停車場外圍繞到上面,開進候車格
    let s = 0;
    while (!busOutside(b.x + ca * s, b.y + sa * s, b.len / 2 + 0.15) && s < 40) s += 0.1;
    const ex = x0 + ca * s, ey = y0 + sa * s, pts = [[ex, ey]];
    const sx = slotX(k), top = [sx, ringT];
    const outT = b.y + sa * s < 0, outB = b.y + sa * s > BUS_LH, outL = b.x + ca * s < 0;
    if (outT) pts.push([Math.max(ringL, Math.min(ringR, ex)), ringT]);
    else if (outB) { const side = ex < TW / 2 ? ringL : ringR; pts.push([ex, ringB], [side, ringB], [side, ringT]); }
    else { const side = outL ? ringL : ringR; pts.push([side, ey], [side, ringT]); }
    pts.push(top, [sx, slotY()]);
    drive(b, pts, 14, () => { b.st = 'slot'; b.ang = -Math.PI / 2; beep(520, 0.08, 'triangle', 0.08); }, 0.86);
  }

  // ---------- 道具:轉向、加一格 ----------
  function updTools() {
    $('b', turnBtn).textContent = G.turns;
    turnBtn.disabled = !G.turns;
    turnBtn.classList.toggle('on', G.turning);
    stage.classList.toggle('turning', G.turning);
    $('b', plusBtn).textContent = G.plusUsed ? 0 : 1;
    plusBtn.disabled = G.plusUsed;
  }
  function turnBus(b) { // 公車調頭:車頭變車尾,往反方向開
    if (G.state !== 'play' || b.st !== 'lot' || b.anim || !G.turns) return;
    G.turns--;
    G.turning = false;
    const from = b.ang;
    b.a = (b.a + Math.PI) % (Math.PI * 2);
    b.spin = { from, to: from + Math.PI, t: 0 };
    SFX.good(); beep(480, 0.08, 'triangle', 0.1);
    updTools();
  }
  function addSlot() {
    if (G.plusUsed || G.slots >= SLOTS_MAX) return false;
    G.plusUsed = true;
    G.slots++;
    updTools();
    SFX.good();
    return true;
  }

  // ---------- 每一幀 ----------
  function revealFree(flash) { // 前面沒有被擋住的「?」公車,翻開顏色
    const lot = lotBuses();
    lot.forEach(b => {
      if (b.hid && !busFirstHit(b, b.a, lot)) { b.hid = false; if (flash) { b.reveal = 0.6; beep(760, 0.08, 'sine', 0.08); } }
    });
  }
  function update(dt) {
    if (G.state === 'play' && (G.revealT += dt) > 0.2) { G.revealT = 0; revealFree(true); }
    G.buses.forEach(b => {
      if (b.spin) { b.spin.t += dt / 0.35; const u = Math.min(1, b.spin.t), e = 1 - (1 - u) ** 3; b.ang = b.spin.from + (b.spin.to - b.spin.from) * e; if (u >= 1) { b.ang = b.a; b.spin = null; } }
      if (b.anim) stepAnim(b, dt);
      else if (b.st === 'slot') b.px += (slotX(b.slot) - b.px) * Math.min(1, dt * 8);
      if (b.shake > 0) b.shake = Math.max(0, b.shake - dt);
      if (b.reveal > 0) b.reveal = Math.max(0, b.reveal - dt);
    });
    // 乘客上車
    G.walkers = G.walkers.filter(w => {
      w.t += dt / 0.32;
      if (w.t < 1) return true;
      w.bus.incoming--; w.bus.boarded++; w.bus.pop = 0.18;
      beep(700 + w.bus.boarded * 40, 0.04, 'sine', 0.05);
      return false;
    });
    G.buses.forEach(b => { if (b.pop > 0) b.pop = Math.max(0, b.pop - dt); });
    updBar();
    if (G.state === 'play' && G.queue.length) {
      G.boardCd -= dt;
      if (G.boardCd <= 0) {
        const c = G.queue[0];
        const bus = G.slotOf.find((b, i) => i < G.slots && b && b.st === 'slot' && b.c === c && b.boarded + b.incoming < b.cap);
        if (bus) {
          const pid = G.qid.shift();
          const [qx, qy] = queuePos(0);
          G.queue.shift();
          bus.incoming++;
          G.walkers.push({ c, bus, t: 0, fx: qx, fy: qy, id: pid });
          G.boardCd = 0.11;
        }
      }
    }
    // 坐滿就開走(往上開走、慢慢變小消失)
    G.buses.forEach(b => {
      if (b.st === 'slot' && b.boarded >= b.cap && !b.incoming) {
        b.st = 'leave';
        G.slotOf[b.slot] = null;
        beep(260, 0.25, 'sawtooth', 0.05); beep(390, 0.2, 'triangle', 0.08, 0.1);
        drive(b, [[b.px, b.py - 0.3], [b.px + (b.slot < SLOTS_MAX / 2 ? -1 : 1) * 2.2, QH - 1.2]], 9, () => { b.st = 'gone'; }, 0.2);
      }
    });
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
      store.set('busMax', Math.max(realMax(), level + 1));
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

  // ---------- 畫面 ----------
  const rr = (x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
  function shade(hex, f) { const v = parseInt(hex.slice(1), 16), ch = k => { const x = (v >> k) & 255; return Math.round(f > 0 ? x + (255 - x) * f : x * (1 + f)); }; return `rgb(${ch(16)},${ch(8)},${ch(0)})`; }
  const blob = (x, y, rx, ry, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
  function drawPerson(x, y, c, s, now, k, id) {
    const bob = Math.abs(Math.sin(now / 260 + k * 0.7)) * 0.02;
    blob(x, y + 0.02 * s, 0.12 * s, 0.045 * s, 'rgba(40,50,70,.22)');
    if (BUS_PEOPLE.ready && BUS_PEOPLE.base.length) {
      const lk = busLook(id == null ? k : id), sp = busPerson(c, lk.pose, lk.hv, lk.sv, lk.pv);
      const h = 0.6 * s * lk.sz, w = sp.width / sp.height * h;
      ctx.drawImage(sp, x - w / 2, y + 0.03 * s - h - bob, w, h);
      return;
    }
    const col = BUS_COLORS[c];
    ctx.fillStyle = col; rr(x - 0.09 * s, y - 0.32 * s - bob, 0.18 * s, 0.3 * s, 0.08 * s); ctx.fill();
    blob(x, y - 0.38 * s - bob, 0.08 * s, 0.08 * s, '#ffd9b3');
  }
  function foot(b, lift, grow) { // 公車底面(在 lift 高度):目前的位置、角度、縮放
    const L = b.len + grow * 2, Wd = BUS_WID + grow * 2, sh = b.shake ? Math.sin(performance.now() / 18) * 0.06 * (b.shake / 0.35) : 0;
    ctx.save();
    ctx.translate(b.px + sh, b.py - lift * b.scale);
    ctx.rotate(b.ang);
    ctx.scale(b.scale, b.scale);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-L / 2, -Wd / 2, L, Wd, 0.2); else ctx.rect(-L / 2, -Wd / 2, L, Wd);
    return [L, Wd];
  }
  function drawBus(b, now) {
    const col = b.hid ? '#a3a9b5' : BUS_COLORS[b.c], H3 = 0.36, pop = b.pop ? 1 + b.pop * 0.25 : 1;
    if (pop !== 1) { ctx.save(); ctx.translate(b.px, b.py); ctx.scale(pop, pop); ctx.translate(-b.px, -b.py); }
    // 影子(柔和、往右下)
    ctx.save(); ctx.translate(0.08 * b.scale, 0.12 * b.scale); foot(b, 0, 0.06); ctx.fillStyle = 'rgba(40,50,75,.22)'; ctx.fill(); ctx.restore(); ctx.restore();
    // 輪子
    const [L, Wd] = foot(b, 0.01, 0); ctx.fillStyle = '#1c1f26';
    [[-L / 2 + 0.22, -Wd / 2 - 0.03], [L / 2 - 0.4, -Wd / 2 - 0.03], [-L / 2 + 0.22, Wd / 2 - 0.06], [L / 2 - 0.4, Wd / 2 - 0.06]].forEach(([x, y]) => { rr(x, y, 0.18, 0.09, 0.04); ctx.fill(); });
    ctx.restore();
    // 車身側面:下裙 → 車身 → 車窗玻璃 → 上緣
    const N = 9;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      foot(b, f * H3, 0);
      ctx.fillStyle = f < 0.15 ? shade(col, -0.5) : f < 0.45 ? shade(col, -0.18) : f < 0.85 ? (f < 0.55 ? '#1d2a3c' : '#2c4462') : shade(col, -0.06);
      ctx.fill();
      ctx.restore();
    }
    // 車頂
    foot(b, H3, 0);
    const rg = ctx.createLinearGradient(-L / 2, -Wd / 2, L / 2, Wd / 2);
    rg.addColorStop(0, shade(col, 0.3)); rg.addColorStop(1, shade(col, 0));
    ctx.fillStyle = rg; ctx.fill();
    ctx.strokeStyle = shade(col, -0.25); ctx.lineWidth = 0.035; ctx.stroke();
    if (b.reveal) { ctx.fillStyle = `rgba(255,255,255,${b.reveal})`; ctx.fill(); }
    ctx.fillStyle = '#1d2a3c'; // 前擋風玻璃
    rr(L / 2 - 0.2, -Wd / 2 + 0.07, 0.14, Wd - 0.14, 0.06); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(L / 2 - 0.17, -Wd / 2 + 0.11, 0.03, Wd - 0.22);
    ctx.fillStyle = 'rgba(255,255,255,.4)'; // 車頂邊的亮線
    rr(-L / 2 + 0.14, -Wd / 2 + 0.05, L - 0.4, 0.045, 0.02); ctx.fill();
    if (b.st === 'lot' || b.st === 'go') {
      if (b.hid) {
        ctx.fillStyle = '#fff'; ctx.font = '900 0.46px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.rotate(-b.ang); ctx.fillText('?', 0, 0.02); ctx.restore();
      } else { // 車頂的白色箭頭
        const ax = -0.05, s2 = b.len > 1.8 ? 1.1 : 0.95;
        ctx.save(); ctx.translate(ax, 0); ctx.scale(s2, s2);
        ctx.beginPath(); ctx.moveTo(0.27, 0); ctx.lineTo(-0.02, -0.21); ctx.lineTo(-0.02, -0.08); ctx.lineTo(-0.26, -0.08); ctx.lineTo(-0.26, 0.08); ctx.lineTo(-0.02, 0.08); ctx.lineTo(-0.02, 0.21); ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.save(); ctx.translate(0.02, 0.03); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.restore();
      }
    } else { // 候車中:座位上的人頭
      const n = b.cap, cols = n / 2, gx = (L - 0.55) / cols;
      for (let i = 0; i < n; i++) {
        const sx = -L / 2 + 0.25 + (i % cols) * gx + gx / 2, sy = i < cols ? -0.15 : 0.15;
        if (i < b.boarded) { blob(sx, sy, 0.1, 0.1, shade(col, 0.55)); blob(sx - 0.03, sy - 0.03, 0.04, 0.04, 'rgba(255,255,255,.7)'); }
        else blob(sx, sy, 0.085, 0.085, 'rgba(0,0,0,.2)');
      }
    }
    ctx.restore();
    if (pop !== 1) ctx.restore();
  }
  function drawLamp(x, y) {
    blob(x + 0.05, y + 0.03, 0.12, 0.05, 'rgba(40,50,70,.2)');
    ctx.fillStyle = '#9aa3b2'; rr(x - 0.04, y - 1.05, 0.08, 1.05, 0.03); ctx.fill();
    ctx.fillStyle = '#7d8798'; rr(x - 0.04, y - 1.08, 0.36, 0.07, 0.03); ctx.fill();
    blob(x + 0.3, y - 1.0, 0.09, 0.05, '#fff3c4');
  }
  function drawGround(lamps) { // 地面:人龍的走道(白色寬帶子)、路燈、候車格、停車場
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); lane.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = '#d4d9e2'; ctx.lineWidth = 1.18; ctx.stroke();
    ctx.strokeStyle = '#f8f9fb'; ctx.lineWidth = 1.02; ctx.stroke();
    if (lamps) { drawLamp(0.4, QH + 0.05); drawLamp(TW - 0.75, QH + 0.05); }
    // 候車格:深灰色的長條,裡面一格一格;還沒開的格子顯示「+」
    ctx.fillStyle = '#c5cbd5'; rr(0.25, QH + 0.12, TW - 0.5, SH, 0.3); ctx.fill();
    ctx.fillStyle = '#5a6170'; rr(0.25, QH + 0.05, TW - 0.5, SH, 0.3); ctx.fill();
    for (let k = 0; k < SLOTS_MAX; k++) {
      const x = slotX(k), w = (TW - 1.1) / SLOTS_MAX - 0.14, y = QH + 0.25, h = SH - 0.4;
      if (k < G.slots) {
        ctx.fillStyle = '#464c58'; rr(x - w / 2, y, w, h, 0.16); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 0.03; ctx.stroke();
      } else {
        ctx.fillStyle = '#525866'; rr(x - w / 2, y, w, h, 0.16); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.setLineDash([0.12, 0.09]); ctx.lineWidth = 0.035; ctx.stroke(); ctx.setLineDash([]);
        const canBuy = !G.plusUsed && k === G.slots;
        blob(x, y + h / 2, 0.26, 0.26, canBuy ? '#2eaa4f' : '#6a7180');
        ctx.fillStyle = '#fff'; ctx.font = '900 0.38px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(canBuy ? '+' : '🔒', x, y + h / 2 + 0.02);
      }
    }
    // 停車場的範圍
    ctx.fillStyle = 'rgba(160,170,190,.13)'; rr(LX - 0.25, LY - 0.25, BUS_LW + 0.5, BUS_LH + 0.5, 0.4); ctx.fill();
  }
  function paintGround(c, x, y, w, h) { // 3D 版:把地面畫在遊戲台的貼圖上(不畫路燈,路燈是 3D 模型)
    const keep = ctx;
    ctx = c;
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#dde3ec'); g.addColorStop(1, '#d2d9e3');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    c.fillStyle = '#b9c2cf'; rr(LX - 0.3, LY - 0.3, BUS_LW + 0.6, BUS_LH + 0.6, 0.45); c.fill(); // 停車場的柏油
    c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 0.03; c.setLineDash([0.18, 0.14]);
    for (let gx = LX + 1.2; gx < LX + BUS_LW; gx += 1.2) { c.beginPath(); c.moveTo(gx, LY - 0.1); c.lineTo(gx, LY + BUS_LH + 0.1); c.stroke(); }
    for (let gy = LY + 1.2; gy < LY + BUS_LH; gy += 1.2) { c.beginPath(); c.moveTo(LX - 0.1, gy); c.lineTo(LX + BUS_LW + 0.1, gy); c.stroke(); }
    c.setLineDash([]);
    c.strokeStyle = '#ffd23f'; c.lineWidth = 0.07; rr(LX - 0.3, LY - 0.3, BUS_LW + 0.6, BUS_LH + 0.6, 0.45); c.stroke(); // 黃色的邊線
    drawGround(false);
    ctx = keep;
  }
  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, cv.height);
    bg.addColorStop(0, '#eef1f6'); bg.addColorStop(1, '#e2e6ee');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(sc, 0, 0, sc, ox, oy);
    drawGround(true);
    // 排隊的人(後面的先畫,前面的蓋在上面);太多的話顯示「+N」
    const vis = Math.min(G.queue.length, laneCap);
    const ppl = [];
    for (let i = 0; i < vis; i++) ppl.push([i, ...queuePos(i)]);
    ppl.sort((p, q) => p[2] - q[2]).forEach(([i, x, y]) => drawPerson(x, y, G.queue[i], 1, now, i, G.qid[i]));
    if (G.queue.length > vis) { ctx.fillStyle = '#5a6170'; ctx.font = '900 0.36px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`+${G.queue.length - vis}`, TW - 1.05, QH - 0.05); }
    // 公車:由遠到近畫
    G.buses.filter(b => b.st !== 'gone').sort((p, q) => p.py - q.py).forEach(b => {
      if (b.st === 'leave') { ctx.globalAlpha = Math.max(0, Math.min(1, b.scale * 2 - 0.3)); drawBus(b, now); ctx.globalAlpha = 1; }
      else drawBus(b, now);
    });
    G.walkers.forEach((w, k) => {
      const tx = w.bus.px, ty = w.bus.py - 0.3, u = w.t;
      drawPerson(w.fx + (tx - w.fx) * u, w.fy + (ty - w.fy) * u - Math.sin(u * Math.PI) * 0.35, w.c, 1 - u * 0.35, now, k, w.id);
    });
  }
  let g3 = null; // 3D 畫面(舊手機、沒網路載入失敗就用 2D)
  glbLoad('assets/bus.glb').then(L => {
    if (!cv.isConnected) return;
    g3 = busCreate3D(L, stage, { TW, TH, LY, lamps: [[0.4, QH + 0.05], [TW - 0.75, QH + 0.05]], G: () => G, queuePos, laneCap, shade, paintGround, boardKey: () => (G ? G.slots + ',' + G.plusUsed : '') });
    stage.classList.add('g3');
  }).catch(e => console.warn('公車 3D 畫面載入失敗,改用 2D', e));
  function frame(now) {
    if (!cv.isConnected) { if (g3) g3.dispose(); return; }
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (G) { update(dt); if (g3) g3.render(now); else draw(now); }
    raf = requestAnimationFrame(frame);
  }

  // ---------- 操作 ----------
  cv.addEventListener('pointerdown', e => {
    if (!G) return;
    e.preventDefault();
    let probes; // [x, y, 往上偏移]:2D 時車頂畫在上面一點;3D 時是車頂、車身、地面三個高度穿過的位置
    if (g3) probes = g3.probes(e.clientX, e.clientY).map(([px, py]) => [px, py, 0]);
    else {
      const r = cv.getBoundingClientRect(), dpr = cv.width / r.width;
      const px = ((e.clientX - r.left) * dpr - ox) / sc, py = ((e.clientY - r.top) * dpr - oy) / sc;
      probes = [[px, py, 0.36], [px, py, 0.18], [px, py, 0]];
    }
    const [x, y] = probes[2];
    // 點到還沒開的「+」候車格
    if (G.state === 'play' && !G.plusUsed && G.slots < SLOTS_MAX) {
      const sxp = slotX(G.slots);
      if (Math.abs(x - sxp) < 0.6 && y > QH && y < QH + SH) { addSlot(); return; }
    }
    // 公車有高度:車頂畫在上面一點。重疊時以畫在最前面(y 最大)的那台為準
    const inBus = (b, [x, y, lift]) => { const dx = x - b.px, dy = y + lift - b.py, c = Math.cos(-b.ang), s = Math.sin(-b.ang), lx = dx * c - dy * s, ly = dx * s + dy * c; return Math.abs(lx) <= b.len / 2 + 0.06 && Math.abs(ly) <= BUS_WID / 2 + 0.06; };
    const cand = lotBuses().filter(b => probes.some(p => inBus(b, p))).sort((p, q) => q.py - p.py);
    const b = cand[0];
    if (G.turning) {
      if (b) turnBus(b); else { G.turning = false; updTools(); }
      return;
    }
    if (b) tap(b);
  });
  turnBtn.addEventListener('click', () => { if (G && G.state === 'play' && G.turns) { G.turning = !G.turning; updTools(); if (G.turning) toast('點一台公車讓它調頭'); } });
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
    else if (e.target.closest('.bgkey')) askKey();
    else if (e.target.closest('.bgkeyok')) tryKey();
    else if (e.target.closest('.bgjumpgo')) jumpTo();
  });
  ov.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.closest('.bgkeyin')) tryKey();
    else if (e.target.closest('.bgjump')) jumpTo();
  });
  function askKey() { // 跳出密碼輸入
    const b = $('.bgkey', ov);
    if (!b) return;
    b.outerHTML = '<div class="bgkeyrow"><input class="bgkeyin" type="password" inputmode="numeric" maxlength="8" placeholder="密碼" autocomplete="off"><button class="btn green sm bgkeyok">確定</button></div>';
    const inp = $('.bgkeyin', ov);
    if (inp) inp.focus();
  }
  function tryKey() {
    const inp = $('.bgkeyin', ov);
    if (!inp) return;
    if (inp.value.trim() === '0522') { store.set('busKey', true); SFX.win(); toast('🔓 已解鎖跳關!'); showMenu(); }
    else { inp.value = ''; inp.classList.remove('bad'); void inp.offsetWidth; inp.classList.add('bad'); SFX.bad(); buzz(80); }
  }
  function jumpTo() {
    const inp = $('.bgjump', ov);
    level = Math.max(1, Math.min(999, parseInt(inp && inp.value, 10) || 1));
    showMenu();
  }
  $('.bglv', scr).addEventListener('click', () => { if (G && G.state !== 'menu') showMenu(); }); // 點上面的「第 N 關」可以隨時回到選關畫面
  const ro = new ResizeObserver(() => { if (!cv.isConnected) return ro.disconnect(); if (G) layout(); });
  ro.observe(stage);

  function showMenu() { // 選關畫面:可以回去玩已經過的關卡
    level = Math.min(level, maxLv());
    if (!G || G.level !== level) start(level);
    G.state = 'menu';
    lvEl.textContent = level;
    ov.innerHTML = `<div class="bgcard"><div class="bgbig">🚌</div><h2>公車大塞車</h2>
      <p>點公車,它會往箭頭的方向開出停車場(被擋住會彈回來),停進上面的候車格;排隊的乘客會坐上<b>同顏色</b>的公車!<br>候車格塞滿、又沒人能上車就輸了</p>
      <div class="bglvsel"><button class="bgprev" ${level <= 1 ? 'disabled' : ''}>‹</button><span>第 <b>${level}</b> 關<i class="bgtier" data-t="${G.tier}">${G.tier}</i></span><button class="bgnextlv" ${level >= maxLv() ? 'disabled' : ''}>›</button></div>
      ${unlocked() ? `<div class="bgjumprow"><input class="bgjump" type="number" inputmode="numeric" min="1" max="999" value="${level}" aria-label="跳到第幾關"><button class="btn white sm bgjumpgo">跳關</button></div>` : ''}
      <button class="btn big green bggo"><span class="bi">▶</span><span class="bt">開始</span></button>
      ${unlocked() ? '<small class="bgkeyst">🔓 已解鎖跳關</small>' : '<button class="bgkey" aria-label="輸入密碼">🔑 輸入密碼</button>'}</div>`;
    ov.classList.add('on');
  }
  showMenu(); // 直接開選關畫面(不要等 requestAnimationFrame,背景分頁時它會暫停)
  raf = requestAnimationFrame(t => { last = t; frame(t); });
}

/* =========================================================
   停車大師 🅿️(闖關 30 關 + 連線對戰「停車大對決」)
   世界座標:x 往右、y 往下,單位公尺;車子的角度 a:車頭朝 (cos a, sin a),往上是 -π/2
   ========================================================= */
const PK = { W: 18, H: 30, L: 4.4, CW: 1.9, WB: 2.7, STEER: 0.6, VF: 6, VR: 3.4 };
const PK_LEN = { Sedan: 4.4, Hatch: 3.8, Van: 4.6 };
const PK_THEMES = { // 地面、線、外圍
  day: { ground: '#9aa3b1', line: '#ffffff', out: '#a6d78b', name: '白天' },
  school: { ground: '#8f9aa8', line: '#ffffff', out: '#b6e08f', name: '駕訓班' },
  garage: { ground: '#7d838e', line: '#ffd23f', out: '#5c626d', name: '地下室' },
  night: { ground: '#4c5466', line: '#e8ecff', out: '#33405a', name: '夜市' },
  street: { ground: '#868f9d', line: '#ffffff', out: '#cfd6df', name: '街道' },
};
// 50 關:版型、格子寬度(路邊停車是空位長度)、倒車入庫、障礙物和 KUSO 機關
// thief:阿姨會來搶車位(倒數)、dark:停電只看得到車燈、inv:方向盤裝反、robots:掃地機器人、movers:走道上開來開去的車、bumps:減速丘
const PK_PLAN = [
  { k: 'open', sw: 4.0, t: 'school', name: '第一次停車', tip: '搖桿指向要去的方向(上下左右是畫面的方向),再按住「前進」' },
  { k: 'open', sw: 3.6, side: 1, cones: 2, t: 'school', name: '右轉進格', tip: '先往前開,再把搖桿指向右邊' },
  { k: 'row', sw: 3.3, cones: 2, t: 'day', name: '兩台車中間', tip: '車子要整台在白線裡面才算' },
  { k: 'row', sw: 3.15, cones: 4, gate: 1, t: 'day', name: '三角錐陣', tip: '格子門口有三角錐,撞飛會扣時間' },
  { k: 'row', sw: 3.3, rev: 1, t: 'school', name: '倒車入庫', tip: '考駕照!車頭要朝外;搖桿指向格子,按「倒車」往那邊倒進去' },
  { k: 'row', sw: 3.05, bananas: 3, gate: 1, t: 'day', name: '香蕉皮警報', tip: '壓到香蕉皮會轉圈圈 🍌' },
  { k: 'double', sw: 3.1, cones: 3, t: 'day', name: '繞一圈', tip: '格子在花台那排的另一邊,要繞過去' },
  { k: 'row', sw: 3.0, ducks: 2, gate: 1, st: 1, t: 'day', name: '鴨子過馬路', tip: '小心鴨子!按「叭」可以催牠們快走' },
  { k: 'parallel', gap: 7.2, cones: 2, bumps: 2, t: 'street', name: '路邊停車', tip: '黃黑條紋是減速丘,開太快會彈起來' },
  { k: 'angled', sw: 3.0, robots: 1, t: 'day', name: '掃地機器人', tip: '停車場怎麼會有掃地機器人?!' },
  { k: 'garage', sw: 2.95, cones: 2, t: 'garage', name: '地下停車場', tip: '柱子很硬,不要撞到' },
  { k: 'row', sw: 3.0, thief: 1, cones: 2, t: 'day', name: '搶車位!', tip: '阿姨正要來搶這個車位,倒數完前停好!' },
  { k: 'double', sw: 2.9, ducks: 1, bananas: 2, st: 1, t: 'day', name: '菜市場', tip: '阿嬤的推車跟鴨子都在路上' },
  { k: 'row', sw: 2.85, rev: 1, cones: 5, gate: 1, t: 'school', name: '教練在看', tip: '倒車入庫+三角錐門,教練皺眉中' },
  { k: 'parallel', gap: 6.7, ducks: 1, cones: 2, t: 'night', name: '夜市路邊', tip: '雞排攤前面的路邊車位!' },
  { k: 'angled', sw: 2.9, carts: 2, gate: 1, t: 'day', name: '推車暴走', tip: '購物車自己在跑?!' },
  { k: 'row', sw: 2.95, dark: 1, cones: 2, t: 'night', name: '停電了!', tip: '整個停車場停電,只看得到車燈照到的地方' },
  { k: 'garage', sw: 2.85, rev: 1, cones: 2, t: 'garage', name: '柱子好多', tip: '倒車停進柱子旁邊' },
  { k: 'double', sw: 2.8, crooked: 1, cones: 3, st: 1, t: 'day', name: '誰停歪了', tip: '旁邊的車都停得歪七扭八…' },
  { k: 'row', sw: 2.9, inv: 1, cones: 2, t: 'school', name: '方向盤裝反了', tip: 'KUSO!這台車左右是相反的' },
  { k: 'parallel', gap: 6.4, bananas: 3, cones: 2, t: 'street', name: '香蕉人行道', tip: '路邊怎麼一堆香蕉皮' },
  { k: 'row', sw: 2.75, ducks: 2, carts: 1, gate: 1, st: 1, t: 'day', name: '動物園停車場', tip: '鴨子家族出遊中' },
  { k: 'double', sw: 2.8, movers: 1, cones: 2, t: 'day', name: '阿伯倒車中', tip: '有台車在走道上開來開去,小心!' },
  { k: 'garage', sw: 2.75, carts: 1, ducks: 1, gate: 1, t: 'garage', name: 'B3 迷宮', tip: '地下三樓為什麼會有鴨子' },
  { k: 'angled', sw: 2.8, robots: 2, bumps: 2, t: 'day', name: '機器人大軍', tip: '掃地機器人開始巡邏了' },
  { k: 'double', sw: 2.72, rev: 1, bananas: 2, cones: 2, t: 'day', name: '倒車大師', tip: '倒車入庫,而且要繞一圈' },
  { k: 'parallel', gap: 6.3, thief: 1, cones: 2, t: 'night', name: '夜市搶車位', tip: '夜市車位超搶手,阿姨已經在路上了!' },
  { k: 'angled', sw: 2.8, rev: 1, ducks: 2, cones: 2, t: 'school', name: '斜倒車', tip: '斜格子也要倒車入庫!' },
  { k: 'garage', sw: 2.75, dark: 1, cones: 2, t: 'garage', name: '地下室停電', tip: '地下室一片黑…靠車燈找格子' },
  { k: 'parallel', gap: 6.1, cones: 3, ducks: 1, t: 'night', name: '一次到位', tip: '空位越來越小了' },
  { k: 'row', sw: 2.72, inv: 1, gate: 1, cones: 3, t: 'school', name: '反向駕訓班', tip: '方向盤又裝反了,教練不知道' },
  { k: 'double', sw: 2.7, movers: 2, bumps: 2, st: 1, t: 'day', name: '下班尖峰', tip: '大家都在搶著出停車場' },
  { k: 'garage', sw: 2.68, rev: 1, cones: 4, gate: 1, t: 'garage', name: '柱子+三角錐', tip: '地下室工程中' },
  { k: 'angled', sw: 2.75, thief: 1, carts: 1, t: 'day', name: '週年慶搶位', tip: '百貨週年慶,阿姨們火力全開' },
  { k: 'double', sw: 2.65, crooked: 1, ducks: 2, carts: 1, st: 1, t: 'day', name: '百貨週年慶', tip: '週年慶停車場,大家都瘋了' },
  { k: 'parallel', gap: 5.95, ducks: 2, bananas: 2, cones: 2, t: 'night', name: '夜市大塞車', tip: '鴨子也來逛夜市' },
  { k: 'row', sw: 2.65, robots: 3, gate: 1, t: 'day', name: '機器人罷工', tip: '三台掃地機器人在格子前面亂跑' },
  { k: 'garage', sw: 2.65, dark: 1, rev: 1, t: 'garage', name: '停電倒車', tip: '黑漆漆的還要倒車入庫…' },
  { k: 'double', sw: 2.65, thief: 1, movers: 1, cones: 2, t: 'day', name: '搶位大作戰', tip: '阿伯在倒車、阿姨在搶位,你在哭' },
  { k: 'row', sw: 2.62, rev: 1, crooked: 1, cones: 6, gate: 1, t: 'school', name: '駕照魔王考', tip: '過了這關直接發駕照' },
  { k: 'angled', sw: 2.68, inv: 1, ducks: 2, t: 'day', name: '反向斜格', tip: '方向盤相反+斜格子+鴨子' },
  { k: 'garage', sw: 2.6, carts: 2, bananas: 2, gate: 1, st: 1, t: 'garage', name: '地下城', tip: '推車、香蕉皮、柱子…這是什麼地城' },
  { k: 'parallel', gap: 5.9, bumps: 3, movers: 1, t: 'street', name: '減速丘大街', tip: '減速丘一條接一條' },
  { k: 'double', sw: 2.6, robots: 2, ducks: 2, cones: 2, t: 'day', name: '動物機器人樂園', tip: '鴨子騎在掃地機器人上?!' },
  { k: 'row', sw: 2.6, dark: 1, thief: 1, gate: 1, t: 'night', name: '停電搶車位', tip: '停電了阿姨還是照搶' },
  { k: 'garage', sw: 2.58, inv: 1, rev: 1, cones: 3, t: 'garage', name: '反向地下城', tip: '方向盤相反還要倒車入庫,加油' },
  { k: 'double', sw: 2.58, rev: 1, ducks: 3, carts: 1, crooked: 1, cones: 2, t: 'day', name: '鴨子大軍', tip: '鴨子們占領了停車場' },
  { k: 'angled', sw: 2.62, movers: 2, robots: 1, bananas: 2, t: 'day', name: '混亂停車場', tip: '什麼東西都在動' },
  { k: 'parallel', gap: 5.85, thief: 1, ducks: 2, bananas: 2, t: 'night', name: '夜市終極搶位', tip: '最後一個夜市車位!' },
  { k: 'double', sw: 2.55, rev: 1, ducks: 2, carts: 1, bananas: 2, cones: 3, robots: 1, thief: 1, t: 'day', name: '終極停車王', tip: '全部機關一次來,停進去你就是停車之神' },
];
const PK_SALT = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]; // 每關的亂數種子(tools/park_levels.js 找不到留路的解法時會自動換)
const PK_PAR = [10,10,11,11,17,11,19,12,12,11,16,11,15,17,15,11,11,18,16,11,16,12,17,18,11,18,14,16,17,15,11,15,19,11,19,16,11,17,19,17,11,14,14,18,11,22,18,13,14,18]; // 三顆星的秒數(照自動解法算的)
const PK_PATH = ["cccccccccccccccccccccccccccccccccccc","edcccaaaddccdcddedaabddadeeeeeeeeee","cdcccccccccccbbdccccccceccdcccccccdecaaa","cccdecccccccccccccbcccccccccccbccccbcccb","cbcccccccccccccccccceedddaaaaaaaaaaaaaaaajijjjjjjijhf","ccccdcccccccccccccccccdccccdebcccbcccba","eeeffffedcddbabaaeaaaabcbaccbccccccbcbaaaacccccbaaaabeeeeedeeee","aaaaaaaaabcccccccccbcccccccccccbcccccbcccd","eeedcccccccccdcceebaaaabaacajjfhfff","cccccccccccccccccccccccccccababceeeeeeee","eeeeeeccccccaabcaadabcbccaababbaabaaaaajjaaabaaa","ccccccccccccccccccccccccccccccccccccccc","cdcbadccbccbbdbacebabbaaaaccbbcacccbcccbaccccbcccacbaedeee","cccccbcccccdccecccdecdaaaaaaaaaaaajjjjjijjhjjjjhihhg","eecddeeeecaaaabbccbcbcbccdcccedaaaaajjhfffec","ccccccccccccccccccccabaabcedbeeeedddeeccd","cccccccccccccccccdebbcccbcccccccbccccbd","jaaaaaccececcccecebbeeaddeededeedeeeeecaaaaajjijjjihihf","aaajjjaacbaaabdccccddcccdcccceedcccccceebebdaaaaa","ccccccdccccccccccccccccdcccccccdcceebaaa","eedccabbcccccdacccaecccaaaaaajijjjjjihhijjjjjjj","aaaaaaaaaccccccccccccbcccccccccccbccccbccb","jaaaaaccdcdcbeedccdedcddceedccdebeeeeeeeeeffeeeeeed","aaaaaacccdbeeeeeddccccecccaeeeeddddeeeedcbaajjjjjjiijihhgg","cccccccccccccccccccccccccababcceeeeedece","jaaaaaaacdedeeeedcdccecccbeeceeeeedeeeeabaaaajijjjjhhig","eeeccccccccccccccccccdcccaaaaadajjjfffee","cccccccccccccccccccededcaaaaaaaaaaaaaajjijjjjhhigff","aaaaaaacccdeeeecdbedebadedeeeeeeeeeeeabaaaajjjjjjihhf","eeecccccccccccccccccdcccaabaadcbajjigfffe","bcccccccccccbcccccccccccccbbaccccdcedccd","cdcbcccccccccaabbbbbcadaaaacccbbbccccbccbaaccccaaaaceeeeedcce","habaaaaacdccceeeeeddcccdcccccceeeeeeedeeeeffgfhffffgfghjgh","ccccccccccccccccccccccccccababceeeeeecee","aaaijaaaaaacaacccdedcccdbceeeedeeeeeecdbaaaajjjjjjjhhf","feeccccccccccccccccdccccabaaadcbajjifgffe","ccccccccccccccccccccccccdccceccccbcccbc","aaaababdcccddecceeeeacdcceeeeedeeeeeeaaaaajjjijjjiihf","fedddeedcccdeaaaaabcbbbccbcaaaaaaccaaaabbeeeedfffffhfgfhj","ccccccccccccccabaabceeeeeeeedeeeeeefffffffffgfhhhhhi","ccccccccccccccccccccccccccababceeeeeecee","aacccccccddcacbbccbccbaaaaaaacccccccccccccaadcdccdccde","eeeecceecdaaacaeccabbaaccaajijffffe","gdedeeedcccddcaaaaacabccebbaaaabaaaaabbceeeeegfffffifhhj","ccccccccccccccccccccccccdccceccccbccbcc","feeedeeacccbcaaaaaacdcccdcbccccabccaaaabababaaajjjijjjjajhggh","feeeeeccbcbcdaabccbabcbbcaaacbbaabbaaabeeeeefgfffffhjhj","cccccccccccccccccccccccccccababeeeeebeeeg","eeedccccdeebacabcdabbcbbaccaajjjfffffd","jabbababbbcceceeedcedbdcdcdeeeeebeeeeecaaacbajjjjjjhhihf"]; // 每關的自動解法(電腦玩家、教練示範用)
const pkWrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const PK_UP = -Math.PI / 2, PK_DOWN = Math.PI / 2;

function parkLevel(n) {
  const P = PK_PLAN[n - 1], r = busRng(n * 7919 + PK_SALT[n - 1] * 104729 + 17), W = PK.W, H = PK.H;
  const ri = k => Math.floor(r() * k), rr = (a, b) => a + r() * (b - a);
  const L = { n, name: P.name, tip: P.tip, theme: P.t, W, H, start: { x: W / 2, y: H - 3.4, a: PK_UP }, spot: null, obs: [], ducks: [], bananas: [], carts: [], movers: [], robots: [], bumps: [], slots: [], par: PK_PAR[n - 1], dark: !!P.dark, inv: !!P.inv };
  const kinds = ['Sedan', 'Sedan', 'Hatch', 'Van'];
  const jit = P.crooked ? 0.16 : 0.035, off = P.crooked ? 0.3 : 0.1;
  const car = (x, y, axis, kind) => { // axis:車子沿著的方向(會隨機前後顛倒)
    kind = kind || kinds[ri(kinds.length)];
    const a = axis + (r() < 0.5 ? 0 : Math.PI) + rr(-jit, jit);
    L.obs.push({ k: 'car', kind, x, y, a, hl: PK_LEN[kind] / 2, hw: PK.CW / 2, c: ri(8) });
  };
  const block = (k, x, y, hl, hw, a) => L.obs.push({ k, x, y, a: a || 0, hl, hw });
  const setSpot = (x, y, a, w, l, extra) => { L.spot = { x, y, a, w, l, rev: !!P.rev, ...extra }; };
  // 一排垂直的格子:y0~y0+len,車頭朝 axis;spotAt 是空格的位置(-1 = 這排沒有空格)
  function row(y0, len, x0, x1, sw, spotAt, into) {
    const n = Math.floor((x1 - x0) / sw), xs = x0 + ((x1 - x0) - n * sw) / 2, yc = y0 + len / 2;
    for (let i = 0; i < n; i++) {
      const cx = xs + (i + 0.5) * sw;
      L.slots.push({ x: cx, y: yc, a: into, w: sw, l: len });
      if (i === spotAt) setSpot(cx, yc, into, sw, len);
      else car(cx + rr(-off, off) * Math.max(0, (sw - PK.CW) / 2), yc + rr(-0.15, 0.15), into);
    }
    return n;
  }
  const midIdx = n => 1 + ri(Math.max(1, n - 2));
  if (P.k === 'open') {
    if (P.side) { setSpot(W - 3.2, 9, 0, P.sw, 5.4); L.slots.push({ ...L.spot }); }
    else { setSpot(W / 2, 5, PK_UP, P.sw, 5.4); L.slots.push({ ...L.spot }); }
    for (let y = 3; y < H - 2; y += 4) { block('cone', 0.8, y, 0.32, 0.32); block('cone', W - 0.8, y, 0.32, 0.32); }
  } else if (P.k === 'row') {
    const n = Math.floor((W - 1) / P.sw);
    row(0.5, 5.2, 0.5, W - 0.5, P.sw, midIdx(n), PK_UP);
    // 左右兩邊的花圃
    block('planter', 1.2, 16, 0.7, 3); block('planter', W - 1.2, 16, 0.7, 3);
  } else if (P.k === 'double' || P.k === 'garage') {
    const isl0 = 4.4, isl1 = W - 4.4;
    const n1 = Math.floor((W - 1) / P.sw), n2 = Math.floor((isl1 - isl0) / P.sw);
    const inIsland = r() < 0.6;
    row(0.5, 5.2, 0.5, W - 0.5, P.sw, inIsland ? -1 : midIdx(n1), PK_UP);
    row(12, 5.2, isl0, isl1, P.sw, inIsland ? midIdx(n2) : -1, PK_DOWN);
    row(17.2, 5.2, isl0, isl1, P.sw, -1, PK_UP);
    if (P.k === 'garage') { // 柱子:每兩格一根,在格子的後端
      const add = (y0, x0, x1, n) => { const xs = x0 + ((x1 - x0) - n * P.sw) / 2; for (let i = 0; i <= n; i += 2) block('pillar', xs + i * P.sw, y0, 0.4, 0.4); };
      add(1.0, 0.5, W - 0.5, n1);
      add(17.2, isl0, isl1, n2);
    } else { block('planter', isl0 - 0.6, 17.2, 0.5, 2.2); block('planter', isl1 + 0.6, 17.2, 0.5, 2.2); }
  } else if (P.k === 'angled') {
    const ang = PK_UP + Math.PI / 4, step = P.sw / Math.sin(Math.PI / 4), n = Math.floor((W - 3.5) / step), xs = 1.2 + ((W - 3.5) - n * step) / 2, sp = midIdx(n);
    for (let i = 0; i < n; i++) {
      const cx = xs + (i + 0.5) * step + 1.2, cy = 3.6;
      L.slots.push({ x: cx, y: cy, a: ang, w: P.sw, l: 5.2 });
      if (i === sp) setSpot(cx, cy, ang, P.sw, 5.2);
      else { const kind = kinds[ri(3)]; L.obs.push({ k: 'car', kind, x: cx + rr(-0.1, 0.1), y: cy, a: ang + (r() < 0.3 ? Math.PI : 0) + rr(-jit, jit), hl: PK_LEN[kind] / 2, hw: PK.CW / 2, c: ri(8) }); }
    }
    block('planter', 1.2, 17, 0.7, 3.5); block('planter', W - 1.2, 17, 0.7, 3.5);
  } else if (P.k === 'parallel') {
    // 右邊路邊一排車(車頭朝上),中間留一個空位;左邊也停一排
    const x = W - 1.7, gy = rr(4.5, 13), gap = P.gap;
    L.slots.push({ x, y: gy + gap / 2, a: PK_UP, w: 2.4, l: gap });
    setSpot(x, gy + gap / 2, PK_UP, 2.4, gap, { par: 1 });
    let y = gy - 0.1;
    while (y > 1.2) { const kind = kinds[ri(3)], l = PK_LEN[kind]; if (y - l < 0.3) break; L.obs.push({ k: 'car', kind, x: x + rr(-0.1, 0.1), y: y - l / 2, a: PK_UP + (r() < 0.25 ? Math.PI : 0) + rr(-jit, jit) * 0.5, hl: l / 2, hw: PK.CW / 2, c: ri(8) }); y -= l + rr(0.6, 1.2); }
    y = gy + gap + 0.1;
    while (y < H - 1.2) { const kind = kinds[ri(3)], l = PK_LEN[kind]; if (y + l > H - 0.3) break; L.obs.push({ k: 'car', kind, x: x + rr(-0.1, 0.1), y: y + l / 2, a: PK_UP + (r() < 0.25 ? Math.PI : 0) + rr(-jit, jit) * 0.5, hl: l / 2, hw: PK.CW / 2, c: ri(8) }); y += l + rr(0.6, 1.2); }
    for (let yy = 1.5; yy < H - 4; yy += rr(5.2, 6.4)) { const kind = kinds[ri(3)]; L.obs.push({ k: 'car', kind, x: 1.7, y: yy + PK_LEN[kind] / 2, a: PK_UP + (r() < 0.5 ? Math.PI : 0), hl: PK_LEN[kind] / 2, hw: PK.CW / 2, c: ri(8) }); }
    L.curb = { x0: W - 0.5, x1: 0.5 };
    L.start = { x: W / 2 - 1, y: H - 3.4, a: PK_UP };
  }
  if (P.st) L.start = { x: 2.6, y: H - 2.6, a: 0 }; // 從左下角、車頭朝右出發
  // 格子門口兩邊各一個三角錐,要開得很準
  if (P.gate && !L.spot.par) {
    const S = L.spot, bx = S.x - Math.cos(S.a) * (S.l / 2 + 1.2), by = S.y - Math.sin(S.a) * (S.l / 2 + 1.2), nx = -Math.sin(S.a), ny = Math.cos(S.a), d = S.w / 2 + 0.5;
    for (const sg of [-1, 1]) block('cone', bx + nx * d * sg, by + ny * d * sg, 0.32, 0.32);
  }
  // 自由的空地(放三角錐、香蕉皮、鴨子、推車用)
  const free = (x, y, rad, keepStart) => {
    if (x < rad || y < rad || x > W - rad || y > H - rad) return false;
    if (Math.hypot(x - L.start.x, y - L.start.y) < (keepStart || 4.5)) return false;
    if (Math.hypot(x - L.spot.x, y - L.spot.y) < 5) return false;
    const sx = L.spot.x + Math.cos(L.spot.a + Math.PI) * 4, sy = L.spot.y + Math.sin(L.spot.a + Math.PI) * 4; // 格子門口
    if (Math.hypot(x - sx, y - sy) < 3.2) return false;
    return !L.obs.some(o => busObbHit(x, y, 0, rad, rad, o.x, o.y, o.a, o.hl + 0.3, o.hw + 0.3)) && !L.bananas.some(b => Math.hypot(b.x - x, b.y - y) < 2.5);
  };
  const place = (rad, fn) => { for (let k = 0; k < 300; k++) { const x = rr(1, W - 1), y = rr(6.5, H - 2); if (free(x, y, rad)) { fn(x, y); return; } } };
  for (let i = 0; i < (P.cones || 0); i++) place(0.6, (x, y) => block('cone', x, y, 0.32, 0.32));
  for (let i = 0; i < (P.bananas || 0); i++) place(0.8, (x, y) => L.bananas.push({ x, y, a: rr(0, 6.28) }));
  // 鴨子、推車:沿著橫向的走道來回
  const lanes = [];
  for (let y = 7; y < H - 5; y += 0.5) { let ok = true; for (let x = 1.5; x < W - 1.5; x += 0.5) if (L.obs.some(o => busObbHit(x, y, 0, 0.4, 0.4, o.x, o.y, o.a, o.hl, o.hw))) { ok = false; break; } if (ok) lanes.push(y); }
  const laneY = () => (lanes.length ? lanes[ri(lanes.length)] : rr(8, 12));
  for (let i = 0; i < (P.ducks || 0); i++) L.ducks.push({ y: laneY(), x0: 1.6, x1: W - 1.6, n: 3 + ri(3), sp: rr(0.9, 1.4) * (1 + n / 22), t: rr(0, 20) });
  for (let i = 0; i < (P.carts || 0); i++) L.carts.push({ y: laneY(), x0: 1.2, x1: W - 1.2, sp: rr(1.4, 2.4) * (1 + n / 30), t: rr(0, 20) });
  // 走道上開來開去的車(要比較寬的走道)
  const wide = lanes.filter(y => { for (let x = 3; x < W - 3; x += 0.5) if (L.obs.some(o => busObbHit(x, y, 0, 2.3, 1.1, o.x, o.y, o.a, o.hl, o.hw))) return false; return true; });
  for (let i = 0; i < (P.movers || 0); i++) L.movers.push({ y: wide.length ? wide[ri(wide.length)] : laneY(), x0: 2.6, x1: W - 2.6, sp: rr(1.3, 2.1), t: rr(0, 20), kind: kinds[ri(3)], c: ri(8) });
  for (let i = 0; i < (P.robots || 0); i++) { const ang = rr(0, Math.PI * 2); L.robots.push({ x: rr(3, W - 3), y: rr(8, H - 6), vx: Math.cos(ang) * 1.5, vy: Math.sin(ang) * 1.5 }); }
  for (let i = 0; i < (P.bumps || 0); i++) { const y = laneY(); if (Math.abs(y - L.start.y) > 2.5 && !L.bumps.some(b => Math.abs(b.y - y) < 2)) L.bumps.push({ y, x0: 1, x1: W - 1 }); }
  if (P.thief) L.thief = Math.ceil(PK_PAR[n - 1] * 2 + 6); // 幾秒後阿姨來搶車位
  return L;
}

/* ---------- 碰撞與判定 ---------- */
function pkHit(L, x, y, a, list, wm) { // 車子在 (x, y, a) 會不會撞到東西或開出場外(離牆 wm 公尺內也算);回傳撞到的東西
  const m = wm == null ? 0.1 : wm;
  const c = Math.cos(a), s = Math.sin(a), hl = PK.L / 2, hw = PK.CW / 2;
  for (const [u, v] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) {
    const px = x + c * u - s * v, py = y + s * u + c * v;
    if (px < m || py < m || px > L.W - m || py > L.H - m) return { k: 'wall' };
  }
  for (const o of list || L.obs) {
    if (o.gone) continue;
    if (Math.abs(o.x - x) > o.hl + o.hw + 2.6 || Math.abs(o.y - y) > o.hl + o.hw + 2.6) continue;
    if (busObbHit(x, y, a, hl, hw, o.x, o.y, o.a, o.hl, o.hw)) return o;
  }
  return null;
}
function pkIn(L, x, y, a, slack) { // 停進格子了嗎(位置 + 方向)
  const S = L.spot, c = Math.cos(S.a), s = Math.sin(S.a), hl = PK.L / 2, hw = PK.CW / 2, ca = Math.cos(a), sa = Math.sin(a);
  const tl = S.l / 2 + 0.05 + (slack || 0), tw = S.w / 2 + (slack || 0);
  for (const [u, v] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) {
    const px = x + ca * u - sa * v - S.x, py = y + sa * u + ca * v - S.y;
    if (Math.abs(px * c + py * s) > tl || Math.abs(-px * s + py * c) > tw) return false;
  }
  const da = pkWrap(a - S.a), tol = 0.15 + (slack || 0);
  if (S.rev) return Math.abs(pkWrap(da - Math.PI)) < tol;
  return Math.abs(da) < tol || Math.abs(pkWrap(da - Math.PI)) < tol;
}
function pkMove(x, y, a, d, steer) { // 後輪為準的單車模型:往前(或後)開 d 公尺
  const k = Math.tan(steer) / PK.WB;
  let rx = x - Math.cos(a) * PK.WB / 2, ry = y - Math.sin(a) * PK.WB / 2;
  if (Math.abs(k) < 1e-6) { rx += Math.cos(a) * d; ry += Math.sin(a) * d; }
  else { const na = a + d * k; rx += (Math.sin(na) - Math.sin(a)) / k; ry -= (Math.cos(na) - Math.cos(a)) / k; a = na; }
  return [rx + Math.cos(a) * PK.WB / 2, ry + Math.sin(a) * PK.WB / 2, a];
}

/* ---------- 自動停車的解法(A*):驗證每關都停得進去、電腦玩家照著開 ---------- */
// 只有 tools/park_levels.js 會用到(產生上面的 PK_PATH、PK_PAR);遊戲裡直接用存好的解法
function* pkSolveGen(L, maxExp) {
  // 離格子 6.5 公尺以外:障礙物每邊多留 0.4 公尺、牆多留 0.3 公尺,玩家才看得出路;靠近格子才需要開得很準
  const far = (x, y) => Math.hypot(x - L.spot.x, y - L.spot.y) > 6.5;
  const stat = L.obs.map(o => (far(o.x, o.y) ? { ...o, hl: o.hl + 0.4, hw: o.hw + 0.4 } : o)).concat(L.bananas.map(b => ({ x: b.x, y: b.y, a: 0, hl: 0.9, hw: 0.9 })));
  const STEP = 0.6, NA = 64, RES = 0.3;
  const key = (x, y, a) => (Math.round(x / RES) * 200 + Math.round(y / RES)) * NA + ((Math.round(pkWrap(a) / (Math.PI * 2 / NA)) % NA) + NA) % NA;
  const S = L.spot, hx = (x, y) => Math.hypot(x - S.x, y - S.y);
  const heap = [], push = n => { heap.push(n); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p].f <= n.f) break; heap[i] = heap[p]; i = p; } heap[i] = n; };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1].f < heap[c].f) c++; if (heap[c].f >= last.f) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return top; };
  const seen = new Map(), st = L.start;
  push({ x: st.x, y: st.y, a: st.a, g: 0, f: hx(st.x, st.y) * 1.6, dir: 1, p: null });
  const STEERS = [-1, -0.5, 0, 0.5, 1];
  let exp = 0;
  while (heap.length) {
    const n = pop(), k = key(n.x, n.y, n.a);
    if (seen.has(k)) continue;
    seen.set(k, 1);
    if (pkIn(L, n.x, n.y, n.a, -0.05)) { const path = []; for (let q = n; q; q = q.p) path.push([q.x, q.y, q.a, q.dir, q.m]); return path.reverse(); }
    if (++exp > (maxExp || 260000)) return null;
    if (exp % 4000 === 0) yield exp;
    for (const dir of [1, -1]) for (let si = 0; si < 5; si++) {
      const s = STEERS[si];
      let x = n.x, y = n.y, a = n.a, ok = true;
      for (let k2 = 0; k2 < 3 && ok; k2++) { [x, y, a] = pkMove(x, y, a, dir * STEP / 3, s * PK.STEER); if (pkHit(L, x, y, a, stat, far(x, y) ? 0.3 : 0.1)) ok = false; }
      if (!ok || seen.has(key(x, y, a))) continue;
      const g = n.g + STEP * (dir < 0 ? 1.3 : 1) + (dir !== n.dir && n.p ? 2.2 : 0) + Math.abs(s) * 0.04;
      push({ x, y, a, g, f: g + hx(x, y) * 1.6, dir, p: n, m: (dir > 0 ? 0 : 5) + si });
    }
  }
  return null;
}
function pkSolve(L, maxExp) { const it = pkSolveGen(L, maxExp); let r; do { r = it.next(); } while (!r.done); return r.value; }
function pkPathTime(path, vf, vr, sw) { // 照著路徑開要幾秒(前進 vf、倒車 vr、換檔 sw 秒)
  let t = 0;
  for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); t += d / (path[i][3] > 0 ? vf : vr); if (i > 1 && path[i][3] !== path[i - 1][3]) t += sw; }
  return t;
}
function pkReplay(L, code) { // 把存好的解法(每個字 = 一步的檔位和方向盤)還原成路徑
  const STEP = 0.6, STEERS = [-1, -0.5, 0, 0.5, 1];
  let x = L.start.x, y = L.start.y, a = L.start.a;
  const path = [[x, y, a, 1]];
  for (const ch of code) {
    const m = ch.charCodeAt(0) - 97, dir = m < 5 ? 1 : -1, s = STEERS[m % 5];
    for (let k = 0; k < 3; k++) [x, y, a] = pkMove(x, y, a, dir * STEP / 3, s * PK.STEER);
    path.push([x, y, a, dir]);
  }
  return path;
}

/* ---------- 停車大師的 3D 畫面(Blender 做的車子、鴨子、香蕉皮、推車、柱子:assets/parking.glb) ---------- */
const PK_CAR_COLORS = ['#e53935', '#1e6fe0', '#f2f3f5', '#2b2f38', '#2eaa4f', '#fbc02d', '#8e44c8', '#9aa3b1'];
function pkView3D(LD, L, host) {
  const { THREE, gltf } = LD, W = L.W, H = L.H, th = PK_THEMES[L.theme], dark = L.theme === 'night' || L.theme === 'garage', off = L.dark; // off:停電
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const cvs = renderer.domElement;
  cvs.className = 'pk3d';
  host.prepend(cvs);
  const P = (x, y, h) => new THREE.Vector3(x - W / 2, h || 0, y - H / 2);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(th.out);
  scene.add(new THREE.HemisphereLight('#ffffff', dark ? '#30384a' : '#b8c2d4', off ? 0.07 : dark ? 0.75 : 1.2));
  const sun = new THREE.DirectionalLight(dark ? '#c9d6ff' : '#fff4e0', off ? 0.06 : dark ? 1.1 : 2.1);
  sun.position.set(-10, 24, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
  scene.add(sun, sun.target);

  // 地面:外圍(草地/人行道/地下室)、停車場、格線、目標格子
  const E = 10, PX = 24, gcv = document.createElement('canvas');
  gcv.width = (W + E * 2) * PX; gcv.height = (H + E * 2) * PX;
  const g = gcv.getContext('2d'), rnd = busRng(L.n * 31 + 7);
  g.scale(PX, PX); g.translate(E, E);
  g.fillStyle = th.out; g.fillRect(-E, -E, W + E * 2, H + E * 2);
  if (L.theme === 'day' || L.theme === 'school') for (let i = 0, x = -E; x < W + E; i++, x += 1.6) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.03)'; g.fillRect(x, -E, 1.6, H + E * 2); }
  if (L.theme === 'street') { g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 0.04; for (let x = -E; x < W + E; x += 1) { g.beginPath(); g.moveTo(x, -E); g.lineTo(x, H + E); g.stroke(); } for (let y = -E; y < H + E; y += 1) { g.beginPath(); g.moveTo(-E, y); g.lineTo(W + E, y); g.stroke(); } }
  g.fillStyle = th.ground; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.05)'; g.fillRect(rnd() * W, rnd() * H, 0.08, 0.08); }
  const inSlot = (s, fn) => { g.save(); g.translate(s.x, s.y); g.rotate(s.a); fn(); g.restore(); };
  g.strokeStyle = th.line; g.lineWidth = 0.12; g.lineCap = 'round';
  L.slots.forEach(s => inSlot(s, () => {
    if (L.spot.par) { g.setLineDash([0.5, 0.35]); g.strokeRect(-s.l / 2, -s.w / 2, s.l, s.w); g.setLineDash([]); return; }
    g.beginPath(); g.moveTo(-s.l / 2, -s.w / 2); g.lineTo(s.l / 2, -s.w / 2); g.lineTo(s.l / 2, s.w / 2); g.lineTo(-s.l / 2, s.w / 2); g.stroke();
  }));
  if (L.curb) { for (let y = 0; y < H; y += 1) { g.fillStyle = (y | 0) % 2 ? '#e53935' : '#ffffff'; g.fillRect(W - 0.32, y, 0.32, 1); } }
  // 減速丘(黃黑斜紋)
  L.bumps.forEach(b => { for (let x = b.x0, i = 0; x < b.x1; x += 0.5, i++) { g.fillStyle = i % 2 ? '#202228' : '#ffc61a'; g.fillRect(x, b.y - 0.3, 0.5, 0.6); } });
  // 障礙物的佔地(深色的框),一看就知道哪裡過不去
  L.obs.forEach(o => {
    if (o.k === 'cone') return;
    g.save(); g.translate(o.x, o.y); g.rotate(o.a);
    g.fillStyle = 'rgba(12,15,24,.38)';
    g.beginPath(); if (g.roundRect) g.roundRect(-o.hl - 0.15, -o.hw - 0.15, (o.hl + 0.15) * 2, (o.hw + 0.15) * 2, 0.3); else g.rect(-o.hl - 0.15, -o.hw - 0.15, (o.hl + 0.15) * 2, (o.hw + 0.15) * 2); g.fill();
    g.restore();
  });
  // 鴨子、推車、開來開去的車會走的路線(黃色虛線)
  g.strokeStyle = 'rgba(255,198,26,.7)'; g.lineWidth = 0.1; g.setLineDash([0.45, 0.3]);
  [...L.ducks, ...L.carts, ...L.movers].forEach(d => { g.beginPath(); g.moveTo(d.x0, d.y); g.lineTo(d.x1, d.y); g.stroke(); });
  g.setLineDash([]);
  // 走道上的箭頭
  g.fillStyle = 'rgba(255,255,255,.35)';
  [[W / 2, H - 9], [W / 2, 9.5]].forEach(([x, y]) => { if (L.obs.some(o => Math.hypot(o.x - x, o.y - y) < 3)) return; g.beginPath(); g.moveTo(x, y - 0.9); g.lineTo(x + 0.55, y - 0.2); g.lineTo(x + 0.2, y - 0.2); g.lineTo(x + 0.2, y + 0.8); g.lineTo(x - 0.2, y + 0.8); g.lineTo(x - 0.2, y - 0.2); g.lineTo(x - 0.55, y - 0.2); g.fill(); });
  // 目標格子
  inSlot(L.spot, () => {
    g.fillStyle = 'rgba(255,214,64,.28)'; g.fillRect(-L.spot.l / 2, -L.spot.w / 2, L.spot.l, L.spot.w);
    g.strokeStyle = '#ffd23f'; g.lineWidth = 0.16; g.setLineDash([]); g.strokeRect(-L.spot.l / 2 + 0.08, -L.spot.w / 2 + 0.08, L.spot.l - 0.16, L.spot.w - 0.16);
  });
  g.save(); g.translate(L.spot.x, L.spot.y);
  g.font = '900 1.5px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,255,255,.9)';
  g.fillText('P', 0, L.spot.rev ? -0.45 : 0.05);
  if (L.spot.rev) { g.font = '900 0.62px "Noto Sans TC", sans-serif'; g.fillText('倒車入庫', 0, 0.75); }
  g.restore();
  const gtex = new THREE.CanvasTexture(gcv);
  gtex.colorSpace = THREE.SRGBColorSpace;
  gtex.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + E * 2, H + E * 2), new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // 目標格子會一閃一閃(停進去變綠色)
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.3, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(L.spot.l, L.spot.w), glowMat);
  glow.rotation.set(-Math.PI / 2, 0, -L.spot.a);
  glow.position.copy(P(L.spot.x, L.spot.y, 0.02));
  scene.add(glow);
  // 停車場外圍的矮牆(地下室是高牆)
  const wallH = L.theme === 'garage' ? 1.3 : 0.32, wallMat = new THREE.MeshStandardMaterial({ color: L.theme === 'garage' ? '#8d939e' : '#e4e8ee', roughness: 0.85 });
  [[W / 2, -0.2, W + 0.8, 0.4], [W / 2, H + 0.2, W + 0.8, 0.4], [-0.2, H / 2, 0.4, H], [W + 0.2, H / 2, 0.4, H]].forEach(([x, y, w, d]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    m.position.copy(P(x, y, wallH / 2)); m.castShadow = m.receiveShadow = true; scene.add(m);
  });

  // Blender 的模型(同材質的零件合併,手機才跑得動)
  gltf.scene.updateMatrixWorld(true);
  const tpls = new Map();
  const tpl = n => {
    if (!tpls.has(n)) { const grp = new THREE.Group(); glbMergeByMat(THREE, gltf.scene.getObjectByName(n)).forEach(({ mat, geo }) => grp.add(new THREE.Mesh(geo, mat))); tpls.set(n, grp); }
    return tpls.get(n);
  };
  const paints = PK_CAR_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.15 }));
  function model(name, x, y, a, opt) {
    const o = tpl(name).clone(true);
    o.traverse(m => {
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      if (opt && opt.paint && m.material.name === 'CarPaint') m.material = opt.paint;
      if (opt && opt.tail && m.material.name === 'TailLight') m.material = opt.tail;
    });
    o.position.copy(P(x, y, opt && opt.h));
    o.rotation.y = -a;
    scene.add(o);
    return o;
  }
  const obsObj = new Map();
  const hz = document.createElement('canvas'); // 黃黑斜紋(花台、障礙物的側面)
  hz.width = 64; hz.height = 16;
  { const x = hz.getContext('2d'); x.fillStyle = '#ffc61a'; x.fillRect(0, 0, 64, 16); x.fillStyle = '#202228'; for (let i = -16; i < 64; i += 16) { x.beginPath(); x.moveTo(i, 16); x.lineTo(i + 8, 16); x.lineTo(i + 16, 0); x.lineTo(i + 8, 0); x.fill(); } }
  const hzTex = new THREE.CanvasTexture(hz);
  hzTex.colorSpace = THREE.SRGBColorSpace; hzTex.wrapS = THREE.RepeatWrapping; hzTex.repeat.set(3, 1);
  const hazard = new THREE.MeshStandardMaterial({ map: hzTex, roughness: 0.7 }), curbTop = new THREE.MeshStandardMaterial({ color: '#6b4a32', roughness: 1 });
  L.obs.forEach(o => {
    if (o.k === 'car') obsObj.set(o, model(o.kind, o.x, o.y, o.a, { paint: paints[o.c % paints.length] }));
    else if (o.k === 'pillar') obsObj.set(o, model('Pillar', o.x, o.y, 0));
    else if (o.k === 'cone') { const m = model('Cone', o.x, o.y, 0); m.scale.setScalar(1.35); obsObj.set(o, m); }
    else if (o.k === 'planter') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(o.hl * 2, 0.75, o.hw * 2), [hazard, hazard, curbTop, hazard, hazard, hazard]); // hl 沿著 x、hw 沿著 y(跟碰撞框一樣)
      m.position.copy(P(o.x, o.y, 0.375)); m.rotation.y = -o.a; m.castShadow = m.receiveShadow = true; scene.add(m);
      const long = Math.max(o.hl, o.hw), ax = o.hl >= o.hw ? 1 : 0; // 樹叢沿著花台比較長的那一邊種
      for (let k = -long + 0.7; k <= long - 0.6; k += 1.2) model('Bush', o.x + (ax ? k : 0), o.y + (ax ? 0 : k), rnd() * 6, { h: 0.7 }).scale.setScalar(0.85);
    }
  });
  const banObj = L.bananas.map(b => { const o = model('Banana', b.x, b.y, b.a, { h: 0.01 }); o.scale.setScalar(1.7); return o; });
  const duckObj = L.ducks.map(d => Array.from({ length: d.n }, (_, i) => { const o = model('Duck', d.x0, d.y, 0); o.scale.setScalar(i ? 1.4 : 1.9); return o; })); // 鴨子放大一點才看得到(鴨媽媽最大)
  const cartObj = L.carts.map(c => model('Cart', c.x0, c.y, 0));
  // 外圍的樹、路燈
  if (L.theme !== 'garage') {
    for (let i = 0; i < 26; i++) {
      const side = i % 4, x = side === 0 ? -2 - rnd() * 6 : side === 1 ? W + 2 + rnd() * 6 : rnd() * W, y = side < 2 ? rnd() * H : (side === 2 ? -2 - rnd() * 6 : H + 2 + rnd() * 6);
      if (L.theme === 'street' && x > W) continue;
      model(rnd() < 0.6 ? 'Tree' : 'Bush', x, y, rnd() * 6).scale.setScalar(0.8 + rnd() * 0.5);
    }
  }
  L.bumps.forEach(b => { const m = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false })); m.position.copy(P((b.x0 + b.x1) / 2, b.y, 0.05)); scene.add(m); });
  const robotObj = L.robots.map(() => { const o = model('Robot', -50, -50, 0); o.scale.setScalar(1.8); return o; }); // 放大一點才看得清楚
  const moverObj = L.movers.map(mv => model(mv.kind, -50, -50, 0, { paint: paints[mv.c % paints.length] }));
  let thiefObj = null;
  if (L.thief) { // 阿姨的粉紅廂型車(頭上有名牌)
    thiefObj = model('Van', -50, -50, 0, { paint: new THREE.MeshStandardMaterial({ color: '#ff6fae', roughness: 0.3 }) });
    const c = document.createElement('canvas'), x = c.getContext('2d');
    c.width = 256; c.height = 64;
    x.font = '900 34px "Noto Sans TC", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 8; x.strokeStyle = '#1f2433'; x.strokeText('🛒 搶位阿姨', 128, 34); x.fillStyle = '#ff6fae'; x.fillText('🛒 搶位阿姨', 128, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    sp.scale.set(3.6, 0.9, 1); sp.position.set(0, 3, 0); sp.renderOrder = 9;
    thiefObj.add(sp);
    thiefObj.visible = false;
  }
  if (dark && !off) { // 夜市、地下室:一盞盞的燈
    const lampMat = new THREE.MeshBasicMaterial({ color: '#fff3c4' }), poleMat = new THREE.MeshStandardMaterial({ color: '#59606d' });
    for (let y = 3; y < H; y += 8) for (const x of [-0.9, W + 0.9]) {
      if (L.theme === 'night') { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4, 8), poleMat); p.position.copy(P(x, y, 2)); scene.add(p); }
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), lampMat); b.position.copy(P(x, y, L.theme === 'night' ? 4.1 : 1.6)); scene.add(b);
      const pl = new THREE.PointLight('#ffe7a8', 18, 14, 1.6); pl.position.copy(P(x, y, 3.5)); scene.add(pl);
    }
  }
  // 玩家的車(跑車)、對手的影子車
  const tailMat = (() => { let m = null; tpl('Sport').traverse(x => { if (x.isMesh && x.material.name === 'TailLight') m = x.material; }); return m.clone(); })();
  let me = null;
  const ghosts = new Map();
  const ghostCar = (color, label) => {
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, transparent: true, opacity: 0.5, depthWrite: false });
    const o = model('Sport', -50, -50, 0, { paint });
    o.traverse(m => { if (m.isMesh && m.material !== paint) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.45; m.material.depthWrite = false; } m.castShadow = false; });
    if (label) {
      const c = document.createElement('canvas'), x = c.getContext('2d');
      c.width = 256; c.height = 64;
      x.font = '900 34px "Noto Sans TC", Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineWidth = 8; x.strokeStyle = '#1f2433'; x.strokeText(label, 128, 34); x.fillStyle = color; x.fillText(label, 128, 34);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
      sp.scale.set(3.2, 0.8, 1); sp.position.set(0, 2.4, 0); sp.renderOrder = 9;
      o.add(sp);
    }
    return o;
  };

  // 鏡頭:幾乎從正上方往下看、視角很窄(看起來不會歪),畫面上看到的位置就是車子真的佔的位置
  const camera = new THREE.PerspectiveCamera(15, 1, 1, 600);
  const TILT = 0.15;
  let w = 0, h = 0;
  const fitCam = () => {
    const corners = [], v = new THREE.Vector3();
    for (const x of [-W / 2 - 0.3, W / 2 + 0.3]) for (const z of [-H / 2 - 0.3, H / 2 + 0.3]) for (const y of [0, 1.4]) corners.push(new THREE.Vector3(x, y, z));
    let tz = 0, d = 40;
    for (let pass = 0; pass < 6; pass++) {
      let lo = 5, hi = 600;
      for (let k = 0; k < 30; k++) {
        d = (lo + hi) / 2;
        camera.position.set(0, Math.cos(TILT) * d, tz + Math.sin(TILT) * d); camera.lookAt(0, 0, tz); camera.updateMatrixWorld();
        if (corners.every(c => { v.copy(c).project(camera); return Math.abs(v.x) <= 0.98 && Math.abs(v.y) <= 0.98; })) hi = d; else lo = d;
      }
      d = hi;
      camera.position.set(0, Math.cos(TILT) * d, tz + Math.sin(TILT) * d); camera.lookAt(0, 0, tz); camera.updateMatrixWorld();
      let y0 = 9, y1 = -9;
      corners.forEach(c => { v.copy(c).project(camera); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
      tz -= (y0 + y1) / 2 * H * 0.5;
    }
  };
  const fit = () => {
    const r = host.getBoundingClientRect();
    if (!r.width || (r.width === w && r.height === h)) return;
    w = r.width; h = r.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fitCam();
  };
  // 輔助線:照現在的方向盤,畫出車頭(前進)或車尾(倒車)兩個角接下來 5 公尺會經過哪裡
  const GN = 18, guideMat = new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.8, depthWrite: false });
  const guides = [0, 1].map(() => {
    const geo = new THREE.BufferGeometry(), idx = [];
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GN * 6), 3));
    for (let i = 0; i < GN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, guideMat);
    m.frustumCulled = false; m.renderOrder = 3; m.visible = false;
    scene.add(m);
    return m;
  });
  function drawGuides(car, dir, steer) {
    let x = car.x, y = car.y, a = car.a;
    const hl = PK.L / 2 * dir, hw = PK.CW / 2 - 0.05;
    for (let i = 0; i < GN; i++) {
      const c = Math.cos(a), sn = Math.sin(a), nx = -sn * 0.08, ny = c * 0.08;
      guides.forEach((m, k) => {
        const v = k ? hw : -hw, px = x + c * hl - sn * v, py = y + sn * hl + c * v, p1 = P(px - nx, py - ny, 0.05), p2 = P(px + nx, py + ny, 0.05);
        m.geometry.attributes.position.array.set([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z], i * 6);
      });
      [x, y, a] = pkMove(x, y, a, dir * 0.3, steer);
    }
    guides.forEach(m => { m.geometry.attributes.position.needsUpdate = true; m.visible = true; });
    guideMat.color.set(dir > 0 ? '#4ade80' : '#ffb020');
  }
  const shakeCam = { t: 0 };
  return {
    shake() { shakeCam.t = 0.3; },
    render(now, S, dt) {
      fit();
      if (S.car && !me) {
        me = model('Sport', S.car.x, S.car.y, S.car.a, { paint: new THREE.MeshStandardMaterial({ color: S.color, roughness: 0.22, metalness: 0.2 }), tail: tailMat });
        if (off) for (const sg of [-1, 1]) { // 停電:只有車燈照得到
          const sl = new THREE.SpotLight('#fff3cf', 260, 30, 0.5, 0.55, 1.4);
          sl.position.set(2.1, 0.7, sg * 0.6); sl.target.position.set(10, 0, sg * 1.2);
          me.add(sl, sl.target);
        }
      }
      if (me) {
        me.visible = !!S.car;
        if (S.car) { me.position.copy(P(S.car.x, S.car.y)); me.rotation.y = -S.car.a; me.rotation.z = S.car.bump || 0; }
        tailMat.emissiveIntensity = S.braking ? 3 : 0.6;
        if (S.car && S.guide) drawGuides(S.car, S.guide, S.car.steer * PK.STEER); else guides.forEach(m => { m.visible = false; });
      }
      // 對手 / 教練的影子車:平滑地追上最新位置
      S.ghosts.forEach((gh, id) => {
        let o = ghosts.get(id);
        if (!o) { o = ghostCar(gh.color, gh.label); ghosts.set(id, o); o.position.copy(P(gh.x, gh.y)); o.rotation.y = -gh.a; }
        const t = P(gh.x, gh.y);
        o.position.lerp(t, Math.min(1, dt * 10));
        let da = -gh.a - o.rotation.y; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        o.rotation.y += da * Math.min(1, dt * 10);
        o.visible = gh.on !== false;
      });
      ghosts.forEach((o, id) => { if (!S.ghosts.has(id)) { scene.remove(o); ghosts.delete(id); } });
      // 被撞飛的三角錐、香蕉皮、鴨子、推車
      L.obs.forEach(o => {
        if (o.k !== 'cone' || !o.gone) return;
        const m = obsObj.get(o), f = o.fly;
        if (!m || !f) return;
        const u = (now - f.t0) / 1000;
        if (u > 1.4) { m.visible = false; return; }
        m.position.copy(P(o.x + f.vx * u, o.y + f.vy * u, Math.max(0, 6 * u - 9 * u * u)));
        m.rotation.x += dt * 12; m.rotation.z += dt * 9;
      });
      L.bananas.forEach((b, i) => { banObj[i].visible = !b.gone; });
      S.ducks.forEach((line, i) => line.forEach((d, k) => {
        const o = duckObj[i][k];
        o.position.copy(P(d.x, d.y, Math.abs(Math.sin(now / 120 + k)) * 0.06));
        o.rotation.y = d.dir > 0 ? 0 : Math.PI;
        o.rotation.x = Math.sin(now / 110 + k) * 0.18;
      }));
      S.carts.forEach((c, i) => { const o = cartObj[i]; o.position.copy(P(c.x, c.y)); o.rotation.y = c.dir > 0 ? 0 : Math.PI; });
      S.robots.forEach((r, i) => { const o = robotObj[i]; o.position.copy(P(r.x, r.y)); o.rotation.y = -Math.atan2(r.vy, r.vx); });
      S.movers.forEach((mv, i) => { const o = moverObj[i]; o.position.copy(P(mv.x, mv.y)); o.rotation.y = mv.dir > 0 ? 0 : Math.PI; });
      if (thiefObj) { thiefObj.visible = !!S.thief; if (S.thief) { thiefObj.position.copy(P(S.thief.x, S.thief.y)); thiefObj.rotation.y = -S.thief.a; } }
      glowMat.color.set(S.inSpot ? '#4ade80' : '#ffd23f');
      glowMat.opacity = S.inSpot ? 0.35 + S.hold * 0.4 : 0.18 + Math.abs(Math.sin(now / 420)) * 0.22;
      if (shakeCam.t > 0) { shakeCam.t -= dt; camera.position.x = Math.sin(now / 25) * 0.25 * (shakeCam.t / 0.3); } else camera.position.x = 0;
      renderer.render(scene, camera);
    },
    dispose() { renderer.dispose(); renderer.forceContextLoss(); cvs.remove(); },
  };
}

/* ---------- 開車:控制、物理、碰撞、KUSO 事件 ---------- */
const PK_MSG = {
  crash: ['砰!', '保險桿:好痛', '叭叭叭!', '車主正在趕來…', '保險理賠 +1', '駕訓班教練扶額', '這不是碰碰車!'],
  wall: ['撞牆了!', '牆:我招誰惹誰', '咚!'],
  pillar: ['柱子:我不會動喔', '咚!柱子贏了', '柱子好硬'],
  duck: ['呱!呱!呱!', '鴨子:你很沒禮貌', '鴨鴨抗議中', '撞鴨扣分!'],
  cart: ['購物車暴衝!', '是誰沒把推車放回去!', '推車:讓我過'],
  banana: ['滑~~~', '香蕉皮!!', '瑪利歐上身', '轉圈圈~'],
  cone: ['三角錐飛走了~', '全壘打!', '錐錐掰掰'],
  robot: ['掃地機器人:我只是在打掃', '嗶嗶嗶!機器人哭哭', '機器人翻肚了'],
  mover: ['阿伯:你沒看到我在倒車嗎!', '叭!阿伯生氣了', '讓一下啦少年仔'],
  bump: ['咚咚!', '減速丘!慢一點', '屁股好痛!'],
  inv: ['方向盤裝反了!', '咦?怎麼往右轉', 'KUSO 左右相反車'],
  horn: ['叭~~!', '讓一讓~', '鴨鴨快走', '叭叭!'],
};
function pkSession(LD, L, o) {
  // o: { stage, pad, color, label, spectate, wait, battle, onFinish, onFail, onPose }
  const stage = o.stage, pad = o.pad;
  stage.insertAdjacentHTML('beforeend', `<div class="pkhud"><span class="pkt">⏱ 0.0</span><span class="pkc">💥 0</span>${L.thief ? `<span class="pkth">🛒 阿姨 ${L.thief}</span>` : ''}${L.inv ? '<span class="pkinv">↔ 反向</span>' : ''}</div>
    <div class="pkmsg"></div><div class="pkhold"><i></i><span>停穩中…</span></div>`);
  const tEl = $('.pkt', stage), cEl = $('.pkc', stage), thEl = $('.pkth', stage), msgEl = $('.pkmsg', stage), holdEl = $('.pkhold', stage);
  const view = pkView3D(LD, L, stage);
  const S = {
    car: o.spectate ? null : { x: L.start.x, y: L.start.y, a: L.start.a, v: 0, steer: 0, bump: 0 },
    color: o.color || '#ffd23f', ghosts: new Map(), ducks: [], carts: [], movers: [], robots: L.robots.map(r => ({ ...r })), thief: null, inSpot: false, hold: 0, braking: false,
  };
  let steerIn = 0, thr = 0, jdir = null, started = false, t0 = 0, crashes = 0, pen = 0, done = false, cool = 0, spin = null, boost = 0, hornCd = 0, beepT = 0, raf = 0, last = 0, live = !o.spectate && !o.wait;
  L.obs.forEach(x => { delete x.gone; delete x.fly; });
  L.bananas.forEach(b => { delete b.gone; });
  const dph = L.ducks.map(d => d.t * d.sp), cph = L.carts.map(c => c.t * c.sp), mph = L.movers.map(m => m.t * m.sp);
  let bumpCd = 0, failed = false;
  const pingpong = (ph, x0, x1) => { const span = x1 - x0, u = ((ph % (span * 2)) + span * 2) % (span * 2); return u < span ? [x0 + u, 1] : [x1 - (u - span), -1]; };
  const say = (list, col) => {
    msgEl.textContent = typeof list === 'string' ? list : pick(list);
    msgEl.style.color = col || '#fff';
    msgEl.classList.remove('on'); void msgEl.offsetWidth; msgEl.classList.add('on');
  };

  // ---------- 控制:左邊搖桿左右拖轉方向(手指放下的地方就是中心)、右邊按住「前進」「倒車」、中間喇叭 ----------
  if (!o.spectate) {
    pad.innerHTML = `<div class="pkpad">
      <div class="pkjarea"><div class="pkjbase"><span class="pkjl u">▲</span><span class="pkjl d">▼</span><span class="pkjl l">◀</span><span class="pkjl r">▶</span><i class="pkjknob"></i></div>
        <button class="pkhorn" aria-label="喇叭">📯<small>叭</small></button></div>
      <div class="pkpeds"><button class="pkgo"><b>▲</b>前進</button><button class="pkrev"><b>▼</b>倒車</button></div></div>`;
    const area = $('.pkjarea', pad), base = $('.pkjbase', pad), knob = $('.pkjknob', pad), hornB = $('.pkhorn', pad), R = 40;
    let jid = null, jx = 0, jy = 0, pthr = 0;
    const setThr = () => { thr = pthr; if (thr) press(); }; // 前進/倒車只有按鈕管
    area.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (jid != null) return;
      jid = e.pointerId; jx = e.clientX; jy = e.clientY;
      try { area.setPointerCapture(e.pointerId); } catch (_) { /* 模擬的觸控沒辦法捕捉 */ }
      const r = area.getBoundingClientRect();
      base.style.left = (jx - r.left) + 'px'; base.style.top = (e.clientY - r.top) + 'px';
      base.classList.add('on');
      knob.style.transform = '';
    });
    area.addEventListener('pointermove', e => {
      if (e.pointerId !== jid) return;
      let dx = e.clientX - jx, dy = e.clientY - jy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // 搖桿指的是畫面上的方向(上下左右是絕對的);車子會自己轉過去,前進/倒車由按鈕決定
      jdir = Math.hypot(dx, dy) > R * 0.35 ? Math.atan2(dy, L.inv ? -dx : dx) : null;
    });
    const jup = e => { if (e.pointerId !== jid) return; jid = null; jdir = null; base.classList.remove('on'); base.style.left = base.style.top = ''; knob.style.transform = ''; };
    area.addEventListener('pointerup', jup); area.addEventListener('pointercancel', jup);
    const pedal = (b, val) => {
      b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) { /* 同上 */ } pthr = val; b.classList.add('on'); setThr(); });
      const up = () => { if (pthr === val) pthr = 0; b.classList.remove('on'); setThr(); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    };
    pedal($('.pkgo', pad), 1); pedal($('.pkrev', pad), -1);
    hornB.addEventListener('pointerdown', e => { e.preventDefault(); horn(); });
  }
  const keys = new Set();
  const kd = e => {
    if (!stage.isConnected) return;
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', ' '].includes(k)) e.preventDefault();
    if (k === ' ' || k === 'h') { horn(); return; }
    keys.add(k); keyUpd(); if (thr) press();
  };
  const ku = e => { keys.delete(e.key); keyUpd(); };
  const keyUpd = () => {
    const L1 = keys.has('ArrowLeft') || keys.has('a'), R1 = keys.has('ArrowRight') || keys.has('d');
    if (L1 || R1 || S.kbSteer) { steerIn = (R1 ? 1 : 0) - (L1 ? 1 : 0); S.kbSteer = L1 || R1; }
    const F = keys.has('ArrowUp') || keys.has('w'), B = keys.has('ArrowDown') || keys.has('s');
    if (F || B || S.kbGas) { thr = F ? 1 : B ? -1 : 0; S.kbGas = F || B; }
  };
  if (!o.spectate) { window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); }
  function press() { if (live && !started && !o.battle) { started = true; t0 = performance.now(); if (L.inv) say(PK_MSG.inv, '#c4b5fd'); } }
  function horn() {
    if (!live || hornCd > 0) return;
    hornCd = 0.8; boost = 2;
    beep(415, 0.16, 'square', 0.09); beep(330, 0.2, 'square', 0.08, 0.17);
    say(PK_MSG.horn, '#ffe066');
  }

  // ---------- 每一幀 ----------
  function crash(hit) {
    const kind = PK_MSG[hit.k] && hit.k !== 'car' ? hit.k : 'crash';
    if (cool <= 0) {
      crashes++; pen += kind === 'duck' ? 3 : 2;
      say(PK_MSG[kind], kind === 'duck' ? '#ffe066' : '#ff8a8a');
      view.shake(); buzz(60);
      if (kind === 'duck') { beep(900, 0.06, 'square', 0.08); beep(760, 0.08, 'square', 0.08, 0.09); }
      else { beep(120, 0.18, 'sawtooth', 0.14); beep(80, 0.2, 'square', 0.08, 0.05); }
      cEl.textContent = '💥 ' + crashes;
      cEl.classList.remove('bump'); void cEl.offsetWidth; cEl.classList.add('bump');
    }
    cool = 0.6;
  }
  function step(dt) {
    const c = S.car;
    cool -= dt; hornCd -= dt; boost = Math.max(0, boost - dt);
    // 鴨子、推車移動
    S.ducks = L.ducks.map((d, i) => { dph[i] += dt * d.sp * (boost > 0 ? 3 : 1); return Array.from({ length: d.n }, (_, k) => { const [x, dir] = pingpong(dph[i] - k * 0.62, d.x0, d.x1); return { x, y: d.y, dir }; }); });
    S.carts = L.carts.map((cc, i) => { cph[i] += dt * cc.sp; const [x, dir] = pingpong(cph[i], cc.x0, cc.x1); return { x, y: cc.y, dir }; });
    S.movers = L.movers.map((mv, i) => { mph[i] += dt * mv.sp; const [x, dir] = pingpong(mph[i], mv.x0, mv.x1); return { x, y: mv.y, dir }; });
    S.robots.forEach(rb => { // 掃地機器人:直直走,碰到東西就轉彎
      const nx = rb.x + rb.vx * dt, ny = rb.y + rb.vy * dt;
      const blocked = (x, y) => x < 1 || y < 1 || x > L.W - 1 || y > L.H - 1 || L.obs.some(ob => !ob.gone && Math.abs(ob.x - x) < 4 && Math.abs(ob.y - y) < 4 && busObbHit(x, y, 0, 0.8, 0.8, ob.x, ob.y, ob.a, ob.hl, ob.hw));
      if (!blocked(nx, ny)) { rb.x = nx; rb.y = ny; }
      else if (!blocked(rb.x - rb.vx * dt, ny)) rb.vx = -rb.vx;
      else if (!blocked(nx, rb.y - rb.vy * dt)) rb.vy = -rb.vy;
      else { rb.vx = -rb.vx; rb.vy = -rb.vy; }
    });
    // 阿姨搶車位:倒數完就開進格子
    if (L.thief && started && !done) {
      const left = L.thief - (performance.now() - t0) / 1000;
      if (thEl) { thEl.textContent = '🛒 阿姨 ' + Math.max(0, Math.ceil(left)); thEl.classList.toggle('warn', left < 6); }
      if (left <= 0 && !S.thief) {
        S.thief = { u: 0 };
        live = false; failed = true; thr = 0;
        say('阿姨來了!!', '#ff6fae'); beep(415, 0.3, 'square', 0.09); beep(330, 0.4, 'square', 0.08, 0.3);
      }
    }
    if (S.thief) {
      const T = S.thief, Sp = L.spot, d = (1 - Math.min(1, T.u)) * (Sp.l / 2 + 9);
      T.u += dt / 2.2;
      T.x = Sp.x - Math.cos(Sp.a) * d; T.y = Sp.y - Math.sin(Sp.a) * d; T.a = Sp.a;
      if (T.u >= 1.4 && !T.told) { T.told = true; if (o.onFail) o.onFail(); }
    }
    if (!c) return;
    if (!live) { c.v *= Math.max(0, 1 - dt * 6); S.guide = 0; return; }
    let sIn = L.inv ? -steerIn : steerIn; // 鍵盤:左右是相對方向盤
    if (jdir != null && thr) { // 搖桿:車頭(前進)或車尾(倒車)要對準搖桿指的方向;倒車時方向盤的作用是相反的
      const err = pkWrap((thr > 0 ? jdir : jdir + Math.PI) - c.a);
      sIn = Math.max(-1, Math.min(1, err * 2.4)) * (thr > 0 ? 1 : -1);
    }
    c.steer += (sIn - c.steer) * Math.min(1, dt * 9);
    S.guide = thr ? Math.sign(thr) : c.v < -0.05 ? -1 : 1;
    S.braking = false;
    if (spin) { c.a += spin.w * dt; c.v *= Math.max(0, 1 - dt * 1.8); spin.t -= dt; if (spin.t <= 0) spin = null; }
    else if (thr > 0) { if (c.v < 0) { c.v = Math.min(0, c.v + 12 * dt); S.braking = true; } else c.v = Math.min(PK.VF, c.v + 4.2 * dt); }
    else if (thr < 0) { if (c.v > 0) { c.v = Math.max(0, c.v - 12 * dt); S.braking = true; } else c.v = Math.max(-PK.VR, c.v - 3.4 * dt); }
    else { const s = Math.sign(c.v); c.v = s * Math.max(0, Math.abs(c.v) - 7 * dt); S.braking = Math.abs(c.v) > 0.05; }
    if (c.v < -0.1) { S.braking = true; beepT -= dt; if (beepT <= 0) { beepT = 0.5; beep(1250, 0.05, 'sine', 0.035); } } // 倒車嗶嗶
    if (Math.abs(c.v) > 0.001) {
      const [nx, ny, na] = pkMove(c.x, c.y, c.a, c.v * dt, spin ? 0 : c.steer * PK.STEER);
      const dyn = [];
      S.ducks.forEach(line => line.forEach(d => dyn.push({ k: 'duck', x: d.x, y: d.y, a: 0, hl: 0.42, hw: 0.32 })));
      S.carts.forEach(cc => dyn.push({ k: 'cart', x: cc.x, y: cc.y, a: 0, hl: 0.55, hw: 0.35 }));
      S.movers.forEach((mv, i) => dyn.push({ k: 'mover', x: mv.x, y: mv.y, a: 0, hl: PK_LEN[L.movers[i].kind] / 2, hw: PK.CW / 2 }));
      S.robots.forEach(rb => dyn.push({ k: 'robot', x: rb.x, y: rb.y, a: 0, hl: 0.75, hw: 0.75 }));
      const hit = pkHit(L, nx, ny, na) || dyn.find(d => Math.hypot(d.x - nx, d.y - ny) < d.hl + 2.6 && busObbHit(nx, ny, na, PK.L / 2, PK.CW / 2, d.x, d.y, 0, d.hl, d.hw));
      if (hit && hit.k === 'cone') { // 三角錐被撞飛(扣 1 秒,車子繼續走)
        hit.gone = true; hit.fly = { t0: performance.now(), vx: Math.cos(c.a) * c.v * 1.4 + (Math.random() - 0.5) * 2, vy: Math.sin(c.a) * c.v * 1.4 + (Math.random() - 0.5) * 2 };
        pen += 1; say(PK_MSG.cone, '#ffb36b'); beep(520, 0.08, 'triangle', 0.1); beep(780, 0.1, 'triangle', 0.08, 0.08);
        c.v *= 0.75; c.x = nx; c.y = ny; c.a = na;
      } else if (hit) { crash(hit); c.v = -c.v * 0.3; c.bump = 0.06; }
      else { c.x = nx; c.y = ny; c.a = na; }
    }
    c.bump *= Math.max(0, 1 - dt * 8);
    // 減速丘:開太快會彈起來、變慢
    bumpCd -= dt;
    L.bumps.forEach(b => {
      if (Math.abs(b.y - c.y) > 3 || !busObbHit(c.x, c.y, c.a, PK.L / 2, PK.CW / 2, (b.x0 + b.x1) / 2, b.y, 0, (b.x1 - b.x0) / 2, 0.3)) return;
      if (Math.abs(c.v) > 2.3) { c.v = Math.sign(c.v) * 1.4; c.bump = 0.14; if (bumpCd <= 0) { bumpCd = 1; say(PK_MSG.bump, '#ffc61a'); beep(140, 0.08, 'square', 0.1); beep(140, 0.08, 'square', 0.1, 0.12); buzz(30); } }
      else if (bumpCd <= 0) { bumpCd = 0.5; c.bump = 0.04; }
    });
    // 香蕉皮
    L.bananas.forEach(b => {
      if (b.gone || Math.hypot(b.x - c.x, b.y - c.y) > 2.6) return;
      if (!busObbHit(c.x, c.y, c.a, PK.L / 2, PK.CW / 2, b.x, b.y, 0, 0.4, 0.4)) return;
      b.gone = true; spin = { w: (Math.random() < 0.5 ? -1 : 1) * 7, t: 0.6 }; c.v = Math.sign(c.v || 1) * Math.max(2.5, Math.abs(c.v));
      pen += 1; say(PK_MSG.banana, '#ffe14d'); beep(600, 0.4, 'sine', 0.06); beep(300, 0.4, 'sine', 0.05, 0.2);
    });
    // 停好了嗎:位置對、方向對、車子停住 0.8 秒
    S.inSpot = pkIn(L, c.x, c.y, c.a) && !spin;
    if (S.inSpot && Math.abs(c.v) < 0.35 && started) S.hold = Math.min(1, S.hold + dt / 0.8); else S.hold = Math.max(0, S.hold - dt * 2);
    holdEl.classList.toggle('on', S.inSpot);
    $('i', holdEl).style.width = Math.round(S.hold * 100) + '%';
    $('span', holdEl).textContent = Math.abs(c.v) < 0.35 ? '停穩中…' : '停進來了,踩煞車!';
    if (S.hold >= 1) finish();
  }
  function finish() {
    if (done) return;
    done = true; live = false; thr = 0;
    const ms = Math.round(performance.now() - t0);
    holdEl.classList.remove('on');
    beep(660, 0.1, 'triangle', 0.1); beep(880, 0.12, 'triangle', 0.1, 0.1); beep(1320, 0.2, 'triangle', 0.1, 0.22);
    if (o.onFinish) o.onFinish({ ms, pen, crashes, total: ms / 1000 + pen });
  }
  let poseT = 0;
  function frame(now) {
    if (!stage.isConnected) { api.destroy(); return; }
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    for (let k = 0, n = Math.ceil(dt / 0.017); k < n; k++) step(dt / n);
    if (started && !done) tEl.textContent = '⏱ ' + ((performance.now() - t0) / 1000 + pen).toFixed(1);
    if (S.car && live && o.onPose && (poseT -= dt) <= 0) { poseT = 0.2; o.onPose(S.car.x, S.car.y, S.car.a); }
    // 教練示範
    if (demo) {
      const u = (now - demo.t0) / 1000;
      let i = 0;
      while (i < demo.tl.length - 1 && demo.tl[i + 1][0] < u) i++;
      const A = demo.tl[i], B = demo.tl[Math.min(i + 1, demo.tl.length - 1)], f = B[0] > A[0] ? Math.min(1, (u - A[0]) / (B[0] - A[0])) : 1;
      let da = B[3] - A[3]; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      S.ghosts.set('demo', { x: A[1] + (B[1] - A[1]) * f, y: A[2] + (B[2] - A[2]) * f, a: A[3] + da * f, color: '#7cc4ff', label: '教練示範' });
      if (u > demo.tl[demo.tl.length - 1][0] + 1.5) { demo = null; S.ghosts.delete('demo'); }
    }
    view.render(now, S, dt);
    raf = requestAnimationFrame(frame);
  }
  let demo = null;
  raf = requestAnimationFrame(t => { last = t; frame(t); });
  const api = {
    S,
    begin() { live = !o.spectate; started = true; t0 = performance.now(); if (L.inv) say(PK_MSG.inv, '#c4b5fd'); }, // 連線對戰:倒數完一起開始計時
    stop() { live = false; thr = 0; },
    setGhost(id, x, y, a, color, label) { const gh = S.ghosts.get(id); if (gh) Object.assign(gh, { x, y, a }); else S.ghosts.set(id, { x, y, a, color, label }); },
    dropGhost(id) { S.ghosts.delete(id); },
    playDemo() { // 教練開一次給你看(照自動解法)
      const path = pkReplay(L, PK_PATH[L.n - 1]);
      let t = 0;
      const tl = [[0, path[0][0], path[0][1], path[0][2]]];
      for (let i = 1; i < path.length; i++) { t += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]) / (path[i][3] > 0 ? 3.2 : 2); if (i > 1 && path[i][3] !== path[i - 1][3]) t += 0.7; tl.push([t, path[i][0], path[i][1], path[i][2]]); }
      demo = { t0: performance.now() + 300, tl };
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      view.dispose();
    },
  };
  return api;
}

/* ---------- 單人闖關:50 關,有星星、可以選關、密碼 0522 跳關 ---------- */
function pkStars(total, par) { return total <= par ? 3 : total <= par * 1.6 ? 2 : 1; }
function pkComment(st, cr) {
  if (st === 3 && !cr) return pick(['神之停車!駕訓班教練落淚', '完美!可以去考職業停車手', '這技術…你是代客泊車的吧']);
  if (st === 3) return pick(['很快!雖然有點擦撞', '速度滿分,保險公司扣分']);
  if (cr >= 4) return pick(['保險公司已經在路上了…', '你是來停車還是來玩碰碰車', '附近的車主都在哭']);
  if (st === 2) return pick(['不錯喔!再快一點就三顆星', '穩穩的,有停進去就好']);
  return pick(['有停進去就是好車手!', '慢慢來比較快', '至少沒有停到隔壁格']);
}
function parkGame() {
  resetView();
  app.innerHTML = '';
  const stars = () => { const a = store.get('parkStars', []); return Array.isArray(a) ? a : []; };
  const unlocked = () => !!store.get('parkKey', false);
  const NL = PK_PLAN.length;
  const maxLv = () => (unlocked() ? NL : Math.min(NL, Math.max(1, store.get('parkMax', 1) | 0)));
  let level = Math.min(maxLv(), Math.max(1, store.get('parkLevel', 1) | 0)), sess = null, LD = null;
  const scr = el('div', 'screen pkg');
  scr.innerHTML = `
    <div class="bgtop">
      <button class="iconbtn pkback" aria-label="回首頁">✕</button>
      <div class="bglv pklv">第 <b>1</b> 關<i class="pkname"></i></div>
      <button class="iconbtn pkdemo" aria-label="教練示範">👻</button>
      <button class="iconbtn pkretry" aria-label="重來">↻</button>
    </div>
    <div class="pkstage"><div class="bgov pkov"></div><div class="pktip"></div></div>
    <div class="pkpadw"></div>`;
  app.appendChild(scr);
  const stage = $('.pkstage', scr), ov = $('.pkov', scr), padW = $('.pkpadw', scr), tipEl = $('.pktip', scr);
  ov.innerHTML = '<div class="bgcard"><div class="bgbig">🅿️</div><h2>停車大師</h2><p>載入 3D 停車場中…</p></div>';
  ov.classList.add('on');
  function start(n, quiet) {
    level = n;
    store.set('parkLevel', n);
    if (sess) sess.destroy();
    $$('.pkhud, .pkmsg, .pkhold', stage).forEach(x => x.remove());
    const L = parkLevel(n);
    $('.pklv b', scr).textContent = n;
    $('.pkname', scr).textContent = L.name;
    ov.className = 'bgov pkov';
    tipEl.innerHTML = `<b>${esc(L.name)}</b>${esc(L.tip)}<small>⭐⭐⭐ ${L.par} 秒內 · 撞車 +2 秒</small>`;
    tipEl.classList.toggle('off', !!quiet);
    if (!quiet) setTimeout(() => tipEl.classList.add('off'), 3800);
    sess = pkSession(LD, L, {
      stage, pad: padW, color: '#ffd23f',
      onFail: () => {
        SFX.bad(); buzz([100, 60, 160]);
        ov.innerHTML = `<div class="bgcard"><div class="bgbig">🛒</div><h2>車位被搶走了!</h2><p class="pkcom">「${pick(['阿姨:少年仔,下次快一點', '阿姨:這格我先看到的', '阿姨已經去逛週年慶了'])}」</p>
          <button class="btn big orange pkagain"><span class="bi">↻</span><span class="bt">再挑戰一次</span></button><div class="pkrow"><button class="btn white sm pkmenu">☰ 選關</button></div></div>`;
        ov.classList.add('on');
      },
      onFinish: r => {
        const st = pkStars(r.total, L.par), arr = stars();
        arr[n - 1] = Math.max(arr[n - 1] || 0, st);
        store.set('parkStars', arr);
        store.set('parkMax', Math.max(store.get('parkMax', 1) | 0, Math.min(NL, n + 1)));
        if (st === 3) { SFX.win(); confetti(); } else SFX.good();
        buzz([60, 60, 120]);
        setTimeout(() => {
          ov.innerHTML = `<div class="bgcard"><div class="pkstars">${[1, 2, 3].map(k => `<span class="${k <= st ? 'on' : ''}" style="animation-delay:${k * 0.18}s">★</span>`).join('')}</div>
            <h2>第 ${n} 關 停好了!</h2><p class="pkres">⏱ <b>${r.total.toFixed(1)}</b> 秒${r.pen ? `<small>(開車 ${(r.ms / 1000).toFixed(1)} + 罰 ${r.pen})</small>` : ''} · 💥 ${r.crashes} 次</p>
            <p class="pkcom">「${pkComment(st, r.crashes)}」</p>
            ${n < NL ? '<button class="btn big green pknext"><span class="bi">▶</span><span class="bt">下一關</span></button>' : `<p class="pkcom">🏆 ${NL} 關全破!你是停車之神!</p>`}
            <div class="pkrow"><button class="btn white sm pkagain">↻ 再一次</button><button class="btn white sm pkmenu">☰ 選關</button></div></div>`;
          ov.classList.add('on');
        }, 700);
      },
    });
  }
  function showMenu() {
    if (sess) sess.stop();
    const s = stars(), mx = maxLv(), total = s.reduce((a, b) => a + (b || 0), 0);
    ov.innerHTML = `<div class="bgcard pkmenuc"><h2>🅿️ 停車大師</h2>
      <p>左邊搖桿指向要去的方向(上下左右是畫面上的方向),右邊按「前進」或「倒車」,把車停進<b>發光的格子</b>!撞車、撞鴨子會扣時間 🦆</p>
      <div class="pkgrid">${Array.from({ length: NL }, (_, i) => { const n = i + 1, lock = n > mx; return `<button class="pkl${lock ? ' lock' : ''}${n === level ? ' cur' : ''}" data-n="${n}" ${lock ? 'disabled' : ''}><b>${lock ? '🔒' : n}</b><small>${lock ? '' : '★'.repeat(s[i] || 0) + '☆'.repeat(3 - (s[i] || 0))}</small></button>`; }).join('')}</div>
      <p class="pktot">⭐ ${total} / ${NL * 3}</p>
      ${unlocked() ? '' : '<button class="btn white sm pkkey">🔑 輸入密碼</button>'}</div>`;
    ov.classList.add('on');
  }
  ov.addEventListener('click', e => {
    const b = e.target.closest('.pkl');
    if (b && !b.disabled) { start(+b.dataset.n); return; }
    if (e.target.closest('.pknext')) start(level + 1);
    else if (e.target.closest('.pkagain')) start(level);
    else if (e.target.closest('.pkmenu')) showMenu();
    else if (e.target.closest('.pkkey')) {
      const k = $('.pkkey', ov);
      k.outerHTML = '<div class="bgkeyrow"><input class="bgkeyin" type="password" inputmode="numeric" maxlength="8" placeholder="密碼" autocomplete="off"><button class="btn green sm pkkeyok">確定</button></div>';
      $('.bgkeyin', ov).focus();
    } else if (e.target.closest('.pkkeyok')) tryKey();
  });
  ov.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.bgkeyin')) tryKey(); });
  function tryKey() {
    const inp = $('.bgkeyin', ov);
    if (inp && inp.value.trim() === '0522') { store.set('parkKey', true); SFX.win(); toast('🔓 已解鎖全部關卡!'); showMenu(); }
    else if (inp) { inp.value = ''; inp.classList.remove('bad'); void inp.offsetWidth; inp.classList.add('bad'); SFX.bad(); buzz(80); }
  }
  $('.pkback', scr).addEventListener('click', () => { if (sess) sess.destroy(); home(); });
  $('.pkretry', scr).addEventListener('click', () => { if (LD) start(level); });
  $('.pkdemo', scr).addEventListener('click', () => { if (sess) { sess.playDemo(); toast('👻 教練示範一次給你看'); } });
  $('.pklv', scr).addEventListener('click', () => { if (LD) showMenu(); });
  glbLoad('assets/parking.glb').then(L => {
    if (!scr.isConnected) return;
    LD = L;
    start(level, true);
    showMenu();
  }).catch(e => {
    console.warn('停車大師 3D 載入失敗', e);
    ov.innerHTML = '<div class="bgcard"><div class="bgbig">😢</div><h2>3D 載入失敗</h2><p>這支手機或瀏覽器不支援 3D,或是網路斷了。換個瀏覽器再試試!</p><button class="btn big blue pkhome"><span class="bi">◀</span><span class="bt">回首頁</span></button></div>';
    $('.pkhome', ov).addEventListener('click', () => home());
  });
}

/* ---------- 連線對戰:停車大對決(3 局,大家停同一個停車場,最快停好的拿最多分) ---------- */
const PKB = { R: 3, T: 90, PTS: [5, 3, 2, 1] };
function hParking(H) {
  let round = 0, phase = 'idle', tok = 0, t0 = 0;
  const tot = {}, ps = {}, NL = PK_PLAN.length, lvs = [rand(3, 15), rand(16, 32), rand(33, NL)];
  H.players.forEach(s => { tot[s] = 0; });
  function startRound() {
    round++;
    const lv = lvs[round - 1];
    H.players.forEach(s => { ps[s] = { done: 0, sc: 0, cr: 0 }; });
    phase = 'cd';
    H.bc({ t: 'g', e: 'prep', rd: round, R: PKB.R, lv });
    H.s.after(2600, () => H.countdown(() => {
      phase = 'play';
      t0 = Date.now();
      H.bc({ t: 'g', e: 'round', rd: round, R: PKB.R, lv, T: PKB.T, order: H.players });
      const my = ++tok;
      H.s.after(PKB.T * 1000, () => { if (my === tok && phase === 'play') endRound(); });
    }));
  }
  const fins = () => H.players.filter(s => ps[s].done).sort((a, b) => ps[a].sc - ps[b].sc);
  function endRound() {
    phase = 'rend'; tok++;
    const fin = fins(), pts = {};
    fin.forEach((s, k) => { pts[s] = PKB.PTS[k] || 1; tot[s] += pts[s]; });
    H.players.forEach(s => { H.scores[s] = tot[s]; });
    H.bc({ t: 'score', scores: H.scores });
    H.bc({ t: 'g', e: 'rend', rd: round, fin, pts, tot, sc: Object.fromEntries(fin.map(s => [s, ps[s].sc])), cr: Object.fromEntries(fin.map(s => [s, ps[s].cr])), last: round >= PKB.R });
    H.s.after(5200, () => (round >= PKB.R ? H.finish() : startRound()));
  }
  const allDone = () => H.active().every(s => ps[s] && ps[s].done);
  return {
    start() { startRound(); },
    input(slot, m) {
      const p = ps[slot];
      if (phase !== 'play' || !p) return;
      if (m.e === 'pos') { H.bc({ t: 'g', e: 'pos', s: slot, x: +m.x || 0, y: +m.y || 0, a: +m.a || 0 }); return; }
      if (m.e === 'done' && !p.done) {
        p.done = Date.now();
        p.cr = Math.max(0, +m.cr || 0);
        p.sc = Math.max(1000, Math.min(p.done - t0 + 500, +m.ms || 0)) + Math.max(0, +m.pen || 0) * 1000;
        const rank = fins().indexOf(slot) + 1;
        H.bc({ t: 'g', e: 'fin', s: slot, sc: p.sc, cr: p.cr, rank });
        if (allDone()) H.s.after(1500, () => { if (phase === 'play') endRound(); });
      }
    },
    presence() { if (phase === 'play' && allDone()) endRound(); },
  };
}
function vParking(V) {
  const me = V.me;
  V.stage('<div class="pkstage"><div class="pkseats"></div><div class="pkcover on"><div class="big">🅿️</div><div>停車大對決</div><div class="small">載入 3D 停車場中…</div></div></div>');
  const stage = $('.pkstage', V.root), cover = $('.pkcover', stage), seats = $('.pkseats', stage);
  let LD = null, sess = null, order = [], st = {}, pending = null, endAt = 0, timer = null;
  glbLoad('assets/parking.glb').then(L => { LD = L; if (pending) { const m = pending; pending = null; V.on(m); } })
    .catch(() => { cover.innerHTML = '<div class="big">😢</div><div>3D 載入失敗</div><div class="small">這支手機不支援 3D,只能看比分了</div>'; });
  const fmt = ms => (ms / 1000).toFixed(1);
  function renderSeats() {
    seats.innerHTML = order.map(s => {
      const p = pinfo(s), o = st[s] || {};
      return `<span class="pkseat${s === me ? ' me' : ''}" style="--pc:${p.color}">${p.emoji}<b>${s === me ? '你' : esc(p.name)}</b>${o.sc ? `<em>${['🥇', '🥈', '🥉', '🎀'][o.rank - 1] || '✅'} ${fmt(o.sc)}s</em>` : '<em>🚗</em>'}</span>`;
    }).join('');
  }
  V.countdown = k => {
    cover.innerHTML = k > 0 ? `<div class="big cdn pulse">${k}</div>` : '<div class="big cdn go">GO!</div>';
    cover.classList.add('on');
    if (k > 0) SFX.tick(); else SFX.go();
  };
  V.on = m => {
    if (m.e === 'prep' || m.e === 'round') {
      if (!LD) { pending = m; return; }
      const L = parkLevel(m.lv);
      if (m.e === 'prep') {
        if (sess) sess.destroy();
        $$('.pkhud, .pkmsg, .pkhold', stage).forEach(x => x.remove());
        order = H_order(m);
        sess = pkSession(LD, L, { stage, pad: V.pad, color: pinfo(me).color, battle: true, wait: true, onPose: (x, y, a) => V.send({ e: 'pos', x: +x.toFixed(2), y: +y.toFixed(2), a: +a.toFixed(3) }),
          onFail: () => { cover.innerHTML = '<div class="big">🛒</div><div>車位被阿姨搶走了!</div><div class="small">這局沒分…看別人停吧</div>'; cover.classList.add('on'); },
          onFinish: r => { V.send({ e: 'done', ms: r.ms, pen: r.pen, cr: r.crashes }); cover.innerHTML = `<div class="big">🅿️</div><div>停好了!${r.total.toFixed(1)} 秒</div><div class="small">等其他人停好…</div>`; setTimeout(() => cover.classList.add('on'), 600); } });
        cover.innerHTML = `<div class="small">第 ${m.rd} / ${m.R} 局 · 第 ${m.lv} 關</div><div class="big">🅿️</div><div>${esc(L.name)}</div><div class="small">${esc(L.tip)}</div>`;
        cover.classList.add('on');
        st = {};
      } else {
        order = m.order;
        st = {};
        renderSeats();
        cover.classList.remove('on');
        if (m.order.includes(me)) sess.begin(); else toast('觀戰中');
        endAt = Date.now() + m.T * 1000;
        clearInterval(timer);
        timer = setInterval(() => { if (!stage.isConnected) return clearInterval(timer); const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000)); seats.dataset.t = left; }, 300);
      }
    } else if (m.e === 'pos') {
      if (m.s !== me && sess) sess.setGhost(m.s, m.x, m.y, m.a, pinfo(m.s).color, pinfo(m.s).name);
    } else if (m.e === 'fin') {
      st[m.s] = { sc: m.sc, rank: m.rank, cr: m.cr };
      renderSeats();
      if (m.s !== me) beep(990, 0.1, 'sine', 0.1);
      else if (m.rank === 1) SFX.win();
    } else if (m.e === 'rend') {
      clearInterval(timer);
      if (sess) sess.stop();
      const rows = Object.keys(m.tot).map(Number).sort((a, b) => m.tot[b] - m.tot[a]).map(s => {
        const k = m.fin.indexOf(s);
        return `<span>${k >= 0 ? ['🥇', '🥈', '🥉', '🎀'][k] : '💤'} ${pinfo(s).emoji} ${s === me ? '你' : esc(pinfo(s).name)} ${k >= 0 ? `<small>${fmt(m.sc[s])}s${m.cr[s] ? ` 💥${m.cr[s]}` : ''}</small>` : '<small>沒停好</small>'} <b>${k >= 0 ? `+${m.pts[s]}` : '+0'}</b><i>共 ${m.tot[s]} 分</i></span>`;
      }).join('');
      cover.innerHTML = `<div class="small">第 ${m.rd} 局結果</div><div class="ffinal">${rows}</div><div class="small">${m.last ? '比賽結束!' : '下一局更難…'}</div>`;
      cover.classList.add('on');
    }
  };
  const H_order = m => m.order || order;
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

/* 停車大對決的電腦:照著每關存好的解法開,越強開越快、越少撞車 */
BOTS.parking = (H, s, m, k) => {
  if (m.t !== 'g' || m.e !== 'round' || !m.order.includes(s)) return;
  const fr = (a, b) => a + Math.random() * (b - a);
  const Lv = parkLevel(m.lv), path = pkReplay(Lv, PK_PATH[m.lv - 1]), st = H.bs[s] = { rd: m.rd };
  const vf = 1.8 + k.sk * 1.4, vr = 1.1 + k.sk * 0.8, pause = 1.4 - k.sk * 0.6; // 比人慢一點,手機上才有得拚
  const cr = Math.random() < (1 - k.sk) * 0.9 ? 1 + Math.floor(Math.random() * (1 + (1 - k.sk) * 2.5)) : 0;
  let t = fr(0.6, 1.6) * k.spd;
  const tl = [[t, path[0][0], path[0][1], path[0][2]]];
  for (let i = 1; i < path.length; i++) {
    t += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]) / (path[i][3] > 0 ? vf : vr);
    if (i > 1 && path[i][3] !== path[i - 1][3]) t += pause;
    tl.push([t, path[i][0], path[i][1], path[i][2]]);
  }
  const stretch = 1 + cr * 0.12 + (1 - k.sk) * fr(0.1, 0.4) + fr(0, 0.15), t0 = Date.now(); // 撞車、猶豫都會拖時間
  const tick = () => {
    if (H.bs[s] !== st) return;
    const u = (Date.now() - t0) / 1000 / stretch;
    let i = 0;
    while (i < tl.length - 1 && tl[i + 1][0] < u) i++;
    const A = tl[i], B = tl[Math.min(i + 1, tl.length - 1)], f = B[0] > A[0] ? Math.max(0, Math.min(1, (u - A[0]) / (B[0] - A[0]))) : 1;
    botSend(H, s, { e: 'pos', x: A[1] + (B[1] - A[1]) * f, y: A[2] + (B[2] - A[2]) * f, a: A[3] + (B[3] - A[3]) * f });
    if (u >= t) { if (!Lv.thief || t * stretch < Lv.thief) botSend(H, s, { e: 'done', ms: Math.round(t * stretch * 1000), pen: cr * 2, cr }); }
    else H.s.after(200, tick);
  };
  H.s.after(200, tick);
};

/* ---------- 防止雙指縮放 / 長按選單 ---------- */
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

home();
