const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const { connectDB } = require('../src/config/database');

const dashboardRoutes = require('../src/routes/dashboard');
const playbackRoutes = require('../src/routes/playback');
const alertRoutes = require('../src/routes/alerts');
const geofenceRoutes = require('../src/routes/geofence');
const reportRoutes = require('../src/routes/reports');
const vehicleRoutes = require('../src/routes/vehicles');
const adminRoutes = require('../src/routes/admin');

const app = express();

app.use(cors());
app.use(express.json());

// Connect to DB on cold start
let dbConnected = false;
app.use(async (req, res, next) => {
  if (!dbConnected) {
    await connectDB();
    dbConnected = true;
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/playback', playbackRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/geofence', geofenceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/admin', adminRoutes);

// Serve pages
app.get('/architecture', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'pages', 'architecture.html'));
});

app.get('/playback', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'pages', 'playback.html'));
});

app.get('/reports', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'pages', 'reports.html'));
});

app.get('/alerts-page', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'pages', 'alerts.html'));
});

app.get('/enhancements', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'pages', 'enhancements.html'));
});

app.get('/guide', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'pages', 'guide.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

module.exports = app;
