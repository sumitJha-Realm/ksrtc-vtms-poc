const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');

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

  const [currentState, vehicleInfo, recentAlerts] = await Promise.all([
    db.collection('vehicle_current_state').findOne({ vehicleId }),
    db.collection('vehicles').findOne({ vehicleId }),
    db.collection('alerts').find({ vehicleId }).sort({ timestamp: -1 }).limit(10).toArray()
  ]);

  res.json({ currentState, vehicleInfo, recentAlerts });
});

module.exports = router;
