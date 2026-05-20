const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { getTimingSnapshot } = require('../services/timingMetrics');

// GET /api/dashboard/summary — real-time fleet summary
router.get('/summary', async (req, res) => {
  const db = getDB();
  const pipeline = [
    {
      $group: {
        _id: null,
        totalVehicles: { $sum: 1 },
        running: { $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] } },
        idle: { $sum: { $cond: [{ $eq: ['$status', 'idle'] }, 1, 0] } },
        stopped: { $sum: { $cond: [{ $eq: ['$status', 'stopped'] }, 1, 0] } },
        avgSpeed: { $avg: '$speed' }
      }
    }
  ];
  const [summary] = await db.collection('vehicle_current_state').aggregate(pipeline).toArray();

  // Active alerts count
  const alertCounts = await db.collection('alerts').aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$type', count: { $sum: 1 } } }
  ]).toArray();

  // Depot-wise summary
  const depotSummary = await db.collection('vehicle_current_state').aggregate([
    {
      $group: {
        _id: '$depotId',
        total: { $sum: 1 },
        running: { $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] } },
        idle: { $sum: { $cond: [{ $eq: ['$status', 'idle'] }, 1, 0] } }
      }
    },
    {
      $lookup: {
        from: 'depots',
        localField: '_id',
        foreignField: 'depotId',
        as: 'depot'
      }
    },
    { $unwind: '$depot' },
    { $project: { depotId: '$_id', name: '$depot.name', location: { type: 'Point', coordinates: ['$depot.lon', '$depot.lat'] }, total: 1, running: 1, idle: 1 } }
  ]).toArray();

  res.json({
    fleet: summary || { totalVehicles: 0, running: 0, idle: 0, stopped: 0, avgSpeed: 0 },
    activeAlerts: alertCounts,
    depots: depotSummary,
    timestamp: new Date()
  });
});

// GET /api/dashboard/vehicles — all vehicle positions (polled every 3s)
router.get('/vehicles', async (req, res) => {
  const db = getDB();
  const { depotId, status } = req.query;
  const filter = {};
  if (depotId) filter.depotId = depotId;
  if (status) filter.status = status;

  const vehicles = await db.collection('vehicle_current_state')
    .find(filter)
    .project({ vehicleId: 1, location: 1, speed: 1, heading: 1, status: 1, depotId: 1, routeId: 1, lastUpdated: 1, ignition: 1 })
    .toArray();

  res.json({ vehicles, count: vehicles.length, timestamp: new Date() });
});

// GET /api/dashboard/vehicle/:vehicleId — single vehicle detail
router.get('/vehicle/:vehicleId', async (req, res) => {
  const db = getDB();
  const { vehicleId } = req.params;

  const [currentState, vehicleInfo, recentAlerts, etaPrediction] = await Promise.all([
    db.collection('vehicle_current_state').findOne({ vehicleId }),
    db.collection('vehicles').findOne({ vehicleId }),
    db.collection('alerts').find({ vehicleId }).sort({ timestamp: -1 }).limit(10).toArray(),
    db.collection('trip_eta_predictions').findOne({ vehicleId })
  ]);

  res.json({ currentState, vehicleInfo, recentAlerts, etaPrediction });
});

// GET /api/dashboard/eta/:vehicleId — current downstream ETA/ETD predictions
router.get('/eta/:vehicleId', async (req, res) => {
  const db = getDB();
  const { vehicleId } = req.params;

  const prediction = await db.collection('trip_eta_predictions').findOne({ vehicleId });
  if (!prediction) {
    return res.status(404).json({
      message: 'ETA prediction not available yet for this vehicle',
      vehicleId
    });
  }

  res.json({
    vehicleId,
    routeId: prediction.routeId,
    tripId: prediction.tripId,
    updatedAt: prediction.updatedAt,
    effectiveSpeedKmh: prediction.effectiveSpeedKmh,
    nextStopSequence: prediction.nextStopSequence,
    predictions: prediction.predictions || []
  });
});

// GET /api/dashboard/trip-progress/:vehicleId — sequence-aware stop progress for UI
router.get('/trip-progress/:vehicleId', async (req, res) => {
  const db = getDB();
  const { vehicleId } = req.params;

  const [state, prediction] = await Promise.all([
    db.collection('vehicle_current_state').findOne({ vehicleId }),
    db.collection('trip_eta_predictions').findOne({ vehicleId })
  ]);

  const routeId = (prediction && prediction.routeId) || (state && state.routeId);
  if (!routeId) {
    return res.status(404).json({ message: 'Route not available for vehicle', vehicleId });
  }

  const [route, skippedAlerts] = await Promise.all([
    db.collection('routes').findOne({ routeId }),
    db.collection('alerts').find({ vehicleId, type: 'stop_skipped' }).sort({ timestamp: -1 }).limit(20).toArray()
  ]);

  if (!route || !Array.isArray(route.stopIds) || route.stopIds.length === 0) {
    return res.status(404).json({ message: 'Route stop sequence not found', vehicleId, routeId });
  }

  const stopDocs = await db.collection('bus_stops')
    .find({ stopId: { $in: route.stopIds } })
    .project({ _id: 0, stopId: 1, name: 1 })
    .toArray();

  const stopNameMap = {};
  for (const s of stopDocs) stopNameMap[s.stopId] = s.name;

  const nextSeq = prediction && prediction.nextStopSequence ? prediction.nextStopSequence : 1;

  const skippedStopIds = new Set(
    skippedAlerts
      .map((a) => a && a.details && (a.details.skippedStopId || a.details.stopId || a.details.skippedStop))
      .filter(Boolean)
  );

  const sequence = route.stopIds.map((stopId, idx) => {
    const seq = idx + 1;
    let status = 'pending';
    if (seq < nextSeq) status = 'completed';
    if (seq === nextSeq) status = 'next';
    if (skippedStopIds.has(stopId)) status = 'skipped';

    return {
      sequence: seq,
      stopId,
      stopName: stopNameMap[stopId] || stopId,
      status
    };
  });

  res.json({
    vehicleId,
    routeId,
    nextStopSequence: nextSeq,
    skippedCount: sequence.filter((s) => s.status === 'skipped').length,
    lastUpdated: (prediction && prediction.updatedAt) || (state && state.lastUpdated) || new Date(),
    etaPredictions: (prediction && prediction.predictions) || [],
    sequence
  });
});

// GET /api/dashboard/timing — global DB and operation timing snapshot
router.get('/timing', (req, res) => {
  res.json(getTimingSnapshot());
});

module.exports = router;
