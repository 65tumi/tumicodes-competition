const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const session = require("express-session");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());

// Use session for admin login
app.use(session({
  secret: process.env.SESSION_SECRET || 'tumisecret',
  resave: false,
  saveUninitialized: true,
}));

// In-memory database
let channels = [];
let winners = [];
let hostChannel = { name: "", link: "" };

// Root check
app.get("/", (req, res) => res.send("✅ Tumicodes Competition API running!"));

// Register channel
app.post("/register", (req, res) => {
  const { name, link, about } = req.body;
  if (!name || !link) return res.status(400).json({ error: "Name and link required" });

  const id = Date.now();
  const channel = { id, name, link, about, votes: 0 };
  channels.push(channel);

  const voteLink = `https://your-frontend-site.netlify.app/vote.html?id=${id}`;

  res.json({ message: "Channel registered!", channel, voteLink });
});

// Get all channels
app.get("/channels", (req, res) => res.json(channels));

// Vote (multi-vote allowed)
app.post("/vote/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const channel = channels.find(c => c.id === id);
  if (!channel) return res.status(404).json({ error: "Channel not found" });

  channel.votes++;
  res.json({ message: "Vote added!", votes: channel.votes });
});

// Admin login
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: "Invalid credentials" });
});

// Check admin session
app.get("/api/admin/check", (req, res) => {
  res.json({ loggedIn: req.session.admin === true });
});

// Admin declare winner
app.post("/api/admin/declare-winner", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ error: "Unauthorized" });
  const { winnerId } = req.body;
  const channel = channels.find(c => c.id === winnerId);
  if (!channel) return res.status(404).json({ error: "Winner not found" });

  winners.push({ ...channel, date: new Date().toISOString() });
  res.json({ message: "Winner declared", winner: channel });
});

// Get past winners
app.get("/winners", (req, res) => res.json(winners));

// Set host channel
app.post("/api/admin/host", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ error: "Unauthorized" });
  const { name, link } = req.body;
  if (!name || !link) return res.status(400).json({ error: "Host name and link required" });
  hostChannel = { name, link };
  res.json({ message: "Host channel updated", hostChannel });
});

// Get host channel
app.get("/host", (req, res) => res.json(hostChannel));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
