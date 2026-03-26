const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────
const STOCKS = [
  { symbol: 'APEX',  name: 'Apex Tech Inc.',       base: 142.50, sector: 'Tech' },
  { symbol: 'NOVA',  name: 'Nova Energy Corp',      base: 58.20,  sector: 'Energy' },
  { symbol: 'CLIO',  name: 'Clio Biomedical',       base: 89.75,  sector: 'Health' },
  { symbol: 'WRLD',  name: 'WorldShip Logistics',   base: 34.10,  sector: 'Industrial' },
  { symbol: 'LUNA',  name: 'Luna Aerospace',         base: 213.40, sector: 'Aerospace' },
  { symbol: 'REEF',  name: 'ReefBank Financial',     base: 71.90,  sector: 'Finance' },
  { symbol: 'PRISM', name: 'Prism Media Group',      base: 22.60,  sector: 'Media' },
  { symbol: 'VOLT',  name: 'Volt Motors EV',         base: 167.80, sector: 'Auto' },
];

const NEWS_TEMPLATES = [
  s => `${s} Q3 earnings beat analyst expectations by 12%`,
  s => `${s} announces major partnership deal`,
  s => `${s} faces regulatory scrutiny — shares volatile`,
  s => `${s} CEO steps down — board appoints interim leader`,
  s => `${s} expands into Asian markets, bullish outlook`,
  s => `Analysts upgrade ${s} to "Strong Buy"`,
  s => `${s} misses revenue targets for second quarter`,
  s => `${s} stock hits 52-week high amid market rally`,
  s => `Breaking: ${s} announces $2B share buyback program`,
  s => `${s} faces supply chain disruptions — guidance lowered`,
  s => `${s} patents new technology, shares surge`,
  s => `${s} reports record user growth`,
];

let state = {
  session: null,   // null = not started, 'running' = active, 'ended' = over
  config: {
    startCash: 10000,
    roundDuration: 90 * 60, // 90 minutes in seconds
    volatility: 3,
    priceUpdateSec: 4,
  },
  tickers: [],
  players: {},     // playerId -> player object
  leaderboard: [], // sorted by total value, updated on every trade/price tick
  news: [],
  timeLeft: 0,
  startedAt: null,
};

function initTickers() {
  state.tickers = STOCKS.map(s => ({
    ...s,
    price: s.base,
    prevPrice: s.base,
    history: Array(20).fill(s.base),
    change: 0,
    changePct: 0,
  }));
}

function makePlayer(name) {
  return {
    id: Date.now() + Math.random().toString(36).slice(2),
    name,
    cash: state.config.startCash,
    startCash: state.config.startCash,
    holdings: {},   // symbol -> qty
    joinedAt: Date.now(),
    trades: 0,
  };
}

// ─────────────────────────────────────────────
// PRICE ENGINE
// ─────────────────────────────────────────────
let priceTimer = null;
let gameTimer = null;

function updatePrices() {
  const vol = state.config.volatility;
  state.tickers.forEach(t => {
    t.prevPrice = t.price;
    const drift = (t.base - t.price) * 0.008;
    const shock = (Math.random() - 0.5) * 2 * vol * (t.price * 0.018);
    t.price = Math.max(0.50, t.price + drift + shock);
    t.change = t.price - t.prevPrice;
    t.changePct = (t.change / t.prevPrice) * 100;
    t.history.push(parseFloat(t.price.toFixed(2)));
    if (t.history.length > 40) t.history.shift();
  });

  // Random news burst
  if (Math.random() < 0.25) {
    const t = state.tickers[Math.floor(Math.random() * state.tickers.length)];
    const tmpl = NEWS_TEMPLATES[Math.floor(Math.random() * NEWS_TEMPLATES.length)];
    state.news.unshift({ text: tmpl(t.symbol), ts: Date.now() });
    if (state.news.length > 30) state.news.pop();
  }

  rebuildLeaderboard();
  broadcast({ type: 'PRICE_UPDATE', tickers: state.tickers, leaderboard: state.leaderboard, news: state.news.slice(0, 8) });
}

function rebuildLeaderboard() {
  const players = Object.values(state.players);
  state.leaderboard = players.map(p => {
    const investedVal = Object.entries(p.holdings).reduce((sum, [sym, qty]) => {
      const t = state.tickers.find(t => t.symbol === sym);
      return sum + (t ? t.price * qty : 0);
    }, 0);
    const total = p.cash + investedVal;
    const pnl = total - p.startCash;
    return {
      id: p.id,
      name: p.name,
      total: parseFloat(total.toFixed(2)),
      cash: parseFloat(p.cash.toFixed(2)),
      invested: parseFloat(investedVal.toFixed(2)),
      pnl: parseFloat(pnl.toFixed(2)),
      pnlPct: parseFloat(((pnl / p.startCash) * 100).toFixed(2)),
      trades: p.trades,
      joinedAt: p.joinedAt,
    };
  }).sort((a, b) => b.total - a.total);
}

function startGameTimers() {
  priceTimer = setInterval(updatePrices, state.config.priceUpdateSec * 1000);

  gameTimer = setInterval(() => {
    state.timeLeft = Math.max(0, state.config.roundDuration - Math.floor((Date.now() - state.startedAt) / 1000));
    broadcast({ type: 'TIMER', timeLeft: state.timeLeft });

    if (state.timeLeft <= 0) {
      endSession();
    }
  }, 1000);
}

function endSession() {
  clearInterval(priceTimer);
  clearInterval(gameTimer);
  state.session = 'ended';

  // Liquidate all holdings
  Object.values(state.players).forEach(p => {
    Object.entries(p.holdings).forEach(([sym, qty]) => {
      const t = state.tickers.find(t => t.symbol === sym);
      if (t) p.cash += t.price * qty;
    });
    p.holdings = {};
  });

  rebuildLeaderboard();
  broadcast({ type: 'SESSION_ENDED', leaderboard: state.leaderboard });
}

// ─────────────────────────────────────────────
// WEBSOCKET
// ─────────────────────────────────────────────
const clients = new Map(); // ws -> { playerId, isAdmin }

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', ws => {
  clients.set(ws, { playerId: null, isAdmin: false });

  sendTo(ws, {
    type: 'WELCOME',
    session: state.session,
    config: state.config,
    tickers: state.tickers,
    leaderboard: state.leaderboard,
    news: state.news.slice(0, 8),
    timeLeft: state.timeLeft,
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const ctx = clients.get(ws);

    switch (msg.type) {

      // ── ADMIN ──────────────────────────────
      case 'ADMIN_START': {
        if (state.session === 'running') {
          sendTo(ws, { type: 'ERROR', text: 'Session already running' }); return;
        }
        state.config = {
          startCash: msg.startCash || 10000,
          roundDuration: (msg.durationMins || 90) * 60,
          volatility: msg.volatility || 3,
          priceUpdateSec: msg.priceUpdateSec || 4,
        };
        state.players = {};
        state.leaderboard = [];
        state.news = [];
        initTickers();
        state.session = 'running';
        state.startedAt = Date.now();
        state.timeLeft = state.config.roundDuration;
        ctx.isAdmin = true;
        startGameTimers();
        broadcast({ type: 'SESSION_STARTED', config: state.config, tickers: state.tickers });
        break;
      }

      case 'ADMIN_END': {
        if (state.session === 'running') endSession();
        break;
      }

      case 'ADMIN_CONFIG': {
        if (state.session !== 'running') {
          state.config = { ...state.config, ...msg.config };
          sendTo(ws, { type: 'CONFIG_UPDATED', config: state.config });
        }
        break;
      }

      case 'ADMIN_AUTH': {
        // Simple pin auth
        if (msg.pin === (process.env.ADMIN_PIN || '1234')) {
          ctx.isAdmin = true;
          sendTo(ws, { type: 'ADMIN_OK', session: state.session, config: state.config });
        } else {
          sendTo(ws, { type: 'ERROR', text: 'Wrong PIN' });
        }
        break;
      }

      // ── PLAYER ─────────────────────────────
      case 'JOIN': {
        if (state.session !== 'running') {
          sendTo(ws, { type: 'ERROR', text: 'No active session. Ask your admin to start the game!' }); return;
        }
        const name = (msg.name || '').trim().slice(0, 20);
        if (!name) { sendTo(ws, { type: 'ERROR', text: 'Enter a name' }); return; }

        // Allow rejoin by name
        let player = Object.values(state.players).find(p => p.name.toLowerCase() === name.toLowerCase());
        if (!player) {
          player = makePlayer(name);
          state.players[player.id] = player;
        }
        ctx.playerId = player.id;

        rebuildLeaderboard();
        sendTo(ws, {
          type: 'JOINED',
          player: { id: player.id, name: player.name, cash: player.cash, holdings: player.holdings, startCash: player.startCash, trades: player.trades },
          tickers: state.tickers,
          leaderboard: state.leaderboard,
          timeLeft: state.timeLeft,
          news: state.news.slice(0, 8),
        });
        broadcast({ type: 'LEADERBOARD_UPDATE', leaderboard: state.leaderboard });
        break;
      }

      case 'TRADE': {
        if (state.session !== 'running') { sendTo(ws, { type: 'ERROR', text: 'Session not active' }); return; }
        const player = state.players[ctx.playerId];
        if (!player) { sendTo(ws, { type: 'ERROR', text: 'Not joined' }); return; }

        const { symbol, side, qty } = msg;
        const q = Math.max(1, parseInt(qty) || 1);
        const ticker = state.tickers.find(t => t.symbol === symbol);
        if (!ticker) { sendTo(ws, { type: 'ERROR', text: 'Unknown symbol' }); return; }

        const cost = ticker.price * q;

        if (side === 'buy') {
          if (cost > player.cash) { sendTo(ws, { type: 'ERROR', text: 'Insufficient funds' }); return; }
          player.cash -= cost;
          player.holdings[symbol] = (player.holdings[symbol] || 0) + q;
        } else if (side === 'sell') {
          const owned = player.holdings[symbol] || 0;
          if (owned < q) { sendTo(ws, { type: 'ERROR', text: 'Not enough shares' }); return; }
          player.cash += cost;
          player.holdings[symbol] = owned - q;
          if (player.holdings[symbol] === 0) delete player.holdings[symbol];
        } else return;

        player.trades++;
        rebuildLeaderboard();

        sendTo(ws, {
          type: 'TRADE_OK',
          side, symbol, qty: q, price: ticker.price, total: cost,
          player: { cash: player.cash, holdings: player.holdings, trades: player.trades },
        });
        broadcast({ type: 'LEADERBOARD_UPDATE', leaderboard: state.leaderboard });
        break;
      }

      default: break;
    }
  });

  ws.on('close', () => clients.delete(ws));
});

// ─────────────────────────────────────────────
// REST ROUTES (for initial page loads)
// ─────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  res.json({
    session: state.session,
    leaderboard: state.leaderboard,
    tickers: state.tickers,
    timeLeft: state.timeLeft,
    news: state.news.slice(0, 8),
  });
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀  StockFloor server running`);
  console.log(`   Admin:  http://localhost:${PORT}/admin.html`);
  console.log(`   Client: http://localhost:${PORT}/`);
  console.log(`   Admin PIN: ${process.env.ADMIN_PIN || '1234'}\n`);
});
