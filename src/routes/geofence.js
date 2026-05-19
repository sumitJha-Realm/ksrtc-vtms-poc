const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');

// GET /api/geofence/check — check if a point is in any geofence
router.get('/check', async (req, res) => {
  const db = getDB();
  const { lat, lon } = req.query;

  const geofences = await db.collection('geofences').find({
    geometry: {
      $geoIntersects: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lon), parseFloat(lat)] }
      }
    }
  }).toArray();

  res.json({ point: { lat, lon }, insideGeofences: geofences.map(g => ({ id: g.geofenceId, name: g.name, type: g.type })) });
});

// GET /api/geofence/vehicles — vehicles currently inside a geofence
router.get('/vehicles/:geofenceId', async (req, res) => {
  const db = getDB();
  const { geofenceId } = req.params;

  const geofence = await db.collection('geofences').findOne({ geofenceId });
  if (!geofence) return res.status(404).json({ error: 'Geofence not found' });

  const vehicles = await db.collection('vehicle_current_state').find({
    location: { $geoWithin: { $geometry: geofence.geometry } }
  }).toArray();

  res.json({ geofence: { id: geofenceId, name: geofence.name }, vehicles, count: vehicles.length });
});

// GET /api/geofence/nearby-stops — nearest bus stops to a point
router.get('/nearby-stops', async (req, res) => {
  const db = getDB();
  const { lat, lon, maxDistance = 1000 } = req.query;

  const stops = await db.collection('bus_stops').find({
    location: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lon), parseFloat(lat)] },
        $maxDistance: parseInt(maxDistance)
      }
    }
  }).limit(5).toArray();

  res.json({ stops });
});

// GET /api/geofence/list — all geofences
router.get('/list', async (req, res) => {
  const db = getDB();
  const geofences = await db.collection('geofences').find({}).toArray();
  res.json({ geofences });
});

module.exports = router;
