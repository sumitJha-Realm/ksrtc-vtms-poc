const { connectDB } = require('../config/database');
require('dotenv').config();

// Bangalore-area routes with realistic coordinates
const ROUTES_DATA = [
  {
    routeId: 'RT001', name: 'Majestic → Electronic City',
    depotId: 'DEP01',
    stops: [
      { stopId: 'S001', name: 'Majestic Bus Station', lat: 12.9767, lon: 77.5713 },
      { stopId: 'S002', name: 'Town Hall', lat: 12.9656, lon: 77.5782 },
      { stopId: 'S003', name: 'Lalbagh Gate', lat: 12.9507, lon: 77.5848 },
      { stopId: 'S004', name: 'Jayanagar 4th Block', lat: 12.9250, lon: 77.5938 },
      { stopId: 'S005', name: 'BTM Layout', lat: 12.9166, lon: 77.6101 },
      { stopId: 'S006', name: 'Silk Board Junction', lat: 12.9172, lon: 77.6227 },
      { stopId: 'S007', name: 'Bommanahalli', lat: 12.9010, lon: 77.6263 },
      { stopId: 'S008', name: 'Electronic City Phase 1', lat: 12.8456, lon: 77.6603 }
    ]
  },
  {
    routeId: 'RT002', name: 'Majestic → Whitefield',
    depotId: 'DEP01',
    stops: [
      { stopId: 'S009', name: 'Majestic Bus Station', lat: 12.9767, lon: 77.5713 },
      { stopId: 'S010', name: 'Shivajinagar', lat: 12.9857, lon: 77.6046 },
      { stopId: 'S011', name: 'Indiranagar', lat: 12.9784, lon: 77.6408 },
      { stopId: 'S012', name: 'HAL Airport Road', lat: 12.9591, lon: 77.6650 },
      { stopId: 'S013', name: 'Marathahalli', lat: 12.9562, lon: 77.7010 },
      { stopId: 'S014', name: 'Kundalahalli', lat: 12.9622, lon: 77.7230 },
      { stopId: 'S015', name: 'ITPL', lat: 12.9854, lon: 77.7320 },
      { stopId: 'S016', name: 'Whitefield', lat: 12.9698, lon: 77.7500 }
    ]
  },
  {
    routeId: 'RT003', name: 'Kempegowda → Bannerghatta',
    depotId: 'DEP02',
    stops: [
      { stopId: 'S017', name: 'Kempegowda Bus Station', lat: 12.9767, lon: 77.5713 },
      { stopId: 'S018', name: 'K.R. Market', lat: 12.9630, lon: 77.5770 },
      { stopId: 'S019', name: 'Lalbagh West Gate', lat: 12.9480, lon: 77.5770 },
      { stopId: 'S020', name: 'Jayanagar 9th Block', lat: 12.9250, lon: 77.5820 },
      { stopId: 'S021', name: 'JP Nagar', lat: 12.9077, lon: 77.5850 },
      { stopId: 'S022', name: 'Gottigere', lat: 12.8830, lon: 77.5880 },
      { stopId: 'S023', name: 'Hulimavu', lat: 12.8730, lon: 77.5950 },
      { stopId: 'S024', name: 'Bannerghatta Zoo', lat: 12.8010, lon: 77.5770 }
    ]
  },
  {
    routeId: 'RT004', name: 'Majestic → Yelahanka',
    depotId: 'DEP03',
    stops: [
      { stopId: 'S025', name: 'Majestic', lat: 12.9767, lon: 77.5713 },
      { stopId: 'S026', name: 'Mekhri Circle', lat: 12.9988, lon: 77.5780 },
      { stopId: 'S027', name: 'Sadashivanagar', lat: 13.0065, lon: 77.5730 },
      { stopId: 'S028', name: 'Hebbal', lat: 13.0358, lon: 77.5970 },
      { stopId: 'S029', name: 'Esteem Mall', lat: 13.0455, lon: 77.5890 },
      { stopId: 'S030', name: 'Jakkur', lat: 13.0630, lon: 77.5880 },
      { stopId: 'S031', name: 'Yelahanka Old Town', lat: 13.0980, lon: 77.5780 },
      { stopId: 'S032', name: 'Yelahanka New Town', lat: 13.1070, lon: 77.5940 }
    ]
  },
  {
    routeId: 'RT005', name: 'Majestic → KR Puram',
    depotId: 'DEP02',
    stops: [
      { stopId: 'S033', name: 'Majestic', lat: 12.9767, lon: 77.5713 },
      { stopId: 'S034', name: 'Shivajinagar', lat: 12.9857, lon: 77.6046 },
      { stopId: 'S035', name: 'Ulsoor', lat: 12.9818, lon: 77.6200 },
      { stopId: 'S036', name: 'Indiranagar CMH', lat: 12.9810, lon: 77.6400 },
      { stopId: 'S037', name: 'New BEL Road', lat: 12.9830, lon: 77.6600 },
      { stopId: 'S038', name: 'Ramamurthy Nagar', lat: 12.9900, lon: 77.6800 },
      { stopId: 'S039', name: 'Banaswadi', lat: 13.0100, lon: 77.6700 },
      { stopId: 'S040', name: 'KR Puram', lat: 13.0070, lon: 77.6960 }
    ]
  },
  {
    routeId: 'RT006', name: 'Shivajinagar → Kengeri',
    depotId: 'DEP03',
    stops: [
      { stopId: 'S041', name: 'Shivajinagar', lat: 12.9857, lon: 77.6046 },
      { stopId: 'S042', name: 'Majestic', lat: 12.9767, lon: 77.5713 },
      { stopId: 'S043', name: 'Mysore Road', lat: 12.9590, lon: 77.5440 },
      { stopId: 'S044', name: 'Nayandahalli', lat: 12.9560, lon: 77.5200 },
      { stopId: 'S045', name: 'RR Nagar', lat: 12.9380, lon: 77.5180 },
      { stopId: 'S046', name: 'Uttarahalli', lat: 12.9100, lon: 77.5300 },
      { stopId: 'S047', name: 'Kengeri Satellite Town', lat: 12.9050, lon: 77.4850 },
      { stopId: 'S048', name: 'Kengeri', lat: 12.8980, lon: 77.4720 }
    ]
  },
  {
    routeId: 'RT007', name: 'Hebbal → Sarjapur',
    depotId: 'DEP04',
    stops: [
      { stopId: 'S049', name: 'Hebbal', lat: 13.0358, lon: 77.5970 },
      { stopId: 'S050', name: 'Mekhri Circle', lat: 12.9988, lon: 77.5780 },
      { stopId: 'S051', name: 'Cubbon Park', lat: 12.9763, lon: 77.5929 },
      { stopId: 'S052', name: 'MG Road', lat: 12.9756, lon: 77.6068 },
      { stopId: 'S053', name: 'Koramangala', lat: 12.9352, lon: 77.6245 },
      { stopId: 'S054', name: 'HSR Layout', lat: 12.9116, lon: 77.6389 },
      { stopId: 'S055', name: 'Sarjapur Road', lat: 12.9100, lon: 77.6700 },
      { stopId: 'S056', name: 'Sarjapur', lat: 12.8700, lon: 77.7900 }
    ]
  },
  {
    routeId: 'RT008', name: 'Yeshwanthpur → Banashankari',
    depotId: 'DEP04',
    stops: [
      { stopId: 'S057', name: 'Yeshwanthpur', lat: 13.0280, lon: 77.5430 },
      { stopId: 'S058', name: 'Rajajinagar', lat: 12.9930, lon: 77.5530 },
      { stopId: 'S059', name: 'Basaveshwaranagar', lat: 12.9870, lon: 77.5380 },
      { stopId: 'S060', name: 'Vijayanagar', lat: 12.9710, lon: 77.5360 },
      { stopId: 'S061', name: 'RV Road', lat: 12.9530, lon: 77.5700 },
      { stopId: 'S062', name: 'Basavanagudi', lat: 12.9400, lon: 77.5720 },
      { stopId: 'S063', name: 'Kathriguppe', lat: 12.9200, lon: 77.5580 },
      { stopId: 'S064', name: 'Banashankari', lat: 12.9150, lon: 77.5450 }
    ]
  },
  {
    routeId: 'RT009', name: 'Majestic → Airport',
    depotId: 'DEP05',
    stops: [
      { stopId: 'S065', name: 'Majestic', lat: 12.9767, lon: 77.5713 },
      { stopId: 'S066', name: 'Hebbal Flyover', lat: 13.0358, lon: 77.5970 },
      { stopId: 'S067', name: 'Yelahanka', lat: 13.1007, lon: 77.5963 },
      { stopId: 'S068', name: 'Air Force Station', lat: 13.1350, lon: 77.6010 },
      { stopId: 'S069', name: 'Bagalur Cross', lat: 13.1600, lon: 77.6200 },
      { stopId: 'S070', name: 'Trumpet Flyover', lat: 13.1800, lon: 77.6350 },
      { stopId: 'S071', name: 'Airport Terminal 1', lat: 13.1989, lon: 77.7068 },
      { stopId: 'S072', name: 'Airport Terminal 2', lat: 13.2000, lon: 77.7100 }
    ]
  },
  {
    routeId: 'RT010', name: 'Mysore Road → Hoskote',
    depotId: 'DEP05',
    stops: [
      { stopId: 'S073', name: 'Mysore Road Satellite', lat: 12.9510, lon: 77.5100 },
      { stopId: 'S074', name: 'Majestic', lat: 12.9767, lon: 77.5713 },
      { stopId: 'S075', name: 'Shivajinagar', lat: 12.9857, lon: 77.6046 },
      { stopId: 'S076', name: 'Tin Factory', lat: 13.0100, lon: 77.6580 },
      { stopId: 'S077', name: 'KR Puram', lat: 13.0070, lon: 77.6960 },
      { stopId: 'S078', name: 'Mahadevapura', lat: 12.9970, lon: 77.7200 },
      { stopId: 'S079', name: 'Old Madras Road', lat: 13.0200, lon: 77.7500 },
      { stopId: 'S080', name: 'Hoskote', lat: 13.0700, lon: 77.7980 }
    ]
  }
];

const DEPOTS = [
  { depotId: 'DEP01', name: 'Kempegowda Depot', division: 'Bangalore Central', lat: 12.9767, lon: 77.5713 },
  { depotId: 'DEP02', name: 'Jayanagar Depot', division: 'Bangalore South', lat: 12.9250, lon: 77.5820 },
  { depotId: 'DEP03', name: 'Yeshwanthpur Depot', division: 'Bangalore North', lat: 13.0280, lon: 77.5430 },
  { depotId: 'DEP04', name: 'Koramangala Depot', division: 'Bangalore East', lat: 12.9352, lon: 77.6245 },
  { depotId: 'DEP05', name: 'Peenya Depot', division: 'Bangalore West', lat: 13.0300, lon: 77.5200 }
];

function buildRouteDocuments() {
  return ROUTES_DATA.map(r => ({
    routeId: r.routeId,
    name: r.name,
    depotId: r.depotId,
    totalStops: r.stops.length,
    distanceKm: 15 + Math.random() * 35,
    geometry: {
      type: 'LineString',
      coordinates: r.stops.map(s => [s.lon, s.lat])
    },
    stopIds: r.stops.map(s => s.stopId)
  }));
}

function buildBusStopsDocuments() {
  const allStops = [];
  const stopSet = new Set();
  for (const route of ROUTES_DATA) {
    for (const stop of route.stops) {
      if (!stopSet.has(stop.stopId)) {
        stopSet.add(stop.stopId);
        allStops.push({
          stopId: stop.stopId,
          name: stop.name,
          location: { type: 'Point', coordinates: [stop.lon, stop.lat] },
          routeIds: ROUTES_DATA.filter(r => r.stops.some(s => s.stopId === stop.stopId)).map(r => r.routeId)
        });
      }
    }
  }
  return allStops;
}

function generateVehicles() {
  const vehicles = [];
  const types = ['Volvo AC', 'Non-AC', 'Ordinary', 'Airavat'];
  for (let i = 1; i <= 50; i++) {
    const depot = DEPOTS[Math.floor((i - 1) / 10)];
    const routeIdx = ((i - 1) % 10);
    vehicles.push({
      vehicleId: `KA-${String(i).padStart(2, '0')}-F-${1000 + i}`,
      registrationNumber: `KA ${String(depot.depotId.slice(-2)).padStart(2, '0')} F ${1000 + i}`,
      type: types[i % types.length],
      depotId: depot.depotId,
      assignedRouteId: ROUTES_DATA[routeIdx].routeId,
      make: i % 2 === 0 ? 'Volvo' : 'Ashok Leyland',
      model: i % 2 === 0 ? 'B8R' : 'Viking',
      year: 2020 + (i % 4),
      capacity: i % 2 === 0 ? 45 : 56,
      fuelType: i % 3 === 0 ? 'Electric' : 'Diesel',
      status: 'active',
      gpsDeviceId: `GPS-${String(i).padStart(4, '0')}`
    });
  }
  return vehicles;
}

function generateGeofences() {
  const geofences = [];
  // Depot geofences (polygons around each depot)
  for (const depot of DEPOTS) {
    const offset = 0.003; // ~300m
    geofences.push({
      geofenceId: `GF-${depot.depotId}`,
      name: `${depot.name} Boundary`,
      type: 'depot',
      depotId: depot.depotId,
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [depot.lon - offset, depot.lat - offset],
          [depot.lon + offset, depot.lat - offset],
          [depot.lon + offset, depot.lat + offset],
          [depot.lon - offset, depot.lat + offset],
          [depot.lon - offset, depot.lat - offset]
        ]]
      }
    });
  }
  // Zone geofences
  const zones = [
    { name: 'Bangalore City Limit', lat: 12.9716, lon: 77.5946, offset: 0.15 },
    { name: 'Airport Zone', lat: 13.1989, lon: 77.7068, offset: 0.02 },
    { name: 'School Zone - Jayanagar', lat: 12.9300, lon: 77.5850, offset: 0.005 },
    { name: 'Hospital Zone - Silk Board', lat: 12.9172, lon: 77.6227, offset: 0.004 },
    { name: 'Restricted Speed Zone - MG Road', lat: 12.9756, lon: 77.6068, offset: 0.003 }
  ];
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    geofences.push({
      geofenceId: `GF-ZONE-${i + 1}`,
      name: z.name,
      type: i === 0 ? 'city_limit' : (i < 2 ? 'zone' : 'speed_restriction'),
      speedLimit: i >= 2 ? 30 : null,
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [z.lon - z.offset, z.lat - z.offset],
          [z.lon + z.offset, z.lat - z.offset],
          [z.lon + z.offset, z.lat + z.offset],
          [z.lon - z.offset, z.lat + z.offset],
          [z.lon - z.offset, z.lat - z.offset]
        ]]
      }
    });
  }
  return geofences;
}

function generateSchedules(vehicles) {
  const schedules = [];
  const baseTimes = ['06:00', '07:00', '08:00', '09:00', '14:00', '15:00', '16:00', '17:00'];
  for (const vehicle of vehicles) {
    const route = ROUTES_DATA.find(r => r.routeId === vehicle.assignedRouteId);
    if (!route) continue;
    // 2 trips per vehicle per day
    for (let trip = 0; trip < 2; trip++) {
      const baseTime = baseTimes[(vehicles.indexOf(vehicle) + trip * 4) % baseTimes.length];
      const [hours, mins] = baseTime.split(':').map(Number);
      const stopTimes = route.stops.map((stop, idx) => ({
        stopId: stop.stopId,
        stopName: stop.name,
        sequence: idx + 1,
        expectedArrival: `${String(hours + Math.floor((idx * 12) / 60)).padStart(2, '0')}:${String((mins + idx * 12) % 60).padStart(2, '0')}`,
        expectedDeparture: `${String(hours + Math.floor(((idx * 12) + 2) / 60)).padStart(2, '0')}:${String((mins + idx * 12 + 2) % 60).padStart(2, '0')}`
      }));
      schedules.push({
        scheduleId: `SCH-${vehicle.vehicleId}-${trip + 1}`,
        vehicleId: vehicle.vehicleId,
        routeId: route.routeId,
        routeName: route.name,
        tripNumber: trip + 1,
        departureTime: baseTime,
        direction: trip === 0 ? 'UP' : 'DOWN',
        stops: stopTimes,
        daysOfWeek: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      });
    }
  }
  return schedules;
}

async function seedData() {
  const db = await connectDB();

  console.log('🔄 Clearing existing data...');
  const collections = ['vehicles', 'depots', 'routes', 'bus_stops', 'geofences', 'schedules', 'alerts', 'vehicle_current_state'];
  for (const col of collections) {
    await db.collection(col).deleteMany({});
  }

  // Seed Depots
  await db.collection('depots').insertMany(DEPOTS);
  console.log(`✓ Seeded ${DEPOTS.length} depots`);

  // Seed Vehicles
  const vehicles = generateVehicles();
  await db.collection('vehicles').insertMany(vehicles);
  console.log(`✓ Seeded ${vehicles.length} vehicles`);

  // Seed Routes
  const routes = ROUTES_DATA.map(r => ({
    routeId: r.routeId,
    name: r.name,
    depotId: r.depotId,
    totalStops: r.stops.length,
    distanceKm: 15 + Math.random() * 35,
    geometry: {
      type: 'LineString',
      coordinates: r.stops.map(s => [s.lon, s.lat])
    },
    stopIds: r.stops.map(s => s.stopId)
  }));
  await db.collection('routes').insertMany(routes);
  console.log(`✓ Seeded ${routes.length} routes`);

  // Seed Bus Stops
  const allStops = [];
  const stopSet = new Set();
  for (const route of ROUTES_DATA) {
    for (const stop of route.stops) {
      if (!stopSet.has(stop.stopId)) {
        stopSet.add(stop.stopId);
        allStops.push({
          stopId: stop.stopId,
          name: stop.name,
          location: { type: 'Point', coordinates: [stop.lon, stop.lat] },
          routeIds: ROUTES_DATA.filter(r => r.stops.some(s => s.stopId === stop.stopId)).map(r => r.routeId)
        });
      }
    }
  }
  await db.collection('bus_stops').insertMany(allStops);
  console.log(`✓ Seeded ${allStops.length} bus stops`);

  // Seed Geofences
  const geofences = generateGeofences();
  await db.collection('geofences').insertMany(geofences);
  console.log(`✓ Seeded ${geofences.length} geofences`);

  // Seed Schedules
  const schedules = generateSchedules(vehicles);
  await db.collection('schedules').insertMany(schedules);
  console.log(`✓ Seeded ${schedules.length} schedules`);

  console.log('\n✅ Seed complete!');
}

async function ensureBaseMasterData(db) {
  const summary = {
    depots: 0,
    vehicles: 0,
    routes: 0,
    busStops: 0,
    geofences: 0,
    schedules: 0
  };

  const depotsCount = await db.collection('depots').countDocuments({}, { limit: 1 });
  if (depotsCount === 0) {
    await db.collection('depots').insertMany(DEPOTS);
    summary.depots = DEPOTS.length;
  }

  const vehiclesCount = await db.collection('vehicles').countDocuments({}, { limit: 1 });
  if (vehiclesCount === 0) {
    const vehicles = generateVehicles();
    await db.collection('vehicles').insertMany(vehicles);
    summary.vehicles = vehicles.length;
  }

  const routesCount = await db.collection('routes').countDocuments({}, { limit: 1 });
  if (routesCount === 0) {
    const routes = buildRouteDocuments();
    await db.collection('routes').insertMany(routes);
    summary.routes = routes.length;
  }

  const stopsCount = await db.collection('bus_stops').countDocuments({}, { limit: 1 });
  if (stopsCount === 0) {
    const allStops = buildBusStopsDocuments();
    await db.collection('bus_stops').insertMany(allStops);
    summary.busStops = allStops.length;
  }

  const geofenceCount = await db.collection('geofences').countDocuments({}, { limit: 1 });
  if (geofenceCount === 0) {
    const geofences = generateGeofences();
    await db.collection('geofences').insertMany(geofences);
    summary.geofences = geofences.length;
  }

  const schedulesCount = await db.collection('schedules').countDocuments({}, { limit: 1 });
  if (schedulesCount === 0) {
    const vehiclesForSchedule = await db.collection('vehicles').find({}).toArray();
    if (vehiclesForSchedule.length > 0) {
      const schedules = generateSchedules(vehiclesForSchedule);
      await db.collection('schedules').insertMany(schedules);
      summary.schedules = schedules.length;
    }
  }

  return summary;
}

if (require.main === module) {
  seedData()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

module.exports = {
  seedData,
  ensureBaseMasterData
};
