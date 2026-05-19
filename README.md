# 🚍 KSRTC VTMS — Vehicle Tracking & Management System PoC

A full-stack **Proof of Concept** demonstrating how MongoDB Atlas can power a real-time Vehicle Tracking & Management System for KSRTC (Karnataka State Road Transport Corporation) — 8,000+ buses, 10-second GPS intervals, real-time alerts, and operational analytics.

Built as a **MongoDB Solutions Architecture** demonstration showcasing Change Streams, Geospatial queries, Aggregation Pipelines, and real-time data patterns.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Leaflet.js)                       │
│  Live Dashboard │ Playback │ Alerts │ Reports │ Architecture     │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / Polling (3s)
┌────────────────────────────▼────────────────────────────────────┐
│                    Express.js Server (:3000)                      │
│                                                                   │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Dashboard │  │ Change Stream│  │ Geofence  │  │   Admin   │  │
│  │   API     │  │  Processor   │  │  Engine   │  │ Seed/Sim  │  │
│  └──────────┘  └──────────────┘  └───────────┘  └───────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ MongoDB Driver (Connection Pool)
┌────────────────────────────▼────────────────────────────────────┐
│                      MongoDB Atlas (M10+)                         │
│                                                                   │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │  gps_events    │  │ vehicle_current  │  │     alerts       │  │
│  │  (Time Series) │  │    _state        │  │  (Active/Closed) │  │
│  └────────────────┘  └─────────────────┘  └──────────────────┘  │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │    routes      │  │   bus_stops      │  │     depots       │  │
│  │  (GeoJSON)     │  │  (GeoJSON Point) │  │  (10 depots)     │  │
│  └────────────────┘  └─────────────────┘  └──────────────────┘  │
│  ┌────────────────┐  ┌─────────────────┐                        │
│  │   vehicles     │  │   geofences     │                        │
│  │  (50 buses)    │  │  (GeoJSON Poly) │                        │
│  └────────────────┘  └─────────────────┘                        │
└──────────────────────────────────────────────────────────────────┘
```

### MongoDB Features Demonstrated

| Feature | Usage |
|---------|-------|
| **Change Streams** | Real-time alert generation when vehicle state changes (overspeed, geofence breach, etc.) |
| **Geospatial Queries** | `$geoWithin`, `$geoNear` for geofence detection, nearest-stop calculations |
| **Aggregation Pipelines** | Fleet analytics, depot summaries, speed reports, trip efficiency |
| **2dsphere Indexes** | Spatial indexing on GPS coordinates for fast geospatial lookups |
| **TTL Indexes** | Auto-expire old GPS events (configurable retention) |
| **Compound Indexes** | Optimized queries on vehicleId + timestamp for playback |
| **$lookup** | Join vehicles with routes, depots, and stops for enriched views |
| **Bucket Pattern** | Time-series GPS data organization |

---

## 📁 Project Structure

```
ksrtc-vtms-poc/
├── server.js                    # Express server entry point
├── package.json
├── .env.example                 # Environment variables template
├── .gitignore
│
├── src/
│   ├── config/
│   │   └── database.js          # MongoDB Atlas connection (pooling, retry)
│   ├── changeStreams/
│   │   └── gpsProcessor.js      # Change Stream processor for real-time alerts
│   ├── models/
│   │   └── setupCollections.js  # Collection schemas, indexes, validation
│   ├── routes/
│   │   ├── admin.js             # Seed data + GPS simulator endpoints
│   │   ├── alerts.js            # Alert CRUD + context (GPS trail)
│   │   ├── dashboard.js         # Fleet summary, vehicle positions
│   │   ├── geofence.js          # Geofence CRUD + zone detection
│   │   ├── playback.js          # Historical GPS playback
│   │   ├── reports.js           # Aggregation-based fleet reports
│   │   └── vehicles.js          # Vehicle + route + stop queries
│   └── seed/
│       ├── seedData.js          # Initial data seeder (routes, stops, depots)
│       └── gpsSimulator.js      # Standalone GPS simulator (CLI)
│
└── public/
    ├── index.html               # Live Dashboard (map + controls)
    ├── css/style.css            # Dark theme styles
    ├── js/app.js                # Dashboard client logic (Leaflet, polling)
    └── pages/
        ├── alerts.html          # Split-view alerts + GPS trail map
        ├── architecture.html    # MongoDB architecture diagrams
        ├── enhancements.html    # Future: Kafka, Stream Processing, Archive
        ├── guide.html           # How-to-use documentation
        ├── playback.html        # Route replay with animation
        └── reports.html         # Fleet analytics with "Show Logic" modals
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+
- **MongoDB Atlas** cluster (M0 free tier works for demo)
- **npm**

### Setup

```bash
# Clone
git clone https://github.com/sumitJha-Realm/ksrtc-vtms-poc.git
cd ksrtc-vtms-poc

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your MongoDB Atlas connection string:
# MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
# DB_NAME=ksrtc_vtms

# Seed reference data (routes, stops, vehicles, depots, geofences)
node src/seed/seedData.js

# Start server
node server.js
```

### Open Browser

Navigate to **http://localhost:3000**

---

## 🎮 How to Use (All from Browser)

### Step 1: Seed Historical Data

On the Live Dashboard, use the **hours dropdown** (2h–48h) and click **🌱 Seed Data**.

A confirmation prompt shows estimated events:
- 2h → ~36K GPS events, 6 alerts
- 6h → ~108K GPS events, 18 alerts
- 24h → ~432K GPS events, 72 alerts

Data is **appended** (never deleted) — safe to run multiple times.

### Step 2: Start Live Simulator

Click **▶ Simulator** on the dashboard. Buses start moving in real-time (50 GPS events every 10 seconds). Click **⏹ Simulator** to stop.

### Step 3: Explore Features

| Page | What It Shows |
|------|---------------|
| **Live Dashboard** | Real-time bus positions, route tracks, stops, depots, fleet summary |
| **Route Playback** | Select a vehicle + time range → animated GPS trail replay |
| **Alerts** | Active/acknowledged alerts with GPS trail context + calculation formulas |
| **Reports** | Fleet analytics (speed, efficiency, distance) with "⚙ Show Logic" pipeline details |
| **Architecture** | MongoDB schema design, indexes, Change Stream flow diagrams |
| **Enhancements** | Future roadmap: Kafka, Atlas Stream Processing, Online Archive |
| **Guide** | Detailed how-to for each feature |

---

## 🗄️ Data Model

### Collections

| Collection | Documents | Purpose |
|-----------|-----------|---------|
| `vehicles` | 50 | Bus master data (vehicleId, depotId, routeId) |
| `routes` | 10 | Route geometry (GeoJSON LineString, 8 waypoints each) |
| `bus_stops` | 80 | Stop locations (GeoJSON Point, linked to routes) |
| `depots` | 10 | Depot master data (name, division, lat/lon) |
| `geofences` | 10 | Geofence polygons (depot zones, restricted areas) |
| `gps_events` | ~100K+ | Time-series GPS telemetry (grows with seed/simulator) |
| `vehicle_current_state` | 50 | Latest position per vehicle (hot collection) |
| `alerts` | ~60+ | Generated alerts (overspeed, breakdown, panic, etc.) |

### Key Indexes

```javascript
// GPS events — compound for playback queries
{ "metadata.vehicleId": 1, "timestamp": -1 }

// Geospatial — for $geoWithin / $geoNear
{ "location": "2dsphere" }

// Alerts — status + time for active alert queries  
{ "status": 1, "timestamp": -1 }

// Vehicle current state — fast lookup
{ "vehicleId": 1 }
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard/summary` | Fleet summary (running/idle/stopped counts, depot breakdown) |
| GET | `/api/dashboard/vehicles` | All vehicle current positions |
| GET | `/api/playback/:vehicleId` | GPS trail for time range |
| GET | `/api/alerts` | List alerts (filterable by status/type) |
| GET | `/api/alerts/:alertId/context` | Alert + surrounding GPS trail |
| GET | `/api/reports/fleet-speed` | Speed analytics aggregation |
| GET | `/api/reports/trip-efficiency` | Trip efficiency metrics |
| GET | `/api/reports/distance-report` | Distance covered per vehicle |
| GET | `/api/reports/event-context` | Report event with GPS context |
| GET | `/api/vehicles/routes/list` | All routes with geometry |
| GET | `/api/vehicles/routes/:routeId` | Route detail + stops |
| GET | `/api/geofence/zones` | All geofence polygons |
| POST | `/api/admin/seed-demo?hours=6` | Generate historical data |
| POST | `/api/admin/simulator/start` | Start live GPS generation |
| POST | `/api/admin/simulator/stop` | Stop GPS generation |
| GET | `/api/admin/simulator/status` | Check simulator state |

---

## 🔄 Change Stream Processing

The server watches `vehicle_current_state` for changes and generates alerts:

```javascript
// Triggers on every vehicle state update
db.collection('vehicle_current_state').watch([
  { $match: { operationType: 'update' } }
]);

// Alert rules evaluated:
// - Overspeed: speed > 60 km/h
// - Geofence breach: vehicle exits assigned zone
// - Unauthorized stop: stationary > 3 min outside stops
// - Route deviation: > 200m from corridor
```

---

## 🌐 Pages

- **/** — Live Dashboard with Leaflet map
- **/playback** — GPS route replay
- **/alerts-page** — Alert management with GPS context
- **/reports** — Fleet analytics
- **/architecture** — MongoDB architecture docs
- **/enhancements** — Future roadmap
- **/guide** — How-to documentation

---

## 📊 Demo Data

| Entity | Count | Notes |
|--------|-------|-------|
| Vehicles | 50 | Karnataka registration numbers (KA-01-F-XXXX) |
| Routes | 10 | Real Bangalore routes (Majestic→Electronic City, etc.) |
| Stops | 80 | 8 stops per route with real coordinates |
| Depots | 10 | Bangalore depots (Kempegowda, Jayanagar, Peenya, etc.) |
| Geofences | 10 | Depot zones + restricted areas |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express.js |
| Database | MongoDB Atlas (6.x driver) |
| Frontend | Vanilla JS, Leaflet.js, CSS3 |
| Maps | Carto Dark tiles, Leaflet polylines/markers |
| Geospatial | Turf.js (server-side), MongoDB 2dsphere |
| Real-time | Change Streams (app-level), Polling (3s) |

---

## 📝 License

MIT — built for MongoDB Solutions Architecture demonstration purposes.
