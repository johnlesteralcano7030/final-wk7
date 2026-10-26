require('dotenv').config();
const { sendStatusEmail } = require('./email_service');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves the frontend files

// --- DATABASE SETUP (SQLite) ---
const db = new Database(process.env.DB_PATH || 'pco.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    total_quantity INTEGER,
    available_quantity INTEGER
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    borrower_id INTEGER,
    item_id INTEGER,
    quantity INTEGER,
    status TEXT DEFAULT 'PENDING_HEAD',
    return_date TEXT,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER,
    action TEXT,
    performed_by TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed initial data if empty
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  const insertUser = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
  insertUser.run('admin', bcrypt.hashSync('admin123', 10), 'admin');
  insertUser.run('depthead', bcrypt.hashSync('head123', 10), 'dept_head');
  insertUser.run('faculty1', bcrypt.hashSync('faculty123', 10), 'borrower');

  const insertItem = db.prepare('INSERT INTO items (name, total_quantity, available_quantity) VALUES (?, ?, ?)');
  insertItem.run('Projector', 5, 5);
  insertItem.run('Laptop', 10, 10);
  console.log('Database seeded with default accounts and items.');
}

// --- MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};

// Helper for Logging
const logAction = (reqId, action, username) => {
  db.prepare('INSERT INTO logs (request_id, action, performed_by) VALUES (?, ?, ?)').run(reqId, action, username);
};

// --- AUTHENTICATION ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token, role: user.role, username: user.username });
});

// --- ITEM ROUTES ---
app.get('/api/items', authenticateToken, (req, res) => {
  const items = db.prepare('SELECT * FROM items').all();
  res.json(items);
});

app.post('/api/items', authenticateToken, authorizeRole(['admin']), (req, res) => {
  const { name, total_quantity } = req.body;
  db.prepare('INSERT INTO items (name, total_quantity, available_quantity) VALUES (?, ?, ?)').run(name, total_quantity, total_quantity);
  res.json({ message: 'Item added' });
});

// --- REQUEST ROUTES ---
app.post('/api/requests', authenticateToken, authorizeRole(['borrower']), (req, res) => {
  const { item_id, quantity } = req.body;
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);

  if (!item || item.available_quantity < quantity) {
    return res.status(400).json({ message: 'Insufficient stock or invalid item' });
  }

  const info = db.prepare('INSERT INTO requests (borrower_id, item_id, quantity) VALUES (?, ?, ?)').run(req.user.id, item_id, quantity);
  logAction(info.lastInsertRowid, 'Request submitted by faculty', req.user.username);
  res.json({ message: 'Request sent to Dept Head' });
});

app.get('/api/requests', authenticateToken, (req, res) => {
  let query = `
    SELECT r.id, r.quantity, r.status, r.return_date, r.requested_at, 
           u.username as borrower, i.name as item_name 
    FROM requests r 
    JOIN users u ON r.borrower_id = u.id 
    JOIN items i ON r.item_id = i.id
  `;
  if (req.user.role === 'borrower') {
    query += ` WHERE r.borrower_id = ${req.user.id}`;
  }
  const requests = db.prepare(query).all();
  res.json(requests);
});

// --- DEPT HEAD ACTIONS ---
app.post('/api/requests/:id/action', authenticateToken, authorizeRole(['dept_head']), (req, res) => {
  const { action } = req.body; // 'approve' or 'deny'
  const reqId = req.params.id;
  
  const status = action === 'approve' ? 'APPROVED' : 'DENIED';
  db.prepare('UPDATE requests SET status = ? WHERE id = ? AND status = ?').run(status, reqId, 'PENDING_HEAD');

  sendStatusEmail('johnlestermacapanas3898@acdeducation.com', 'item', status);

  logAction(reqId, `Request ${action}d by Dept Head`, req.user.username);
  res.json({ message: `Request ${status}` });
});

// --- ADMIN (PCO) ACTIONS ---
app.post('/api/requests/:id/release', authenticateToken, authorizeRole(['admin']), (req, res) => {
  const reqId = req.params.id;
  const { return_date } = req.body;

  const request = db.prepare('SELECT * FROM requests WHERE id = ? AND status = ?').get(reqId, 'APPROVED');
  if (!request) return res.status(400).json({ message: 'Request not approved or not found' });

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(request.item_id);
  if (item.available_quantity < request.quantity) return res.status(400).json({ message: 'Not enough inventory' });

db.prepare('UPDATE items SET available_quantity = available_quantity - ? WHERE id = ?').run(request.quantity, request.item_id);
db.prepare('UPDATE requests SET status = ?, return_date = ? WHERE id = ?').run('RELEASED', return_date, reqId);

const itemRow = db.prepare('SELECT name FROM items WHERE id = ?').get(request.item_id);
sendStatusEmail(
  request.borrower_email || 'johnlestermacapanas3898@acdeducation.com',
  itemRow ? itemRow.name : 'item',
  'RELEASED',
  return_date
);

  logAction(reqId, `Item released. Due on ${return_date}`, req.user.username);
  res.json({ message: 'Item released successfully' });
});

app.post('/api/requests/:id/return', authenticateToken, authorizeRole(['admin']), (req, res) => {
  const reqId = req.params.id;
  const request = db.prepare('SELECT * FROM requests WHERE id = ? AND status = ?').get(reqId, 'RELEASED');
  if (!request) return res.status(400).json({ message: 'Item not currently released' });

db.prepare('UPDATE items SET available_quantity = available_quantity + ? WHERE id = ?').run(request.quantity, request.item_id);
db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('RETURNED', reqId);

const itemRow = db.prepare('SELECT name FROM items WHERE id = ?').get(request.item_id);
sendStatusEmail(
  request.borrower_email || 'johnlestermacapanas3898@acdeducation.com',
  itemRow ? itemRow.name : 'item',
  'RETURNED'
);

  logAction(reqId, `Item returned by borrower`, req.user.username);
  res.json({ message: 'Item returned successfully' });
});

// --- LOGS ---
app.get('/api/logs', authenticateToken, authorizeRole(['admin']), (req, res) => {
  const logs = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC').all();
  res.json(logs);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});