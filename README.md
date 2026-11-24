# SmartRoute: Real-Time Emergency Vehicle Route Optimization Using Dynamic Weighted Directed Graphs

A college Data Structures project featuring an emergency vehicle dispatch and monitoring platform paired with pure C algorithmic implementations.

---

## ðŸ“Œ Project Overview
**SmartRoute** solves real-time emergency routing using **Dynamic Weighted Directed Graphs**. When an ambulance is dispatched, road conditions, traffic spikes, weather, and sensitive forest ecosystems dynamically alter edge weights. The system recalculates optimal paths using **Dijkstra's Algorithm with a Min-Heap Priority Queue**, monitors telemetry using a **15-Second GPS Watchdog**, alerts drivers when entering protected forest reserves, and notifies central operators when drivers log in.

---

## ðŸ›ï¸ Core Data Structures & Algorithms

### 1. Dynamic Weighted Directed Graph
- **Vertices ($V$):** City intersections, hospital emergency trauma centers, and staging depots.
- **Directed Edges ($E$):** Roads connecting intersections with one-way or two-way directional flow.
- **Dynamic Weight Function:**
  $$\text{Weight}(u, v) = \text{Distance}(u, v) \times \text{TrafficMultiplier}(u, v) + \text{ForestHazardPenalty}(u, v)$$
  - **Traffic Multipliers:**
    - Low / Free-flow: `1.0x` (Green)
    - Moderate Congestion: `1.8x` (Yellow)
    - Severe Congestion: `3.5x - 4.0x` (Red)
    - Road Blocked: $\infty$

### 2. Adjacency List Representation
- Memory-efficient graph representation requiring $O(V + E)$ space.
- Each vertex points to a linked list of outgoing edges containing destination vertex, physical distance (km), traffic multiplier, road designation, and forest flag.

### 3. Min-Heap Priority Queue
- Binary Min-Heap storing `(vertex, tentative_distance)`.
- Features an auxiliary `pos[]` array mapping vertex ID to heap index for **$O(1)$ lookup** and **$O(\log V)$ decrease-key** operations.

### 4. Dijkstra's Algorithm
- **Time Complexity:** $O((V + E) \log V)$ using Min-Heap.
- **Space Complexity:** $O(V)$ for distances, visited set, and parent pointers.

### 5. Forest Geofence Detection Engine
- Uses **Ray-Casting Algorithm** (Point-in-Polygon) to detect when an ambulance enters a protected reserve.
- Proximity buffer detection triggers an **Amber Warning** within 600m.
- Entering the forest triggers a **Red Alert** and presents the driver with two distinct choices:
  1. **Option 1:** Switch to Safe 4-Lane Highway Bypass (Dijkstra adds detour penalty to forest edges).
  2. **Option 2:** Continue on Current Forest Route (Driver discretion).
- Route selection is **never forced**; driver decision is respected.

### 6. 15-Second GPS Watchdog System
- Tracks continuous telemetry pings from each ambulance.
- If no update is received for $\ge 15$ seconds:
  - Status transitions to `CONNECTION LOST`.
  - Displays alert banner with Ambulance ID, last known coordinates, last update timestamp, and elapsed time.
  - Replaces active marker with a "Last Known Location" ghost marker and renders a dotted 400m dead-reckoning radius of uncertainty.
  - Automatically restores to `CONNECTED` when telemetry resumes.

### 7. Driver Login Profile & Real-Time Operator Notification
- Drivers log in with their Name, ID/Badge, and assigned Ambulance ID.
- Upon login:
  - In-Cab navigation switches to the authenticated driver.
  - Central CAD Operator receives an immediate audio-visual notification banner and log entry:
    `"ðŸ”” Driver Rajesh Kumar (AMB-101) logged in. Vehicle is now ON DUTY."`
  - Operator fleet table updates dynamically.

### 8. Live Area Location Anchoring
- Uses HTML5 `navigator.geolocation` API.
- Clicking **"Use My Area Location"** anchors the entire road graph, destination hospital, forest reserve, and bypass highway directly around the user's real geographic location.

---

## ðŸš€ How to Run the Website

### Option 1: Double-Click Direct Launch (Easiest)
1. Open the folder:
   ```
   C:\Users\jayas\.gemini\antigravity\scratch\smartroute
   ```
2. Double-click **`run_website.bat`** or double-click **`index.html`** in any modern web browser (Chrome, Edge, Firefox, Brave).

### Option 2: Built-in PowerShell HTTP Server (Zero Install)
In PowerShell:
```powershell
cd C:\Users\jayas\.gemini\antigravity\scratch\smartroute
powershell -ExecutionPolicy Bypass -File .\start_server.ps1
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

### Option 3: Python HTTP Server
```powershell
cd C:\Users\jayas\.gemini\antigravity\scratch\smartroute
python server.py
```

---

## ðŸ’» How to Compile and Run the C Program (`smartroute.c`)

The standalone C implementation contains the complete dynamic graph, min-heap priority queue, Dijkstra's algorithm, forest geofence warnings, 15-second GPS watchdog, and interactive menu.

### Compilation:
Using GCC / MinGW:
```bash
gcc -O2 smartroute.c -o smartroute.exe
./smartroute.exe
```

Using MSVC (`cl`):
```cmd
cl /O2 smartroute.c
smartroute.exe
```

Using Online C Compilers (e.g., OnlineGDB, Programiz):
- Simply copy and paste `smartroute.c` into the editor and click **Run**.

---

## ðŸ“ Project Directory Structure
```
smartroute/
â”‚â”€â”€ index.html          # Modern Emergency Monitoring Dashboard & Driver HUD
â”‚â”€â”€ styles.css          # Navy blue CAD dark theme, high-contrast driver styling
â”‚â”€â”€ graph.js            # Graph, Min-Heap, Dijkstra, Geofence, and GPS Watchdog
â”‚â”€â”€ app.js              # Leaflet integration, live tracking, driver login, audio cues
â”‚â”€â”€ smartroute.c        # Pure C algorithm implementation for college evaluation
â”‚â”€â”€ server.py           # Optional Python web server
â”‚â”€â”€ start_server.ps1    # PowerShell HTTP server (Zero external dependencies)
â”‚â”€â”€ run_website.bat     # One-click browser launcher
â””â”€â”€ README.md           # Documentation & Viva presentation guide
```
