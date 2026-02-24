# 🎮 Console Catch — Multiplayer Game Server

Real-time multiplayer card game built with **Node.js + Socket.io**.  
4–6 players, collect 3 sets of 3 console cards to win!

---

## 🚀 Quick Start (Local / Same WiFi)

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
npm start
```

### 3. Open in browser
```
http://localhost:3000
```

### 4. Invite friends on the same WiFi
Find your local IP address:
- **Mac/Linux:** `ifconfig | grep "inet "` or `ip a`
- **Windows:** `ipconfig` → look for IPv4 Address

Share: `http://192.168.1.XXX:3000` ← replace with your IP

---

## 🌍 Deploy for Internet Play (Friends Anywhere)

### Option A: Railway (Recommended — Free tier)
1. Create account at [railway.app](https://railway.app)
2. Click **"New Project" → "Deploy from GitHub Repo"**
3. Push this folder to a GitHub repo, connect it
4. Railway auto-detects Node.js and deploys!
5. Get a public URL like `https://console-catch-production.up.railway.app`

### Option B: Render (Free tier)
1. Create account at [render.com](https://render.com)
2. **New → Web Service → Connect GitHub repo**
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Done! You get a `.onrender.com` URL

### Option C: Fly.io
```bash
npm install -g flyctl
fly auth login
fly launch
fly deploy
```

### Option D: Heroku
```bash
heroku create your-console-catch
git push heroku main
```

---

## 📁 File Structure

```
console-catch/
├── server.js          ← Node.js + Socket.io game server
├── package.json       ← Dependencies
├── README.md          ← This file
└── public/
    └── index.html     ← Frontend game (served by Express)
```

---

## 🎮 How to Play

1. **Host** enters their name → clicks **HOST A GAME** → gets a room code
2. **Friends** enter their name + the room code → click **JOIN GAME**
3. Host clicks **▶ START GAME** when everyone is in (2–6 players)
4. Each player draws/discards cards on their turn (30 second limit)
5. Use **✨ Auto Arrange** to group your cards into sets
6. First to complete **3 sets of 3** and discard wins!

### Sets
- **3 identical cards** (e.g. 3× N64) ✅
- **3 same-color cards** (e.g. 3 Beige/Nintendo cards) ✅

### Console Families
| Color | Brand | Cards |
|-------|-------|-------|
| 🟤 Beige | Nintendo | SNES, N64, Switch |
| 🟢 Green | Sony | PS1, PSP, PS4 |
| 🔵 Blue | Sega | Saturn, Dreamcast, GameGear |
| 🟡 Yellow | Xbox | XBOX, Xbox 360, Xbox One |
| 🟠 Orange | Steam | SteamDeck, Steam Machine, Steam Frame |
| ⚪ Grey | PC | Keyboard, Mouse, Gaming PC |
| 🔴 Red | VR | Oculus, Meta Quest, Apple VR |

---

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla HTML/CSS/JS (no build step needed)
- **Real-time:** WebSocket via Socket.io
