const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Simple in-memory DB (later replaced with db.json if you want persistence)
let channels = [];
let votes = {};
let winners = [];
let hostChannel = { name: "", link: "" };

// Root check route
app.get("/", (req, res) => {
  res.send("✅ Tumicodes Competition API is running!");
});

// Register channel
app.post("/register", (req, res) => {
  const { name, link, about } = req.body;
  if (!name || !link) {
    return res.status(400).json({ error: "Name and link are required" });
  }

  const channel = { id: Date.now(), name, link, about, votes: 0 };
  channels.push(channel);
  res.json({ message: "Channel registered!", channel });
});

// Get all channels
app.get("/channels", (req, res) => {
  res.json(channels);
});

// Cast vote
app.post("/vote/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const channel = channels.find(c => c.id === id);
  if (!channel) {
    return res.status(404).json({ error: "Channel not found" });
  }
  channel.votes++;
  res.json({ message: "Vote added!", votes: channel.votes });
});

// Admin declare winner
app.post("/admin/declare-winner", (req, res) => {
  const { winnerId } = req.body;
  const channel = channels.find(c => c.id === winnerId);
  if (!channel) {
    return res.status(404).json({ error: "Winner not found" });
  }
  winners.push({
    id: channel.id,
    name: channel.name,
    link: channel.link,
    about: channel.about,
    votes: channel.votes,
    date: new Date().toISOString()
  });
  res.json({ message: "Winner declared", winner: channel });
});

// Get past winners
app.get("/winners", (req, res) => {
  res.json(winners);
});

// Set host channel (admin only)
app.post("/admin/host", (req, res) => {
  const { name, link } = req.body;
  if (!name || !link) {
    return res.status(400).json({ error: "Host name and link required" });
  }
  hostChannel = { name, link };
  res.json({ message: "Host channel updated", hostChannel });
});

// Get host channel
app.get("/host", (req, res) => {
  res.json(hostChannel);
});

// Use Render's port
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
