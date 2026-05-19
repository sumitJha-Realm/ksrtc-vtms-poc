const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');

// GET /api/reports/tracking-summary — Vehicle Tracking Summary
router.get('/tracking-summary', async (req, res) => {
  const db = getDB();
  const { depotId, date } = req.query;
  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
  const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

  const matchStage = { timestamp: { $gte: startOfDay, $lte: endOfDay } };
  if (depotId) matchStage['metadata.depotId'] = depotId;

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: '$metadata.vehicleId',
        totalPings: { $sum: 1 },
        firstPing: { $first: '$timestamp' },
        lastPing: { $last: '$timestamp' },
        maxSpeed: { $max: '$speed' },
        avgSpeed: { $avg: '$speed' },
        startLocation: { $first: '$location' },
        endLocation: { $last: '$location' },
        depotId: { $first: '$metadata.depotId' },
        routeId: { $first: '$metadata.routeId' }
      }
    },
    {
      $addFields: {
        operatingHours: {
          $round: [{ $divide: [{ $dateDiff: { startDate: '$firstPing', endDate: '$lastPing', unit: 'minute' } }, 60] }, 1]
        },
        estimatedKm: { $round: [{ $multiply: [{ $divide: ['$avgSpeed', 60] }, { $dateDiff: { startDate: '$firstPing', endDate: '$lastPing', unit: 'minute' } }] }, 1] }
      }
    },
    { $sort: { _id: 1 } }
  ];

  const summary = await db.collection('gps_events').aggregate(pipeline).toArray();
  res.json({ report: 'Vehicle Tracking Summary', date: startOfDay, vehicles: summary });
});

// GET /api/reports/overspeed — Overspeeding Violations
router.get('/overspeed', async (req, res) => {
  const db = getDB();
  const { depotId, from, to } = req.query;
  const filter = { type: 'overspeed' };
  if (depotId) filter.depotId = depotId;
  if (from && to) filter.timestamp = { $gte: new Date(from), $lte: new Date(to) };

  const violations = await db.collection('alerts')
    .find(filter)
    .sort({ timestamp: -1 })
    .toArray();

  // Aggregation by vehicle
  const byVehicle = await db.collection('alerts').aggregate([
    { $match: filter },
    { $group: { _id: '$vehicleId', count: { $sum: 1 }, maxSpeed: { $max: '$details.speed' } } },
    { $sort: { count: -1 } }
  ]).toArray();

  res.json({ report: 'Overspeeding Violations', violations, byVehicle, total: violations.length });
});

// GET /api/reports/schedule-adherence — using window functions
router.get('/schedule-adherence', async (req, res) => {
  const db = getDB();
  const { vehicleId, date } = req.query;
  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(new Date(targetDate).setHours(0, 0, 0, 0));
  const endOfDay = new Date(new Date(targetDate).setHours(23, 59, 59, 999));

  // Get schedule for this vehicle
  const schedules = await db.collection('schedules')
    .find(vehicleId ? { vehicleId } : {})
    .limit(20)
    .toArray();

  // Get actual GPS data near bus stops using time series window functions
  const matchFilter = { timestamp: { $gte: startOfDay, $lte: endOfDay } };
  if (vehicleId) matchFilter['metadata.vehicleId'] = vehicleId;

  const pipeline = [
    { $match: matchFilter },
    {
      $setWindowFields: {
        partitionBy: '$metadata.vehicleId',
        sortBy: { timestamp: 1 },
        output: {
          prevSpeed: { $shift: { output: '$speed', by: -1 } },
          // Detect stops: speed drops to 0 from >0
          stoppedAt: {
            $sum: { $cond: [{ $and: [{ $lte: ['$speed', 2] }, { $gt: ['$prevSpeed', 5] }] }, 1, 0] },
            window: { documents: ['unbounded', 'current'] }
          }
        }
      }
    },
    { $match: { speed: { $lte: 2 } } },
    {
      $group: {
        _id: { vehicleId: '$metadata.vehicleId', stopEvent: '$stoppedAt' },
        arrivalTime: { $first: '$timestamp' },
        location: { $first: '$location' }
      }
    },
    { $sort: { arrivalTime: 1 } },
    { $limit: 100 }
  ];

  const actualStops = await db.collection('gps_events').aggregate(pipeline).toArray();

  res.json({
    report: 'Schedule Adherence',
    date: startOfDay,
    schedules: schedules.slice(0, 5),
    actualStopEvents: actualStops,
    note: 'Compare actualStopEvents timestamps with schedule expected times to compute deviation'
  });
});

// GET /api/reports/harsh-events — Harsh Braking/Acceleration using window functions
router.get('/harsh-events', async (req, res) => {
  const db = getDB();
  const { vehicleId, from, to } = req.query;
  const startDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const endDate = to ? new Date(to) : new Date();

  const matchFilter = { timestamp: { $gte: startDate, $lte: endDate } };
  if (vehicleId) matchFilter['metadata.vehicleId'] = vehicleId;

  // Use $setWindowFields to compute acceleration between consecutive pings
  const pipeline = [
    { $match: matchFilter },
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
        timeDeltaSec: {
          $cond: {
            if: { $eq: ['$prevTimestamp', null] },
            then: 10,
            else: { $dateDiff: { startDate: '$prevTimestamp', endDate: '$timestamp', unit: 'second' } }
          }
        },
        speedDelta: {
          $cond: {
            if: { $eq: ['$prevSpeed', null] },
            then: 0,
            else: { $subtract: ['$speed', '$prevSpeed'] }
          }
        }
      }
    },
    {
      $addFields: {
        // Convert km/h change to m/s² (divide by 3.6, then by timeDelta)
        accelerationMs2: {
          $cond: {
            if: { $eq: ['$timeDeltaSec', 0] },
            then: 0,
            else: { $divide: [{ $divide: ['$speedDelta', 3.6] }, '$timeDeltaSec'] }
          }
        }
      }
    },
    {
      $match: {
        $or: [
          { accelerationMs2: { $lt: -2 } },   // Harsh braking (< -2 m/s²)
          { accelerationMs2: { $gt: 2 } }     // Harsh acceleration (> 2 m/s²)
        ]
      }
    },
    {
      $project: {
        _id: 0,
        vehicleId: '$metadata.vehicleId',
        timestamp: 1,
        location: 1,
        speed: 1,
        prevSpeed: 1,
        accelerationMs2: { $round: ['$accelerationMs2', 2] },
        eventType: { $cond: [{ $lt: ['$accelerationMs2', 0] }, 'harsh_braking', 'harsh_acceleration'] }
      }
    },
    { $sort: { timestamp: -1 } },
    { $limit: 100 }
  ];

  const events = await db.collection('gps_events').aggregate(pipeline).toArray();
  res.json({
    report: 'Harsh Driving Events (Window Function Analysis)',
    period: { from: startDate, to: endDate },
    events,
    total: events.length,
    note: 'Computed using $setWindowFields — acceleration derived from consecutive GPS readings'
  });
});

// GET /api/reports/unauthorized-stops — using window functions
router.get('/unauthorized-stops', async (req, res) => {
  const db = getDB();
  const { vehicleId, from, to } = req.query;
  const startDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const endDate = to ? new Date(to) : new Date();

  const matchFilter = { timestamp: { $gte: startDate, $lte: endDate } };
  if (vehicleId) matchFilter['metadata.vehicleId'] = vehicleId;

  // Detect sustained stationary periods (>3 min = 18 consecutive pings at speed 0)
  const pipeline = [
    { $match: matchFilter },
    {
      $setWindowFields: {
        partitionBy: '$metadata.vehicleId',
        sortBy: { timestamp: 1 },
        output: {
          // Count consecutive low-speed pings in a 3-minute window (18 pings × 10s)
          stationaryCount: {
            $sum: { $cond: [{ $lte: ['$speed', 2] }, 1, 0] },
            window: { documents: [-17, 0] }
          }
        }
      }
    },
    // Only keep points where vehicle has been stationary for full 3 minutes
    { $match: { stationaryCount: { $gte: 18 }, speed: { $lte: 2 } } },
    // Group consecutive stationary events
    {
      $group: {
        _id: {
          vehicleId: '$metadata.vehicleId',
          // Group by rough time (5 min buckets)
          timeBucket: { $dateTrunc: { date: '$timestamp', unit: 'minute', binSize: 5 } }
        },
        startTime: { $first: '$timestamp' },
        endTime: { $last: '$timestamp' },
        location: { $first: '$location' },
        pingsCount: { $sum: 1 }
      }
    },
    {
      $addFields: {
        durationMinutes: { $round: [{ $divide: [{ $dateDiff: { startDate: '$startTime', endDate: '$endTime', unit: 'second' } }, 60] }, 1] }
      }
    },
    { $match: { durationMinutes: { $gte: 3 } } },
    { $sort: { startTime: -1 } },
    { $limit: 50 }
  ];

  const stops = await db.collection('gps_events').aggregate(pipeline).toArray();
  res.json({
    report: 'Unauthorized Stops (Window Function Detection)',
    period: { from: startDate, to: endDate },
    stops,
    total: stops.length,
    note: 'Detected via $setWindowFields counting consecutive stationary pings over 3-minute sliding window'
  });
});

// GET /api/reports/breakdown — Breakdown incidents
router.get('/breakdown', async (req, res) => {
  const db = getDB();
  const filter = { type: 'breakdown' };
  const { depotId, from, to } = req.query;
  if (depotId) filter.depotId = depotId;
  if (from && to) filter.timestamp = { $gte: new Date(from), $lte: new Date(to) };

  const incidents = await db.collection('alerts').find(filter).sort({ timestamp: -1 }).toArray();
  res.json({ report: 'Breakdown Incidents', incidents, total: incidents.length });
});

// GET /api/reports/depot-status — Depot-wise Vehicle Status
router.get('/depot-status', async (req, res) => {
  const db = getDB();
  const status = await db.collection('vehicle_current_state').aggregate([
    {
      $group: {
        _id: '$depotId',
        total: { $sum: 1 },
        running: { $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] } },
        idle: { $sum: { $cond: [{ $eq: ['$status', 'idle'] }, 1, 0] } },
        stopped: { $sum: { $cond: [{ $eq: ['$status', 'stopped'] }, 1, 0] } },
        avgSpeed: { $avg: '$speed' }
      }
    },
    {
      $lookup: { from: 'depots', localField: '_id', foreignField: 'depotId', as: 'depot' }
    },
    { $unwind: '$depot' },
    { $project: { depotId: '$_id', depotName: '$depot.name', division: '$depot.division', total: 1, running: 1, idle: 1, stopped: 1, avgSpeed: { $round: ['$avgSpeed', 1] } } }
  ]).toArray();

  res.json({ report: 'Depot-wise Vehicle Status', depots: status });
});

// GET /api/reports/stop-skipping — Bus Stop Skipping using window functions
router.get('/stop-skipping', async (req, res) => {
  const db = getDB();
  const alerts = await db.collection('alerts')
    .find({ type: 'stop_skipped' })
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray();

  res.json({ report: 'Bus Stop Skipping', incidents: alerts, total: alerts.length });
});

// GET /api/reports/panic — Panic/SOS events
router.get('/panic', async (req, res) => {
  const db = getDB();
  const events = await db.collection('alerts')
    .find({ type: 'panic' })
    .sort({ timestamp: -1 })
    .toArray();

  res.json({ report: 'Panic/SOS Events', events, total: events.length });
});

// GET /api/reports/event-context — GPS trail around a specific event for map visualization
router.get('/event-context', async (req, res) => {
  const db = getDB();
  const { vehicleId, timestamp, minutes = 2 } = req.query;

  if (!vehicleId || !timestamp) {
    return res.status(400).json({ error: 'vehicleId and timestamp required' });
  }

  const eventTime = new Date(timestamp);
  const halfWindow = parseInt(minutes) * 60 * 1000;
  const before = new Date(eventTime.getTime() - halfWindow);
  const after = new Date(eventTime.getTime() + halfWindow);

  const pipeline = [
    {
      $match: {
        'metadata.vehicleId': vehicleId,
        timestamp: { $gte: before, $lte: after }
      }
    },
    { $sort: { timestamp: 1 } },
    {
      $setWindowFields: {
        partitionBy: '$metadata.vehicleId',
        sortBy: { timestamp: 1 },
        output: {
          prevSpeed: { $shift: { output: '$speed', by: -1 } }
        }
      }
    },
    {
      $project: {
        _id: 0, timestamp: 1, location: 1, speed: 1, heading: 1, prevSpeed: 1,
        metadata: 1
      }
    }
  ];

  const trail = await db.collection('gps_events').aggregate(pipeline).toArray();

  // Get route geometry
  let routeGeometry = null;
  if (trail.length > 0 && trail[0].metadata?.routeId) {
    const route = await db.collection('routes').findOne({ routeId: trail[0].metadata.routeId });
    if (route) routeGeometry = route.geometry;
  }

  res.json({ trail, routeGeometry, eventTime: eventTime.toISOString() });
});

module.exports = router;
