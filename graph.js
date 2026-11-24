/**
 * SmartRoute: Graph Data Structures & Algorithms
 * Implemented:
 * - Dynamic Weighted Directed Graph (Adjacency List)
 * - Min-Heap Priority Queue
 * - Dijkstra's Shortest Path with Dynamic Weights: O((V + E) log V)
 * - Forest Geofencing (Ray Casting & Buffer Proximity)
 * - 15-Second GPS Watchdog Timer
 */

class MinHeap {
    constructor() {
        this.heap = [];
        this.pos = new Map(); // O(1) node position lookup for decreaseKey
    }

    size() {
        return this.heap.length;
    }

    isEmpty() {
        return this.heap.length === 0;
    }

    swap(i, j) {
        const temp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = temp;
        this.pos.set(this.heap[i].vertex, i);
        this.pos.set(this.heap[j].vertex, j);
    }

    insert(vertex, dist) {
        const node = { vertex, dist };
        this.heap.push(node);
        const idx = this.heap.length - 1;
        this.pos.set(vertex, idx);
        this.bubbleUp(idx);
    }

    bubbleUp(idx) {
        while (idx > 0) {
            const parentIdx = Math.floor((idx - 1) / 2);
            if (this.heap[idx].dist < this.heap[parentIdx].dist) {
                this.swap(idx, parentIdx);
                idx = parentIdx;
            } else {
                break;
            }
        }
    }

    extractMin() {
        if (this.isEmpty()) return null;
        const root = this.heap[0];
        const last = this.heap.pop();
        this.pos.delete(root.vertex);

        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.pos.set(last.vertex, 0);
            this.sinkDown(0);
        }
        return root;
    }

    sinkDown(idx) {
        const length = this.heap.length;
        while (true) {
            let smallest = idx;
            const left = 2 * idx + 1;
            const right = 2 * idx + 2;

            if (left < length && this.heap[left].dist < this.heap[smallest].dist) {
                smallest = left;
            }
            if (right < length && this.heap[right].dist < this.heap[smallest].dist) {
                smallest = right;
            }
            if (smallest !== idx) {
                this.swap(idx, smallest);
                idx = smallest;
            } else {
                break;
            }
        }
    }

    decreaseKey(vertex, newDist) {
        if (!this.pos.has(vertex)) return;
        let idx = this.pos.get(vertex);
        if (newDist < this.heap[idx].dist) {
            this.heap[idx].dist = newDist;
            this.bubbleUp(idx);
        }
    }

    contains(vertex) {
        return this.pos.has(vertex);
    }
}

class Graph {
    constructor() {
        this.vertices = new Map(); // id -> { id, name, lat, lng, inForest, nearForest }
        this.adjList = new Map();  // id -> Array<{ dest, distKm, trafficFactor, isForest, roadName }>
        this.edges = [];           // Array of all edge objects for map rendering
    }

    addVertex(id, name, lat, lng, inForest = false, nearForest = false) {
        this.vertices.set(id, { id, name, lat, lng, inForest, nearForest });
        if (!this.adjList.has(id)) {
            this.adjList.set(id, []);
        }
    }

    addEdge(src, dest, distKm, trafficFactor = 1.0, isForest = false, roadName = "Road") {
        const edge = {
            id: `${src}-${dest}`,
            src,
            dest,
            distKm,
            trafficFactor,
            isForest,
            roadName
        };

        this.adjList.get(src).push(edge);
        this.edges.push(edge);

        // Also add bidirectional edge for 2-way roads
        const revEdge = {
            id: `${dest}-${src}`,
            src: dest,
            dest: src,
            distKm,
            trafficFactor,
            isForest,
            roadName
        };
        if (!this.adjList.has(dest)) this.adjList.set(dest, []);
        this.adjList.get(dest).push(revEdge);
    }

    setTraffic(src, dest, trafficFactor) {
        const update = (from, to) => {
            const edges = this.adjList.get(from) || [];
            const edge = edges.find(e => e.dest === to);
            if (edge) edge.trafficFactor = trafficFactor;
        };
        update(src, dest);
        update(dest, src);

        const edgeInList = this.edges.find(e => (e.src === src && e.dest === dest) || (e.src === dest && e.dest === src));
        if (edgeInList) edgeInList.trafficFactor = trafficFactor;
    }

    /**
     * Dijkstra's Shortest Path Algorithm using Min-Heap
     * Dynamic Weight = distKm * trafficFactor + (avoidForest && isForest ? 12.0 : 0)
     */
    dijkstra(src, dest, avoidForest = false) {
        const distances = new Map();
        const actualKm = new Map();
        const parent = new Map();
        const minHeap = new MinHeap();
        const visitedOrder = [];

        this.vertices.forEach((v, id) => {
            distances.set(id, Infinity);
            actualKm.set(id, 0);
            parent.set(id, null);
        });

        distances.set(src, 0);
        minHeap.insert(src, 0);

        while (!minHeap.isEmpty()) {
            const minNode = minHeap.extractMin();
            const u = minNode.vertex;
            visitedOrder.push(u);

            if (u === dest) break; // Found shortest path to destination

            const neighbors = this.adjList.get(u) || [];
            for (const edge of neighbors) {
                const v = edge.dest;
                let weight = edge.distKm * edge.trafficFactor;

                // If user/driver requested forest bypass, penalize forest edges heavily
                if (avoidForest && edge.isForest) {
                    weight += 15.0; // Dynamic detour penalty
                }

                const newDist = distances.get(u) + weight;
                if (newDist < distances.get(v)) {
                    distances.set(v, newDist);
                    actualKm.set(v, actualKm.get(u) + edge.distKm);
                    parent.set(v, u);

                    if (minHeap.contains(v)) {
                        minHeap.decreaseKey(v, newDist);
                    } else {
                        minHeap.insert(v, newDist);
                    }
                }
            }
        }

        // Reconstruct path
        const path = [];
        let curr = dest;
        while (curr !== null) {
            path.unshift(curr);
            curr = parent.get(curr);
        }

        // Check if path is valid
        const isReachable = path.length > 0 && path[0] === src;
        const totalDistanceKm = isReachable ? actualKm.get(dest) : 0;
        // Estimated Time: 50 km/h emergency speed base, scaled by traffic weight
        const totalTimeMins = isReachable ? Math.round((distances.get(dest) / 45.0) * 60) : 0;

        return {
            path: isReachable ? path : [],
            distanceKm: Number(totalDistanceKm.toFixed(2)),
            etaMinutes: Math.max(1, totalTimeMins),
            cost: distances.get(dest),
            visitedOrder
        };
    }
}

/**
 * Forest Geofence Detection Engine
 * Uses Point-in-Polygon (Ray Casting) and Proximity Radius
 */
class ForestGeofence {
    constructor(polygonCoords, name = "Protected Reserve Forest") {
        this.polygon = polygonCoords; // Array of [lat, lng]
        this.name = name;
        this.approachBufferKm = 0.6; // 600m warning buffer
    }

    // Ray-casting algorithm for point-in-polygon
    contains(lat, lng) {
        let inside = false;
        const n = this.polygon.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = this.polygon[i][0], yi = this.polygon[i][1];
            const xj = this.polygon[j][0], yj = this.polygon[j][1];

            const intersect = ((yi > lng) !== (yj > lng)) &&
                (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    // Haversine distance in km between two lat/lng
    static distanceKm(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Check if within approach buffer
    isApproaching(lat, lng) {
        if (this.contains(lat, lng)) return false; // Already inside

        for (const [pLat, pLng] of this.polygon) {
            const d = ForestGeofence.distanceKm(lat, lng, pLat, pLng);
            if (d <= this.approachBufferKm) {
                return true;
            }
        }
        return false;
    }
}

/**
 * 15-Second GPS Connection Watchdog
 */
class GPSWatchdog {
    constructor(timeoutSeconds = 15, onStatusChange = null) {
        this.timeoutSeconds = timeoutSeconds;
        this.onStatusChange = onStatusChange;
        this.lastPingTime = Date.now();
        this.isConnected = true;
        this.isSimulatedLoss = false;
        this.lossReason = "NONE"; // "SIGNAL_LOSS" | "NETWORK_OFFLINE"
        this.timer = null;
        this.start();
    }

    start() {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => this.check(), 1000);
    }

    ping() {
        if (this.isSimulatedLoss) return; // Block pings during simulated outage
        this.lastPingTime = Date.now();
        if (!this.isConnected) {
            this.isConnected = true;
            this.lossReason = "NONE";
            if (this.onStatusChange) {
                this.onStatusChange(true, 0, "RESTORED");
            }
        }
    }

    check() {
        const elapsedSec = (Date.now() - this.lastPingTime) / 1000;
        if (elapsedSec >= this.timeoutSeconds && this.isConnected) {
            this.isConnected = false;
            this.lossReason = "GPS_SIGNAL_TIMEOUT";
            if (this.onStatusChange) {
                this.onStatusChange(false, Math.floor(elapsedSec), this.lossReason);
            }
        }
    }

    simulateLoss(reason = "GPS_SATELLITE_BLOCKED") {
        this.isSimulatedLoss = true;
        this.isConnected = false;
        this.lossReason = reason;
        this.lastPingTime = Date.now() - (this.timeoutSeconds * 1000) - 2000; // Force > 15s
        if (this.onStatusChange) {
            this.onStatusChange(false, 17, reason);
        }
    }

    restore() {
        this.isSimulatedLoss = false;
        this.lastPingTime = Date.now();
        this.isConnected = true;
        this.lossReason = "NONE";
        if (this.onStatusChange) {
            this.onStatusChange(true, 0, "RESTORED");
        }
    }

    getElapsedSeconds() {
        return Math.floor((Date.now() - this.lastPingTime) / 1000);
    }
}

/**
 * Dynamic Road Network Generator anchored around ANY Live Location!
 * This enables the app to center around the user's current city/area coordinates!
 */
function createCityGraphAt(centerLat, centerLng) {
    const g = new Graph();

    // Offsets in degrees (~1 deg lat = 111 km, 0.01 deg ~= 1.1 km)
    const dLat = 0.009;
    const dLng = 0.012;

    // Define 8 vertices around user location
    // Node 0: Current User / Emergency Scene (Origin)
    g.addVertex(0, "Emergency Scene (Live Location)", centerLat, centerLng, false, false);

    // Node 1: North Junction
    g.addVertex(1, "North Boulevard Junction", centerLat + dLat * 0.8, centerLng + dLng * 0.4, false, false);

    // Node 2: Forest Approach Gateway
    g.addVertex(2, "Forest Approach Point", centerLat + dLat * 1.6, centerLng + dLng * 0.8, false, true);

    // Node 3: Forest South Gate (Inside Forest)
    g.addVertex(3, "Eco Reserve South Gate", centerLat + dLat * 2.3, centerLng + dLng * 1.2, true, false);

    // Node 4: Forest North Crossing (Inside Forest)
    g.addVertex(4, "Deep Forest Canopy Crossing", centerLat + dLat * 3.1, centerLng + dLng * 1.5, true, false);

    // Node 5: West Expressway Cross (Highway Bypass route)
    g.addVertex(5, "West Highway Interchange", centerLat + dLat * 1.0, centerLng - dLng * 0.9, false, false);

    // Node 6: Outer Bypass Flyover
    g.addVertex(6, "Express Ring Road (ORR)", centerLat + dLat * 2.7, centerLng - dLng * 0.5, false, false);

    // Node 7: Metro Super-Speciality Trauma Center (Destination)
    g.addVertex(7, "Apollo Trauma & Emergency Center", centerLat + dLat * 3.8, centerLng + dLng * 0.7, false, false);

    // Define Edges
    // Route 1 (Forest Path): 0 -> 1 -> 2 -> 3 -> 4 -> 7
    g.addEdge(0, 1, 2.4, 1.0, false, "Boulevard Link");
    g.addEdge(1, 2, 2.1, 1.1, false, "Ridge Road");
    g.addEdge(2, 3, 2.2, 1.0, true,  "Forest Entry Cutoff");
    g.addEdge(3, 4, 2.8, 1.0, true,  "Eco Canopy Track");
    g.addEdge(4, 7, 2.6, 1.2, false, "Hospital Link Road");

    // Route 2 (Express Highway Bypass): 0 -> 5 -> 6 -> 7
    g.addEdge(0, 5, 3.2, 1.1, false, "City West Radial");
    g.addEdge(5, 6, 4.8, 1.0, false, "Outer Ring Expressway");
    g.addEdge(6, 7, 3.5, 1.0, false, "Trauma Center North Flyover");

    // Connector between North Junction and Bypass
    g.addEdge(1, 5, 2.9, 1.3, false, "Radial Link 2");

    // Define Forest Polygon Boundaries surrounding Nodes 3 & 4
    const forestPolygon = [
        [centerLat + dLat * 1.8, centerLng + dLng * 0.5],
        [centerLat + dLat * 3.6, centerLng + dLng * 0.8],
        [centerLat + dLat * 3.5, centerLng + dLng * 2.2],
        [centerLat + dLat * 2.0, centerLng + dLng * 2.0],
        [centerLat + dLat * 1.8, centerLng + dLng * 0.5]
    ];

    const forestGeofence = new ForestGeofence(forestPolygon, "Green Reserve Bio-Corridor");

    return { graph: g, forestGeofence, forestPolygon };
}
