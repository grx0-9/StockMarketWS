# 🚀 StockFloor — Live Trading Simulator

A real-time multiplayer stock trading game for classrooms. Players join from their phones, trade 8 live tickers, and compete on a live leaderboard.

---

## Quick Start

```bash
# 1. Install dependencies (first time only)
npm install

# 2. Start the server
node server.js

# 3. Open in browser
# Admin:  http://localhost:3000/admin.html
# Client: http://localhost:3000/
```

**For classroom use on a local network:**
```bash
# Find your local IP
# Mac/Linux:
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows:
ipconfig | findstr "IPv4"

# Students open:  http://YOUR_LOCAL_IP:3000/
# Your admin:     http://YOUR_LOCAL_IP:3000/admin.html
```

---

## Files

```
stockfloor/
├── server.js          ← Node.js backend (WebSockets + price engine)
└── public/
    ├── index.html     ← Client (phone-optimized)
    └── admin.html     ← Admin control panel
```

---

## Admin PIN

Default PIN: **1234**

Change it by setting the `ADMIN_PIN` environment variable:
```bash
ADMIN_PIN=9876 node server.js
```

---

## How It Works

### Admin Flow
1. Open `admin.html` → enter PIN
2. Configure: starting cash, duration, volatility, update speed
3. Click **Launch Session**
4. Share your local IP with students

### Player Flow
1. Student opens `http://YOUR_IP:3000` on their phone
2. Enters their name → joins the live session
3. Taps stocks to buy/sell
4. Watches the live leaderboard update in real time
5. Players can join at any point during the 90-minute window

### Game Mechanics
- 8 fictional tickers with randomized price movements
- Prices use a random walk with mean reversion to the base price
- All holdings auto-liquidate when time runs out
- Leaderboard updates on every trade AND every price tick
- Players can rejoin by re-entering their name

---

## Tickers

| Symbol | Company              | Base Price | Sector     |
|--------|----------------------|------------|------------|
| APEX   | Apex Tech Inc.       | $142.50    | Tech       |
| NOVA   | Nova Energy Corp     | $58.20     | Energy     |
| CLIO   | Clio Biomedical      | $89.75     | Health     |
| WRLD   | WorldShip Logistics  | $34.10     | Industrial |
| LUNA   | Luna Aerospace       | $213.40    | Aerospace  |
| REEF   | ReefBank Financial   | $71.90     | Finance    |
| PRISM  | Prism Media Group    | $22.60     | Media      |
| VOLT   | Volt Motors EV       | $167.80    | Auto       |
