# KSRTC VTMS — GIS Strategy Summary
### Why a MongoDB + In-Memory (Turf/Shapely) approach wins over PostGIS-at-DB-level at KSRTC scale

## Executive Summary

PostGIS has a **larger catalogue of GIS functions** than MongoDB — this is true and not disputed. However, **for the KSRTC VTMS workload — 70 million GPS pings/day, ~1,000 messages/second, ~800 point-in-polygon checks/second, with a < 5-second GPS-to-dashboard SLA — the deciding factor is not "how many GIS functions exist," but "where the geometry is computed."**

At this scale, running spatial math **inside any database on the per-ping hot path** (PostGIS or MongoDB) means thousands of network round-trips per second against a vertically-scaled engine. The correct architecture is:

1. **MongoDB** as the store-of-record and coarse spatial filter (`2dsphere` indexes).
2. **Precomputed route buffers** (corridors) that convert "advanced" geometry into simple point-in-polygon.
3. **In-memory geometry** (Turf.js / Shapely) on **stateless, horizontally-scalable workers** for the per-ping hot path.

Crucially, **Shapely uses the same GEOS geometry library that powers PostGIS** — so the in-memory approach delivers *PostGIS-grade geometric correctness* with **zero database round-trip**. PostGIS remains valuable only as an **optional offline "Tier-3" sidecar** for heavy network-routing/topology — operations this project **does not require**.

---

## 1. Does KSRTC VTMS Need Advanced GIS?

The entire GIS scope is **simple computational geometry**. With **no real-time traffic requirement**, even ETA/ETD is simple linear-referencing math — there is effectively **no "advanced" slice** in scope.

| Requirement | Operation | Complexity |
|---|---|---|
| 800 PiP geofence checks/s | Point-in-polygon | Simple |
| Route corridor deviation (100 m) | Point-in-buffer / point-to-line | Simple |
| Stop arrival / departure / skip | Point-in-circle + linear referencing | Simple |
| Nearest bus stop (passenger app) | k-NN / nearest-neighbor | Simple |
| ETA/ETD cascade (no live traffic) | Linear referencing + speed-based travel time | Simple |
| Schedule adherence, unauthorized stop | Time + distance-along-line | Simple |
| Overspeed, harsh braking, rash turning | Speed/heading deltas (kinematics) | Not geometry |
| Panic button | None | — |

**None of the scope requires topology, polygon overlay/union, Voronoi/Delaunay, isochrones, or road-network routing — the operations where PostGIS is genuinely class-leading.**

### 1a. There Is No "Advanced 5%" in Scope

A general GIS database like PostGIS is famous for a class of "advanced" operations. **None of them are required by any KSRTC KPI or functionality.** They are listed here only to demonstrate that nothing in scope is missing.

| Advanced operation | In KSRTC KPIs / functionality? | Status | Notes |
|---|---|---|---|
| **ETA / ETD** | ✅ In scope | **Simple geometry — no traffic, no routing engine** | Customer requires ETA **without** real-time traffic. This is **linear referencing** (distance-along-route ÷ speed), done **in-memory** — already implemented in the POC. **Not advanced.** |
| **Road-network routing / live-traffic ETA** | ❌ Not in any KPI or functionality | **Not required** | Only needed if live traffic/dynamic re-routing were required — it is not. No OSRM/Valhalla/pgRouting needed. |
| **Isochrones** ("area reachable in N minutes") | ❌ Not in any KPI or functionality | **Not required** | Future-proofing headroom only. |
| **Topology / overlay / union** (merging/dissolving zones) | ❌ Not in any KPI or functionality | **Not required** | Future-proofing headroom only. |

**Key points for the customer:**

- The customer wants **ETA but does NOT need real-time traffic.** Removing live traffic removes the only thing that would have made ETA "advanced." What remains — *how far along the route, how far to each downstream stop, when will it arrive at current/typical speed* — is **simple linear-referencing geometry the POC already does in-memory.**
- **No road-network routing engine, no PostGIS, no traffic feed, no road graph** is required for any KSRTC functionality.
- Optional accuracy boost (still no traffic, still in-memory): replace instantaneous speed with **historical average segment speeds** precomputed offline from KSRTC's own 90 days of GPS history via a MongoDB aggregation. At ping time it remains an in-memory lookup.

> **In short: with no real-time traffic requirement, 100% of the KSRTC GIS scope — including ETA/ETD — is simple computational geometry. There is no advanced operation that must run at the DB level, and PostGIS-class operations (routing, isochrones, topology) are not required by any KPI or functionality.**

---

## 2. The Route-Buffer Insight

Corridor deviation is the only requirement that *sounds* advanced. By **precomputing a 100 m buffer around each route once, offline**, and storing it as an indexed polygon, runtime deviation detection collapses into the **cheapest spatial test that exists — point-in-polygon.**

- Buffer generation (`ST_Buffer` / `turf.buffer`) runs **once per route at design time**, not 1,000×/second.
- Runtime check = `$geoWithin` (MongoDB native) or `turf.booleanPointInPolygon` (in-memory) — microseconds.
- **No PostGIS needed at runtime** for deviation.

**Principle:** *Precompute the hard geometry offline; reduce the hot path to PiP and distance lookups.*

---

## 3. What "In-Memory" Means for Each Engine

| | What "in-memory" actually means | Geometry engine |
|---|---|---|
| **MongoDB** | No embeddable Mongo geo-engine in your app. Cache geometry once, compute in the app tier with **Turf.js** or **Shapely**. Mongo `$geo*` operators run inside `mongod`. | Turf (JS) / GEOS via Shapely |
| **PostGIS** | Either (a) geometry cached in Postgres `shared_buffers` — **but still a query round-trip**, or (b) pulled into the app and computed with **Shapely/GEOS** — identical to the Mongo-side app approach. | **GEOS** (in-DB) or GEOS via Shapely |

> **Decisive point: PostGIS's geometric quality comes from the GEOS library. Shapely wraps the *same* GEOS library. Therefore PostGIS-grade geometry is available in application memory with zero DB round-trip. The "PostGIS is native" argument does not buy correctness you can't already get in-memory — it only changes where the CPU runs.**

---

## 4. Who Wins, Per Tier

| Tier | Workload | Winner | Why |
|---|---|---|---|
| **Hot path** (per ping, 800–1,000/s) | PiP, deviation, snap-to-line, kinematics, ETA cascade | **In-memory (Turf/Shapely)** | Microsecond in-process call vs. millisecond+ networked DB call ×1,000/s. True for Mongo *and* PostGIS — no DB belongs in the per-ping loop. |
| **Coarse filter** (over millions of stored docs) | `$geoWithin`, `$nearSphere` candidate selection | **MongoDB `2dsphere`** (PostGIS GiST equal) | Pick by where data lives. Telemetry lives in MongoDB. |
| **Tier-3 offline** | Road routing, topology, overlay/union, isochrones | **PostGIS / pgRouting / OSRM** | **Not required by KSRTC scope.** Listed only as headroom if scope ever expands. |

**Net for KSRTC:** In-memory wins the runtime; MongoDB wins storage + coarse filtering; PostGIS / Tier-3 is **not needed** for any current functionality.

---

## 5. Why the DB Can't Own the Hot Path at This Scale

1. **Round-trip tax:** 1,000 msg/s × ~800 PiP/s in the DB = thousands of spatial queries/second, each paying network + planner + connection cost. In-memory pays none of that.
2. **Static geometry, wastefully recomputed:** Geofences and route lines rarely change. Workers load them **once** and reuse across millions of pings. The DB re-reads/re-plans every query.
3. **Vertical vs. horizontal scaling:** DB-side compute concentrates load on one primary's CPU. In-memory workers are **stateless and scale out linearly** (N workers, partitioned by vehicle/depot hash). This also satisfies the **zero-single-point-of-failure** and **< 1-hour service resumption** requirements.

This is an **architecture principle, not a MongoDB limitation** — PostGIS at DB level would hit the same wall on the same hot path.

---

## 6. Per-Function Classification: MongoDB native vs. PostGIS native vs. **Recommended**

| GIS function | MongoDB native (DB level) | PostGIS native (DB level) | **Recommended for KSRTC** |
|---|---|---|---|
| **Point-in-polygon (geofence)** | `$geoWithin` / `$geoIntersects` + `2dsphere` | `ST_Contains` / `ST_Within` + GiST | **In-memory** Turf `booleanPointInPolygon` (+ H3/rbush pre-filter) — hot path |
| **Nearest bus stop (k-NN)** | `$nearSphere` + `$maxDistance` | `ST_DWithin` + `<->` KNN GiST | **MongoDB `$nearSphere`** — passenger app, not per-ping |
| **Distance (point-to-point)** | `$geoNear` distance / Haversine | `ST_Distance(::geography)` | **In-memory** `turf.distance` |
| **Route corridor deviation** | `$geoWithin` on precomputed buffer | `ST_DWithin(line, pt, 100)` | **Precompute buffer offline** → in-memory PiP / `$geoWithin` |
| **Buffer generation** | ❌ not supported | `ST_Buffer` | **Offline once** via `turf.buffer` / Shapely, store as indexed polygon |
| **ETA/ETD cascade (no live traffic)** | ❌ not supported | `ST_LineLocatePoint` / `ST_LineSubstring` | **In-memory** `turf.nearestPointOnLine` + speed-based travel time (already in POC). **No routing engine, no traffic feed.** |
| **Linear referencing (distance-along-route)** | ❌ not supported | `ST_LineLocatePoint` / `ST_LineSubstring` | **In-memory** `turf.nearestPointOnLine` |
| **Bearing / heading (rash-turn)** | ❌ | `ST_Azimuth` | **In-memory** `turf.bearing` |
| **Stop arrival/departure/skip (sequence-aware)** | partial via `$geoWithin` per stop | `ST_DWithin` + linear-ref logic | **In-memory state machine** (stop circle + distance-along-line) |
| **Harsh braking / accel / rash turn (windowed)** | `$setWindowFields` (in DB, batch) | `LAG`/`LEAD` window functions (in DB) | **In-memory per-vehicle ring buffer** — O(1)/ping |
| **Line simplification (playback 2x–10x)** | ❌ | `ST_Simplify` | **In-memory/offline** `turf.simplify` |
| **Polygon area** | ❌ | `ST_Area` | **In-memory** `turf.area` (rare/offline) |
| **Coarse spatial filtering over 70M docs** | `2dsphere` index | GiST index | **MongoDB `2dsphere`** — store of record |
| **16 reports / schedule-adherence rollups** | Aggregation pipeline + `$setWindowFields` | SQL + window functions | **MongoDB aggregation** — offline/batch in DB (correct place for set-based history) |

**Legend:** ❌ = not available natively at DB level in that engine.

---

## 7. On Aggregations & Window Functions "In Memory"

- MongoDB **aggregation pipeline** and **`$setWindowFields`** run **inside `mongod`** — there is no embeddable Mongo aggregation engine for app memory. (Same for PostgreSQL `LAG`/`LEAD`/`OVER`.)
- **You don't need them in memory.** The per-ping windowed signals (harsh braking/accel/rash turn) are better as an **in-memory per-vehicle ring buffer** (last N pings), giving O(1) work per ping with no round-trip.
- Use Mongo aggregation / window functions exactly where they shine: **the 16 reports and historical rollups — offline, in the DB.**

---

## 8. Bottom Line for KSRTC

1. **PostGIS has more GIS functions — acknowledged.** But the entire VTMS scope is simple geometry (PiP, point-to-line, nearest-neighbor, linear referencing).
2. **The customer needs ETA without real-time traffic** — which removes the only operation that could have been "advanced." ETA becomes simple linear referencing the POC already does in-memory. **There is no advanced GIS requirement in scope.**
3. **At 1,000 msg/s with < 5 s SLAs, no database — Mongo or PostGIS — should compute on the per-ping hot path.** The round-trip and vertical-scaling costs are disqualifying. This is architecture, not a product limitation.
4. **In-memory Turf/Shapely wins the hot path and uses the same GEOS library as PostGIS** — PostGIS-grade correctness, zero round-trip, horizontally scalable.
5. **MongoDB wins** as the store-of-record + coarse `2dsphere` filter; **precomputed buffers** remove the only "advanced-sounding" runtime need.
6. **PostGIS / routing engines are not required** for any current KSRTC functionality — they remain optional Tier-3 headroom only if scope ever expands to live traffic, isochrones, or topology.

> **MongoDB + precomputed route buffers + in-memory Turf/Shapely meets every KSRTC GIS KPI at scale. Because the customer needs ETA without real-time traffic, 100% of GIS scope is simple in-memory geometry — with PostGIS-grade GEOS correctness via Shapely, zero round-trips, and horizontal scalability. PostGIS at DB level changes none of the math; it only puts the CPU on the wrong side of the network. PostGIS stays as optional Tier-3 headroom that current scope does not require.**
