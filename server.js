const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const { connectDB } = require('./src/config/database');
const { startChangeStreamProcessor } = require('./src/changeStreams/gpsProcessor');

const dashboardRoutes = require('./src/routes/dashboard');
const playbackRoutes = require('./src/routes/playback');
const alertRoutes = require('./src/routes/alerts');
const geofenceRoutes = require('./src/routes/geofence');
const reportRoutes = require('./src/routes/reports');
const vehicleRoutes = require('./src/routes/vehicles');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  res.sendFile(path.join(__dirname, 'public', 'pages', 'architecture.html'));
});

app.get('/playback', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'playback.html'));
});

app.get('/reports', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'reports.html'));
});

app.get('/alerts-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'alerts.html'));
});

app.get('/enhancements', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'enhancements.html'));
});

app.get('/guide', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'guide.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date(), uptime: process.uptime() });
});

async function start() {
  try {
    await connectDB();
    console.log('✓ Database connected');

    // Start Change Stream processor
    await startChangeStreamProcessor();

    app.listen(PORT, () => {
      console.log(`\n🚍 KSRTC VTMS PoC running at http://localhost:${PORT}`);
      console.log(`   Dashboard:    http://localhost:${PORT}`);
      console.log(`   Architecture: http://localhost:${PORT}/architecture`);
      console.log(`   Playback:     http://localhost:${PORT}/playback`);
      console.log(`   Reports:      http://localhost:${PORT}/reports`);
      console.log(`   Alerts:       http://localhost:${PORT}/alerts-page`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
