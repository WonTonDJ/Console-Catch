/**
 * Console Catch v3 — Multiplayer Game Server
 * Fixed: real-time lobby updates, dedicated lobby_update event,
 *        bot controls, 1v5 to 5v1 AI scaling
 */

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─────────────────────────────────────────────────────────────
// STATIC DATA
// ─────────────────────────────────────────────────────────────
const CONSOLE_SETS = {
  beige:  { name:'Nintendo', cards:[{id:'snes',name:'SNES',emoji:'🕹️'},{id:'n64',name:'N64',emoji:'🎮'},{id:'switch',name:'Switch',emoji:'🔋'}] },
  green:  { name:'Sony',     cards:[{id:'ps1',name:'PS1',emoji:'📀'},{id:'psp',name:'PSP',emoji:'🎯'},{id:'ps4',name:'PS4',emoji:'🕹️'}] },
  blue:   { name:'Sega',     cards:[{id:'saturn',name:'Saturn',emoji:'🪐'},{id:'dreamcast',name:'Dreamcast',emoji:'💫'},{id:'gamegear',name:'GameGear',emoji:'💿'}] },
  yellow: { name:'Xbox',     cards:[{id:'xbox',name:'XBOX',emoji:'🟩'},{id:'xbox360',name:'Xbox 360',emoji:'⚙️'},{id:'xboxone',name:'Xbox One',emoji:'⬛'}] },
  orange: { name:'Steam',    cards:[{id:'steamdeck',name:'SteamDeck',emoji:'🎲'},{id:'steammachine',name:'Steam Mach.',emoji:'🖥️'},{id:'steamframe',name:'Steam Frame',emoji:'🖼️'}] },
  grey:   { name:'PC',       cards:[{id:'keyboard',name:'Keyboard',emoji:'⌨️'},{id:'mouse',name:'Mouse',emoji:'🖱️'},{id:'gamingpc',name:'Gaming PC',emoji:'🖥️'}] },
  red:    { name:'VR',       cards:[{id:'oculus',name:'Oculus',emoji:'🥽'},{id:'metaquest',name:'Meta Quest',emoji:'🔮'},{id:'applevr',name:'Apple VR',emoji:'🍎'}] },
};

const AVATARS    = ['🐉','🦊','🐺','🦁','🐯','🦄','🐻','🐼','🦅','🦋'];
const BOT_NAMES  = ['RetroBot','PixelBot','NESBot','CassetteBot','DreamBot','ArcadeBot'];
const ROOM_WORDS = ['SNES','SEGA','XBOX','STEAM','PIXEL','SONIC','MARIO','ZELDA','RETRO','ATARI'];

// ─────────────────────────────────────────────────────────────
// IN-MEMORY STORE
// ─────────────────────────────────────────────────────────────
const rooms       = {};   // code -> room
const socketRoom  = {};   // socketId -> code

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const cards = [];
  for (const [color, set] of Object.entries(CONSOLE_SETS))
    for (const card of set.cards)
      for (let i = 0; i < 4; i++)
        cards.push({ ...card, color, setName: set.name });
  return shuffle(cards);
}

function genCode() {
  let c;
  do { c = ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)] +
           Math.floor(Math.random() * 89 + 10); }
  while (rooms[c]);
  return c;
}

function isValidSet(cards) {
  if (!cards || cards.length !== 3) return false;
  return cards.every(c => c.id    === cards[0].id)
      || cards.every(c => c.color === cards[0].color);
}

// ─────────────────────────────────────────────────────────────
// PLAYER FACTORY
// ─────────────────────────────────────────────────────────────
function makePlayer(id, name, avatar, isBot) {
  return {
    id, name, avatar, isBot: !!isBot,
    hand: [], sets: [[],[],[]], lockedSets: 0,
    lockedSetCards: [[],[],[]], discardPile: [],
    gold: 0, lucky: 0, hasDrawn: false,
  };
}

// ─────────────────────────────────────────────────────────────
// LOBBY BROADCAST  ← dedicated event so the waiting screen
//                    always gets fresh data regardless of phase
// ─────────────────────────────────────────────────────────────
function broadcastLobby(room) {
  const payload = {
    roomCode : room.code,
    hostId   : room.hostId,
    phase    : room.phase,
    players  : room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot,
    })),
  };
  io.to(room.code).emit('lobby_update', payload);
}

// ─────────────────────────────────────────────────────────────
// GAME STATE BROADCAST  ← used only during active game
// ─────────────────────────────────────────────────────────────
function broadcastGame(room) {
  io.to(room.code).emit('game_state', {
    roomCode    : room.code,
    phase       : room.phase,
    hostId      : room.hostId,
    currentTurn : room.currentTurn,
    round       : room.round,
    deckCount   : room.deck.length,
    topDiscard  : room.discardPile.at(-1) ?? null,
    players     : room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot,
      cardCount: p.hand.length, lockedSets: p.lockedSets,
      gold: p.gold, lucky: p.lucky, discardPile: p.discardPile,
    })),
  });
}

function pushHand(room, player) {
  if (player.isBot) return;
  io.to(player.id).emit('your_hand', {
    hand: player.hand, sets: player.sets,
    lockedSets: player.lockedSets, lockedSetCards: player.lockedSetCards,
    hasDrawn: player.hasDrawn,
  });
}

function pushAllHands(room) {
  room.players.forEach(p => pushHand(room, p));
}

// ─────────────────────────────────────────────────────────────
// ROOM MANAGEMENT
// ─────────────────────────────────────────────────────────────
function createRoom(socket, name) {
  const code = genCode();
  const room = {
    code, hostId: socket.id, phase: 'waiting',
    players: [], deck: [], discardPile: [],
    currentTurn: 0, round: 1, timerTimeout: null,
  };
  rooms[code] = room;
  _addHuman(room, socket, name);
  return room;
}

function _addHuman(room, socket, name) {
  const av = AVATARS[room.players.length % AVATARS.length];
  const p  = makePlayer(socket.id, name, av, false);
  room.players.push(p);
  socketRoom[socket.id] = room.code;
  socket.join(room.code);
  return p;
}

function _addBot(room) {
  const used = new Set(room.players.map(p => p.name));
  const name = BOT_NAMES.find(n => !used.has(n)) ?? `Bot${room.players.length}`;
  const av   = AVATARS[room.players.length % AVATARS.length];
  const bot  = makePlayer(`bot_${Date.now()}_${Math.random()}`, name, av, true);
  room.players.push(bot);
  return bot;
}

function _removeLastBot(room) {
  for (let i = room.players.length - 1; i >= 0; i--) {
    if (room.players[i].isBot) { room.players.splice(i, 1); return true; }
  }
  return false;
}

function getPlayer(room, id) { return room.players.find(p => p.id === id); }

// ─────────────────────────────────────────────────────────────
// GAME FLOW
// ─────────────────────────────────────────────────────────────
function startGame(room) {
  room.phase       = 'playing';
  room.deck        = buildDeck();
  room.discardPile = [];
  room.currentTurn = 0;
  room.round       = 1;
  for (const p of room.players) {
    p.hand = []; p.sets = [[],[],[]];
    p.lockedSets = 0; p.lockedSetCards = [[],[],[]];
    p.discardPile = []; p.hasDrawn = false;
    for (let i = 0; i < 8 && room.deck.length; i++) p.hand.push(room.deck.pop());
  }
  if (room.deck.length) room.discardPile.push(room.deck.pop());
  io.to(room.code).emit('game_started', {});
  broadcastGame(room);
  pushAllHands(room);
  scheduleTurn(room);
}

function scheduleTurn(room) {
  if (room.timerTimeout) clearTimeout(room.timerTimeout);
  if (room.phase !== 'playing') return;
  const cur = room.players[room.currentTurn];
  if (!cur) return;
  io.to(room.code).emit('timer_start', { seconds: 30, playerId: cur.id });
  const delay = cur.isBot ? 1200 + Math.random() * 800 : 30000;
  room.timerTimeout = setTimeout(() => {
    if (room.phase !== 'playing') return;
    cur.isBot ? doBotTurn(room, cur) : forceMove(room, cur);
  }, delay);
}

function nextTurn(room) {
  if (room.phase !== 'playing') return;
  room.currentTurn = (room.currentTurn + 1) % room.players.length;
  room.round++;
  room.players[room.currentTurn].hasDrawn = false;
  broadcastGame(room);
  pushAllHands(room);
  scheduleTurn(room);
}

function forceMove(room, player) {
  if (!player.hasDrawn) {
    if (!room.deck.length) reshuffleDeck(room);
    if (room.deck.length) { player.hand.push(room.deck.pop()); player.hasDrawn = true; }
  }
  if (player.hand.length) {
    const card = player.hand.splice(Math.floor(Math.random() * player.hand.length), 1)[0];
    player.discardPile.push(card);
    room.discardPile.push(card);
  }
  if (!player.isBot) io.to(player.id).emit('force_move', {});
  broadcastGame(room);
  nextTurn(room);
}

function reshuffleDeck(room) {
  if (room.discardPile.length <= 1) return;
  const top = room.discardPile.pop();
  room.deck = shuffle(room.discardPile);
  room.discardPile = [top];
  io.to(room.code).emit('deck_reshuffled', {});
}

function tryWin(room, player) {
  if (player.lockedSets < 3) return false;
  if (room.timerTimeout) clearTimeout(room.timerTimeout);
  room.phase = 'ended';
  const gold  = 120 + Math.floor(Math.random() * 80);
  const lucky = Math.random() < 0.7 ? Math.floor(Math.random() * 15) + 5 : 0;
  player.gold  += gold;
  player.lucky += lucky;
  const scores = room.players
    .map(p => ({ id:p.id, name:p.name, avatar:p.avatar, isBot:p.isBot,
                 gold:p.gold, lucky:p.lucky, lockedSets:p.lockedSets }))
    .sort((a,b) => b.lockedSets - a.lockedSets || b.gold - a.gold);
  io.to(room.code).emit('game_over', {
    winner: { id:player.id, name:player.name, avatar:player.avatar },
    goldEarned: gold, luckyEarned: lucky, finalScores: scores,
  });
  return true;
}

// ─────────────────────────────────────────────────────────────
// BOT AI
// ─────────────────────────────────────────────────────────────
function doBotTurn(room, bot) {
  if (room.phase !== 'playing') return;
  if (!room.deck.length) reshuffleDeck(room);
  if (room.deck.length) { bot.hand.push(room.deck.pop()); bot.hasDrawn = true; }
  botTryLock(room, bot);
  if (room.phase !== 'playing') return;
  if (bot.hand.length) {
    const di   = botWorstCard(bot);
    const card = bot.hand.splice(di, 1)[0];
    bot.discardPile.push(card);
    room.discardPile.push(card);
  }
  broadcastGame(room);
  nextTurn(room);
}

function botTryLock(room, bot) {
  if (bot.lockedSets >= 3) return;
  const pool = [...bot.hand];
  const byId = {}, byColor = {};
  pool.forEach(c => {
    (byId[c.id]       = byId[c.id]       || []).push(c);
    (byColor[c.color] = byColor[c.color] || []).push(c);
  });
  const used = new Set();
  const tryGroup = (group) => {
    if (bot.lockedSets >= 3) return;
    const avail = group.filter(c => !used.has(c));
    if (avail.length >= 3 && isValidSet(avail.slice(0,3))) {
      const triple = avail.slice(0,3);
      const slot   = bot.lockedSets;
      bot.lockedSetCards[slot] = triple;
      bot.lockedSets++;
      triple.forEach(c => used.add(c));
      bot.hand = bot.hand.filter(c => !used.has(c));
      broadcastGame(room);
      tryWin(room, bot);
    }
  };
  [...Object.values(byId), ...Object.values(byColor)].forEach(tryGroup);
}

function botWorstCard(bot) {
  const cc = {}, ic = {};
  bot.hand.forEach(c => { cc[c.color]=(cc[c.color]||0)+1; ic[c.id]=(ic[c.id]||0)+1; });
  let worst=0, wScore=Infinity;
  bot.hand.forEach((c,i)=>{
    const s=Math.max(cc[c.color]||0,ic[c.id]||0);
    if(s<wScore){wScore=s;worst=i;}
  });
  return worst;
}

// ─────────────────────────────────────────────────────────────
// LEAVE / DISCONNECT
// ─────────────────────────────────────────────────────────────
function handleLeave(socket) {
  const code = socketRoom[socket.id];
  if (!code || !rooms[code]) return;
  const room = rooms[code];
  const idx  = room.players.findIndex(p => p.id === socket.id);
  if (idx === -1) { delete socketRoom[socket.id]; return; }
  const player = room.players[idx];
  room.players.splice(idx, 1);
  delete socketRoom[socket.id];

  // Announce to remaining players
  io.to(code).emit('player_left', { name: player.name, avatar: player.avatar });

  // Clean up empty room
  if (room.players.filter(p => !p.isBot).length === 0) {
    if (room.timerTimeout) clearTimeout(room.timerTimeout);
    delete rooms[code];
    return;
  }

  // Reassign host if needed
  if (room.hostId === socket.id) {
    const newHost = room.players.find(p => !p.isBot);
    if (newHost) {
      room.hostId = newHost.id;
      io.to(newHost.id).emit('you_are_host', {});
    }
  }

  if (room.phase === 'waiting') {
    broadcastLobby(room);   // ← refresh lobby for everyone
  } else {
    if (room.currentTurn >= room.players.length) room.currentTurn = 0;
    broadcastGame(room);
  }
}

// ─────────────────────────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  // ── HOST ──────────────────────────────────────────────────
  socket.on('host_game', ({ playerName }) => {
    if (!playerName?.trim()) return socket.emit('error', { message: 'Name required' });
    const room = createRoom(socket, playerName.trim());
    socket.emit('room_created', { roomCode: room.code });
    broadcastLobby(room);   // ← send lobby state immediately
    console.log(`[ROOM ${room.code}] Created by ${playerName}`);
  });

  // ── JOIN ──────────────────────────────────────────────────
  socket.on('join_game', ({ playerName, roomCode }) => {
    const code = roomCode?.trim().toUpperCase();
    if (!playerName?.trim()) return socket.emit('error', { message: 'Enter your name' });
    const room = rooms[code];
    if (!room)                    return socket.emit('error', { message: `Room "${code}" not found` });
    if (room.phase !== 'waiting') return socket.emit('error', { message: 'Game already started' });
    if (room.players.filter(p => !p.isBot).length >= 6)
                                  return socket.emit('error', { message: 'Room is full (max 6 humans)' });

    const player = _addHuman(room, socket, playerName.trim());
    socket.emit('room_joined', { roomCode: code });
    broadcastLobby(room);   // ← update EVERYONE's lobby list
    io.to(code).emit('player_joined', { name: player.name, avatar: player.avatar });
    console.log(`[ROOM ${code}] ${playerName} joined`);
  });

  // ── LEAVE WAITING ROOM ────────────────────────────────────
  socket.on('leave_room', () => {
    handleLeave(socket);
    socket.emit('left_room', {});
  });

  // ── BOT CONTROLS (host only) ──────────────────────────────
  socket.on('add_bot', () => {
    const room = rooms[socketRoom[socket.id]];
    if (!room || room.phase !== 'waiting') return;
    if (room.hostId !== socket.id) return socket.emit('error', { message: 'Only host can add bots' });
    if (room.players.length >= 6)  return socket.emit('error', { message: 'Room is full (max 6)' });
    const bot = _addBot(room);
    broadcastLobby(room);   // ← refresh lobby with new bot
    io.to(room.code).emit('player_joined', { name: bot.name, avatar: bot.avatar, isBot: true });
    console.log(`[ROOM ${room.code}] Bot "${bot.name}" added`);
  });

  socket.on('remove_bot', () => {
    const room = rooms[socketRoom[socket.id]];
    if (!room || room.phase !== 'waiting') return;
    if (room.hostId !== socket.id) return socket.emit('error', { message: 'Only host can remove bots' });
    if (_removeLastBot(room)) {
      broadcastLobby(room);   // ← refresh lobby after removal
      console.log(`[ROOM ${room.code}] Bot removed`);
    }
  });

  // ── START GAME ────────────────────────────────────────────
  socket.on('start_game', () => {
    const room = rooms[socketRoom[socket.id]];
    if (!room) return;
    if (room.hostId !== socket.id) return socket.emit('error', { message: 'Only host can start' });
    if (room.players.length < 2)   return socket.emit('error', { message: 'Need at least 2 players — add a bot!' });
    startGame(room);
    console.log(`[ROOM ${room.code}] Game started (${room.players.length} players)`);
  });

  // ── DRAW FROM DECK ────────────────────────────────────────
  socket.on('draw_deck', () => {
    const room   = rooms[socketRoom[socket.id]];
    const player = room && getPlayer(room, socket.id);
    if (!room || room.phase !== 'playing') return;
    if (!player || room.players[room.currentTurn].id !== socket.id || player.hasDrawn) return;
    if (!room.deck.length) reshuffleDeck(room);
    if (!room.deck.length) return socket.emit('error', { message: 'No cards left!' });
    if (room.timerTimeout) clearTimeout(room.timerTimeout);
    const card = room.deck.pop();
    player.hand.push(card);
    player.hasDrawn = true;
    // Restart 30s for discard phase
    room.timerTimeout = setTimeout(() => forceMove(room, player), 30000);
    io.to(room.code).emit('timer_start', { seconds: 30, playerId: player.id });
    socket.emit('card_drawn', { card, source: 'deck' });
    pushHand(room, player);
    broadcastGame(room);
  });

  // ── DRAW FROM DISCARD ─────────────────────────────────────
  socket.on('draw_discard', () => {
    const room   = rooms[socketRoom[socket.id]];
    const player = room && getPlayer(room, socket.id);
    if (!room || room.phase !== 'playing') return;
    if (!player || room.players[room.currentTurn].id !== socket.id || player.hasDrawn) return;
    if (!room.discardPile.length) return socket.emit('error', { message: 'Discard pile is empty' });
    if (room.timerTimeout) clearTimeout(room.timerTimeout);
    const card = room.discardPile.pop();
    player.hand.push(card);
    player.hasDrawn = true;
    room.timerTimeout = setTimeout(() => forceMove(room, player), 30000);
    io.to(room.code).emit('timer_start', { seconds: 30, playerId: player.id });
    socket.emit('card_drawn', { card, source: 'discard' });
    pushHand(room, player);
    broadcastGame(room);
  });

  // ── DISCARD CARD ──────────────────────────────────────────
  socket.on('discard_card', ({ handIndex }) => {
    const room   = rooms[socketRoom[socket.id]];
    const player = room && getPlayer(room, socket.id);
    if (!room || room.phase !== 'playing') return;
    if (!player || room.players[room.currentTurn].id !== socket.id || !player.hasDrawn) return;
    if (handIndex < 0 || handIndex >= player.hand.length) return socket.emit('error', { message: 'Invalid card' });
    if (room.timerTimeout) clearTimeout(room.timerTimeout);
    const card = player.hand.splice(handIndex, 1)[0];
    player.discardPile.push(card);
    room.discardPile.push(card);
    broadcastGame(room);
    nextTurn(room);
  });

  // ── LOCK SET ──────────────────────────────────────────────
  socket.on('lock_set', ({ slotIndex, cards }) => {
    const room   = rooms[socketRoom[socket.id]];
    const player = room && getPlayer(room, socket.id);
    if (!room || room.phase !== 'playing' || !player) return;
    if (slotIndex < 0 || slotIndex > 2)           return socket.emit('error', { message: 'Invalid slot' });
    if (player.lockedSetCards[slotIndex].length)   return socket.emit('error', { message: 'Slot already locked!' });
    if (!cards || cards.length !== 3)              return socket.emit('error', { message: 'Need exactly 3 cards' });
    if (!isValidSet(cards))                        return socket.emit('error', { message: '❌ Not a valid set — 3 identical or 3 same-color' });

    // Verify cards exist in hand
    const copy = [...player.hand];
    for (const c of cards) {
      const i = copy.findIndex(h => h.id === c.id && h.color === c.color);
      if (i === -1) return socket.emit('error', { message: 'Card not in your hand' });
      copy.splice(i, 1);
    }
    player.hand = copy;
    player.lockedSetCards[slotIndex] = cards;
    player.lockedSets++;

    pushHand(room, player);
    socket.emit('set_locked', { slotIndex, cards, lockedSets: player.lockedSets });
    broadcastGame(room);
    tryWin(room, player);
  });

  // ── DISCONNECT ────────────────────────────────────────────
  socket.on('disconnect', () => {
    handleLeave(socket);
    console.log(`[-] ${socket.id}`);
  });
});

// ─────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────
server.listen(PORT, () =>
  console.log(`\n🎮  Console Catch v3  →  http://localhost:${PORT}\n`));
