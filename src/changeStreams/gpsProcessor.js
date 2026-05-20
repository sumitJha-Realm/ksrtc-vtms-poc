const { getDB, getClient } = require('../config/database');
const turf = require('@turf/turf');

let geofenceCache = [];
let routeCache = {};  // routeId -> turf LineString
let routeStopsCache = {}; // routeId -> [{ stopId, name, sequence, coordinates, distanceAlongKm }]
let stopByIdCache = {}; // stopId -> stop doc
let changeStream = null;

const ROUTE_DEVIATION_THRESHOLD_METERS = 100;
const ETA_COLLECTION = 'trip_eta_predictions';
const ETA_DWELL_SECONDS = Number(process.env.ETA_DWELL_SECONDS || 20);
const ETA_MIN_MOVING_SPEED_KMH = Number(process.env.ETA_MIN_MOVING_SPEED_KMH || 12);
const ETA_MAX_DOWNSTREAM_STOPS = Number(process.env.ETA_MAX_DOWNSTREAM_STOPS || 8);

async function loadGeofences(db) {
  geofenceCache = await db.collection('geofences').find({}).toArray();
  console.log(`   Loaded ${geofenceCache.length} geofences into memory cache`);
}

async function loadRoutes(db) {
  const routes = await db.collection('routes').find({}).toArray();
  const stops = await db.collection('bus_stops').find({}).toArray();

  stopByIdCache = {};
  for (const stop of stops) {
    stopByIdCache[stop.stopId] = stop;
  }

  routeCache = {};
  routeStopsCache = {};

  for (const route of routes) {
    if (route.geometry && route.geometry.coordinates && route.geometry.coordinates.length >= 2) {
      const line = turf.lineString(route.geometry.coordinates);
      routeCache[route.routeId] = line;

      const orderedStops = [];
      if (Array.isArray(route.stopIds)) {
        for (let i = 0; i < route.stopIds.length; i++) {
          const stopId = route.stopIds[i];
          const stop = stopByIdCache[stopId];
          if (!stop || !stop.location || !Array.isArray(stop.location.coordinates)) continue;

          const stopPoint = turf.point(stop.location.coordinates);
          const nearest = turf.nearestPointOnLine(line, stopPoint, { units: 'kilometers' });

          orderedStops.push({
            stopId,
            name: stop.name,
            sequence: i + 1,
            coordinates: stop.location.coordinates,
            distanceAlongKm: nearest.properties.location
          });
        }
      }
      routeStopsCache[route.routeId] = orderedStops;
    }
  }
  console.log(`   Loaded ${Object.keys(routeCache).length} routes into memory cache (+ stop order for ETA)`);
}

function estimateDownstreamEta(event) {
  const routeId = event.metadata.routeId;
  const routeLine = routeCache[routeId];
  const routeStops = routeStopsCache[routeId];

  if (!routeId || !routeLine || !Array.isArray(routeStops) || routeStops.length === 0) {
    return null;
  }

  if (!event.location || !Array.isArray(event.location.coordinates)) {
    return null;
  }

  const busPoint = turf.point(event.location.coordinates);
  const snapped = turf.nearestPointOnLine(routeLine, busPoint, { units: 'kilometers' });
  const currentDistanceAlongKm = snapped.properties.location;

  const effectiveSpeedKmh = Math.max(Number(event.speed) || 0, ETA_MIN_MOVING_SPEED_KMH);
  const nowTs = event.timestamp ? new Date(event.timestamp) : new Date();

  // Find next stop ahead of current projected position.
  let nextStopIndex = routeStops.findIndex((s) => s.distanceAlongKm >= currentDistanceAlongKm);
  if (nextStopIndex === -1) nextStopIndex = routeStops.length - 1;

  const etaStops = [];
  for (let i = nextStopIndex; i < routeStops.length && etaStops.length < ETA_MAX_DOWNSTREAM_STOPS; i++) {
    const stop = routeStops[i];
    const remainingKm = Math.max(0, stop.distanceAlongKm - currentDistanceAlongKm);
    const travelSeconds = Math.round((remainingKm / effectiveSpeedKmh) * 3600);

    // Add small cumulative dwell for intermediate stops to avoid too-optimistic ETAs.
    const stopsAhead = i - nextStopIndex;
    const dwellSeconds = stopsAhead * ETA_DWELL_SECONDS;
    const etaTs = new Date(nowTs.getTime() + (travelSeconds + dwellSeconds) * 1000);

    etaStops.push({
      stopId: stop.stopId,
      stopName: stop.name,
      sequence: stop.sequence,
      remainingKm: Number(remainingKm.toFixed(2)),
      eta: etaTs,
      etd: new Date(etaTs.getTime() + ETA_DWELL_SECONDS * 1000)
    });
  }

  return {
    routeId,
    effectiveSpeedKmh,
    currentDistanceAlongKm: Number(currentDistanceAlongKm.toFixed(2)),
    nextStopSequence: routeStops[nextStopIndex] ? routeStops[nextStopIndex].sequence : null,
    stops: etaStops
  };
}

async function upsertEtaPrediction(db, event, etaResult) {
  if (!etaResult) return;

  const vehicleId = event.metadata.vehicleId;
  if (!vehicleId) return;

  await db.collection(ETA_COLLECTION).updateOne(
    { vehicleId },
    {
      $set: {
        vehicleId,
        routeId: etaResult.routeId,
        tripId: event.metadata.tripId || null,
        depotId: event.metadata.depotId,
        currentLocation: event.location,
        currentSpeed: event.speed,
        effectiveSpeedKmh: etaResult.effectiveSpeedKmh,
        currentDistanceAlongKm: etaResult.currentDistanceAlongKm,
        nextStopSequence: etaResult.nextStopSequence,
        predictions: etaResult.stops,
        updatedAt: new Date(),
        source: 'change_stream_worker'
      }
    },
    { upsert: true }
  );
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

  // 4. ETA/ETD cascade for downstream stops (real-time, per ping)
  const etaResult = estimateDownstreamEta(event);
  await upsertEtaPrediction(db, event, etaResult);
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
