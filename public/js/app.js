// KSRTC VTMS — Main Dashboard Application
const POLL_INTERVAL = 3000; // 3 seconds polling (no WebSocket)
let map, markers = {}, pollingTimer;
let routeLayers = {};   // Route tracks by routeId
let stopsLayer = null;  // All bus stops layer
let depotsLayer = null; // Depot markers layer
let showRoutes = true;  // Toggle for route visibility

// Route colors for visual distinction
const ROUTE_COLORS = ['#2196f3','#e91e63','#00bcd4','#ff9800','#9c27b0','#4caf50','#f44336','#3f51b5','#009688','#ff5722'];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadRoutesAndStops(); // Load all route tracks + stops + depots on init
  loadDashboard();
  loadAlerts();
  startPolling();
  checkSimulatorStatus();

  document.getElementById('depotFilter').addEventListener('change', loadVehicles);
  document.getElementById('statusFilter').addEventListener('change', loadVehicles);
  document.getElementById('refreshBtn').addEventListener('click', loadDashboard);
});

function initMap() {
  map = L.map('map').setView([12.9716, 77.5946], 12); // Bangalore center
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 19
  }).addTo(map);
}

// Load all route tracks, bus stops, and depot markers on page load
async function loadRoutesAndStops() {
  try {
    const res = await fetch('/api/vehicles/routes/list');
    const data = await res.json();

    stopsLayer = L.layerGroup().addTo(map);
    depotsLayer = L.layerGroup().addTo(map);

    // Load each route's track and stops
    for (let i = 0; i < data.routes.length; i++) {
      const route = data.routes[i];
      const color = ROUTE_COLORS[i % ROUTE_COLORS.length];

      if (route.geometry && route.geometry.coordinates) {
        const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
        const layer = L.layerGroup().addTo(map);

        // Route polyline (semi-transparent, thin)
        L.polyline(coords, {
          color: color, weight: 3, opacity: 0.4, dashArray: '6,4'
        }).bindTooltip(route.name || route.routeId, {
          permanent: false, direction: 'center', className: 'route-tooltip'
        }).addTo(layer);

        routeLayers[route.routeId] = { layer, color, name: route.name || route.routeId };
      }

      // Fetch stops for this route
      try {
        const stopsRes = await fetch(`/api/vehicles/routes/${route.routeId}`);
        const stopsData = await stopsRes.json();
        if (stopsData.stops) {
          stopsData.stops.forEach(stop => {
            const [lon, lat] = stop.location.coordinates;
            L.circleMarker([lat, lon], {
              radius: 4, color: color, fillColor: color, fillOpacity: 0.6, weight: 1
            }).bindTooltip(`<strong>${stop.name}</strong><br><span style="color:${color}">${route.name || route.routeId}</span>`, {
              direction: 'top'
            }).addTo(stopsLayer);
          });
        }
      } catch (e) { /* skip */ }
    }

    // Load depot markers
    const depotRes = await fetch('/api/dashboard/summary');
    const depotData = await depotRes.json();
    if (depotData.depots) {
      for (const depot of depotData.depots) {
        if (depot.location && depot.location.coordinates) {
          const [lon, lat] = depot.location.coordinates;
          L.marker([lat, lon], {
            icon: L.divIcon({
              className: '',
              html: `<div style="
                background: #263238; border: 2px solid #4fc3f7; border-radius: 6px;
                padding: 2px 5px; font-size: 0.65rem; color: #4fc3f7; white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0,0,0,0.5);
              ">🏢 ${depot.name}</div>`,
              iconSize: [80, 20], iconAnchor: [40, 10]
            })
          }).bindPopup(`<strong>${depot.name}</strong><br>Total: ${depot.total || '?'}<br>Running: ${depot.running || 0} | Idle: ${depot.idle || 0}`)
           .addTo(depotsLayer);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load routes/stops:', err);
  }
}

async function loadDashboard() {
  try {
    const [summaryRes, vehiclesRes] = await Promise.all([
      fetch('/api/dashboard/summary'),
      fetch('/api/dashboard/vehicles')
    ]);
    const summary = await summaryRes.json();
    const vehiclesData = await vehiclesRes.json();

    updateSummaryCards(summary);
    updateDepotList(summary.depots);
    updateMapMarkers(vehiclesData.vehicles);
    updateTimestamp();
  } catch (err) {
    console.error('Dashboard load error:', err);
    document.getElementById('connectionStatus').className = 'status-dot red';
  }
}

function updateSummaryCards(summary) {
  document.getElementById('totalVehicles').textContent = summary.fleet.totalVehicles || 0;
  document.getElementById('runningVehicles').textContent = summary.fleet.running || 0;
  document.getElementById('idleVehicles').textContent = summary.fleet.idle || 0;
  document.getElementById('avgSpeed').textContent = Math.round(summary.fleet.avgSpeed || 0);

  const totalAlerts = summary.activeAlerts.reduce((sum, a) => sum + a.count, 0);
  document.getElementById('activeAlerts').textContent = totalAlerts;
}

function updateDepotList(depots) {
  const depotFilter = document.getElementById('depotFilter');
  const depotList = document.getElementById('depotList');

  // Update filter dropdown (only once)
  if (depotFilter.options.length <= 1) {
    depots.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.depotId;
      opt.textContent = d.name;
      depotFilter.appendChild(opt);
    });
  }

  // Update sidebar list
  depotList.innerHTML = depots.map(d => `
    <div class="depot-item">
      <span class="depot-name">${d.name}</span>
      <span class="depot-stats">
        <span class="stat-running">${d.running} ▶</span>
        <span class="stat-idle">${d.idle} ⏸</span>
      </span>
    </div>
  `).join('');
}

// Status color & shape config
const STATUS_CONFIG = {
  running:   { color: '#4caf50', icon: '▶', shape: 'arrow',  label: 'Running' },
  idle:      { color: '#ffc107', icon: '⏸', shape: 'circle', label: 'Idle' },
  stopped:   { color: '#f44336', icon: '■', shape: 'square', label: 'Stopped' },
  breakdown: { color: '#9c27b0', icon: '⚠', shape: 'diamond', label: 'Breakdown' }
};

let activeRouteLayer = null;
let deviationCircle = null;

function getVehicleIcon(status, heading, speed) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.stopped;
  const size = status === 'running' ? 16 : 12;
  
  if (status === 'running') {
    // Arrow/triangle shape for moving buses — rotated by heading
    return L.divIcon({
      className: 'vehicle-marker',
      html: `<div style="
        width: 0; height: 0;
        border-left: 7px solid transparent;
        border-right: 7px solid transparent;
        border-bottom: 16px solid ${cfg.color};
        filter: drop-shadow(0 0 4px ${cfg.color});
        transform: rotate(${(heading || 0) - 180}deg);
      "></div>`,
      iconSize: [14, 16],
      iconAnchor: [7, 8]
    });
  } else if (status === 'idle') {
    // Pulsing circle for idle
    return L.divIcon({
      className: 'vehicle-marker',
      html: `<div style="
        width: 12px; height: 12px;
        background: ${cfg.color};
        border-radius: 50%;
        border: 2px solid #fff;
        box-shadow: 0 0 8px ${cfg.color};
        animation: pulse 2s infinite;
      "></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
  } else if (status === 'breakdown') {
    // Diamond shape for breakdown
    return L.divIcon({
      className: 'vehicle-marker',
      html: `<div style="
        width: 12px; height: 12px;
        background: ${cfg.color};
        border: 2px solid #fff;
        box-shadow: 0 0 8px ${cfg.color};
        transform: rotate(45deg);
      "></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
  } else {
    // Square for stopped
    return L.divIcon({
      className: 'vehicle-marker',
      html: `<div style="
        width: 10px; height: 10px;
        background: ${cfg.color};
        border: 2px solid #fff;
        box-shadow: 0 0 6px ${cfg.color};
        border-radius: 2px;
      "></div>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5]
    });
  }
}

function buildVehiclePopupHtml(v) {
  const routeInfo = routeLayers[v.routeId];
  const routeLabel = routeInfo ? routeInfo.name : (v.routeId || 'N/A');
  const routeColor = routeInfo ? routeInfo.color : '#78909c';
  const speedVal = Number(v.speed || 0).toFixed(1);

  return `
    <strong>${v.vehicleId}</strong><br>
    Speed: ${speedVal} km/h<br>
    Status: <span style="color:${(STATUS_CONFIG[v.status] || STATUS_CONFIG.stopped).color}">${v.status}</span><br>
    Route: <span style="color:${routeColor};font-weight:600;">${routeLabel}</span><br>
    Depot: ${v.depotId || 'N/A'}<br>
    <small>Updated: ${v.lastUpdated ? new Date(v.lastUpdated).toLocaleTimeString() : '--'}</small><br>
    <a href="#" onclick="highlightRoute('${v.routeId}');return false;" style="color:#4fc3f7;">⬤ Highlight Route</a> |
    <a href="#" onclick="showRouteOnMap('${v.vehicleId}','${v.routeId}');return false;" style="color:#4fc3f7;">Show Stops</a> |
    <a href="/playback?vehicle=${v.vehicleId}" style="color:#4fc3f7;">Playback →</a>
  `;
}

function updateMapMarkers(vehicles) {
  // Remove old markers that no longer exist
  const currentIds = new Set(vehicles.map(v => v.vehicleId));
  Object.keys(markers).forEach(id => {
    if (!currentIds.has(id)) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  });

  vehicles.forEach(v => {
    if (!v.location || !v.location.coordinates) return;
    const [lon, lat] = v.location.coordinates;
    const icon = getVehicleIcon(v.status, v.heading, v.speed);

    if (markers[v.vehicleId]) {
      markers[v.vehicleId].setLatLng([lat, lon]);
      markers[v.vehicleId].setIcon(icon);
      markers[v.vehicleId].setPopupContent(buildVehiclePopupHtml(v));
    } else {
      markers[v.vehicleId] = L.marker([lat, lon], { icon })
        .addTo(map)
        .bindPopup(buildVehiclePopupHtml(v))
        .on('click', () => showVehicleDetail(v.vehicleId));
    }
  });
}

// Highlight a specific route track (make it bold, others dim)
function highlightRoute(routeId) {
  Object.entries(routeLayers).forEach(([id, info]) => {
    info.layer.eachLayer(l => {
      if (l.setStyle) {
        if (id === routeId) {
          l.setStyle({ weight: 6, opacity: 0.9, dashArray: null });
        } else {
          l.setStyle({ weight: 2, opacity: 0.2, dashArray: '6,4' });
        }
      }
    });
  });
  // Reset after 8 seconds
  setTimeout(() => {
    Object.values(routeLayers).forEach(info => {
      info.layer.eachLayer(l => {
        if (l.setStyle) l.setStyle({ weight: 3, opacity: 0.4, dashArray: '6,4' });
      });
    });
  }, 8000);
}

// Show assigned route track on map + deviation indicator
async function showRouteOnMap(vehicleId, routeId) {
  // Clear previous route overlay
  if (activeRouteLayer) { map.removeLayer(activeRouteLayer); activeRouteLayer = null; }
  if (deviationCircle) { map.removeLayer(deviationCircle); deviationCircle = null; }

  if (!routeId || routeId === 'null') return;

  try {
    const res = await fetch(`/api/vehicles/routes/${routeId}`);
    const data = await res.json();
    if (!data.route || !data.route.geometry) return;

    // Draw route line
    const coords = data.route.geometry.coordinates.map(c => [c[1], c[0]]);
    activeRouteLayer = L.layerGroup().addTo(map);

    // Route track (blue dashed line)
    L.polyline(coords, { 
      color: '#2196f3', weight: 4, opacity: 0.7, dashArray: '10,8' 
    }).addTo(activeRouteLayer);

    // Bus stops along route
    if (data.stops) {
      data.stops.forEach(s => {
        L.circleMarker([s.location.coordinates[1], s.location.coordinates[0]], {
          radius: 5, color: '#fff', fillColor: '#2196f3', fillOpacity: 0.8, weight: 2
        }).bindTooltip(s.name, { permanent: false }).addTo(activeRouteLayer);
      });
    }

    // Check deviation — find vehicle current position and compare to route
    const vMarker = markers[vehicleId];
    if (vMarker) {
      const vPos = vMarker.getLatLng();
      const minDist = getDistToRoute(vPos, coords);
      
      // If > 200m from route, show red deviation circle
      if (minDist > 200) {
        deviationCircle = L.circle([vPos.lat, vPos.lng], {
          radius: minDist,
          color: '#f44336', fillColor: '#f44336', fillOpacity: 0.15,
          weight: 2, dashArray: '5,5'
        }).addTo(activeRouteLayer);
        L.popup()
          .setLatLng([vPos.lat, vPos.lng])
          .setContent(`<span style="color:#f44336;font-weight:bold;">⚠ OFF ROUTE</span><br>Deviation: ${Math.round(minDist)}m from track`)
          .openOn(map);
      } else {
        L.popup()
          .setLatLng([vPos.lat, vPos.lng])
          .setContent(`<span style="color:#4caf50;font-weight:bold;">✓ ON TRACK</span><br>Distance: ${Math.round(minDist)}m from route`)
          .openOn(map);
      }
    }

    map.fitBounds(L.polyline(coords).getBounds().pad(0.1));
  } catch (e) {
    console.error('Show route error:', e);
  }
}

// Calculate min distance from point to polyline (meters)
function getDistToRoute(latlng, routeCoords) {
  let minDist = Infinity;
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const dist = distToSegment(latlng, routeCoords[i], routeCoords[i + 1]);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function distToSegment(p, a, b) {
  const pa = { lat: p.lat - a[0], lng: p.lng - a[1] };
  const ba = { lat: b[0] - a[0], lng: b[1] - a[1] };
  const t = Math.max(0, Math.min(1, (pa.lat * ba.lat + pa.lng * ba.lng) / (ba.lat * ba.lat + ba.lng * ba.lng)));
  const proj = [a[0] + t * ba.lat, a[1] + t * ba.lng];
  // Approx meters (1 deg lat ≈ 111320m, 1 deg lng ≈ 111320 * cos(lat))
  const dlat = (p.lat - proj[0]) * 111320;
  const dlng = (p.lng - proj[1]) * 111320 * Math.cos(p.lat * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

async function showVehicleDetail(vehicleId) {
  const [detailRes, progressRes] = await Promise.all([
    fetch(`/api/dashboard/vehicle/${vehicleId}`),
    fetch(`/api/dashboard/trip-progress/${vehicleId}`)
  ]);
  const data = await detailRes.json();
  const tripProgress = progressRes.ok ? await progressRes.json() : null;
  const panel = document.getElementById('vehicleDetailPanel');
  const detail = document.getElementById('vehicleDetail');

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const cs = data.currentState || {};
  const vi = data.vehicleInfo || {};
  const eta = data.etaPrediction || null;

  const sequenceHtml = tripProgress && Array.isArray(tripProgress.sequence)
    ? `
      <div class="detail-row" style="margin-top:0.8rem; border-bottom:none; padding-bottom:0.2rem;">
        <span class="label" style="color:#4fc3f7;font-weight:700;">Stop Sequence Progress</span>
        <button class="btn btn-sm" style="padding:0.2rem 0.45rem;font-size:0.7rem;" onclick="toggleTripExplain()">Explain</button>
      </div>
      <div id="tripExplainBox" style="display:none; background:#0f1923; border:1px solid #2a3a4a; border-radius:6px; padding:0.55rem; margin:0.4rem 0 0.7rem 0; font-size:0.76rem; line-height:1.45; color:#b0bec5;">
        <div style="color:#4fc3f7;font-weight:600;margin-bottom:0.25rem;">Sequence-aware stop detection in PoC UI</div>
        <div>1) Route stop order comes from <strong>routes.stopIds</strong>.</div>
        <div>2) Next expected sequence comes from latest ETA prediction.</div>
        <div>3) Stops before expected are marked completed; expected is highlighted; skip alerts mark skipped stops.</div>
        <div style="margin-top:0.35rem;color:#4fc3f7;font-weight:600;">Exact MongoDB queries used</div>
        <pre style="white-space:pre-wrap;background:#111b25;border:1px solid #2a3a4a;padding:0.45rem;border-radius:6px;color:#9ad5c0;margin-top:0.2rem;">db.routes.findOne({ routeId })
db.bus_stops.find({ stopId: { $in: route.stopIds } })
db.trip_eta_predictions.findOne({ vehicleId })
db.alerts.find({ vehicleId, type: "stop_skipped" }).sort({ timestamp: -1 })</pre>
      </div>
      <div class="detail-row"><span class="label">Next Expected Stop</span><span class="value">#${tripProgress.nextStopSequence || '--'}</span></div>
      <div class="detail-row"><span class="label">Skipped Stops</span><span class="value" style="color:${tripProgress.skippedCount > 0 ? '#f44336' : '#4caf50'}">${tripProgress.skippedCount || 0}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.55rem;">
        ${tripProgress.sequence.slice(0, 12).map((s) => {
          const chipColor = s.status === 'completed' ? '#4caf50' : (s.status === 'next' ? '#4fc3f7' : (s.status === 'skipped' ? '#f44336' : '#78909c'));
          return `<span title="${s.sequence}. ${s.stopName} (${s.status})" style="font-size:0.68rem;padding:0.16rem 0.38rem;border-radius:10px;border:1px solid ${chipColor};color:${chipColor};">${s.sequence}</span>`;
        }).join('')}
      </div>
    `
    : `<div style="margin-top:0.8rem;color:#78909c;font-size:0.82rem;">Trip sequence state is not available yet for this vehicle.</div>`;

  const etaHtml = eta && Array.isArray(eta.predictions) && eta.predictions.length > 0
    ? `
      <div class="detail-row" style="margin-top:0.8rem; border-bottom:none; padding-bottom:0.2rem;">
        <span class="label" style="color:#4fc3f7;font-weight:700;">ETA / ETD (Downstream Stops)</span>
        <button class="btn btn-sm" style="padding:0.2rem 0.45rem;font-size:0.7rem;" onclick="toggleEtaExplain()">Explain</button>
      </div>
      <div id="etaExplainBox" style="display:none; background:#0f1923; border:1px solid #2a3a4a; border-radius:6px; padding:0.55rem; margin:0.4rem 0 0.7rem 0; font-size:0.76rem; line-height:1.45; color:#b0bec5;">
        <div style="color:#4fc3f7;font-weight:600;margin-bottom:0.25rem;">How ETA/ETD works in this PoC</div>
        <div>1) Every GPS update in <strong>vehicle_current_state</strong> triggers Change Stream processing.</div>
        <div>2) Bus point is snapped to route line (turf nearest point on line).</div>
        <div>3) Remaining distance to each downstream stop is computed.</div>
        <div>4) ETA uses effective speed + small dwell per intermediate stop; ETD = ETA + dwell.</div>
        <div style="margin-top:0.35rem;color:#4fc3f7;font-weight:600;">Exact MongoDB queries (PoC)</div>
        <pre style="white-space:pre-wrap;background:#111b25;border:1px solid #2a3a4a;padding:0.45rem;border-radius:6px;color:#9ad5c0;margin-top:0.2rem;">// Worker writes latest ETA vector
db.trip_eta_predictions.updateOne(
  { vehicleId: event.metadata.vehicleId },
  {
    $set: {
      routeId: event.metadata.routeId,
      currentSpeed: event.speed,
      predictions: [
        { stopId, stopName, sequence, remainingKm, eta, etd }
      ],
      updatedAt: new Date()
    }
  },
  { upsert: true }
)

// UI/API reads latest ETA
db.trip_eta_predictions.findOne({ vehicleId: "KA-01-F-1001" })</pre>
        <div style="margin-top:0.35rem;color:#4fc3f7;font-weight:600;">Production recommendation</div>
        <div>Use Kafka + Worker/Flink with traffic and dwell models, confidence score, and publish only meaningful ETA deltas.</div>
      </div>
      <div style="font-size:0.78rem;color:#90a4ae;margin-bottom:0.4rem;">
        Updated: ${eta.updatedAt ? new Date(eta.updatedAt).toLocaleTimeString() : '--'}
      </div>
      ${eta.predictions.slice(0, 4).map((p) => `
        <div class="detail-row">
          <span class="label">${p.sequence}. ${p.stopName}</span>
          <span class="value">${p.eta ? new Date(p.eta).toLocaleTimeString() : '--'}</span>
        </div>
        <div class="detail-row" style="margin-top:-6px;">
          <span class="label">ETD</span>
          <span class="value">${p.etd ? new Date(p.etd).toLocaleTimeString() : '--'}</span>
        </div>
      `).join('')}
    `
    : `<div style="margin-top:1rem;color:#78909c;font-size:0.82rem;">ETA is initializing. Start simulator and click this vehicle again in a few seconds.</div>`;

  detail.innerHTML = `
    <div class="detail-row"><span class="label">Vehicle ID</span><span class="value">${vehicleId}</span></div>
    <div class="detail-row"><span class="label">Type</span><span class="value">${vi.type || 'N/A'}</span></div>
    <div class="detail-row"><span class="label">Route</span><span class="value">${cs.routeId || 'N/A'}</span></div>
    <div class="detail-row"><span class="label">Speed</span><span class="value">${Number(cs.speed || 0).toFixed(1)} km/h</span></div>
    <div class="detail-row"><span class="label">Status</span><span class="value">${cs.status || 'unknown'}</span></div>
    <div class="detail-row"><span class="label">Depot</span><span class="value">${cs.depotId || 'N/A'}</span></div>
    <div class="detail-row"><span class="label">Ignition</span><span class="value">${cs.ignition ? 'ON' : 'OFF'}</span></div>
    <div class="detail-row"><span class="label">Last Update</span><span class="value">${cs.lastUpdated ? new Date(cs.lastUpdated).toLocaleTimeString() : '--'}</span></div>
    ${etaHtml}
    ${sequenceHtml}
    <br>
    <a href="/playback?vehicle=${vehicleId}" class="btn btn-sm">📍 Route Playback</a>
    ${data.recentAlerts.length > 0 ? '<h4 style="margin-top:1rem;color:#f44336;">Recent Alerts</h4>' + 
      data.recentAlerts.slice(0, 3).map(a => `<div class="alert-item ${a.severity}"><span class="alert-type">${a.type.replace('_', ' ')}</span><br><span class="alert-time">${new Date(a.timestamp).toLocaleString()}</span></div>`).join('') : ''}
  `;
}

function toggleEtaExplain() {
  const box = document.getElementById('etaExplainBox');
  if (!box) return;
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function toggleTripExplain() {
  const box = document.getElementById('tripExplainBox');
  if (!box) return;
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function loadAlerts() {
  const res = await fetch('/api/alerts?status=active&limit=10');
  const data = await res.json();
  const alertList = document.getElementById('alertList');

  alertList.innerHTML = data.alerts.map(a => `
    <div class="alert-item ${a.severity}">
      <div class="alert-type">${a.type.replace(/_/g, ' ')}</div>
      <div class="alert-vehicle">${a.vehicleId}</div>
      <div class="alert-time">${new Date(a.timestamp).toLocaleTimeString()}</div>
    </div>
  `).join('') || '<p style="color:#546e7a;font-size:0.8rem;">No active alerts</p>';
}

async function loadVehicles() {
  const depotId = document.getElementById('depotFilter').value;
  const status = document.getElementById('statusFilter').value;
  const params = new URLSearchParams();
  if (depotId) params.set('depotId', depotId);
  if (status) params.set('status', status);

  const res = await fetch(`/api/dashboard/vehicles?${params}`);
  const data = await res.json();
  updateMapMarkers(data.vehicles);
}

function updateTimestamp() {
  document.getElementById('lastUpdate').textContent = `Updated: ${new Date().toLocaleTimeString()}`;
  document.getElementById('connectionStatus').className = 'status-dot green';
}

function startPolling() {
  pollingTimer = setInterval(async () => {
    await loadDashboard();
    await loadAlerts();
  }, POLL_INTERVAL);
}

// Toggle route track visibility
function toggleRouteLayers() {
  showRoutes = !showRoutes;
  Object.values(routeLayers).forEach(info => {
    if (showRoutes) map.addLayer(info.layer);
    else map.removeLayer(info.layer);
  });
  const btn = document.getElementById('toggleRoutes');
  btn.style.opacity = showRoutes ? '1' : '0.5';
}

// Toggle stops layer visibility
let showStops = true;
function toggleStopsLayer() {
  showStops = !showStops;
  if (showStops) map.addLayer(stopsLayer);
  else map.removeLayer(stopsLayer);
  const btn = document.getElementById('toggleStops');
  btn.style.opacity = showStops ? '1' : '0.5';
}

// Seed demo data (GPS history + alerts)
async function seedDemoData() {
  const btn = document.getElementById('seedBtn');
  const hours = parseInt(document.getElementById('seedHours').value);
  const estEvents = (50 * 360 * hours).toLocaleString();
  const estAlerts = Math.max(5, hours * 3);
  if (!confirm(`🌱 Seed Demo Data\n\nDuration: ${hours} hours\nEstimated GPS events: ~${estEvents}\nEstimated alerts: ~${estAlerts}\n\n(Appends to existing data — nothing is deleted)\n\nProceed?`)) return;

  btn.disabled = true;
  btn.textContent = '⏳ Seeding...';
  btn.style.opacity = '0.6';

  try {
    const res = await fetch(`/api/admin/seed-demo?hours=${hours}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(`✅ Seed complete!\n\n• ${data.gpsEvents.toLocaleString()} GPS events inserted\n• ${data.alerts} alerts created\n• ${data.hours}h of history added\n• 50 vehicle states updated\n\nStart GPS simulator for live movement.`);
      loadDashboard();
    } else {
      alert('❌ Seed failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('❌ Seed failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🌱 Seed Data';
    btn.style.opacity = '1';
  }
}

// GPS Simulator toggle (in-process, server-side)
let simulatorRunning = false;

async function toggleSimulator() {
  const btn = document.getElementById('simBtn');
  const action = simulatorRunning ? 'stop' : 'start';

  try {
    btn.disabled = true;
    const res = await fetch(`/api/admin/simulator/${action}`, { method: 'POST' });
    const data = await res.json();
    simulatorRunning = data.running;
    updateSimBtn();
  } catch (err) {
    alert('❌ Simulator error: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

function updateSimBtn() {
  const btn = document.getElementById('simBtn');
  if (simulatorRunning) {
    btn.textContent = '⏹ Simulator';
    btn.style.background = '#f44336';
    btn.title = 'Stop live GPS simulator';
  } else {
    btn.textContent = '▶ Simulator';
    btn.style.background = '#4caf50';
    btn.title = 'Start live GPS simulator (50 events/10s)';
  }
}

// Check simulator status on load
async function checkSimulatorStatus() {
  try {
    const res = await fetch('/api/admin/simulator/status');
    const data = await res.json();
    simulatorRunning = data.running;
    updateSimBtn();
  } catch (e) { /* ignore */ }
}
