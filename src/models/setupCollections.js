const { connectDB } = require('../config/database');
require('dotenv').config();

async function setupCollections() {
  const db = await connectDB();

  console.log('Setting up collections...');

  // 1. Time Series Collection — GPS Events
  try {
    await db.createCollection('gps_events', {
      timeseries: {
        timeField: 'timestamp',
        metaField: 'metadata',
        granularity: 'seconds'
      },
      expireAfterSeconds: 7776000 // 90 days
    });
    console.log('✓ Created gps_events (time series)');
  } catch (e) {
    if (e.code === 48) console.log('• gps_events already exists');
    else throw e;
  }

  // 2. Standard Collections
  const standardCollections = [
    'vehicle_current_state',
    'vehicles',
    'routes',
    'bus_stops',
    'geofences',
    'schedules',
    'depots',
    'alerts',
    'trip_eta_predictions',
    'gps_devices',
    'audit_logs',
    'users',
    'trip_summaries'
  ];

  for (const name of standardCollections) {
    try {
      await db.createCollection(name);
      console.log(`✓ Created ${name} (standard)`);
    } catch (e) {
      if (e.code === 48) console.log(`• ${name} already exists`);
      else throw e;
    }
  }

  // 3. Create Indexes
  console.log('\nCreating indexes...');

  // GPS Events indexes
  await db.collection('gps_events').createIndex({ 'metadata.vehicleId': 1, timestamp: 1 });
  await db.collection('gps_events').createIndex({ 'metadata.depotId': 1, timestamp: 1 });
  await db.collection('gps_events').createIndex({ location: '2dsphere' });
  console.log('✓ gps_events indexes');

  // Vehicle Current State
  await db.collection('vehicle_current_state').createIndex({ vehicleId: 1 }, { unique: true });
  await db.collection('vehicle_current_state').createIndex({ location: '2dsphere' });
  await db.collection('vehicle_current_state').createIndex({ depotId: 1, status: 1 });
  console.log('✓ vehicle_current_state indexes');

  // Vehicles
  await db.collection('vehicles').createIndex({ vehicleId: 1 }, { unique: true });
  await db.collection('vehicles').createIndex({ depotId: 1 });
  console.log('✓ vehicles indexes');

  // Routes
  await db.collection('routes').createIndex({ routeId: 1 }, { unique: true });
  await db.collection('routes').createIndex({ geometry: '2dsphere' });
  console.log('✓ routes indexes');

  // Bus Stops
  await db.collection('bus_stops').createIndex({ stopId: 1 }, { unique: true });
  await db.collection('bus_stops').createIndex({ location: '2dsphere' });
  await db.collection('bus_stops').createIndex({ routeIds: 1 });
  console.log('✓ bus_stops indexes');

  // Geofences
  await db.collection('geofences').createIndex({ geometry: '2dsphere' });
  await db.collection('geofences').createIndex({ type: 1 });
  console.log('✓ geofences indexes');

  // Schedules
  await db.collection('schedules').createIndex({ routeId: 1, vehicleId: 1 });
  await db.collection('schedules').createIndex({ vehicleId: 1, departureTime: 1 });
  console.log('✓ schedules indexes');

  // Alerts
  await db.collection('alerts').createIndex({ vehicleId: 1, timestamp: 1 });
  await db.collection('alerts').createIndex({ type: 1, status: 1 });
  await db.collection('alerts').createIndex({ depotId: 1, type: 1, timestamp: -1 });
  console.log('✓ alerts indexes');

  // Trip ETA predictions
  await db.collection('trip_eta_predictions').createIndex({ vehicleId: 1 }, { unique: true });
  await db.collection('trip_eta_predictions').createIndex({ routeId: 1, updatedAt: -1 });
  await db.collection('trip_eta_predictions').createIndex({ updatedAt: -1 });
  console.log('✓ trip_eta_predictions indexes');

  // Audit Logs (TTL: 1 year)
  await db.collection('audit_logs').createIndex({ timestamp: 1 }, { expireAfterSeconds: 31536000 });
  await db.collection('audit_logs').createIndex({ userId: 1, action: 1 });
  console.log('✓ audit_logs indexes');

  console.log('\n✅ Setup complete!');
  process.exit(0);
}

setupCollections().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
