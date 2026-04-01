const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/mcp.db');

// Ensure data dir exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable WAL mode for concurrency
db.pragma('journal_mode = WAL');

// API keys table — tracks provisioned keys + usage
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    owner TEXT,
    tier TEXT DEFAULT 'free',        -- free | paid
    call_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key TEXT,
    tool TEXT NOT NULL,
    input TEXT,
    success INTEGER DEFAULT 1,
    latency_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_usage_log_key ON usage_log(api_key);
  CREATE INDEX IF NOT EXISTS idx_usage_log_tool ON usage_log(tool);
  CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
`);

/**
 * Log a tool call and increment counter for the key.
 * Returns the updated call_count for the key (or anonymous counter).
 */
function logCall({ key, tool, input, success = true, latencyMs }) {
  db.prepare(`
    INSERT INTO usage_log (api_key, tool, input, success, latency_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(key || '__anon__', tool, JSON.stringify(input) || null, success ? 1 : 0, latencyMs || null);

  if (key) {
    db.prepare(`
      UPDATE api_keys SET call_count = call_count + 1, last_used_at = datetime('now')
      WHERE key = ?
    `).run(key);
  }
}

/**
 * Get or create an anonymous call counter by IP (stored as a pseudo-key).
 * Returns { count } — current call count for this IP.
 */
function getAnonCount(ip) {
  const pseudoKey = `__anon__${ip}`;
  let row = db.prepare('SELECT call_count FROM api_keys WHERE key = ?').get(pseudoKey);
  if (!row) {
    const { v4: uuidv4 } = require('uuid');
    db.prepare(`
      INSERT INTO api_keys (id, key, owner, tier) VALUES (?, ?, ?, 'free')
    `).run(uuidv4(), pseudoKey, ip);
    row = { call_count: 0 };
  }
  return row.call_count;
}

function incrementAnonCount(ip) {
  const pseudoKey = `__anon__${ip}`;
  db.prepare(`
    UPDATE api_keys SET call_count = call_count + 1, last_used_at = datetime('now')
    WHERE key = ?
  `).run(pseudoKey);
}

/**
 * Look up a key. Returns row or null.
 */
function getKey(key) {
  return db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key) || null;
}

/**
 * Get daily usage summary for the monitor agent.
 */
function getDailySummary() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT tool, COUNT(*) as calls, AVG(latency_ms) as avg_ms
    FROM usage_log
    WHERE created_at >= ?
    GROUP BY tool
    ORDER BY calls DESC
  `).all(today + 'T00:00:00');
  const total = db.prepare(`
    SELECT COUNT(*) as n FROM usage_log WHERE created_at >= ?
  `).get(today + 'T00:00:00');
  return { date: today, byTool: rows, totalCalls: total.n };
}

module.exports = { db, logCall, getAnonCount, incrementAnonCount, getKey, getDailySummary };
