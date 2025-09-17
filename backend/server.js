require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const db = require('./db');
const stringify = require('csv-stringify').stringify;

const ADMIN_USER = process.env.ADMIN_USER || 'tunmiboy';
const ADMIN_PASS = process.env.ADMIN_PASS || 'tunmiboy';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'tumisecret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Utilities
function getClientKey(req){
  return req.body.voterId || req.ip;
}

// -------- Public API -------- //

// Register channel
app.post('/api/register', (req, res) => {
  try {
    const { name, link, about, owner } = req.body;
    if(!name || !link) return res.status(400).json({ error: 'name and link required' });
    const stmt = db.prepare('INSERT INTO channels (name, link, about) VALUES (?,?,?)');
    const info = stmt.run(name, link, about || '');
    const id = info.lastInsertRowid;
    const voteLink = `${req.protocol}://${req.get('host')}/vote.html?channel=${id}`;
    res.json({ channelId: id, voteLink });
  } catch (err){
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Get channels leaderboard
app.get('/api/channels', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, name, link, about, votes FROM channels ORDER BY votes DESC').all();
    const host = `${req.protocol}://${req.get('host')}`;
    const channels = rows.map(r => ({ ...r, voteLink: `${host}/vote.html?channel=${r.id}` }));
    res.json({ channels });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Get channel by id
app.get('/api/channel/:id', (req,res) => {
  try{
    const id = req.params.id;
    const row = db.prepare('SELECT id, name, link, about, votes FROM channels WHERE id=?').get(id);
    if(!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch(err){
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Vote endpoint - enforces 1 vote total per voter_key
app.post('/api/vote', (req, res) => {
  try {
    const { channelId, voterId } = req.body;
    if(!channelId) return res.status(400).json({ error: 'channelId required' });
    const voterKey = getClientKey(req);
    const exists = db.prepare('SELECT * FROM votes WHERE voter_key = ?').get(voterKey);
    if(exists){
      return res.status(400).json({ error: 'already voted' });
    }
    const insert = db.prepare('INSERT INTO votes (channel_id, voter_key) VALUES (?,?)');
    const inc = db.prepare('UPDATE channels SET votes = votes + 1 WHERE id = ?');
    const ch = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
    if(!ch) return res.status(404).json({ error: 'channel not found' });
    const tx = db.transaction(() => {
      insert.run(channelId, voterKey);
      inc.run(channelId);
    });
    tx();
    res.json({ success: true });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Get past winners
app.get('/api/winners', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, channel_id, name, link, about, votes, declared_at FROM winners ORDER BY declared_at DESC').all();
    res.json({ winners: rows });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Get host info
app.get('/api/host', (req, res) => {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('host');
    if(!row || !row.value) return res.json({ host: null });
    const host = JSON.parse(row.value);
    res.json({ host });
  } catch(err){ console.error(err); res.status(500).json({ error: 'server error' }); }
});

// Get settings (endAt)
app.get('/api/settings', (req,res) => {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('endAt');
    res.json({ endAt: row ? row.value : null });
  } catch(err){ console.error(err); res.status(500).json({ error: 'server error' }); }
});

// -------- Admin API (protected by session) -------- //

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if(username === ADMIN_USER && password === ADMIN_PASS){
    req.session.admin = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'invalid credentials' });
});

app.post('/api/admin/logout', (req,res) => {
  req.session.destroy(()=>{ res.json({ success:true }); });
});

function requireAdmin(req,res,next){
  if(req.session && req.session.admin) return next();
  return res.status(401).json({ error: 'not authorized' });
}

// Admin: get all channels
app.get('/api/admin/channels', requireAdmin, (req,res) => {
  try {
    const rows = db.prepare('SELECT id, name, link, about, votes, created_at FROM channels ORDER BY created_at DESC').all();
    res.json({ channels: rows });
  } catch(err){ console.error(err); res.status(500).json({ error: 'server error' }); }
});

// Admin: remove channel
app.post('/api/admin/remove', requireAdmin, (req,res) => {
  try {
    const { id } = req.body;
    db.prepare('DELETE FROM channels WHERE id = ?').run(id);
    db.prepare('DELETE FROM votes WHERE channel_id = ?').run(id);
    res.json({ success: true });
  } catch(err){ console.error(err); res.status(500).json({ error: 'server error' }); }
});

// Admin: declare winner (adds to winners table and stores currentWinner)
app.post('/api/admin/declare', requireAdmin, (req,res) => {
  try {
    const { id } = req.body;
    const ch = db.prepare('SELECT id, name, link, about, votes FROM channels WHERE id = ?').get(id);
    if(!ch) return res.status(404).json({ error: 'not found' });
    db.prepare('INSERT INTO winners (channel_id, name, link, about, votes) VALUES (?,?,?,?,?)')
      .run(ch.id, ch.name, ch.link, ch.about || '', ch.votes || 0);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run('currentWinner', String(ch.id));
    res.json({ success: true });
  } catch(err){ console.error(err); res.status(500).json({ error: 'server error' }); }
});

// Admin: set host
app.post('/api/admin/sethost', requireAdmin, (req,res) => {
  try {
    const { name, link } = req.body;
    const hostObj = { name: name||'', link: link||'' };
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run('host', JSON.stringify(hostObj));
    res.json({ success: true });
  } catch(err){ console.error(err); res.status(500).json({ error: 'server error' }); }
});

// Admin: get host (protected)
app.get('/api/admin/host', requireAdmin, (req,res) => {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('host');
    if(!row || !row.value) return res.json({ host: null });
    res.json({ host: JSON.parse(row.value) });
  } catch(err){ console.error(err); res.status(500).json({ error: 'server error' }); }
});

// Admin: reset competition (delete channels, votes, current winner)
app.post('/api/admin/reset', requireAdmin, (req,res) => {
  try {
    db.prepare('DELETE FROM votes').run();
    db.prepare('DELETE FROM channels').run();
    db.prepare('DELETE FROM settings WHERE key = ?').run('currentWinner');
    res.json({ success: true });
  } catch(err){ console.error(err); res.status(500).json({ error: 'server error' }); }
});

// Admin: set competition end datetime (store in settings)
app.post('/api/admin/setend', requireAdmin, (req,res) => {
  try {
    const { endAt } = req.body; // ISO string
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run('endAt', endAt || '');
    res.json({ success: true });
  } catch(err){ console.error(err); res.status(500).json({ error: 'server error' }); }
});

// Admin: export CSV
app.get('/api/admin/export', requireAdmin, (req,res) => {
  try {
    const rows = db.prepare('SELECT id, name, link, about, votes, created_at FROM channels ORDER BY created_at DESC').all();
    const data = rows.map(r => [r.id, r.name, r.link, r.about || '', r.votes || 0, r.created_at]);
    const header = ['id','name','link','about','votes','created_at'];
    stringify([header, ...data], (err, output) => {
      if(err) return res.status(500).send('error');
      res.setHeader('Content-disposition', 'attachment; filename=channels.csv');
      res.setHeader('Content-Type', 'text/csv');
      res.send(output);
    });
  } catch(err){ console.error(err); res.status(500).json({ error: 'server error' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Server running on port', PORT));
