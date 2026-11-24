/**
 * SmartRoute: Main Application Controller
 * Handles Leaflet Map, Real-Time GPS Tracking, Forest Warning System,
 * 15-Second GPS Watchdog, Dynamic Dijkstra Recalculation, Driver Login Profile,
 * and Live User Geolocation Integration.
 */

// ============================================================================
// SYSTEM STATE & CONFIGURATION
// ============================================================================
const STATE = {
    currentRole: 'operator', // 'operator' | 'driver'
    driver: {
        name: 'Rajesh Kumar',
        id: 'DRV-842',
        ambulanceId: 'AMB-101',
        isLoggedIn: true
    },
    trackingActive: false,
    currentCoords: [17.3850, 78.4867], // Default city origin (Hyderabad/Metro)
    userLocationCenter: [17.3850, 78.4867],
    graphData: null, // { graph, forestGeofence, forestPolygon }
    activeRouteInfo: null, // Result of Dijkstra
    alternativeRouteInfo: null,
    currentPathIndex: 0,
    progressAlongEdge: 0, // 0.0 to 1.0
    currentSpeedKmh: 58,
    isForestWarningTriggered: false,
    isForestEntryTriggered: false,
    avoidForestChoice: false,
    lastKnownPosition: null,
    uncertaintyCircle: null,
    audioEnabled: true
};

// Map & Layer References
let map = null;
let ambulanceMarker = null;
let hospitalMarker = null;
let forestPolygonLayer = null;
let roadLayers = [];
let activeRoutePolyline = null;
let alternativeRoutePolyline = null;
let nodeMarkers = [];
let simulationInterval = null;
let watchdog = null;

// ============================================================================
// AUDIO ALERT SYNTHESIZER (Web Audio API)
// ============================================================================
function playAlertTone(type = 'info') {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'critical') {
            // High double pulse
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
            osc.start();
            osc.stop(ctx.currentTime + 0.35);
        } else if (type === 'warning') {
            // Amber chime
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.2); // G5
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        } else {
            // Pleasant notification blip
            osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
        }
    } catch (e) {
        // Audio auto-play might be restricted before first click
    }
}

// ============================================================================
// INITIALIZATION & LIVE LOCATION ENGINE
// ============================================================================
let userLiveFixCircle = null;
let userLiveFixMarker = null;

document.addEventListener('DOMContentLoaded', () => {
    initWatchdog();
    initGraphAndMap(STATE.userLocationCenter[0], STATE.userLocationCenter[1]);
    initCodeInspectorContent();
    setupKeyboardShortcuts();

    // Push initial login alert
    logAlert("Driver Rajesh Kumar (AMB-101) logged in. Unit is ON DUTY.", "success");
    logAlert("Dijkstra Min-Heap engine initialized. Road network loaded.", "info");

    // Automatically locate user's real area on startup
    tryAutoGeolocate();
});

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'F') {
            // Ignore if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            toggleMapMaximize();
        } else if (e.key === 'Escape') {
            const wrapper = document.getElementById('mainMapWrapper');
            if (wrapper && wrapper.classList.contains('maximized')) {
                toggleMapMaximize();
            }
        }
    });
}

function tryAutoGeolocate() {
    const badge = document.getElementById('hudAreaBadge');
    if (badge) badge.textContent = "Detecting Live Location...";

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const accuracy = pos.coords.accuracy || 50;

                updateLocationAndRebuildGraph(lat, lng, "Live Location");
                reverseGeocodeArea(lat, lng);
                logAlert(`ðŸ“ GPS Lock acquired: ${lat.toFixed(4)}, ${lng.toFixed(4)} (Accuracy: ${Math.round(accuracy)}m). Map centered on your current location.`, "success");
                playAlertTone('info');
            },
            (err) => {
                console.warn("Browser GPS prompt skipped or denied, attempting IP city fallback...", err.message);
                fallbackIpLocation();
            },
            { timeout: 8000, enableHighAccuracy: true, maximumAge: 0 }
        );
    } else {
        fallbackIpLocation();
    }
}

function fallbackIpLocation() {
    // Free IP geolocation fallback (No API key needed)
    fetch('https://get.geojs.io/v1/ip/geo.json')
        .then(res => res.json())
        .then(data => {
            if (data && data.latitude && data.longitude) {
                const lat = parseFloat(data.latitude);
                const lng = parseFloat(data.longitude);
                const city = data.city || data.region || "Your Metro Area";
                updateLocationAndRebuildGraph(lat, lng, city);
                const badge = document.getElementById('hudAreaBadge');
                if (badge) badge.textContent = `ðŸ“ ${city}`;
                const originLabel = document.getElementById('routeOriginName');
                if (originLabel) originLabel.textContent = `${city} (Origin)`;
                logAlert(`ðŸ“ Area located via IP telemetry: ${city} (${lat.toFixed(4)}, ${lng.toFixed(4)}). Graph centered on your city.`, "info");
            }
        })
        .catch(() => {
            const badge = document.getElementById('hudAreaBadge');
            if (badge) badge.textContent = "ðŸ“ Metro Center";
        });
}

function fetchUserLiveLocation() {
    if (!("geolocation" in navigator)) {
        alert("Geolocation is not supported by your browser.");
        return;
    }
    const btn = document.getElementById('btnUseLiveLocation');
    const oldText = btn.innerHTML;
    btn.innerHTML = `<span class="pulse-dot" style="display:inline-block;"></span> Locating...`;

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            btn.innerHTML = oldText;
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            updateLocationAndRebuildGraph(lat, lng, "Live Area Location");
            reverseGeocodeArea(lat, lng);
            logAlert(`Map and Directed Graph re-anchored to your live coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, "success");
            playAlertTone('info');
        },
        (err) => {
            btn.innerHTML = oldText;
            alert("Could not retrieve exact GPS fix (" + err.message + "). Check browser location permissions.");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function reverseGeocodeArea(lat, lng) {
    const badge = document.getElementById('hudAreaBadge');
    const originLabel = document.getElementById('routeOriginName');

    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`)
        .then(res => res.json())
        .then(data => {
            if (data && data.address) {
                const area = data.address.suburb || data.address.neighbourhood || data.address.residential || data.address.city || data.address.town || data.address.county || "Live Area";
                const city = data.address.city || data.address.state_district || "";
                const displayStr = city ? `${area}, ${city}` : area;

                if (badge) badge.textContent = `ðŸ“ ${displayStr}`;
                if (originLabel) originLabel.textContent = `${displayStr} (Emergency Scene)`;
                logAlert(`Area identified: ${displayStr}`, "info");
            }
        })
        .catch(() => {
            if (badge) badge.textContent = `ðŸ“ ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
        });
}

function updateLocationAndRebuildGraph(centerLat, centerLng, label = "Origin") {
    STATE.userLocationCenter = [centerLat, centerLng];
    STATE.currentCoords = [centerLat, centerLng];
    STATE.lastKnownPosition = [centerLat, centerLng];

    // Rebuild dynamic graph anchored at this location
    STATE.graphData = createCityGraphAt(centerLat, centerLng);

    // Reposition map
    if (map) {
        map.flyTo([centerLat + 0.015, centerLng + 0.005], 13.5, { duration: 1.2 });
        renderGraphOnMap();
        computeAndRenderDijkstra();
    }
}

// ============================================================================
// MOVEABLE MAP CONTROLS (MAXIMIZE / FULLSCREEN, MINIMIZE, RECENTER)
// ============================================================================
function toggleMapMaximize() {
    const wrapper = document.getElementById('mainMapWrapper');
    if (!wrapper) return;

    wrapper.classList.toggle('maximized');
    wrapper.classList.remove('minimized');
    const isMax = wrapper.classList.contains('maximized');

    const icon = document.getElementById('iconMaximize');
    if (icon) {
        icon.setAttribute('data-lucide', isMax ? 'minimize-2' : 'maximize-2');
        if (window.lucide) lucide.createIcons();
    }

    const btn = document.getElementById('btnToggleMaximize');
    if (btn) {
        btn.setAttribute('title', isMax ? 'Restore Default View (F / Esc)' : 'Maximize / Fullscreen Map (F)');
    }

    // Force Leaflet to re-calculate container dimensions across full window
    setTimeout(() => {
        if (map) {
            map.invalidateSize({ pan: false, debounceMoveEvents: true });
        }
    }, 200);

    logAlert(isMax ? "Map expanded to Fullscreen CAD Mode (Press F or Esc to restore)." : "Map restored to standard dashboard view.", "info");
}

function toggleMapMinimize() {
    const wrapper = document.getElementById('mainMapWrapper');
    if (!wrapper) return;

    wrapper.classList.toggle('minimized');
    wrapper.classList.remove('maximized');

    setTimeout(() => {
        if (map) {
            map.invalidateSize({ pan: false });
        }
    }, 200);
}

function recenterToLiveLocation() {
    if (!map || !STATE.userLocationCenter) return;
    map.flyTo(STATE.userLocationCenter, 14, { duration: 1.0 });
    logAlert("Map re-centered to your live location.", "info");
}

// ============================================================================
// WATCHDOG TIMER SETUP (15-Second Connection Loss Detection)
// ============================================================================
function initWatchdog() {
    watchdog = new GPSWatchdog(15, (isConnected, elapsedSeconds, reason) => {
        const pill = document.getElementById('headerGpsPill');
        const text = document.getElementById('headerGpsText');
        const cabPill = document.getElementById('cabGpsPill');
        const cabText = document.getElementById('cabGpsText');
        const kpiVal = document.getElementById('kpiGpsStatus');
        const kpiSub = document.getElementById('kpiGpsSub');
        const banner = document.getElementById('bannerGpsLost');
        const tblGps = document.getElementById('tblGps101');

        if (!isConnected) {
            // LOST STATE
            pill.classList.add('lost');
            text.textContent = 'GPS: LOST (15s+)';
            if (cabPill) {
                cabPill.classList.add('lost');
                cabText.textContent = 'GPS SIGNAL LOST';
            }
            kpiVal.textContent = 'LOST';
            kpiVal.style.color = 'var(--emergency-red)';
            kpiSub.textContent = `No ping for ${elapsedSeconds}s (Threshold: 15s)`;
            banner.classList.add('visible');

            const details = document.getElementById('bannerGpsLostDetails');
            const latLngStr = STATE.currentCoords ? `${STATE.currentCoords[0].toFixed(5)}, ${STATE.currentCoords[1].toFixed(5)}` : "Unknown";
            details.textContent = `Vehicle: ${STATE.driver.ambulanceId} | Driver: ${STATE.driver.name} | Last Ping: ${elapsedSeconds}s ago | Last Known: [${latLngStr}]`;

            if (tblGps) {
                tblGps.innerHTML = `<span style="color:#ef4444; font-weight:700;">&bull; LOST (${elapsedSeconds}s)</span>`;
            }

            // Draw uncertainty circle on map around last known coordinates
            showUncertaintyCircle();

            logAlert(`CRITICAL: GPS Connection Lost for ${STATE.driver.ambulanceId}! Telemetry stopped. Last known: ${latLngStr}`, 'critical');
            playAlertTone('critical');
        } else {
            // CONNECTED STATE
            pill.classList.remove('lost');
            text.textContent = 'GPS: CONNECTED';
            if (cabPill) {
                cabPill.classList.remove('lost');
                cabText.textContent = 'GPS ACTIVE';
            }
            kpiVal.textContent = 'CONNECTED';
            kpiVal.style.color = 'var(--status-green)';
            kpiSub.textContent = 'Ping delay: 1.0s (15s threshold)';
            banner.classList.remove('visible');

            if (tblGps) {
                tblGps.innerHTML = `<span style="color:#10b981;">&bull; Active</span>`;
            }

            removeUncertaintyCircle();

            if (reason === "RESTORED") {
                logAlert(`GPS Connection Restored for ${STATE.driver.ambulanceId}. Telemetry synchronized.`, 'success');
                playAlertTone('info');
            }
        }
    });

    // Update GPS ping timer display every second
    setInterval(() => {
        if (watchdog && watchdog.isConnected) {
            const sub = document.getElementById('kpiGpsSub');
            if (sub) {
                const el = watchdog.getElapsedSeconds();
                sub.textContent = `Ping delay: ${el.toFixed(1)}s (15s threshold)`;
            }
        }
    }, 1000);
}

function showUncertaintyCircle() {
    if (!map || !STATE.currentCoords) return;
    removeUncertaintyCircle();

    // 400m radius of dead-reckoning uncertainty
    STATE.uncertaintyCircle = L.circle(STATE.currentCoords, {
        radius: 400,
        color: '#ef4444',
        weight: 2,
        dashArray: '6, 6',
        fillColor: '#ef4444',
        fillOpacity: 0.15
    }).addTo(map);

    // Change ambulance icon to semi-transparent ghost marker
    if (ambulanceMarker) {
        ambulanceMarker.setOpacity(0.5);
    }
}

function removeUncertaintyCircle() {
    if (STATE.uncertaintyCircle && map) {
        map.removeLayer(STATE.uncertaintyCircle);
        STATE.uncertaintyCircle = null;
    }
    if (ambulanceMarker) {
        ambulanceMarker.setOpacity(1.0);
    }
}

// ============================================================================
// MAP & GRAPH RENDERING
// ============================================================================
function initGraphAndMap(centerLat, centerLng) {
    // Generate Graph Data
    STATE.graphData = createCityGraphAt(centerLat, centerLng);

    // Initialize Leaflet Map with Dark Matter tiles
    map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView([centerLat + 0.015, centerLng + 0.005], 13.5);

    // CartoDB Dark Matter Tiles (Professional dark navy aesthetic)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(map);

    renderGraphOnMap();
    computeAndRenderDijkstra();
}

function renderGraphOnMap() {
    const { graph, forestPolygon } = STATE.graphData;

    // Clear previous layers
    roadLayers.forEach(l => map.removeLayer(l));
    roadLayers = [];
    nodeMarkers.forEach(m => map.removeLayer(m));
    nodeMarkers = [];

    if (forestPolygonLayer) map.removeLayer(forestPolygonLayer);
    if (ambulanceMarker) map.removeLayer(ambulanceMarker);
    if (hospitalMarker) map.removeLayer(hospitalMarker);

    // 1. Draw Forest Polygon
    forestPolygonLayer = L.polygon(forestPolygon, {
        color: '#059669',
        weight: 2,
        dashArray: '5, 5',
        fillColor: '#059669',
        fillOpacity: 0.25
    }).addTo(map);

    forestPolygonLayer.bindPopup(`<strong>${STATE.graphData.forestGeofence.name}</strong><br>Eco-Sensitive Geofenced Forest Corridor`);

    // 2. Draw Road Edges (Color by traffic factor)
    graph.edges.forEach(edge => {
        const u = graph.vertices.get(edge.src);
        const v = graph.vertices.get(edge.dest);
        if (!u || !v) return;

        let strokeColor = '#10b981'; // Green (1.0x)
        if (edge.trafficFactor >= 3.0) {
            strokeColor = '#ef4444'; // Red (Heavy)
        } else if (edge.trafficFactor > 1.3) {
            strokeColor = '#f59e0b'; // Amber (Moderate)
        }

        const line = L.polyline([[u.lat, u.lng], [v.lat, v.lng]], {
            color: strokeColor,
            weight: 4,
            opacity: 0.75
        }).addTo(map);

        line.bindTooltip(`${edge.roadName}: ${edge.distKm} km (Traffic: ${edge.trafficFactor}x)`, { sticky: true });
        roadLayers.push(line);
    });

    // 3. Draw Vertex Nodes
    graph.vertices.forEach(vertex => {
        const isHospital = vertex.id === 7;
        const isStart = vertex.id === 0;

        const nodeIcon = L.divIcon({
            className: 'custom-node-icon',
            html: `<div style="
                background: ${isHospital ? '#ef4444' : (isStart ? '#38bdf8' : '#1e293b')};
                border: 2px solid ${isHospital ? '#ffffff' : '#38bdf8'};
                color: #ffffff;
                width: 22px;
                height: 22px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: 800;
                box-shadow: 0 0 10px rgba(0,0,0,0.5);
            ">${vertex.id}</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11]
        });

        const marker = L.marker([vertex.lat, vertex.lng], { icon: nodeIcon }).addTo(map);
        marker.bindPopup(`<strong>[Node ${vertex.id}] ${vertex.name}</strong><br>Lat: ${vertex.lat.toFixed(4)}, Lng: ${vertex.lng.toFixed(4)}`);
        nodeMarkers.push(marker);
    });

    // 4. Hospital Marker at Destination (Node 7)
    const hospitalVertex = graph.vertices.get(7);
    const hospIcon = L.divIcon({
        className: 'hospital-marker-icon',
        html: `
            <div style="background:#ef4444; color:white; width:34px; height:34px; border-radius:8px; border:2px solid white; display:flex; align-items:center; justify-content:center; box-shadow:0 0 15px rgba(239,68,68,0.8); font-weight:bold; font-size:18px;">
                +
            </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
    });
    hospitalMarker = L.marker([hospitalVertex.lat, hospitalVertex.lng], { icon: hospIcon }).addTo(map);
    hospitalMarker.bindPopup(`<strong>${hospitalVertex.name}</strong><br>Level-1 Emergency Trauma Hospital`);

    // 5. Ambulance Marker at Origin (Node 0)
    const startVertex = graph.vertices.get(0);
    const ambIcon = L.divIcon({
        className: 'ambulance-marker-icon',
        html: `
            <div class="siren-beacon">
                <div class="siren-ring"></div>
                <div style="background:#0ea5e9; width:28px; height:28px; border-radius:50%; border:2px solid #ffffff; display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px #0ea5e9;">
                    <span style="font-size:14px;">ðŸš‘</span>
                </div>
            </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });
    ambulanceMarker = L.marker([startVertex.lat, startVertex.lng], { icon: ambIcon, zIndexOffset: 1000 }).addTo(map);
}

// ============================================================================
// DIJKSTRA ROUTE COMPUTATION & RENDERING
// ============================================================================
function computeAndRenderDijkstra(avoidForest = STATE.avoidForestChoice) {
    const { graph } = STATE.graphData;
    const result = graph.dijkstra(0, 7, avoidForest);
    STATE.activeRouteInfo = result;

    const coords = result.path.map(id => {
        const v = graph.vertices.get(id);
        return [v.lat, v.lng];
    });

    // Remove old polylines
    if (activeRoutePolyline) map.removeLayer(activeRoutePolyline);
    if (alternativeRoutePolyline) map.removeLayer(alternativeRoutePolyline);

    // If avoiding forest, also compute the default forest path to show as gray dashed alternative
    if (avoidForest) {
        const defaultResult = graph.dijkstra(0, 7, false);
        STATE.alternativeRouteInfo = defaultResult;
        const defaultCoords = defaultResult.path.map(id => {
            const v = graph.vertices.get(id);
            return [v.lat, v.lng];
        });

        alternativeRoutePolyline = L.polyline(defaultCoords, {
            color: '#64748b',
            weight: 4,
            dashArray: '6, 8',
            opacity: 0.65
        }).addTo(map);
        alternativeRoutePolyline.bindTooltip("Original Forest Route (Bypassed)", { sticky: true });
    }

    // Active Route Polyline (Glowing cyan/blue)
    activeRoutePolyline = L.polyline(coords, {
        color: '#06b6d4',
        weight: 6,
        opacity: 0.95,
        lineCap: 'round'
    }).addTo(map);

    // Update UI elements
    updateRouteUI(result, avoidForest);
}

function updateRouteUI(result, avoidForest) {
    const { graph } = STATE.graphData;
    const pathStr = result.path.map(id => {
        const v = graph.vertices.get(id);
        return `${v.name.split(' ')[0]} (${id})`;
    }).join(' &rarr; ');

    document.getElementById('routeNodesText').innerHTML = pathStr;
    document.getElementById('sideDist').textContent = `${result.distanceKm} km`;
    document.getElementById('sideEta').textContent = `~${result.etaMinutes} mins`;
    document.getElementById('hudDist').textContent = `${result.distanceKm} km`;
    document.getElementById('hudEta').textContent = `${result.etaMinutes} mins`;
    document.getElementById('cabDistVal').textContent = `${result.distanceKm} km`;
    document.getElementById('cabEtaVal').textContent = `${result.etaMinutes} mins`;

    const badge = document.getElementById('routeTagBadge');
    const hudMode = document.getElementById('hudMode');
    if (avoidForest) {
        badge.textContent = 'Bypass Highway (Safe)';
        badge.style.color = '#10b981';
        hudMode.textContent = 'Highway Bypass';
        hudMode.style.color = '#10b981';
    } else {
        badge.textContent = 'Standard Dijkstra';
        badge.style.color = '#38bdf8';
        hudMode.textContent = 'Optimal Direct';
        hudMode.style.color = '#38bdf8';
    }
}

// ============================================================================
// REAL-TIME AMBULANCE GPS SIMULATION LOOP
// ============================================================================
function toggleAmbulanceTracking() {
    STATE.trackingActive = !STATE.trackingActive;
    const btn = document.getElementById('btnToggleTracking');
    const text = document.getElementById('btnTrackingText');

    if (STATE.trackingActive) {
        btn.classList.remove('success');
        btn.classList.add('danger');
        text.textContent = 'Pause GPS Tracking';
        startSimulationLoop();
        logAlert("Ambulance live tracking started. Vehicle moving on active route.", "info");
    } else {
        btn.classList.remove('danger');
        btn.classList.add('success');
        text.textContent = 'Start GPS Tracking';
        stopSimulationLoop();
        logAlert("Ambulance tracking paused.", "info");
    }
}

function startSimulationLoop() {
    if (simulationInterval) clearInterval(simulationInterval);

    simulationInterval = setInterval(() => {
        if (!STATE.trackingActive) return;

        // Ping watchdog to simulate live satellite heartbeat
        if (watchdog) watchdog.ping();

        stepAmbulanceAlongRoute();
    }, 400); // 400ms tick for smooth movement
}

function stopSimulationLoop() {
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
}

function stepAmbulanceAlongRoute() {
    const { graph, forestGeofence } = STATE.graphData;
    const path = STATE.activeRouteInfo.path;
    if (!path || path.length < 2) return;

    if (STATE.currentPathIndex >= path.length - 1) {
        // Reached hospital destination!
        logAlert("AMBULANCE ARRIVED AT APOLLO TRAUMA CENTER. Emergency handover in progress.", "success");
        playAlertTone('warning');
        toggleAmbulanceTracking();
        return;
    }

    const uId = path[STATE.currentPathIndex];
    const vId = path[STATE.currentPathIndex + 1];
    const u = graph.vertices.get(uId);
    const v = graph.vertices.get(vId);

    // Advance progress along current edge
    STATE.progressAlongEdge += 0.05; // 5% per tick

    if (STATE.progressAlongEdge >= 1.0) {
        STATE.progressAlongEdge = 0;
        STATE.currentPathIndex++;
    }

    // Interpolate coordinates
    const curLat = u.lat + (v.lat - u.lat) * STATE.progressAlongEdge;
    const curLng = u.lng + (v.lng - u.lng) * STATE.progressAlongEdge;
    STATE.currentCoords = [curLat, curLng];
    STATE.lastKnownPosition = [curLat, curLng];

    // Update Marker position on Operator Map
    if (ambulanceMarker && map) {
        ambulanceMarker.setLatLng([curLat, curLng]);
    }

    // Update Driver Map ambulance position
    if (driverAmbulanceMarker && driverMap) {
        driverAmbulanceMarker.setLatLng([curLat, curLng]);
    }

    // Dynamic speed simulation
    const speed = Math.floor(52 + Math.random() * 12);
    STATE.currentSpeedKmh = speed;
    document.getElementById('hudSpeed').textContent = `${speed} km/h`;
    document.getElementById('cabSpeedVal').innerHTML = `${speed} <span style="font-size: 1rem; color:var(--text-muted);">km/h</span>`;

    // Update Operator CAD "Where Ambulance is Going" strip
    const stripPos = document.getElementById('stripCurrentPos');
    const stripNext = document.getElementById('stripNextWaypoint');
    const stripSpd = document.getElementById('stripSpeedHeading');
    const stripEta = document.getElementById('stripEtaCountdown');
    if (stripPos) stripPos.textContent = `${curLat.toFixed(4)}Â° N, ${curLng.toFixed(4)}Â° E â€¢ ${u.name}`;
    if (stripNext) stripNext.textContent = `Approaching ${v.name}`;
    if (stripSpd) stripSpd.textContent = `${speed} km/h â€¢ Heading NE 38Â°`;
    if (stripEta && STATE.activeRouteInfo) stripEta.textContent = `${STATE.activeRouteInfo.etaMinutes} mins remaining`;

    // Update Split View telemetry
    updateSplitTelemetry();

    // Turn guidance update for Driver Cabin
    updateTurnGuidance(u, v);

    // Check Forest Geofence Condition
    checkForestProximity(curLat, curLng, forestGeofence);
}

function updateTurnGuidance(currVertex, nextVertex) {
    const title = document.getElementById('turnInstructionTitle');
    const sub = document.getElementById('turnInstructionSub');
    if (!title || !sub) return;

    title.textContent = `Head toward ${nextVertex.name}`;
    sub.textContent = `Leaving ${currVertex.name} &bull; Speed: ${STATE.currentSpeedKmh} km/h`;
}

// ============================================================================
// FOREST WARNING & ENTRY SYSTEM
// ============================================================================
function checkForestProximity(lat, lng, forestGeofence) {
    const isInside = forestGeofence.contains(lat, lng);
    const isApproaching = forestGeofence.isApproaching(lat, lng);

    const bannerApproach = document.getElementById('bannerForestApproach');
    const bannerEntry = document.getElementById('bannerForestEntry');
    const cabDecision = document.getElementById('cabDecisionPanel');
    const kpiForest = document.getElementById('kpiForestStatus');
    const kpiSub = document.getElementById('kpiForestSub');

    if (isInside) {
        // INSIDE FOREST
        if (!STATE.isForestEntryTriggered) {
            STATE.isForestEntryTriggered = true;
            bannerApproach.classList.remove('visible');
            bannerEntry.classList.add('visible');
            cabDecision.classList.add('active');

            kpiForest.textContent = 'INSIDE FOREST';
            kpiForest.style.color = 'var(--emergency-red)';
            kpiSub.textContent = 'Wildlife & cellular risk active';

            // Flash forest polygon red
            if (forestPolygonLayer) {
                forestPolygonLayer.setStyle({
                    color: '#ef4444',
                    fillColor: '#ef4444',
                    fillOpacity: 0.45
                });
            }

            logAlert("RED ALERT: Ambulance entered Forest Area. Wildlife hazard & weak telemetry.", "critical");
            playAlertTone('critical');
        }
    } else if (isApproaching) {
        // APPROACHING FOREST (within 600m buffer)
        if (!STATE.isForestWarningTriggered && !STATE.isForestEntryTriggered) {
            STATE.isForestWarningTriggered = true;
            bannerApproach.classList.add('visible');
            kpiForest.textContent = 'APPROACHING';
            kpiForest.style.color = 'var(--alert-amber)';
            kpiSub.textContent = 'Within 600m of forest boundary';

            logAlert("WARNING: You are approaching a Forest Area. Please review route before proceeding.", "warning");
            playAlertTone('warning');
        }
    } else {
        // CLEAR
        if (STATE.isForestWarningTriggered && !STATE.isForestEntryTriggered) {
            STATE.isForestWarningTriggered = false;
            bannerApproach.classList.remove('visible');
            kpiForest.textContent = 'CLEAR';
            kpiForest.style.color = 'var(--status-green)';
            kpiSub.textContent = 'Eco-reserve proximity';
        }
    }
}

function driverChooseRoute(avoidForest) {
    STATE.avoidForestChoice = avoidForest;

    // Dismiss banners
    dismissBanner('bannerForestEntry');
    dismissBanner('bannerForestApproach');
    const cabDecision = document.getElementById('cabDecisionPanel');
    if (cabDecision) cabDecision.classList.remove('active');

    // Recalculate route using Dijkstra
    computeAndRenderDijkstra(avoidForest);

    // Update Driver Map route
    if (typeof renderDriverRoute === 'function') {
        renderDriverRoute();
    }

    const modeBadge = document.getElementById('driverRouteModeBadge');
    const splitTag = document.getElementById('splitRouteTag');
    if (modeBadge) {
        modeBadge.textContent = avoidForest ? "Highway Bypass Route (Safe)" : "Direct Forest Cutoff Route";
        modeBadge.style.color = avoidForest ? "#10b981" : "#f59e0b";
        modeBadge.style.borderColor = avoidForest ? "#10b981" : "#f59e0b";
    }
    if (splitTag) {
        splitTag.textContent = avoidForest ? "Highway Bypass" : "Forest Path";
    }

    if (avoidForest) {
        logAlert(`DRIVER DECISION: Switched to Highway Bypass Route. Recalculated via Dijkstra.`, "success");
        playAlertTone('info');
    } else {
        logAlert(`DRIVER DECISION: Continuing on current forest route under caution.`, "warning");
    }
}

function dismissBanner(bannerId) {
    const el = document.getElementById(bannerId);
    if (el) el.classList.remove('visible');
}

// ============================================================================
// GPS WATCHDOG SIMULATION TRIGGERS
// ============================================================================
function simulateGpsLoss() {
    if (watchdog) {
        watchdog.simulateLoss("GPS_SATELLITE_BLOCKED");
    }
}

function restoreGpsConnection() {
    if (watchdog) {
        watchdog.restore();
    }
}

// ============================================================================
// TRAFFIC SIMULATION & RECALCULATION
// ============================================================================
function simulateTrafficJam() {
    const { graph } = STATE.graphData;
    // Inject heavy traffic on edge 0 <-> 1 (Boulevard Link)
    graph.setTraffic(0, 1, 4.0); // 4x traffic multiplier

    // Re-render roads on map
    renderGraphOnMap();

    // Recalculate route
    computeAndRenderDijkstra(STATE.avoidForestChoice);

    const kpiTraffic = document.getElementById('kpiTrafficStatus');
    const kpiTrafficSub = document.getElementById('kpiTrafficSub');
    kpiTraffic.textContent = 'CONGESTED';
    kpiTraffic.style.color = 'var(--emergency-red)';
    kpiTrafficSub.textContent = 'Boulevard Link: 4.0x congestion';

    logAlert("TRAFFIC CONGESTION DETECTED: Boulevard Link traffic factor 4.0x. Dynamic Dijkstra recalculated optimal bypass.", "warning");
    playAlertTone('warning');
}

function recalculateOptimalRoute() {
    computeAndRenderDijkstra(STATE.avoidForestChoice);
    logAlert("Dijkstra Min-Heap recalculated optimal route based on live dynamic weights.", "info");
    playAlertTone('info');
}

function simulateApproachForest() {
    const { graph } = STATE.graphData;
    // Jump ambulance to vertex 2 (Forest Approach Point)
    const v2 = graph.vertices.get(2);
    STATE.currentPathIndex = 2;
    STATE.progressAlongEdge = 0;
    STATE.currentCoords = [v2.lat, v2.lng];
    if (ambulanceMarker) ambulanceMarker.setLatLng([v2.lat, v2.lng]);
    map.panTo([v2.lat, v2.lng]);

    checkForestProximity(v2.lat, v2.lng, STATE.graphData.forestGeofence);
}

function simulateEnterForest() {
    const { graph } = STATE.graphData;
    // Jump ambulance to vertex 3 (Eco Reserve South Gate)
    const v3 = graph.vertices.get(3);
    STATE.currentPathIndex = 3;
    STATE.progressAlongEdge = 0.2;
    STATE.currentCoords = [v3.lat, v3.lng];
    if (ambulanceMarker) ambulanceMarker.setLatLng([v3.lat, v3.lng]);
    map.panTo([v3.lat, v3.lng]);

    checkForestProximity(v3.lat, v3.lng, STATE.graphData.forestGeofence);
}

function resetDemo() {
    stopSimulationLoop();
    STATE.trackingActive = false;
    STATE.currentPathIndex = 0;
    STATE.progressAlongEdge = 0;
    STATE.isForestWarningTriggered = false;
    STATE.isForestEntryTriggered = false;
    STATE.avoidForestChoice = false;

    // Reset traffic on all edges
    const { graph } = STATE.graphData;
    graph.edges.forEach(e => e.trafficFactor = 1.0);

    // Reset buttons
    const btn = document.getElementById('btnToggleTracking');
    btn.classList.remove('danger');
    btn.classList.add('success');
    document.getElementById('btnTrackingText').textContent = 'Start GPS Tracking';

    dismissBanner('bannerForestApproach');
    dismissBanner('bannerForestEntry');
    dismissBanner('bannerGpsLost');

    if (watchdog) watchdog.restore();

    renderGraphOnMap();
    computeAndRenderDijkstra(false);

    document.getElementById('kpiTrafficStatus').textContent = 'OPTIMAL';
    document.getElementById('kpiTrafficStatus').style.color = 'var(--status-green)';
    document.getElementById('kpiTrafficSub').textContent = 'Dynamic edge weights';
    document.getElementById('kpiForestStatus').textContent = 'CLEAR';
    document.getElementById('kpiForestStatus').style.color = 'var(--status-green)';

    logAlert("Simulation state reset to default parameters.", "info");
}

// ============================================================================
// DRIVER PROFILE LOGIN SYSTEM
// ============================================================================
function openDriverLoginModal() {
    const modal = document.getElementById('modalDriverLogin');
    modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('active');
}

function selectQuickProfile(name, id, ambId, element) {
    document.querySelectorAll('.quick-pick-card').forEach(c => c.classList.remove('selected'));
    element.classList.add('selected');

    document.getElementById('loginDriverName').value = name;
    document.getElementById('loginDriverId').value = id;
    document.getElementById('loginAmbulanceId').value = ambId;
}

function handleDriverLogin(event) {
    event.preventDefault();
    const name = document.getElementById('loginDriverName').value.trim();
    const id = document.getElementById('loginDriverId').value.trim();
    const ambId = document.getElementById('loginAmbulanceId').value;

    STATE.driver.name = name;
    STATE.driver.id = id;
    STATE.driver.ambulanceId = ambId;
    STATE.driver.isLoggedIn = true;

    // Update UI headers & Driver Cabin
    document.getElementById('headerDriverName').textContent = `Driver: ${name} (${ambId})`;
    document.getElementById('cabDriverName').textContent = `Driver: ${name}`;
    document.getElementById('cabAmbulanceId').textContent = ambId;

    closeModal('modalDriverLogin');

    // Operator notification
    const msg = `ðŸ”” Driver ${name} (ID: ${id}) logged in to Ambulance ${ambId}. Vehicle is now ON DUTY.`;
    logAlert(msg, "success");
    playAlertTone('info');
}

// ============================================================================
// ROLE SWITCHER: OPERATOR CONTROL vs DRIVER CABIN vs DUAL SPLIT VIEW
// ============================================================================
let driverMap = null;
let driverRoutePolyline = null;
let driverAmbulanceMarker = null;

function switchRole(role) {
    STATE.currentRole = role;
    const btnOp = document.getElementById('btnRoleOperator');
    const btnDrv = document.getElementById('btnRoleDriver');
    const btnSplit = document.getElementById('btnRoleSplit');
    const opView = document.getElementById('operatorView');
    const drvView = document.getElementById('driverCabinView');
    const splitView = document.getElementById('dualSplitContainer');
    const metricsGrid = document.getElementById('metricsGrid');

    btnOp.classList.remove('active');
    btnDrv.classList.remove('active');
    if (btnSplit) btnSplit.classList.remove('active');

    if (role === 'driver') {
        btnDrv.classList.add('active');
        opView.style.display = 'none';
        metricsGrid.style.display = 'none';
        if (splitView) splitView.classList.remove('active');
        drvView.classList.add('active');

        // Initialize or re-size Driver In-Cab Map
        setTimeout(() => {
            initDriverMap();
            if (driverMap) driverMap.invalidateSize();
        }, 150);

    } else if (role === 'split') {
        if (btnSplit) btnSplit.classList.add('active');
        opView.style.display = 'none';
        drvView.classList.remove('active');
        metricsGrid.style.display = 'none';
        if (splitView) splitView.classList.add('active');

        updateSplitTelemetry();

    } else {
        // Operator view default
        btnOp.classList.add('active');
        drvView.classList.remove('active');
        if (splitView) splitView.classList.remove('active');
        opView.style.display = 'grid';
        metricsGrid.style.display = 'grid';

        setTimeout(() => { if (map) map.invalidateSize(); }, 150);
    }
}

function initDriverMap() {
    const el = document.getElementById('driverRouteMap');
    if (!el) return;

    if (!driverMap) {
        driverMap = L.map('driverRouteMap', {
            zoomControl: true,
            attributionControl: false
        }).setView([STATE.currentCoords[0] + 0.015, STATE.currentCoords[1] + 0.005], 13.5);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        }).addTo(driverMap);
    }

    renderDriverRoute();
}

function renderDriverRoute() {
    if (!driverMap || !STATE.activeRouteInfo || !STATE.graphData) return;
    const { graph } = STATE.graphData;
    const coords = STATE.activeRouteInfo.path.map(id => {
        const v = graph.vertices.get(id);
        return [v.lat, v.lng];
    });

    if (driverRoutePolyline) driverMap.removeLayer(driverRoutePolyline);

    driverRoutePolyline = L.polyline(coords, {
        color: '#10b981',
        weight: 6,
        opacity: 0.95,
        lineCap: 'round'
    }).addTo(driverMap);

    if (driverAmbulanceMarker) driverMap.removeLayer(driverAmbulanceMarker);

    const ambIcon = L.divIcon({
        className: 'ambulance-marker-icon',
        html: `
            <div style="background:#10b981; width:28px; height:28px; border-radius:50%; border:2px solid white; display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px #10b981;">
                <span style="font-size:14px;">ðŸš‘</span>
            </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    driverAmbulanceMarker = L.marker(STATE.currentCoords, { icon: ambIcon }).addTo(driverMap);
    driverMap.fitBounds(driverRoutePolyline.getBounds(), { padding: [25, 25] });
}

function setDriverStatus(status) {
    document.querySelectorAll('.btn-driver-status').forEach(b => b.classList.remove('active'));
    if (status === 'duty') {
        const b = document.getElementById('btnStatusDuty');
        if (b) b.classList.add('active');
        logAlert("Driver Rajesh Kumar: En route to emergency patient pickup.", "info");
        playAlertTone('info');
    } else if (status === 'critical') {
        const b = document.getElementById('btnStatusCritical');
        if (b) b.classList.add('active');
        logAlert("ðŸš¨ PATIENT ONBOARD for AMB-101. Critical Priority 1 transit to Apollo Trauma Center.", "critical");
        playAlertTone('critical');
    } else if (status === 'arrived') {
        const b = document.getElementById('btnStatusArrived');
        if (b) b.classList.add('active');
        logAlert("ðŸ¥ Ambulance AMB-101 arrived at Apollo Trauma Emergency Ward. Patient transfer in progress.", "success");
        playAlertTone('warning');
    }
}

function updateSplitTelemetry() {
    const latLng = STATE.currentCoords ? `${STATE.currentCoords[0].toFixed(4)}Â° N, ${STATE.currentCoords[1].toFixed(4)}Â° E` : "17.3850Â° N, 78.4867Â° E";
    const splitCoords = document.getElementById('splitLiveCoords');
    const splitSpeed = document.getElementById('splitSpeed');
    const splitEta = document.getElementById('splitEta');
    const splitDist = document.getElementById('splitDist');

    if (splitCoords) splitCoords.textContent = latLng;
    if (splitSpeed) splitSpeed.textContent = `${STATE.currentSpeedKmh} km/h`;
    if (splitEta && STATE.activeRouteInfo) splitEta.textContent = `${STATE.activeRouteInfo.etaMinutes} mins`;
    if (splitDist && STATE.activeRouteInfo) splitDist.textContent = `${STATE.activeRouteInfo.distanceKm} km`;
}

// ============================================================================
// ALERT LOGGING UTILITIES
// ============================================================================
function logAlert(message, type = 'info') {
    const feed = document.getElementById('alertFeedContainer');
    if (!feed) return;

    const item = document.createElement('div');
    item.className = `alert-item ${type}`;

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    item.innerHTML = `
        <div>${message}</div>
        <div class="alert-meta">
            <span>${type.toUpperCase()}</span>
            <span>${timeStr}</span>
        </div>
    `;

    feed.insertBefore(item, feed.firstChild);

    // Limit to 25 items
    while (feed.children.length > 25) {
        feed.removeChild(feed.lastChild);
    }
}

function clearAlerts() {
    const feed = document.getElementById('alertFeedContainer');
    if (feed) feed.innerHTML = '';
}

function dispatchNewAmbulance() {
    const randomId = `AMB-${Math.floor(200 + Math.random() * 200)}`;
    logAlert(`New Emergency Unit ${randomId} dispatched to Sector 4 incident.`, "info");
    playAlertTone('info');
}

// ============================================================================
// CODE & GRAPH INSPECTORS
// ============================================================================
function openGraphInspector() {
    const modal = document.getElementById('modalGraphInspector');
    const container = document.getElementById('graphAdjacencyListContent');
    const { graph } = STATE.graphData;

    let output = "================================================================================\n";
    output += "   SMART ROUTE: DYNAMIC WEIGHTED DIRECTED GRAPH (ADJACENCY LIST)\n";
    output += "================================================================================\n\n";

    graph.vertices.forEach((v, id) => {
        const edges = graph.adjList.get(id) || [];
        output += `[Node ${id}] ${v.name.padEnd(30, ' ')} -> \n`;
        if (edges.length === 0) {
            output += `    (No outgoing edges)\n`;
        } else {
            edges.forEach(e => {
                const effWeight = (e.distKm * e.trafficFactor).toFixed(2);
                const forestTag = e.isForest ? " [FOREST HAZARD]" : "";
                output += `    â†³ to Node ${e.dest} | Road: "${e.roadName}" | Dist: ${e.distKm} km | Traffic: ${e.trafficFactor.toFixed(1)}x | Dynamic Cost: ${effWeight}${forestTag}\n`;
            });
        }
        output += "\n";
    });

    container.textContent = output;
    modal.classList.add('active');
}

let cachedCCode = `/**
 * SmartRoute: Real-Time Emergency Vehicle Route Optimization
 * Dynamic Weighted Directed Graph & Dijkstra with Min-Heap
 * Language: C (ANSI / C99 Standard)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <float.h>
#include <time.h>

#define MAX_VERTICES 20
#define GPS_TIMEOUT_SECONDS 15
#define FOREST_HAZARD_PENALTY 10.0

// Data Structure: Adjacency List Node
typedef struct AdjListNode {
    int dest;
    double distance_km;
    double traffic_factor; // 1.0 (Low), 1.8 (Medium), 3.5 (Heavy)
    bool is_forest_road;
    char road_name[64];
    struct AdjListNode* next;
} AdjListNode;

// Data Structure: Min-Heap Priority Queue for Dijkstra O((V+E)log V)
typedef struct MinHeapNode {
    int v;
    double dist;
} MinHeapNode;

typedef struct MinHeap {
    int size;
    int capacity;
    int* pos; // O(1) position lookup
    MinHeapNode** array;
} MinHeap;

// Dijkstra Shortest Path with Dynamic Weights
void dijkstra_shortest_path(const Graph* g, int src, int dest, bool avoid_forest, 
                           int* path_out, int* path_len, double* total_dist, double* total_time_mins) {
    // 1. Initialize Min-Heap with distances
    // 2. Extract minimum vertex u
    // 3. Relax neighbors: weight = dist * traffic_factor + (avoid_forest ? FOREST_HAZARD_PENALTY : 0)
    // 4. Decrease key in priority queue
    // 5. Reconstruct shortest path array
}

// 15-Second GPS Watchdog Timer
void check_gps_watchdog(Ambulance* amb) {
    time_t now = time(NULL);
    double elapsed = difftime(now, amb->last_gps_ping_time);
    if (elapsed >= GPS_TIMEOUT_SECONDS) {
        amb->gps_connected = false;
        printf("!! CRITICAL WARNING: GPS CONNECTION LOST !!\\n");
        printf("Ambulance ID: %s | Last Known: %.4f, %.4f\\n", amb->ambulance_id, amb->last_known_lat, amb->last_known_lng);
    }
}

// Driver Login & Operator Alert
void driver_login(Ambulance* amb) {
    amb->driver.is_logged_in = true;
    printf("[OPERATOR ALERT] Driver %s logged in (Ambulance %s). Vehicle ON DUTY.\\n", 
           amb->driver.driver_name, amb->ambulance_id);
}

// Complete source code is located in smartroute.c
`;

function initCodeInspectorContent() {
    fetch('smartroute.c')
        .then(res => res.text())
        .then(code => {
            if (code && code.length > 100) {
                cachedCCode = code;
            }
            const container = document.getElementById('cCodeDisplay');
            if (container) container.textContent = cachedCCode;
        })
        .catch(() => {
            const container = document.getElementById('cCodeDisplay');
            if (container) container.textContent = cachedCCode;
        });
}

function openCodeInspector() {
    const modal = document.getElementById('modalCodeInspector');
    if (!cachedCCode) {
        initCodeInspectorContent();
    }
    modal.classList.add('active');
}

function copyCCode() {
    if (cachedCCode) {
        navigator.clipboard.writeText(cachedCCode).then(() => {
            alert("C source code (smartroute.c) copied to clipboard!");
        });
    }
}
