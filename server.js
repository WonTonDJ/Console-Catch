/**
 * Console Catch - Multiplayer Game Server
 * Node.js + Socket.io WebSocket Server
 *
 * INSTALL & RUN:
 *   npm install express socket.io
 *   node server.js
 *
 * Then open http://localhost:3000 in your browser.
 * Share your local IP (e.g. http://192.168.1.x:3000) with friends on the same WiFi.
 * For internet play, deploy to Railway, Render, or Fly.io (see README).
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ============================================================
// GAME DATA
// ============================================================
const CONSOLE_SETS = {
  beige: { name: 'Nintendo', emoji: '🕹️', cards: [
    { id: 'snes', name: 'SNES', emoji: '🕹️' },
    { id: 'n64', name: 'N64', emoji: '🎮' },
    { id: 'switch', name: 'Switch', emoji: '🔋' },
  ]},
  green: { name: 'Sony', emoji: '📀', cards: [
    { id: 'ps1', name: 'PS1', emoji: '📀' },
    { id: 'psp', name: 'PSP', emoji: '🎯' },
    { id: 'ps4', name: 'PS4', emoji: '🕹️' },
  ]},
  blue: { name: 'Sega', emoji: '💿', cards: [
    { id: 'saturn', name: 'Saturn', emoji: '🪐' },
    { id: 'dreamcast', name: 'Dreamcast', emoji: '💫' },
    { id: 'gamegear', name: 'GameGear', emoji: '💿' },
  ]},
  yellow: { name: 'Xbox', emoji: '🟩', cards: [
    { id: 'xbox', name: 'XBOX', emoji: '🟩' },
    { id: 'xbox360', name: 'Xbox 360', emoji: '⚙️' },
    { id: 'xboxone', name: 'Xbox One', emoji: '⬛' },
  ]},
  orange: { name: 'Steam', emoji: '🎲', cards: [
    { id: 'steamdeck', name: 'SteamDeck', emoji: '🎲' },
    { id: 'steammachine', name: 'Steam Mach.', emoji: '🖥️' },
    { id: 'steamframe', name: 'Steam Frame', emoji: '🖼️' },
  ]},
  grey: { name: 'PC', emoji: '⌨️', cards: [
    { id: 'keyboard', name: 'Keyboard', emoji: '⌨️' },
    { id: 'mouse', name: 'Mouse', emoji: '🖱️' },
    { id: 'gamingpc', name: 'Gaming PC', emoji: '🖥️' },
  ]},
  red: { name: 'VR', emoji: '🥽', cards: [
    { id: 'oculus', name: 'Oculus', emoji: '🥽' },
    { id: 'metaquest', name: 'Meta Quest', emoji: '🔮' },
    { id: 'applevr', name: 'Apple VR', emoji: '🍎' },
  ]},
};

const AVATARS = ['🐉','🦊','🐺','🦁','🐯','🦄','🐻','🐼','🦅','🦋'];
const ROOM_CODE_WORDS = ['SNES','PS1','SEGA','XBOX','STEAM','N64','PIXEL','SONIC','MARIO','ZELDA','RETRO','ATARI'];

// In-memory game rooms
const rooms = {}; // roomCode -> Room
const socketToRoom = {}; // socketId -> roomCode

// ============================================================
// HELPERS
// ============================================================
function buildDeck() {
  let cards = [];
  for (const [color, set] of Object.entries(CONSOLE_SETS)) {
    for (const card of set.cards) {
      for (let i = 0; i < 4; i++) {
        cards.push({ ...card, color, setName: set.name });
      }
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
  do {
    code = ROOM_CODE_WORDS[Math.floor(Math.random() * ROOM_CODE_WORDS.length)]
         + Math.floor(Math.random() * 100);
  } while (rooms[code]);
  return code;
}

function isValidSet(cards) {
  if (cards.length !== 3) return false;
  if (cards.every(c => c.id === cards[0].id)) return true;
  if (cards.every(c => c.color === cards[0].color)) return true;
  return false;
}

function getRoomPublicState(room) {
  return {
    roomCode: room.code,
    phase: room.phase,
    currentTurn: room.currentTurn,
    round: room.round,
    deckCount: room.deck.length,
    topDiscard: room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      cardCount: p.hand.length,
      setsComplete: p.sets.filter(s => s.length === 3 && isValidSet(s)).length,
      gold: p.gold,
      lucky: p.lucky,
      // Only send discard pile (visible to others via Q)
      discardPile: p.discardPile,
    })),
  };
}

// ============================================================
// ROOM MANAGEMENT
// ============================================================
function createRoom(hostSocket, playerName) {
  const code = generateRoomCode();
  const room = {
    code,
    phase: 'waiting',
    hostId: hostSocket.id,
    players: [],
    deck: [],
    discardPile: [],
    currentTurn: 0,
    round: 1,
    timerTimeout: null,
  };
  rooms[code] = room;
  addPlayerToRoom(room, hostSocket, playerName);
  return room;
}

function addPlayerToRoom(room, socket, playerName) {
  const player = {
    id: socket.id,
    name: playerName,
    avatar: AVATARS[room.players.length % AVATARS.length],
    hand: [],
    sets: [[], [], []],
    discardPile: [],
    gold: 0,
    lucky: 0,
    hasDrawn: false,
  };
  room.players.push(player);
  socketToRoom[socket.id] = room.code;
  socket.join(room.code);
  return player;
}

function getPlayer(room, socketId) {
  return room.players.find(p => p.id === socketId);
}

// ============================================================
// GAME LOGIC
// ============================================================
function startGameInRoom(room) {
  room.phase = 'playing';
  room.deck = buildDeck();
  room.discardPile = [];
  room.currentTurn = 0;
  room.round = 1;

  // Deal 8 cards to each player
  for (const player of room.players) {
    player.hand = [];
    player.sets = [[], [], []];
    player.discardPile = [];
    player.hasDrawn = false;
    for (let i = 0; i < 8; i++) {
      if (room.deck.length > 0) player.hand.push(room.deck.pop());
    }
  }

  // First discard
  if (room.deck.length > 0) room.discardPile.push(room.deck.pop());

  // Send each player their private hand + public state
  broadcastGameState(room);
  room.players.forEach(p => {
    io.to(p.id).emit('your_hand', {
      hand: p.hand,
      sets: p.sets,
      hasDrawn: p.hasDrawn,
    });
  });

  io.to(room.code).emit('game_started', { message: '🎮 Game has started!' });
  startTurnTimer(room);
}

function broadcastGameState(room) {
  io.to(room.code).emit('game_state', getRoomPublicState(room));
}

function startTurnTimer(room) {
  if (room.timerTimeout) clearTimeout(room.timerTimeout);
  const currentPlayer = room.players[room.currentTurn];
  if (!currentPlayer) return;

  io.to(room.code).emit('timer_start', { seconds: 30, playerId: currentPlayer.id });

  room.timerTimeout = setTimeout(() => {
    console.log(`[${room.code}] Timer expired for ${currentPlayer.name}`);
    forceMove(room, currentPlayer);
  }, 30000);
}

function forceMove(room, player) {
  // Force draw if not drawn
  if (!player.hasDrawn) {
    if (room.deck.length > 0) {
      player.hand.push(room.deck.pop());
    } else if (room.discardPile.length > 1) {
      reshuffleDeck(room);
      if (room.deck.length > 0) player.hand.push(room.deck.pop());
    }
    player.hasDrawn = true;
  }

  // Force discard random card
  if (player.hand.length > 0) {
    const idx = Math.floor(Math.random() * player.hand.length);
    const card = player.hand.splice(idx, 1)[0];
    player.discardPile.push(card);
    room.discardPile.push(card);
  }

  io.to(player.id).emit('force_move', { message: '⏰ Time expired! Auto-move made.' });
  advanceTurn(room);
}

function reshuffleDeck(room) {
  if (room.discardPile.length <= 1) return;
  const top = room.discardPile.pop();
  room.deck = shuffle(room.discardPile);
  room.discardPile = [top];
  io.to(room.code).emit('deck_reshuffled', {});
}

function advanceTurn(room) {
  room.currentTurn = (room.currentTurn + 1) % room.players.length;
  room.round++;

  const nextPlayer = room.players[room.currentTurn];
  nextPlayer.hasDrawn = false;

  broadcastGameState(room);
  room.players.forEach(p => {
    io.to(p.id).emit('your_hand', {
      hand: p.hand,
      sets: p.sets,
      hasDrawn: p.hasDrawn,
    });
  });

  startTurnTimer(room);
}

function checkWinCondition(room, player) {
  const completeSets = player.sets.filter(s => s.length === 3 && isValidSet(s));
  if (completeSets.length >= 3 && player.hand.length === 0) {
    return true;
  }
  return false;
}

function triggerWin(room, winner) {
  if (room.timerTimeout) clearTimeout(room.timerTimeout);
  room.phase = 'ended';

  const goldEarned = 120 + Math.floor(Math.random() * 80);
  const luckyEarned = Math.random() < 0.7 ? Math.floor(Math.random() * 15) + 5 : 0;

  winner.gold += goldEarned;
  winner.lucky += luckyEarned;

  const finalScores = room.players.map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    gold: p.gold,
    lucky: p.lucky,
    setsComplete: p.sets.filter(s => isValidSet(s)).length,
  })).sort((a, b) => b.gold - a.gold);

  io.to(room.code).emit('game_over', {
    winner: {
      id: winner.id,
      name: winner.name,
      avatar: winner.avatar,
    },
    goldEarned,
    luckyEarned,
    finalScores,
  });
}

// ============================================================
// SOCKET EVENTS
// ============================================================
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // HOST
  socket.on('host_game', ({ playerName }) => {
    if (!playerName?.trim()) return socket.emit('error', { message: 'Name required' });
    const room = createRoom(socket, playerName.trim());
    socket.emit('room_created', {
      roomCode: room.code,
      player: getPlayer(room, socket.id),
    });
    broadcastGameState(room);
    console.log(`[${room.code}] Hosted by ${playerName}`);
  });

  // JOIN
  socket.on('join_game', ({ playerName, roomCode }) => {
    const code = roomCode?.trim().toUpperCase();
    if (!playerName?.trim()) return socket.emit('error', { message: 'Name required' });
    const room = rooms[code];
    if (!room) return socket.emit('error', { message: `Room "${code}" not found` });
    if (room.phase !== 'waiting') return socket.emit('error', { message: 'Game already in progress' });
    if (room.players.length >= 6) return socket.emit('error', { message: 'Room is full (max 6)' });

    addPlayerToRoom(room, socket, playerName.trim());
    const player = getPlayer(room, socket.id);
    socket.emit('room_joined', { roomCode: code, player });
    broadcastGameState(room);
    io.to(room.code).emit('player_joined', { name: playerName.trim(), avatar: player.avatar });
    console.log(`[${code}] ${playerName} joined`);
  });

  // START GAME
  socket.on('start_game', () => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];
    if (!room) return;
    if (room.hostId !== socket.id) return socket.emit('error', { message: 'Only host can start' });
    if (room.players.length < 2) return socket.emit('error', { message: 'Need at least 2 players' });
    startGameInRoom(room);
    console.log(`[${roomCode}] Game started with ${room.players.length} players`);
  });

  // DRAW FROM DECK
  socket.on('draw_deck', () => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];
    if (!room || room.phase !== 'playing') return;
    const player = getPlayer(room, socket.id);
    if (!player || room.players[room.currentTurn].id !== socket.id) return;
    if (player.hasDrawn) return socket.emit('error', { message: 'Already drew this turn' });

    if (room.deck.length === 0) reshuffleDeck(room);
    if (room.deck.length === 0) return socket.emit('error', { message: 'No cards left!' });

    const card = room.deck.pop();
    player.hand.push(card);
    player.hasDrawn = true;

    socket.emit('card_drawn', { card, source: 'deck' });
    socket.emit('your_hand', { hand: player.hand, sets: player.sets, hasDrawn: true });
    broadcastGameState(room);
  });

  // DRAW FROM DISCARD
  socket.on('draw_discard', () => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];
    if (!room || room.phase !== 'playing') return;
    const player = getPlayer(room, socket.id);
    if (!player || room.players[room.currentTurn].id !== socket.id) return;
    if (player.hasDrawn) return socket.emit('error', { message: 'Already drew this turn' });
    if (room.discardPile.length === 0) return socket.emit('error', { message: 'Discard pile empty' });

    const card = room.discardPile.pop();
    player.hand.push(card);
    player.hasDrawn = true;

    socket.emit('card_drawn', { card, source: 'discard' });
    socket.emit('your_hand', { hand: player.hand, sets: player.sets, hasDrawn: true });
    broadcastGameState(room);
  });

  // DISCARD CARD
  socket.on('discard_card', ({ handIndex }) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];
    if (!room || room.phase !== 'playing') return;
    const player = getPlayer(room, socket.id);
    if (!player || room.players[room.currentTurn].id !== socket.id) return;
    if (!player.hasDrawn) return socket.emit('error', { message: 'Draw a card first' });
    if (handIndex < 0 || handIndex >= player.hand.length) return socket.emit('error', { message: 'Invalid card' });

    if (room.timerTimeout) clearTimeout(room.timerTimeout);

    const card = player.hand.splice(handIndex, 1)[0];
    player.discardPile.push(card);
    room.discardPile.push(card);

    // Check win
    if (checkWinCondition(room, player)) {
      broadcastGameState(room);
      triggerWin(room, player);
      return;
    }

    advanceTurn(room);
  });

  // UPDATE SETS (player arranges their sets locally and syncs)
  socket.on('update_sets', ({ sets, hand }) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];
    if (!room || room.phase !== 'playing') return;
    const player = getPlayer(room, socket.id);
    if (!player) return;

    // Validate: total cards must match
    const totalNew = sets.flat().length + hand.length;
    const totalOld = player.sets.flat().length + player.hand.length;
    if (totalNew !== totalOld) return; // prevent cheating

    player.sets = sets;
    player.hand = hand;
    socket.emit('your_hand', { hand: player.hand, sets: player.sets, hasDrawn: player.hasDrawn });
    broadcastGameState(room);
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    const roomCode = socketToRoom[socket.id];
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      const playerIdx = room.players.findIndex(p => p.id === socket.id);
      const player = room.players[playerIdx];

      if (player) {
        console.log(`[${roomCode}] ${player.name} disconnected`);
        io.to(roomCode).emit('player_left', { name: player.name, avatar: player.avatar });
        room.players.splice(playerIdx, 1);
      }

      if (room.players.length === 0) {
        if (room.timerTimeout) clearTimeout(room.timerTimeout);
        delete rooms[roomCode];
        console.log(`[${roomCode}] Room deleted (empty)`);
      } else {
        // If host left, assign new host
        if (room.hostId === socket.id) {
          room.hostId = room.players[0].id;
          io.to(room.hostId).emit('you_are_host', {});
        }
        // Fix turn index if needed
        if (room.phase === 'playing') {
          if (room.currentTurn >= room.players.length) {
            room.currentTurn = 0;
          }
          broadcastGameState(room);
        } else {
          broadcastGameState(room);
        }
      }
    }
    delete socketToRoom[socket.id];
    console.log(`[-] Disconnected: ${socket.id}`);
  });
});

// ============================================================
// START
// ============================================================
server.listen(PORT, () => {
  console.log(`\n🎮 Console Catch Server running at http://localhost:${PORT}`);
  console.log(`📱 Share with friends on same WiFi: http://<YOUR_IP>:${PORT}`);
  console.log(`🌍 For internet play, see README.md\n`);
});
