const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');

// GET /api/alerts — list alerts with filters
router.get('/', async (req, res) => {
  const db = getDB();
  const { type, status, depotId, vehicleId, limit = 50 } = req.query;
  const filter = {};
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (depotId) filter.depotId = depotId;
  if (vehicleId) filter.vehicleId = vehicleId;

  const alerts = await db.collection('alerts')
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(parseInt(limit))
    .toArray();

  const counts = await db.collection('alerts').aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$severity', count: { $sum: 1 } } }
  ]).toArray();

  res.json({ alerts, activeCounts: counts, total: alerts.length });
});

// PUT /api/alerts/:alertId/acknowledge
router.put('/:alertId/acknowledge', async (req, res) => {
  const db = getDB();
  const { alertId } = req.params;
  const { userId } = req.body;

  const result = await db.collection('alerts').updateOne(
    { alertId, status: 'active' },
    { $set: { status: 'acknowledged', acknowledgedBy: userId || 'operator', acknowledgedAt: new Date() } }
  );

  res.json({ success: result.modifiedCount > 0 });
});

// PUT /api/alerts/:alertId/close
router.put('/:alertId/close', async (req, res) => {
  const db = getDB();
  const { alertId } = req.params;
  const { userId, resolution } = req.body;

  const result = await db.collection('alerts').updateOne(
    { alertId },
    { $set: { status: 'closed', closedBy: userId || 'operator', closedAt: new Date(), resolution } }
  );

  res.json({ success: result.modifiedCount > 0 });
});

// GET /api/alerts/:alertId/context — GPS trail around an alert event (±2 min)
router.get('/:alertId/context', async (req, res) => {
  const db = getDB();
  const { alertId } = req.params;

  const alert = await db.collection('alerts').findOne({ alertId });
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  const alertTime = new Date(alert.timestamp);
  const before = new Date(alertTime.getTime() - 2 * 60 * 1000); // 2 min before
  const after = new Date(alertTime.getTime() + 2 * 60 * 1000);  // 2 min after

  const pipeline = [
    {
      $match: {
        'metadata.vehicleId': alert.vehicleId,
        timestamp: { $gte: before, $lte: after }
      }
    },
    { $sort: { timestamp: 1 } },
    {
      $setWindowFields: {
        partitionBy: '$metadata.vehicleId',
        sortBy: { timestamp: 1 },
        output: {
          prevSpeed: { $shift: { output: '$speed', by: -1 } },
          prevTimestamp: { $shift: { output: '$timestamp', by: -1 } }
        }
      }
    },
    {
      $addFields: {
        speedDelta: { $subtract: ['$speed', { $ifNull: ['$prevSpeed', '$speed'] }] },
        isAlertPoint: {
          $and: [
            { $gte: ['$timestamp', new Date(alertTime.getTime() - 5000)] },
            { $lte: ['$timestamp', new Date(alertTime.getTime() + 5000)] }
          ]
        }
      }
    },
    {
      $project: {
        _id: 0, timestamp: 1, location: 1, speed: 1, heading: 1,
        prevSpeed: 1, speedDelta: 1, isAlertPoint: 1
      }
    }
  ];

  const trail = await db.collection('gps_events').aggregate(pipeline).toArray();

  // Get route geometry for reference line
  let routeGeometry = null;
  if (alert.routeId) {
    const route = await db.collection('routes').findOne({ routeId: alert.routeId });
    if (route) routeGeometry = route.geometry;
  }

  res.json({
    alert,
    trail,
    routeGeometry,
    explanation: getAlertExplanation(alert, trail)
  });
});

function getAlertExplanation(alert, trail) {
  const alertPoint = trail.find(p => p.isAlertPoint) || {};
  switch (alert.type) {
    case 'overspeed':
      return `Vehicle was traveling at ${alert.details?.speed || alertPoint.speed || '?'} km/h, exceeding the speed limit of ${alert.details?.limit || 60} km/h. The bus accelerated from ~${alertPoint.prevSpeed || '?'} km/h. Duration: ${alert.details?.duration || 'momentary'}.`;
    case 'harsh_braking':
      return `Vehicle decelerated sharply from ${alert.details?.prevSpeed || alertPoint.prevSpeed || '?'} km/h to ${alert.details?.currentSpeed || alertPoint.speed || '?'} km/h. Deceleration: ${alert.details?.deceleration || 'severe'}. This indicates emergency braking or unsafe driving.`;
    case 'harsh_acceleration':
      return `Vehicle accelerated rapidly from ${alert.details?.prevSpeed || '?'} km/h to ${alert.details?.currentSpeed || '?'} km/h. Acceleration: ${alert.details?.acceleration || 'excessive'}. This indicates aggressive driving behavior.`;
    case 'unauthorized_stop':
      return `Vehicle was stationary for ${alert.details?.duration || '>3 minutes'} at a location ${alert.details?.nearestStop || 'far from'} any scheduled stop. The bus was stopped with ignition on.`;
    case 'route_deviation':
      return `Vehicle deviated ${alert.details?.distance || '200+ meters'} from the assigned route corridor for ${alert.details?.duration || 'an extended period'}. The bus left the designated path.`;
    case 'panic':
      return `Panic/SOS button was activated by ${alert.details?.triggeredBy || 'the driver'}. Message: "${alert.details?.message || 'Emergency'}". Immediate attention required.`;
    case 'stop_skipped':
      return `Vehicle skipped scheduled stop "${alert.details?.skippedStop || 'unknown'}". Expected arrival: ${alert.details?.expectedArrival || '?'}. Next stop reached at: ${alert.details?.nextStopReached || '?'}.`;
    case 'breakdown':
      return `Vehicle appears to have broken down. ${alert.details?.reason || 'Engine stall detected'}. Stationary for ${alert.details?.stationaryDuration || '15+ minutes'}.`;
    default:
      return `Alert triggered at ${new Date(alert.timestamp).toLocaleString()}.`;
  }
}

module.exports = router;
