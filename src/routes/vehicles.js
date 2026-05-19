const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');

// GET /api/vehicles — list all vehicles
router.get('/', async (req, res) => {
  const db = getDB();
  const { depotId } = req.query;
  const filter = {};
  if (depotId) filter.depotId = depotId;

  const vehicles = await db.collection('vehicles').find(filter).toArray();
  res.json({ vehicles, total: vehicles.length });
});

// GET /api/vehicles/:vehicleId
router.get('/:vehicleId', async (req, res) => {
  const db = getDB();
  const vehicle = await db.collection('vehicles').findOne({ vehicleId: req.params.vehicleId });
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  res.json(vehicle);
});

// GET /api/routes — list all routes
router.get('/routes/list', async (req, res) => {
  const db = getDB();
  const routes = await db.collection('routes').find({}).toArray();
  res.json({ routes });
});

// GET /api/vehicles/routes/:routeId — route detail with stops
router.get('/routes/:routeId', async (req, res) => {
  const db = getDB();
  const route = await db.collection('routes').findOne({ routeId: req.params.routeId });
  if (!route) return res.status(404).json({ error: 'Route not found' });

  const stops = await db.collection('bus_stops').find({ routeIds: route.routeId }).toArray();
  res.json({ route, stops });
});

module.exports = router;
