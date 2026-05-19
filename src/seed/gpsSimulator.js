const { connectDB } = require('../config/database');
require('dotenv').config();

// Simulate realistic bus movement along routes
async function simulateGPS() {
  const db = await connectDB();

  const vehicles = await db.collection('vehicles').find({}).toArray();
  const routes = await db.collection('routes').find({}).toArray();
  const routeMap = {};
  routes.forEach(r => { routeMap[r.routeId] = r; });

  // Load route stops for interpolation
  const busStops = await db.collection('bus_stops').find({}).toArray();
  const stopMap = {};
  busStops.forEach(s => { stopMap[s.stopId] = s; });

  console.log(`🚌 Starting GPS simulation for ${vehicles.length} vehicles...`);
  console.log('   Generating 1 day of history + continuous real-time updates');

  // Generate 1 day of historical data first
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let totalInserted = 0;
  const batchSize = 1000;
  let batch = [];

  // Pre-seed some alerts for demo
  const alertTypes = ['overspeed', 'harsh_braking', 'harsh_acceleration', 'unauthorized_stop', 'breakdown', 'panic', 'stop_skipped', 'route_deviation'];

  for (const vehicle of vehicles) {
    const route = routeMap[vehicle.assignedRouteId];
    if (!route) continue;

    const coords = route.geometry.coordinates;
    let currentTime = new Date(oneDayAgo);
    let segmentIndex = 0;
    let progress = 0; // 0 to 1 within current segment
    let direction = 1; // 1 = forward, -1 = reverse
    let tripCount = 0;

    while (currentTime < now) {
      // Calculate position between two route points (direction-aware)
      let fromCoord, toCoord;
      if (direction === 1) {
        fromCoord = coords[segmentIndex];
        toCoord = coords[Math.min(segmentIndex + 1, coords.length - 1)];
      } else {
        fromCoord = coords[Math.min(segmentIndex + 1, coords.length - 1)];
        toCoord = coords[segmentIndex];
      }

      // Interpolate position
      const lon = fromCoord[0] + (toCoord[0] - fromCoord[0]) * progress;
      const lat = fromCoord[1] + (toCoord[1] - fromCoord[1]) * progress;

      // Add some noise for realism
      const noiseLon = (Math.random() - 0.5) * 0.0003;
      const noiseLat = (Math.random() - 0.5) * 0.0003;

      // Simulate speed (0-80 km/h)
      let speed = 20 + Math.random() * 40;
      const isAtStop = progress < 0.05 && Math.random() < 0.3;
      if (isAtStop) speed = 0;

      // Occasionally simulate overspeed
      const isOverspeeding = Math.random() < 0.005;
      if (isOverspeeding) speed = 75 + Math.random() * 20;

      // Calculate heading
      const heading = Math.atan2(toCoord[0] - fromCoord[0], toCoord[1] - fromCoord[1]) * 180 / Math.PI;

      const gpsEvent = {
        timestamp: new Date(currentTime),
        metadata: {
          vehicleId: vehicle.vehicleId,
          depotId: vehicle.depotId,
          routeId: vehicle.assignedRouteId,
          tripId: `TRIP-${vehicle.vehicleId}-${tripCount}`
        },
        location: {
          type: 'Point',
          coordinates: [lon + noiseLon, lat + noiseLat]
        },
        speed: Math.round(speed * 10) / 10,
        heading: Math.round(((heading % 360) + 360) % 360),
        altitude: 900 + Math.random() * 20,
        ignition: speed > 0 || Math.random() > 0.1,
        satellites: 8 + Math.floor(Math.random() * 6),
        odometer: 50000 + totalInserted * 0.1
      };

      batch.push(gpsEvent);

      if (batch.length >= batchSize) {
        await db.collection('gps_events').insertMany(batch);
        totalInserted += batch.length;
        batch = [];
        if (totalInserted % 10000 === 0) {
          process.stdout.write(`\r   Inserted ${totalInserted.toLocaleString()} GPS events...`);
        }
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

      // Advance time by 10 seconds
      currentTime = new Date(currentTime.getTime() + 10000);

      // Simulate signal loss (2-minute gap) occasionally
      if (Math.random() < 0.0005) {
        currentTime = new Date(currentTime.getTime() + 120000);
      }
    }

    // Update vehicle_current_state with last known position
    const lastCoord = coords[segmentIndex];
    await db.collection('vehicle_current_state').updateOne(
      { vehicleId: vehicle.vehicleId },
      {
        $set: {
          vehicleId: vehicle.vehicleId,
          depotId: vehicle.depotId,
          routeId: vehicle.assignedRouteId,
          location: { type: 'Point', coordinates: [lastCoord[0], lastCoord[1]] },
          speed: Math.round(Math.random() * 50),
          heading: Math.round(Math.random() * 360),
          ignition: true,
          status: 'running',
          lastUpdated: now,
          tripId: `TRIP-${vehicle.vehicleId}-${tripCount}`
        }
      },
      { upsert: true }
    );
  }

  // Insert remaining batch
  if (batch.length > 0) {
    await db.collection('gps_events').insertMany(batch);
    totalInserted += batch.length;
  }

  console.log(`\n✓ Inserted ${totalInserted.toLocaleString()} GPS events (historical)`);

  // Generate sample alerts
  const sampleAlerts = [];
  const alertVehicles = vehicles.slice(0, 15);
  for (let i = 0; i < alertVehicles.length; i++) {
    const v = alertVehicles[i];
    const route = routeMap[v.assignedRouteId];
    const coord = route.geometry.coordinates[Math.floor(Math.random() * route.geometry.coordinates.length)];
    const alertTime = new Date(now.getTime() - Math.random() * 12 * 60 * 60 * 1000);

    const type = alertTypes[i % alertTypes.length];
    const alert = {
      alertId: `ALT-${Date.now()}-${i}`,
      vehicleId: v.vehicleId,
      depotId: v.depotId,
      routeId: v.assignedRouteId,
      type: type,
      severity: type === 'panic' ? 'critical' : (type === 'breakdown' ? 'high' : 'medium'),
      status: i < 5 ? 'active' : 'acknowledged',
      timestamp: alertTime,
      location: { type: 'Point', coordinates: coord },
      details: getAlertDetails(type),
      acknowledgedBy: i >= 5 ? 'operator1' : null,
      acknowledgedAt: i >= 5 ? new Date(alertTime.getTime() + 60000) : null
    };
    sampleAlerts.push(alert);
  }

  // Add more alerts for demo variety
  for (let i = 0; i < 30; i++) {
    const v = vehicles[Math.floor(Math.random() * vehicles.length)];
    const route = routeMap[v.assignedRouteId];
    const coord = route.geometry.coordinates[Math.floor(Math.random() * route.geometry.coordinates.length)];
    const type = alertTypes[Math.floor(Math.random() * alertTypes.length)];
    sampleAlerts.push({
      alertId: `ALT-${Date.now()}-H-${i}`,
      vehicleId: v.vehicleId,
      depotId: v.depotId,
      routeId: v.assignedRouteId,
      type: type,
      severity: type === 'panic' ? 'critical' : (type === 'breakdown' ? 'high' : 'medium'),
      status: 'closed',
      timestamp: new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000),
      location: { type: 'Point', coordinates: coord },
      details: getAlertDetails(type),
      closedBy: 'system',
      closedAt: new Date(now.getTime() - Math.random() * 12 * 60 * 60 * 1000)
    });
  }

  await db.collection('alerts').insertMany(sampleAlerts);
  console.log(`✓ Seeded ${sampleAlerts.length} alerts`);

  console.log('\n✅ Simulation complete!');
  console.log('\n🔄 Starting real-time simulation...');

  // Now run continuous real-time simulation
  await runRealtimeSimulation(db, vehicles, routeMap);
}

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

async function runRealtimeSimulation(db, vehicles, routeMap) {
  // Track current position of each vehicle
  const vehicleStates = {};
  for (const v of vehicles) {
    const route = routeMap[v.assignedRouteId];
    vehicleStates[v.vehicleId] = {
      segmentIndex: Math.floor(Math.random() * (route.geometry.coordinates.length - 1)),
      progress: Math.random(),
      direction: Math.random() > 0.5 ? 1 : -1,
      tripCount: 0
    };
  }

  setInterval(async () => {
    const batch = [];
    const now = new Date();

    for (const vehicle of vehicles) {
      const route = routeMap[vehicle.assignedRouteId];
      if (!route) continue;
      const coords = route.geometry.coordinates;
      const state = vehicleStates[vehicle.vehicleId];

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
          vehicleId: vehicle.vehicleId,
          depotId: vehicle.depotId,
          routeId: vehicle.assignedRouteId,
          tripId: `TRIP-${vehicle.vehicleId}-RT-${state.tripCount}`
        },
        location: { type: 'Point', coordinates: [lon + noiseLon, lat + noiseLat] },
        speed: Math.round(speed * 10) / 10,
        heading: Math.round(((heading % 360) + 360) % 360),
        altitude: 900 + Math.random() * 20,
        ignition: speed > 0 || Math.random() > 0.1,
        satellites: 8 + Math.floor(Math.random() * 6),
        odometer: 50000 + Math.random() * 1000
      });

      // Update current state
      await db.collection('vehicle_current_state').updateOne(
        { vehicleId: vehicle.vehicleId },
        {
          $set: {
            location: { type: 'Point', coordinates: [lon + noiseLon, lat + noiseLat] },
            speed: Math.round(speed * 10) / 10,
            heading: Math.round(((heading % 360) + 360) % 360),
            ignition: speed > 0 || Math.random() > 0.1,
            status: speed > 0 ? 'running' : 'idle',
            lastUpdated: now
          }
        },
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

    // Batch insert GPS events
    if (batch.length > 0) {
      await db.collection('gps_events').insertMany(batch);
    }

    console.log(`[${now.toISOString()}] Inserted ${batch.length} GPS events`);
  }, 10000); // Every 10 seconds
}

simulateGPS().catch(err => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
