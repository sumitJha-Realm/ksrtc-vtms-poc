const { getDB, getClient } = require('../config/database');
const turf = require('@turf/turf');

let geofenceCache = [];
let routeCache = {};  // routeId -> turf LineString
let changeStream = null;

const ROUTE_DEVIATION_THRESHOLD_METERS = 100;

async function loadGeofences(db) {
  geofenceCache = await db.collection('geofences').find({}).toArray();
  console.log(`   Loaded ${geofenceCache.length} geofences into memory cache`);
}

async function loadRoutes(db) {
  const routes = await db.collection('routes').find({}).toArray();
  routeCache = {};
  for (const route of routes) {
    if (route.geometry && route.geometry.coordinates && route.geometry.coordinates.length >= 2) {
      routeCache[route.routeId] = turf.lineString(route.geometry.coordinates);
    }
  }
  console.log(`   Loaded ${Object.keys(routeCache).length} routes into memory cache`);
}

function checkRouteDeviation(event) {
  const routeId = event.metadata.routeId;
  if (!routeId || !routeCache[routeId]) return null;

  const busPoint = turf.point(event.location.coordinates);
  const routeLine = routeCache[routeId];
  const nearest = turf.nearestPointOnLine(routeLine, busPoint, { units: 'meters' });
  const distanceFromRoute = nearest.properties.dist;

  if (distanceFromRoute > ROUTE_DEVIATION_THRESHOLD_METERS) {
    return Math.round(distanceFromRoute);
  }
  return null;
}

function checkGeofences(event) {
  const point = turf.point(event.location.coordinates);
  const results = [];
  for (const fence of geofenceCache) {
    try {
      const polygon = turf.polygon(fence.geometry.coordinates);
      if (turf.booleanPointInPolygon(point, polygon)) {
        results.push(fence);
      }
    } catch (e) { /* skip malformed */ }
  }
  return results;
}

async function processGPSEvent(db, event) {
  const vehicleId = event.metadata.vehicleId;

  // 1. Overspeed check
  if (event.speed > 70) {
    await db.collection('alerts').insertOne({
      alertId: `ALT-OS-${Date.now()}-${vehicleId}`,
      vehicleId,
      depotId: event.metadata.depotId,
      routeId: event.metadata.routeId,
      type: 'overspeed',
      severity: event.speed > 85 ? 'critical' : 'medium',
      status: 'active',
      timestamp: event.timestamp,
      location: event.location,
      details: { speed: event.speed, limit: 70 }
    });
  }

  // 2. Geofence check (in-memory)
  const fencesInside = checkGeofences(event);
  // Check if vehicle entered a speed-restricted zone
  for (const fence of fencesInside) {
    if (fence.type === 'speed_restriction' && fence.speedLimit && event.speed > fence.speedLimit) {
      await db.collection('alerts').insertOne({
        alertId: `ALT-GF-${Date.now()}-${vehicleId}`,
        vehicleId,
        depotId: event.metadata.depotId,
        type: 'geofence_speed_violation',
        severity: 'medium',
        status: 'active',
        timestamp: event.timestamp,
        location: event.location,
        details: { zone: fence.name, speed: event.speed, limit: fence.speedLimit }
      });
    }
  }

  // 3. Route corridor deviation check (in-memory, 100m threshold)
  const deviationDistance = checkRouteDeviation(event);
  if (deviationDistance) {
    await db.collection('alerts').insertOne({
      alertId: `ALT-RD-${Date.now()}-${vehicleId}`,
      vehicleId,
      depotId: event.metadata.depotId,
      routeId: event.metadata.routeId,
      type: 'route_deviation',
      severity: deviationDistance > 300 ? 'critical' : 'medium',
      status: 'active',
      timestamp: event.timestamp,
      location: event.location,
      details: { distance: `${deviationDistance}m from corridor`, threshold: `${ROUTE_DEVIATION_THRESHOLD_METERS}m` }
    });
  }
}

async function startChangeStreamProcessor() {
  const db = getDB();

  // Load geofences and routes into memory
  await loadGeofences(db);
  await loadRoutes(db);
  // Refresh every 5 minutes
  setInterval(() => loadGeofences(db), 5 * 60 * 1000);
  setInterval(() => loadRoutes(db), 5 * 60 * 1000);

  console.log('📡 Starting Change Stream processor on vehicle_current_state...');

  try {
    // Watch vehicle_current_state (standard collection) instead of time series
    // The GPS simulator upserts this collection on every ping, so we get the same events
    changeStream = db.collection('vehicle_current_state').watch(
      [{ $match: { operationType: { $in: ['insert', 'update', 'replace'] } } }],
      { fullDocument: 'updateLookup' }
    );

    changeStream.on('change', async (change) => {
      try {
        const doc = change.fullDocument;
        if (doc && doc.vehicleId) {
          // Transform vehicle_current_state doc to event format for processing
          const event = {
            metadata: { vehicleId: doc.vehicleId, depotId: doc.depotId, routeId: doc.routeId },
            location: doc.location,
            speed: doc.speed,
            timestamp: doc.lastUpdated || new Date()
          };
          await processGPSEvent(db, event);
        }
      } catch (err) {
        console.error('Change Stream processing error:', err.message);
      }
    });

    changeStream.on('error', (err) => {
      console.error('Change Stream error:', err.message);
      // Attempt to restart after 5 seconds
      setTimeout(() => startChangeStreamProcessor(), 5000);
    });

    console.log('✓ Change Stream processor running (watching vehicle_current_state)');
  } catch (err) {
    console.error('Failed to start Change Stream:', err.message);
    console.log('  (Change Streams require a replica set — Atlas always has this)');
  }
}

function stopChangeStreamProcessor() {
  if (changeStream) {
    changeStream.close();
    console.log('Change Stream processor stopped');
  }
}

module.exports = { startChangeStreamProcessor, stopChangeStreamProcessor };
