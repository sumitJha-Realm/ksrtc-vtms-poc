const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');

// POST /api/admin/seed-demo — Generate historical GPS + alerts data
router.post('/seed-demo', async (req, res) => {
  const db = getDB();
  const hours = parseInt(req.query.hours) || 6;

  try {

    const vehicles = await db.collection('vehicles').find({}).toArray();
    const routes = await db.collection('routes').find({}).toArray();
    const routeMap = {};
    routes.forEach(r => { routeMap[r.routeId] = r; });

    const now = new Date();
    const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);

    let totalGPS = 0;
    const batchSize = 2000;
    let batch = [];

    // Generate GPS history for each vehicle
    for (const vehicle of vehicles) {
      const route = routeMap[vehicle.assignedRouteId];
      if (!route) continue;

      const coords = route.geometry.coordinates;
      let currentTime = new Date(startTime);
      let segmentIndex = 0;
      let progress = 0;
      let direction = 1;
      let tripCount = 0;

      while (currentTime < now) {
        let fromCoord, toCoord;
        if (direction === 1) {
          fromCoord = coords[segmentIndex];
          toCoord = coords[Math.min(segmentIndex + 1, coords.length - 1)];
        } else {
          fromCoord = coords[Math.min(segmentIndex + 1, coords.length - 1)];
          toCoord = coords[segmentIndex];
        }

        const lon = fromCoord[0] + (toCoord[0] - fromCoord[0]) * progress;
        const lat = fromCoord[1] + (toCoord[1] - fromCoord[1]) * progress;
        const noiseLon = (Math.random() - 0.5) * 0.0003;
        const noiseLat = (Math.random() - 0.5) * 0.0003;

        let speed = 20 + Math.random() * 40;
        const isAtStop = progress < 0.05 && Math.random() < 0.3;
        if (isAtStop) speed = 0;
        if (Math.random() < 0.005) speed = 75 + Math.random() * 20; // overspeed

        const heading = Math.atan2(toCoord[0] - fromCoord[0], toCoord[1] - fromCoord[1]) * 180 / Math.PI;

        batch.push({
          timestamp: new Date(currentTime),
          metadata: {
            vehicleId: vehicle.vehicleId,
            depotId: vehicle.depotId,
            routeId: vehicle.assignedRouteId,
            tripId: `TRIP-${vehicle.vehicleId}-${tripCount}`
          },
          location: { type: 'Point', coordinates: [lon + noiseLon, lat + noiseLat] },
          speed: Math.round(speed * 10) / 10,
          heading: Math.round(((heading % 360) + 360) % 360),
          altitude: 900 + Math.random() * 20,
          ignition: speed > 0 || Math.random() > 0.1,
          satellites: 8 + Math.floor(Math.random() * 6),
          odometer: 50000 + totalGPS * 0.1
        });

        if (batch.length >= batchSize) {
          await db.collection('gps_events').insertMany(batch);
          totalGPS += batch.length;
          batch = [];
        }

        // Advance position
        progress += 0.03 + Math.random() * 0.02;
        if (progress >= 1) {
          progress = 0;
          segmentIndex += direction;
          if (segmentIndex >= coords.length - 1) {
            direction = -1;
            segmentIndex = coords.length - 2;
            tripCount++;
          } else if (segmentIndex <= 0) {
            direction = 1;
            segmentIndex = 0;
            tripCount++;
          }
        }

        // Advance time 10s
        currentTime = new Date(currentTime.getTime() + 10000);

        // Occasional signal gap
        if (Math.random() < 0.001) {
          currentTime = new Date(currentTime.getTime() + 120000);
        }
      }

      // Set final vehicle_current_state
      const lastCoord = coords[segmentIndex];
      await db.collection('vehicle_current_state').updateOne(
        { vehicleId: vehicle.vehicleId },
        {
          $set: {
            location: { type: 'Point', coordinates: [lastCoord[0], lastCoord[1]] },
            speed: Math.round(Math.random() * 50),
            heading: Math.round(Math.random() * 360),
            ignition: true,
            status: Math.random() > 0.2 ? 'running' : 'idle',
            lastUpdated: now,
            tripId: `TRIP-${vehicle.vehicleId}-${tripCount}`
          }
        },
        { upsert: true }
      );
    }

    // Flush remaining GPS batch
    if (batch.length > 0) {
      await db.collection('gps_events').insertMany(batch);
      totalGPS += batch.length;
    }

    // Generate alerts spread across the time range
    const alertTypes = ['overspeed', 'harsh_braking', 'harsh_acceleration', 'unauthorized_stop', 'breakdown', 'panic', 'stop_skipped', 'route_deviation'];
    const alerts = [];
    const alertCount = Math.max(5, Math.round(hours * 3));

    for (let i = 0; i < alertCount; i++) {
        const v = vehicles[Math.floor(Math.random() * vehicles.length)];
        const route = routeMap[v.assignedRouteId];
        if (!route) continue;
        const coord = route.geometry.coordinates[Math.floor(Math.random() * route.geometry.coordinates.length)];
        const type = alertTypes[Math.floor(Math.random() * alertTypes.length)];
        const alertTime = new Date(startTime.getTime() + Math.random() * hours * 60 * 60 * 1000);

        alerts.push({
          alertId: `ALT-${Date.now()}-${i}`,
          vehicleId: v.vehicleId,
          depotId: v.depotId,
          routeId: v.assignedRouteId,
          type,
          severity: type === 'panic' ? 'critical' : (type === 'breakdown' ? 'high' : 'medium'),
          status: i < 5 ? 'active' : (Math.random() > 0.3 ? 'closed' : 'acknowledged'),
          timestamp: alertTime,
          location: { type: 'Point', coordinates: coord },
          details: getAlertDetails(type),
          acknowledgedBy: Math.random() > 0.5 ? 'operator1' : null,
          closedBy: Math.random() > 0.5 ? 'system' : null,
          closedAt: Math.random() > 0.5 ? new Date(alertTime.getTime() + Math.random() * 3600000) : null
        });
    }

    await db.collection('alerts').insertMany(alerts);

    res.json({
      success: true,
      message: `Seeded ${hours} hours of demo data`,
      hours,
      gpsEvents: totalGPS,
      alerts: alerts.length,
      vehicles: vehicles.length
    });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: err.message });
  }
});

function getAlertDetails(type) {
  const details = {
    overspeed: { speed: 78 + Math.floor(Math.random() * 15), limit: 60, duration: '45 seconds' },
    harsh_braking: { deceleration: -(8 + Math.random() * 5).toFixed(1) + ' m/s²', prevSpeed: 55, currentSpeed: 12 },
    harsh_acceleration: { acceleration: (6 + Math.random() * 4).toFixed(1) + ' m/s²', prevSpeed: 10, currentSpeed: 52 },
    unauthorized_stop: { duration: (3 + Math.floor(Math.random() * 10)) + ' minutes', nearestStop: '450m away' },
    breakdown: { reason: 'Engine stall detected', stationaryDuration: '15 minutes', engineTemp: 'Normal' },
    panic: { triggeredBy: 'Driver', message: 'Emergency assistance required' },
    stop_skipped: { skippedStop: 'BTM Layout', expectedArrival: '09:24', nextStopReached: '09:35' },
    route_deviation: { distance: (120 + Math.floor(Math.random() * 200)) + 'm from corridor', duration: '3 minutes' }
  };
  return details[type] || {};
}

// ---- REAL-TIME GPS SIMULATOR (in-process) ----
let simulatorInterval = null;
let simulatorStates = {};
let simulatorStats = { ticks: 0, totalEvents: 0, startedAt: null };

// POST /api/admin/simulator/start
router.post('/simulator/start', async (req, res) => {
  if (simulatorInterval) {
    return res.json({ running: true, message: 'Simulator already running', stats: simulatorStats });
  }

  const db = getDB();
  const vehicles = await db.collection('vehicles').find({}).toArray();
  const routes = await db.collection('routes').find({}).toArray();
  const routeMap = {};
  routes.forEach(r => { routeMap[r.routeId] = r; });

  // Initialize vehicle states
  simulatorStates = {};
  for (const v of vehicles) {
    const route = routeMap[v.assignedRouteId];
    if (!route) continue;
    simulatorStates[v.vehicleId] = {
      vehicle: v,
      route,
      segmentIndex: Math.floor(Math.random() * (route.geometry.coordinates.length - 1)),
      progress: Math.random(),
      direction: Math.random() > 0.5 ? 1 : -1,
      tripCount: 0
    };
  }

  simulatorStats = { ticks: 0, totalEvents: 0, startedAt: new Date() };

  simulatorInterval = setInterval(async () => {
    try {
      const db = getDB();
      const batch = [];
      const now = new Date();

      for (const [vehicleId, state] of Object.entries(simulatorStates)) {
        const coords = state.route.geometry.coordinates;
        let fromCoord, toCoord;

        if (state.direction === 1) {
          fromCoord = coords[state.segmentIndex];
          toCoord = coords[Math.min(state.segmentIndex + 1, coords.length - 1)];
        } else {
          fromCoord = coords[Math.min(state.segmentIndex + 1, coords.length - 1)];
          toCoord = coords[state.segmentIndex];
        }

        const lon = fromCoord[0] + (toCoord[0] - fromCoord[0]) * state.progress;
        const lat = fromCoord[1] + (toCoord[1] - fromCoord[1]) * state.progress;
        const noiseLon = (Math.random() - 0.5) * 0.0002;
        const noiseLat = (Math.random() - 0.5) * 0.0002;

        let speed = 15 + Math.random() * 45;
        if (state.progress < 0.05 && Math.random() < 0.3) speed = 0;

        const heading = Math.atan2(toCoord[0] - fromCoord[0], toCoord[1] - fromCoord[1]) * 180 / Math.PI;

        batch.push({
          timestamp: now,
          metadata: {
            vehicleId: state.vehicle.vehicleId,
            depotId: state.vehicle.depotId,
            routeId: state.vehicle.assignedRouteId,
            tripId: `TRIP-${vehicleId}-RT-${state.tripCount}`
          },
          location: { type: 'Point', coordinates: [lon + noiseLon, lat + noiseLat] },
          speed: Math.round(speed * 10) / 10,
          heading: Math.round(((heading % 360) + 360) % 360),
          altitude: 900 + Math.random() * 20,
          ignition: speed > 0 || Math.random() > 0.1,
          satellites: 8 + Math.floor(Math.random() * 6),
          odometer: 50000 + Math.random() * 1000
        });

        // Update vehicle_current_state
        await db.collection('vehicle_current_state').updateOne(
          { vehicleId },
          { $set: {
            location: { type: 'Point', coordinates: [lon + noiseLon, lat + noiseLat] },
            speed: Math.round(speed * 10) / 10,
            heading: Math.round(((heading % 360) + 360) % 360),
            ignition: speed > 0 || Math.random() > 0.1,
            status: speed > 0 ? 'running' : 'idle',
            lastUpdated: now
          }},
          { upsert: true }
        );

        // Advance position
        state.progress += 0.02 + Math.random() * 0.03;
        if (state.progress >= 1) {
          state.progress = 0;
          state.segmentIndex += state.direction;
          if (state.segmentIndex >= coords.length - 1) {
            state.direction = -1;
            state.segmentIndex = coords.length - 2;
            state.tripCount++;
          } else if (state.segmentIndex <= 0) {
            state.direction = 1;
            state.segmentIndex = 0;
            state.tripCount++;
          }
        }
      }

      if (batch.length > 0) {
        await db.collection('gps_events').insertMany(batch);
      }
      simulatorStats.ticks++;
      simulatorStats.totalEvents += batch.length;
    } catch (err) {
      console.error('Simulator tick error:', err.message);
    }
  }, 10000); // Every 10 seconds

  res.json({ running: true, message: 'Simulator started — 50 GPS events every 10 seconds', stats: simulatorStats });
});

// POST /api/admin/simulator/stop
router.post('/simulator/stop', (req, res) => {
  if (!simulatorInterval) {
    return res.json({ running: false, message: 'Simulator is not running' });
  }
  clearInterval(simulatorInterval);
  simulatorInterval = null;
  res.json({ running: false, message: 'Simulator stopped', stats: simulatorStats });
});

// GET /api/admin/simulator/status
router.get('/simulator/status', (req, res) => {
  res.json({
    running: !!simulatorInterval,
    stats: simulatorStats
  });
});

module.exports = router;
