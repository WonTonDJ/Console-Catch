/**
 * Console Catch v2 - Multiplayer Game Server
 * Node.js + Socket.io
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ============================================================
// GAME DATA
// ============================================================
const CONSOLE_SETS = {
  beige:  { name: 'Nintendo', cards: [{ id:'snes',name:'SNES',emoji:'🕹️' },{ id:'n64',name:'N64',emoji:'🎮' },{ id:'switch',name:'Switch',emoji:'🔋' }] },
  green:  { name: 'Sony',     cards: [{ id:'ps1',name:'PS1',emoji:'📀' },{ id:'psp',name:'PSP',emoji:'🎯' },{ id:'ps4',name:'PS4',emoji:'🕹️' }] },
  blue:   { name: 'Sega',     cards: [{ id:'saturn',name:'Saturn',emoji:'🪐' },{ id:'dreamcast',name:'Dreamcast',emoji:'💫' },{ id:'gamegear',name:'GameGear',emoji:'💿' }] },
  yellow: { name: 'Xbox',     cards: [{ id:'xbox',name:'XBOX',emoji:'🟩' },{ id:'xbox360',name:'Xbox 360',emoji:'⚙️' },{ id:'xboxone',name:'Xbox One',emoji:'⬛' }] },
  orange: { name: 'Steam',    cards: [{ id:'steamdeck',name:'SteamDeck',emoji:'🎲' },{ id:'steammachine',name:'Steam Mach.',emoji:'🖥️' },{ id:'steamframe',name:'Steam Frame',emoji:'🖼️' }] },
  grey:   { name: 'PC',       cards: [{ id:'keyboard',name:'Keyboard',emoji:'⌨️' },{ id:'mouse',name:'Mouse',emoji:'🖱️' },{ id:'gamingpc',name:'Gaming PC',emoji:'🖥️' }] },
  red:    { name: 'VR',       cards: [{ id:'oculus',name:'Oculus',emoji:'🥽' },{ id:'metaquest',name:'Meta Quest',emoji:'🔮' },{ id:'applevr',name:'Apple VR',emoji:'🍎' }] },
};

const AVATARS = ['🐉','🦊','🐺','🦁','🐯','🦄','🐻','🐼','🦅','🦋'];
const BOT_NAMES = ['RetroBot','PixelBot','NESBot','CassetteBot','DreamBot','ArcadeBot'];
const ROOM_WORDS = ['SNES','SEGA','XBOX','STEAM','PIXEL','SONIC','MARIO','ZELDA','RETRO','ATARI'];

const rooms = {};
const socketToRoom = {};

// ============================================================
// HELPERS
// ============================================================
function buildDeck() {
  const cards = [];
  for (const [color, set] of Object.entries(CONSOLE_SETS)) {
    for (const card of set.cards) {
      for (let i = 0; i < 4; i++) cards.push({ ...card, color, setName: set.name });
    }
  }
  return shuffle(cards);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateRoomCode() {
  let code;
  do { code = ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)] + Math.floor(Math.random() * 89 + 10); }
  while (rooms[code]);
  return code;
}

function isValidSet(cards) {
  if (!cards || cards.length !== 3) return false;
  if (cards.every(c => c.id === cards[0].id)) return true;
  if (cards.every(c => c.color === cards[0].color)) return true;
  return false;
}

function makePlayerPublic(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot || false,
    cardCount: p.hand.length, lockedSets: p.lockedSets,
    gold: p.gold, lucky: p.lucky, discardPile: p.discardPile,
  };
}

function getRoomPublicState(room) {
  return {
    roomCode: room.code, phase: room.phase, hostId: room.hostId,
    currentTurn: room.currentTurn, round: room.round,
    deckCount: room.deck.length,
    topDiscard: room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null,
    players: room.players.map(makePlayerPublic),
  };
}

// ============================================================
// ROOM MANAGEMENT
// ============================================================
function makePlayer(id, name, avatar, isBot) {
  return {
    id, name, avatar, isBot: isBot || false,
    hand: [], sets: [[], [], []],
    lockedSets: 0, lockedSetCards: [[], [], []],
    discardPile: [], gold: 0, lucky: 0, hasDrawn: false,
  };
}

function createRoom(socket, playerName) {
  const code = generateRoomCode();
  const room = {
    code, phase: 'waiting', hostId: socket.id,
    players: [], deck: [], discardPile: [],
    currentTurn: 0, round: 1, timerTimeout: null,
  };
  rooms[code] = room;
  const player = makePlayer(socket.id, playerName, AVATARS[0], false);
  room.players.push(player);
  socketToRoom[socket.id] = code;
  socket.join(code);
  return room;
}

function joinRoom(socket, room, playerName) {
  const avatar = AVATARS[room.players.length % AVATARS.length];
  const player = makePlayer(socket.id, playerName, avatar, false);
  room.players.push(player);
  socketToRoom[socket.id] = room.code;
  socket.join(room.code);
  return player;
}

function addBot(room) {
  const used = new Set(room.players.map(p => p.name));
  const name = BOT_NAMES.find(n => !used.has(n)) || `Bot${room.players.length}`;
  const avatar = AVATARS[room.players.length % AVATARS.length];
  const bot = makePlayer(`bot_${Date.now()}`, name, avatar, true);
  room.players.push(bot);
  return bot;
}

function removeBot(room) {
  for (let i = room.players.length - 1; i >= 0; i--) {
    if (room.players[i].isBot) { room.players.splice(i, 1); return true; }
  }
  return false;
}

function getPlayer(room, id) { return room.players.find(p => p.id === id); }

// ============================================================
// GAME LOGIC
// ============================================================
function startGame(room) {
  room.phase = 'playing';
  room.deck = buildDeck();
  room.discardPile = [];
  room.currentTurn = 0;
  room.round = 1;
  for (const p of room.players) {
    p.hand = []; p.sets = [[], [], []];
    p.lockedSets = 0; p.lockedSetCards = [[], [], []];
    p.discardPile = []; p.hasDrawn = false;
    for (let i = 0; i < 8; i++) { if (room.deck.length > 0) p.hand.push(room.deck.pop()); }
  }
  if (room.deck.length > 0) room.discardPile.push(room.deck.pop());
  broadcastState(room);
  pushHands(room);
  io.to(room.code).emit('game_started', {});
  scheduleTurn(room);
}

function broadcastState(room) {
  io.to(room.code).emit('game_state', getRoomPublicState(room));
}

function pushHands(room) {
  room.players.forEach(p => {
    if (!p.isBot) {
      io.to(p.id).emit('your_hand', {
        hand: p.hand, sets: p.sets,
        lockedSets: p.lockedSets, lockedSetCards: p.lockedSetCards,
        hasDrawn: p.hasDrawn,
      });
    }
  });
}

function scheduleTurn(room) {
  if (room.timerTimeout) clearTimeout(room.timerTimeout);
  const cur = room.players[room.currentTurn];
  if (!cur || room.phase !== 'playing') return;
  io.to(room.code).emit('timer_start', { seconds: 30, playerId: cur.id });
  const delay = cur.isBot ? (1500 + Math.random() * 1000) : 30000;
  room.timerTimeout = setTimeout(() => {
    if (room.phase !== 'playing') return;
    if (cur.isBot) doBotTurn(room, cur);
    else forceMove(room, cur);
  }, delay);
}

function nextTurn(room) {
  if (room.phase !== 'playing') return;
  room.currentTurn = (room.currentTurn + 1) % room.players.length;
  room.round++;
  room.players[room.currentTurn].hasDrawn = false;
  broadcastState(room);
  pushHands(room);
  scheduleTurn(room);
}

function forceMove(room, player) {
  if (!player.hasDrawn) {
    if (room.deck.length === 0) reshuffleDeck(room);
    if (room.deck.length > 0) { player.hand.push(room.deck.pop()); player.hasDrawn = true; }
  }
  if (player.hand.length > 0) {
    const card = player.hand.splice(Math.floor(Math.random() * player.hand.length), 1)[0];
    player.discardPile.push(card); room.discardPile.push(card);
  }
  if (!player.isBot) io.to(player.id).emit('force_move', {});
  broadcastState(room);
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
  if (player.lockedSets >= 3) {
    if (room.timerTimeout) clearTimeout(room.timerTimeout);
    room.phase = 'ended';
    const gold = 120 + Math.floor(Math.random() * 80);
    const lucky = Math.random() < 0.7 ? Math.floor(Math.random() * 15) + 5 : 0;
    player.gold += gold; player.lucky += lucky;
    const scores = room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot,
      gold: p.gold, lucky: p.lucky, lockedSets: p.lockedSets,
    })).sort((a, b) => b.lockedSets - a.lockedSets || b.gold - a.gold);
    io.to(room.code).emit('game_over', {
      winner: { id: player.id, name: player.name, avatar: player.avatar },
      goldEarned: gold, luckyEarned: lucky, finalScores: scores,
    });
    return true;
  }
  return false;
}

// ============================================================
// BOT AI
// ============================================================
function doBotTurn(room, bot) {
  if (room.phase !== 'playing') return;
  // Draw
  if (room.deck.length === 0) reshuffleDeck(room);
  if (room.deck.length > 0) { bot.hand.push(room.deck.pop()); bot.hasDrawn = true; }

  // Attempt to lock sets
  botTryLockSets(room, bot);
  if (room.phase !== 'playing') return;

  // Discard
  if (bot.hand.length > 0) {
    const di = botPickDiscard(bot);
    const card = bot.hand.splice(di, 1)[0];
    bot.discardPile.push(card); room.discardPile.push(card);
  }
  broadcastState(room);
  nextTurn(room);
}

function botTryLockSets(room, bot) {
  if (bot.lockedSets >= 3) return;
  const allCards = [...bot.hand];
  const byId = {}, byColor = {};
  allCards.forEach(c => {
    if (!byId[c.id]) byId[c.id] = [];    byId[c.id].push(c);
    if (!byColor[c.color]) byColor[c.color] = []; byColor[c.color].push(c);
  });
  const used = new Set();

  const tryLock = (candidates) => {
    if (bot.lockedSets >= 3) return;
    const avail = candidates.filter(c => !used.has(c));
    if (avail.length >= 3 && isValidSet(avail.slice(0,3))) {
      const triple = avail.slice(0,3);
      const slot = bot.lockedSets;
      bot.lockedSetCards[slot] = triple;
      bot.lockedSets++;
      triple.forEach(c => used.add(c));
      bot.hand = bot.hand.filter(c => !used.has(c));
      broadcastState(room);
      if (tryWin(room, bot)) return;
    }
  };
  for (const cards of Object.values(byId)) tryLock(cards);
  for (const cards of Object.values(byColor)) tryLock(cards);
}

function botPickDiscard(bot) {
  const colorCount = {}, idCount = {};
  bot.hand.forEach(c => { colorCount[c.color]=(colorCount[c.color]||0)+1; idCount[c.id]=(idCount[c.id]||0)+1; });
  let worst = 0, worstScore = Infinity;
  bot.hand.forEach((c, i) => {
    const s = Math.max(colorCount[c.color]||0, idCount[c.id]||0);
    if (s < worstScore) { worstScore = s; worst = i; }
  });
  return worst;
}

// ============================================================
// SOCKET EVENTS
// ============================================================
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  socket.on('host_game', ({ playerName }) => {
    if (!playerName?.trim()) return socket.emit('error', { message: 'Name required' });
    const room = createRoom(socket, playerName.trim());
    socket.emit('room_created', { roomCode: room.code });
    broadcastState(room);
  });

  socket.on('join_game', ({ playerName, roomCode }) => {
    const code = roomCode?.trim().toUpperCase();
    if (!playerName?.trim()) return socket.emit('error', { message: 'Name required' });
    const room = rooms[code];
    if (!room) return socket.emit('error', { message: `Room "${code}" not found` });
    if (room.phase !== 'waiting') return socket.emit('error', { message: 'Game already started' });
    if (room.players.filter(p => !p.isBot).length >= 6) return socket.emit('error', { message: 'Room is full (max 6)' });
    const player = joinRoom(socket, room, playerName.trim());
    socket.emit('room_joined', { roomCode: code });
    broadcastState(room);
    io.to(room.code).emit('player_joined', { name: player.name, avatar: player.avatar });
  });

  socket.on('leave_room', () => { handleLeave(socket); socket.emit('left_room', {}); });

  socket.on('add_bot', () => {
    const room = rooms[socketToRoom[socket.id]];
    if (!room || room.phase !== 'waiting' || room.hostId !== socket.id) return;
    if (room.players.length >= 6) return socket.emit('error', { message: 'Room is full' });
    const bot = addBot(room);
    broadcastState(room);
    io.to(room.code).emit('player_joined', { name: bot.name, avatar: bot.avatar, isBot: true });
  });

  socket.on('remove_bot', () => {
    const room = rooms[socketToRoom[socket.id]];
    if (!room || room.phase !== 'waiting' || room.hostId !== socket.id) return;
    if (removeBot(room)) broadcastState(room);
  });

  socket.on('start_game', () => {
    const room = rooms[socketToRoom[socket.id]];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error', { message: 'Need at least 2 players — add a bot!' });
    startGame(room);
  });

  socket.on('draw_deck', () => {
    const room = rooms[socketToRoom[socket.id]];
    if (!room || room.phase !== 'playing') return;
    const player = getPlayer(room, socket.id);
    if (!player || room.players[room.currentTurn].id !== socket.id || player.hasDrawn) return;
    if (room.deck.length === 0) reshuffleDeck(room);
    if (room.deck.length === 0) return socket.emit('error', { message: 'No cards left!' });
    if (room.timerTimeout) clearTimeout(room.timerTimeout);
    const card = room.deck.pop(); player.hand.push(card); player.hasDrawn = true;
    // Reset timer for discard phase
    room.timerTimeout = setTimeout(() => forceMove(room, player), 30000);
    io.to(room.code).emit('timer_start', { seconds: 30, playerId: player.id });
    socket.emit('card_drawn', { card, source: 'deck' });
    socket.emit('your_hand', { hand: player.hand, sets: player.sets, lockedSets: player.lockedSets, lockedSetCards: player.lockedSetCards, hasDrawn: true });
    broadcastState(room);
  });

  socket.on('draw_discard', () => {
    const room = rooms[socketToRoom[socket.id]];
    if (!room || room.phase !== 'playing') return;
    const player = getPlayer(room, socket.id);
    if (!player || room.players[room.currentTurn].id !== socket.id || player.hasDrawn) return;
    if (room.discardPile.length === 0) return socket.emit('error', { message: 'Discard pile empty' });
    if (room.timerTimeout) clearTimeout(room.timerTimeout);
    const card = room.discardPile.pop(); player.hand.push(card); player.hasDrawn = true;
    room.timerTimeout = setTimeout(() => forceMove(room, player), 30000);
    io.to(room.code).emit('timer_start', { seconds: 30, playerId: player.id });
    socket.emit('card_drawn', { card, source: 'discard' });
    socket.emit('your_hand', { hand: player.hand, sets: player.sets, lockedSets: player.lockedSets, lockedSetCards: player.lockedSetCards, hasDrawn: true });
    broadcastState(room);
  });

  socket.on('discard_card', ({ handIndex }) => {
    const room = rooms[socketToRoom[socket.id]];
    if (!room || room.phase !== 'playing') return;
    const player = getPlayer(room, socket.id);
    if (!player || room.players[room.currentTurn].id !== socket.id || !player.hasDrawn) return;
    if (handIndex < 0 || handIndex >= player.hand.length) return socket.emit('error', { message: 'Invalid card' });
    if (room.timerTimeout) clearTimeout(room.timerTimeout);
    const card = player.hand.splice(handIndex, 1)[0];
    player.discardPile.push(card); room.discardPile.push(card);
    broadcastState(room);
    nextTurn(room);
  });

  // Lock a verified set into a slot
  socket.on('lock_set', ({ slotIndex, cards }) => {
    const room = rooms[socketToRoom[socket.id]];
    if (!room || room.phase !== 'playing') return;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    if (slotIndex < 0 || slotIndex > 2) return socket.emit('error', { message: 'Invalid slot' });
    if (player.lockedSetCards[slotIndex].length > 0) return socket.emit('error', { message: 'Slot already locked!' });
    if (!cards || cards.length !== 3) return socket.emit('error', { message: 'Select exactly 3 cards' });
    if (!isValidSet(cards)) return socket.emit('error', { message: '❌ Not a valid set! Need 3 identical or 3 same-color.' });

    // Verify cards are in player hand
    const handCopy = [...player.hand];
    for (const c of cards) {
      const idx = handCopy.findIndex(h => h.id === c.id && h.color === c.color);
      if (idx === -1) return socket.emit('error', { message: 'Card not found in your hand' });
      handCopy.splice(idx, 1);
    }
    player.hand = handCopy;
    player.lockedSetCards[slotIndex] = cards;
    player.lockedSets++;

    socket.emit('your_hand', { hand: player.hand, sets: player.sets, lockedSets: player.lockedSets, lockedSetCards: player.lockedSetCards, hasDrawn: player.hasDrawn });
    socket.emit('set_locked', { slotIndex, cards, lockedSets: player.lockedSets });
    broadcastState(room);
    tryWin(room, player);
  });

  socket.on('disconnect', () => { handleLeave(socket); console.log(`[-] ${socket.id}`); });
});

function handleLeave(socket) {
  const code = socketToRoom[socket.id];
  if (!code || !rooms[code]) return;
  const room = rooms[code];
  const idx = room.players.findIndex(p => p.id === socket.id);
  if (idx === -1) { delete socketToRoom[socket.id]; return; }
  const player = room.players[idx];
  io.to(code).emit('player_left', { name: player.name, avatar: player.avatar });
  room.players.splice(idx, 1);
  delete socketToRoom[socket.id];

  if (room.players.filter(p => !p.isBot).length === 0) {
    if (room.timerTimeout) clearTimeout(room.timerTimeout);
    delete rooms[code]; return;
  }
  if (room.hostId === socket.id) {
    const newHost = room.players.find(p => !p.isBot);
    if (newHost) { room.hostId = newHost.id; io.to(newHost.id).emit('you_are_host', {}); }
  }
  if (room.phase === 'playing') {
    if (room.currentTurn >= room.players.length) room.currentTurn = 0;
  }
  broadcastState(room);
}

server.listen(PORT, () => console.log(`\n🎮 Console Catch v2 at http://localhost:${PORT}\n`));
