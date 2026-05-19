const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');

// GET /api/playback/:vehicleId — route playback data
router.get('/:vehicleId', async (req, res) => {
  const db = getDB();
  const { vehicleId } = req.params;
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'from and to query params required (ISO date)' });
  }

  const pipeline = [
    {
      $match: {
        'metadata.vehicleId': vehicleId,
        timestamp: { $gte: new Date(from), $lte: new Date(to) }
      }
    },
    { $sort: { timestamp: 1 } },
    // Window function: detect signal gaps
    {
      $setWindowFields: {
        partitionBy: '$metadata.vehicleId',
        sortBy: { timestamp: 1 },
        output: {
          prevTimestamp: { $shift: { output: '$timestamp', by: -1 } },
          prevSpeed: { $shift: { output: '$speed', by: -1 } }
        }
      }
    },
    {
      $addFields: {
        gapSeconds: {
          $cond: {
            if: { $eq: ['$prevTimestamp', null] },
            then: 0,
            else: { $dateDiff: { startDate: '$prevTimestamp', endDate: '$timestamp', unit: 'second' } }
          }
        }
      }
    },
    {
      $addFields: {
        signalLost: { $gt: ['$gapSeconds', 30] }
      }
    },
    {
      $project: {
        _id: 0,
        timestamp: 1,
        location: 1,
        speed: 1,
        heading: 1,
        ignition: 1,
        signalLost: 1,
        gapSeconds: 1
      }
    }
  ];

  const points = await db.collection('gps_events').aggregate(pipeline).toArray();

  // Get alerts during this period for overlay
  const alerts = await db.collection('alerts').find({
    vehicleId,
    timestamp: { $gte: new Date(from), $lte: new Date(to) }
  }).sort({ timestamp: 1 }).toArray();

  // Get route info for reference path
  const vehicleState = await db.collection('vehicle_current_state').findOne({ vehicleId });
  let routeGeometry = null;
  if (vehicleState && vehicleState.routeId) {
    const route = await db.collection('routes').findOne({ routeId: vehicleState.routeId });
    if (route) routeGeometry = route.geometry;
  }

  res.json({
    vehicleId,
    from,
    to,
    totalPoints: points.length,
    points,
    alerts,
    routeGeometry,
    metadata: {
      durationMinutes: points.length > 0 ? Math.round((new Date(to) - new Date(from)) / 60000) : 0,
      signalGaps: points.filter(p => p.signalLost).length,
      maxSpeed: points.length > 0 ? Math.max(...points.map(p => p.speed)) : 0,
      avgSpeed: points.length > 0 ? Math.round(points.reduce((s, p) => s + p.speed, 0) / points.length) : 0
    }
  });
});

// GET /api/playback/:vehicleId/summary — quick trip overview without full point data
router.get('/:vehicleId/summary', async (req, res) => {
  const db = getDB();
  const { vehicleId } = req.params;
  const { from, to } = req.query;

  const pipeline = [
    {
      $match: {
        'metadata.vehicleId': vehicleId,
        timestamp: { $gte: new Date(from), $lte: new Date(to) }
      }
    },
    {
      $group: {
        _id: '$metadata.tripId',
        startTime: { $first: '$timestamp' },
        endTime: { $last: '$timestamp' },
        startLocation: { $first: '$location' },
        endLocation: { $last: '$location' },
        totalPoints: { $sum: 1 },
        maxSpeed: { $max: '$speed' },
        avgSpeed: { $avg: '$speed' }
      }
    },
    { $sort: { startTime: 1 } }
  ];

  const trips = await db.collection('gps_events').aggregate(pipeline).toArray();
  res.json({ vehicleId, trips });
});

module.exports = router;
