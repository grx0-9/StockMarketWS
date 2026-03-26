const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────
// STOCKS & NEWS
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
  // BULLISH — strong
  { text: s => `🚀 ${s} Q3 earnings crush estimates — revenue up 34% YoY`,           impact:  0.045 },
  { text: s => `📈 ${s} wins landmark $4B government contract`,                        impact:  0.055 },
  { text: s => `💊 ${s} FDA approves breakthrough treatment — analysts ecstatic`,      impact:  0.065 },
  { text: s => `🤝 ${s} merger talks confirmed — premium buyout expected`,              impact:  0.070 },
  { text: s => `🏆 ${s} named to S&P 500 index — passive fund buying incoming`,        impact:  0.050 },
  { text: s => `💰 ${s} announces $2B share buyback program`,                          impact:  0.035 },
  { text: s => `🌏 ${s} expands into Asian markets — TAM doubles overnight`,           impact:  0.040 },
  { text: s => `⚡ ${s} patents revolutionary technology — licensing deals imminent`,   impact:  0.060 },
  { text: s => `📊 Analysts upgrade ${s} to "Strong Buy" — price target raised 40%`,  impact:  0.042 },
  { text: s => `🛢️ ${s} discovers major new resource deposit`,                         impact:  0.058 },
  // BULLISH — moderate
  { text: s => `📰 ${s} reports record user growth for third consecutive quarter`,     impact:  0.022 },
  { text: s => `🤝 ${s} signs strategic partnership with Fortune 500 firm`,            impact:  0.028 },
  { text: s => `💵 ${s} raises full-year guidance citing strong demand`,               impact:  0.030 },
  { text: s => `🧑‍💼 ${s} appoints celebrated industry veteran as new CEO`,            impact:  0.018 },
  { text: s => `🔬 ${s} Phase 3 trial shows promising results`,                        impact:  0.025 },
  { text: s => `🌱 ${s} secures $800M green energy transition fund`,                   impact:  0.020 },
  // BEARISH — strong
  { text: s => `💥 ${s} misses earnings — revenue down 18%, guidance slashed`,         impact: -0.052 },
  { text: s => `⚖️ ${s} hit with massive antitrust lawsuit — DOJ investigation opens`, impact: -0.060 },
  { text: s => `🚨 ${s} CEO arrested on securities fraud charges`,                     impact: -0.075 },
  { text: s => `📉 ${s} recalls flagship product — safety investigation underway`,     impact: -0.055 },
  { text: s => `🏦 ${s} discloses accounting irregularities — audit committee formed`, impact: -0.068 },
  { text: s => `💔 ${s} loses exclusive contract worth $3B annually`,                  impact: -0.050 },
  { text: s => `🌊 ${s} faces class-action lawsuit from shareholders`,                 impact: -0.040 },
  { text: s => `📉 Analysts downgrade ${s} to "Sell" — slashes price target 35%`,     impact: -0.038 },
  // BEARISH — moderate
  { text: s => `⚠️ ${s} warns of supply chain disruptions — margin compression ahead`, impact: -0.025 },
  { text: s => `🚪 ${s} CFO unexpectedly resigns — no successor named`,                impact: -0.022 },
  { text: s => `🏭 ${s} shuts down key facility amid safety concerns`,                 impact: -0.030 },
  { text: s => `🌧️ ${s} lowers full-year revenue outlook citing macro headwinds`,      impact: -0.028 },
  { text: s => `📦 ${s} inventory builds to 3-year high — demand slowdown feared`,    impact: -0.020 },
  // NEUTRAL
  { text: s => `❓ ${s} in takeover talks — outcome uncertain, shares swing wildly`,   impact:  0.000 },
  { text: s => `🗳️ ${s} faces shareholder vote on controversial restructuring plan`,   impact:  0.000 },
];

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
/*
  serverState:
    'idle'   — not started yet; no market ticking
    'open'   — market is live; players can join and get their personal countdown
    'closed' — admin shut the market; no new joins, remaining active players are liquidated

  Each player has their own run:
    runState: 'active' | 'ended'
    timeLeft: personal seconds remaining
    When timeLeft hits 0 → holdings liquidated, runState = 'ended'
    Ended players can still view prices/leaderboard but cannot trade.
*/
let state = {
  serverState: 'idle',
  config: {
    startCash: 10000,
    playerRunSecs: 10 * 60,  // default: 10 min per player
    volatility: 3,
    priceUpdateSec: 4,
  },
  tickers: [],
  players: {},             // id -> player object
  allTimeLeaderboard: [],  // sorted by total value; includes ended players
  news: [],
  openedAt: null,
};

function initTickers() {
  state.tickers = STOCKS.map(s => ({
    ...s,
    price: s.base,
    prevPrice: s.base,
    history: Array(20).fill(s.base),
    change: 0,
    changePct: 0,
    newsImpact: 0,
  }));
}

function makePlayer(name) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    name,
    cash: state.config.startCash,
    startCash: state.config.startCash,
    holdings: {},
    joinedAt: Date.now(),
    trades: 0,
    runState: 'active',
    timeLeft: state.config.playerRunSecs,
    runEndedAt: null,
  };
}

// ─────────────────────────────────────────────
// PRICE ENGINE
// ─────────────────────────────────────────────
let priceTimer = null;
let playerTickTimer = null;

function updatePrices() {
  const vol = state.config.volatility;
  state.tickers.forEach(t => {
    t.prevPrice = t.price;
    const drift = (t.base - t.price) * 0.008;
    const shock = (Math.random() - 0.5) * 2 * vol * (t.price * 0.018);
    const newsNudge = t.newsImpact * t.price;
    t.newsImpact *= 0.70;
    if (Math.abs(t.newsImpact) < 0.0001) t.newsImpact = 0;
    t.price = Math.max(0.50, t.price + drift + shock + newsNudge);
    t.change = t.price - t.prevPrice;
    t.changePct = (t.change / t.prevPrice) * 100;
    t.history.push(parseFloat(t.price.toFixed(2)));
    if (t.history.length > 40) t.history.shift();
  });

  // Random news event
  if (Math.random() < 0.25) {
    const t = state.tickers[Math.floor(Math.random() * state.tickers.length)];
    const template = NEWS_TEMPLATES[Math.floor(Math.random() * NEWS_TEMPLATES.length)];
    t.newsImpact += template.impact;
    let sentiment = 'neutral';
    if (template.impact > 0.01) sentiment = 'bullish';
    else if (template.impact < -0.01) sentiment = 'bearish';
    state.news.unshift({ text: template.text(t.symbol), ts: Date.now(), symbol: t.symbol, sentiment });
    if (state.news.length > 30) state.news.pop();
  }

  rebuildLeaderboard();
  broadcast({
    type: 'PRICE_UPDATE',
    tickers: state.tickers,
    leaderboard: state.allTimeLeaderboard,
    news: state.news.slice(0, 8),
  });
}

// Ticks every second — decrements each active player's personal timer
function tickPlayerTimers() {
  let changed = false;
  Object.values(state.players).forEach(p => {
    if (p.runState !== 'active') return;
    p.timeLeft = Math.max(0, p.timeLeft - 1);
    changed = true;

    // Push personal timer to that player's socket only
    const sock = findSocketForPlayer(p.id);
    if (sock) sendTo(sock, { type: 'PLAYER_TIMER', timeLeft: p.timeLeft });

    if (p.timeLeft <= 0) endPlayerRun(p);
  });

  // Broadcast leaderboard so admin sees updated timeLeft values
  if (changed) {
    rebuildLeaderboard();
    broadcast({ type: 'LEADERBOARD_UPDATE', leaderboard: state.allTimeLeaderboard });
  }
}

function endPlayerRun(player) {
  // Liquidate all open positions at current market price
  Object.entries(player.holdings).forEach(([sym, qty]) => {
    const t = state.tickers.find(t => t.symbol === sym);
    if (t) player.cash += t.price * qty;
  });
  player.holdings = {};
  player.runState = 'ended';
  player.runEndedAt = Date.now();

  rebuildLeaderboard();

  const sock = findSocketForPlayer(player.id);
  if (sock) {
    sendTo(sock, {
      type: 'RUN_ENDED',
      player: sanitizePlayer(player),
      leaderboard: state.allTimeLeaderboard,
    });
  }
  broadcast({ type: 'LEADERBOARD_UPDATE', leaderboard: state.allTimeLeaderboard });
}

function rebuildLeaderboard() {
  state.allTimeLeaderboard = Object.values(state.players).map(p => {
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
      runState: p.runState,
      timeLeft: p.timeLeft,
    };
  }).sort((a, b) => b.total - a.total);
}

function sanitizePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    cash: p.cash,
    holdings: p.holdings,
    startCash: p.startCash,
    trades: p.trades,
    runState: p.runState,
    timeLeft: p.timeLeft,
  };
}

function startMarket() {
  priceTimer = setInterval(updatePrices, state.config.priceUpdateSec * 1000);
  playerTickTimer = setInterval(tickPlayerTimers, 1000);
}

function stopTimers() {
  clearInterval(priceTimer);
  clearInterval(playerTickTimer);
  priceTimer = null;
  playerTickTimer = null;
}

function closeMarket() {
  stopTimers();
  // Force-end any still-active players
  Object.values(state.players).forEach(p => {
    if (p.runState === 'active') endPlayerRun(p);
  });
  state.serverState = 'closed';
  rebuildLeaderboard();
  broadcast({ type: 'MARKET_CLOSED', leaderboard: state.allTimeLeaderboard });
}

// ─────────────────────────────────────────────
// WEBSOCKET LAYER
// ─────────────────────────────────────────────
const clients = new Map(); // ws -> { playerId, isAdmin }

function findSocketForPlayer(playerId) {
  for (const [ws, ctx] of clients.entries()) {
    if (ctx.playerId === playerId) return ws;
  }
  return null;
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

function sendTo(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', ws => {
  clients.set(ws, { playerId: null, isAdmin: false });

  // Welcome packet — enough for client to decide what screen to show
  sendTo(ws, {
    type: 'WELCOME',
    serverState: state.serverState,
    config: state.config,
    tickers: state.tickers,
    leaderboard: state.allTimeLeaderboard,
    news: state.news.slice(0, 8),
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const ctx = clients.get(ws);

    switch (msg.type) {

      // ─── ADMIN ──────────────────────────────────────
      case 'ADMIN_AUTH': {
        if (msg.pin === (process.env.ADMIN_PIN || '1234')) {
          ctx.isAdmin = true;
          sendTo(ws, {
            type: 'ADMIN_OK',
            serverState: state.serverState,
            config: state.config,
            players: Object.values(state.players).map(sanitizePlayer),
          });
        } else {
          sendTo(ws, { type: 'ERROR', text: 'Wrong PIN' });
        }
        break;
      }

      case 'ADMIN_OPEN': {
        if (!ctx.isAdmin) return;
        if (state.serverState === 'open') {
          sendTo(ws, { type: 'ERROR', text: 'Market already open' }); return;
        }
        state.config = {
          startCash:      msg.startCash      || 10000,
          playerRunSecs:  (msg.playerRunMins || 10) * 60,
          volatility:     msg.volatility     || 3,
          priceUpdateSec: msg.priceUpdateSec || 4,
        };
        // Full reset if idle or admin requested it
        if (state.serverState === 'idle' || msg.reset) {
          state.players = {};
          state.allTimeLeaderboard = [];
          state.news = [];
          initTickers();
        }
        state.serverState = 'open';
        state.openedAt = Date.now();
        startMarket();
        broadcast({
          type: 'MARKET_OPENED',
          serverState: 'open',
          config: state.config,
          tickers: state.tickers,
        });
        break;
      }

      case 'ADMIN_CLOSE': {
        if (!ctx.isAdmin) return;
        if (state.serverState !== 'open') {
          sendTo(ws, { type: 'ERROR', text: 'Market is not open' }); return;
        }
        closeMarket();
        break;
      }

      case 'ADMIN_RESET': {
        if (!ctx.isAdmin) return;
        stopTimers();
        state.players = {};
        state.allTimeLeaderboard = [];
        state.news = [];
        state.tickers = [];
        state.serverState = 'idle';
        state.openedAt = null;
        broadcast({ type: 'MARKET_RESET', serverState: 'idle' });
        break;
      }

      case 'ADMIN_KICK': {
        if (!ctx.isAdmin) return;
        const target = state.players[msg.playerId];
        if (target && target.runState === 'active') endPlayerRun(target);
        break;
      }

      // ─── PLAYER ─────────────────────────────────────
      case 'JOIN': {
        if (state.serverState !== 'open') {
          sendTo(ws, { type: 'ERROR', text: 'The market is not open right now.' }); return;
        }
        const name = (msg.name || '').trim().slice(0, 20);
        if (!name) { sendTo(ws, { type: 'ERROR', text: 'Enter a name' }); return; }

        // Allow reconnect by name
        let player = Object.values(state.players).find(
          p => p.name.toLowerCase() === name.toLowerCase()
        );

        if (player) {
          // Reconnect — just re-associate this socket
          ctx.playerId = player.id;
        } else {
          player = makePlayer(name);
          state.players[player.id] = player;
          ctx.playerId = player.id;
        }

        rebuildLeaderboard();
        sendTo(ws, {
          type: 'JOINED',
          player: sanitizePlayer(player),
          tickers: state.tickers,
          leaderboard: state.allTimeLeaderboard,
          news: state.news.slice(0, 8),
        });
        broadcast({ type: 'LEADERBOARD_UPDATE', leaderboard: state.allTimeLeaderboard });
        break;
      }

      case 'TRADE': {
        if (state.serverState !== 'open') {
          sendTo(ws, { type: 'ERROR', text: 'Market is closed' }); return;
        }
        const player = state.players[ctx.playerId];
        if (!player) { sendTo(ws, { type: 'ERROR', text: 'Not joined' }); return; }
        if (player.runState !== 'active') {
          sendTo(ws, { type: 'ERROR', text: 'Your run has ended — no more trades!' }); return;
        }

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
          player: sanitizePlayer(player),
        });
        broadcast({ type: 'LEADERBOARD_UPDATE', leaderboard: state.allTimeLeaderboard });
        break;
      }

      default: break;
    }
  });

  ws.on('close', () => clients.delete(ws));
});

// ─────────────────────────────────────────────
// REST
// ─────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  res.json({
    serverState: state.serverState,
    leaderboard: state.allTimeLeaderboard,
    tickers: state.tickers,
    news: state.news.slice(0, 8),
    config: state.config,
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
