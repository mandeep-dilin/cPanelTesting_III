const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APP_VERSION = 'db-v2';
const PORT = process.env.PORT || 3000;
const started = new Date();
const MOODS = ['happy', 'neutral', 'sad', 'fire'];

// Uses DATABASE_URL if set, otherwise DB_HOST / DB_USER / DB_PASSWORD / DB_NAME
const pool = process.env.DATABASE_URL
  ? mysql.createPool(process.env.DATABASE_URL)
  : mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectionLimit: 5,
    });

let dbReady = false;
let dbError = null;

async function initDb() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      message VARCHAR(500) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    // Add mood column to tables created by db-v1
    const [cols] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entries' AND COLUMN_NAME = 'mood'`
    );
    if (!cols[0].n) {
      await pool.query(`ALTER TABLE entries ADD COLUMN mood VARCHAR(20) NOT NULL DEFAULT 'neutral'`);
    }
    dbReady = true;
    dbError = null;
    console.log('DB ready');
  } catch (e) {
    dbReady = false;
    dbError = e.message;
    console.error('DB error:', e.message);
  }
}

function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e5) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const url = u.pathname;

  try {
    // GET /health
    if (url.endsWith('/health')) {
      if (!dbReady) await initDb();
      return send(res, 200, {
        status: 'ok',
        version: APP_VERSION,
        node: process.version,
        started: started.toISOString(),
        uptime: Math.floor(process.uptime()),
        db: dbReady ? 'connected' : 'error',
        dbError,
      });
    }

    if (url.includes('/api/')) {
      if (!dbReady) await initDb();
      if (!dbReady) return send(res, 500, { error: 'Database not connected: ' + dbError });
    }

    // GET /api/stats
    if (url.endsWith('/api/stats') && req.method === 'GET') {
      const [[s]] = await pool.query(`SELECT COUNT(*) AS total,
        COALESCE(SUM(DATE(created_at) = CURDATE()), 0) AS today,
        COUNT(DISTINCT name) AS people FROM entries`);
      const [[v]] = await pool.query('SELECT VERSION() AS mysql');
      return send(res, 200, {
        total: Number(s.total), today: Number(s.today), people: Number(s.people), mysql: v.mysql,
      });
    }

    // DELETE /api/entries/:id
    const del = url.match(/\/api\/entries\/(\d+)$/);
    if (del && req.method === 'DELETE') {
      const [r] = await pool.query('DELETE FROM entries WHERE id = ?', [Number(del[1])]);
      return send(res, r.affectedRows ? 200 : 404, { deleted: r.affectedRows });
    }

    // GET /api/entries?q=  |  POST /api/entries
    if (url.endsWith('/api/entries')) {
      if (req.method === 'GET') {
        const q = (u.searchParams.get('q') || '').trim();
        const [rows] = q
          ? await pool.query(
              'SELECT id, name, message, mood, created_at FROM entries WHERE name LIKE ? OR message LIKE ? ORDER BY id DESC LIMIT 100',
              [`%${q}%`, `%${q}%`]
            )
          : await pool.query(
              'SELECT id, name, message, mood, created_at FROM entries ORDER BY id DESC LIMIT 100'
            );
        return send(res, 200, rows);
      }

      if (req.method === 'POST') {
        const { name, message, mood } = await readBody(req);
        if (!name || !message) return send(res, 400, { error: 'Name and message are required' });
        const m = MOODS.includes(mood) ? mood : 'neutral';
        const [result] = await pool.query(
          'INSERT INTO entries (name, message, mood) VALUES (?, ?, ?)',
          [String(name).slice(0, 100), String(message).slice(0, 500), m]
        );
        return send(res, 201, { id: result.insertId });
      }

      return send(res, 405, { error: 'Method not allowed' });
    }

    if (url.includes('/api/')) return send(res, 404, { error: 'Not found' });

    fs.readFile(path.join(__dirname, 'index.html'), (err, html) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('index.html not found');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT} (${APP_VERSION})`);
  initDb();
});
