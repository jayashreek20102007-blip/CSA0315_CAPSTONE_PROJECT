/**
 * ============================================================================
 * Project: SmartRoute - Emergency Vehicle Route Optimization
 * College Data Structures Project
 * 
 * Core Concepts Implemented:
 * 1. Dynamic Weighted Directed Graph (Intersections as Vertices, Roads as Edges)
 * 2. Adjacency List Representation
 * 3. Min-Heap Priority Queue for Dijkstra's Algorithm: O((V + E) log V)
 * 4. Dynamic Weight Calculation (Distance x Traffic Factor + Forest Penalty)
 * 5. Forest Proximity & Entry Warning System (Driver Choice Routing)
 * 6. 15-Second GPS Connection Watchdog System
 * 7. Driver Login Profile & Real-Time Operator Notification
 * ============================================================================
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <float.h>
#include <time.h>

#define MAX_VERTICES 20
#define MAX_NAME_LEN 64
#define GPS_TIMEOUT_SECONDS 15
#define FOREST_HAZARD_PENALTY 10.0 // Extra weight penalty if driver chooses to bypass forest

/* ============================================================================
 * DATA STRUCTURE 1: GRAPH ADJACENCY LIST
 * ============================================================================ */

typedef struct AdjListNode {
    int dest;
    double distance_km;
    double traffic_factor; // 1.0 = Free flow (Green), 1.8 = Moderate (Yellow), 3.5 = Heavy (Red)
    bool is_forest_road;   // True if road cuts through protected forest
    char road_name[MAX_NAME_LEN];
    struct AdjListNode* next;
} AdjListNode;

typedef struct VertexInfo {
    char name[MAX_NAME_LEN];
    double latitude;
    double longitude;
    bool is_in_forest;
    bool is_near_forest;
} VertexInfo;

typedef struct Graph {
    int num_vertices;
    AdjListNode* adj_lists[MAX_VERTICES];
    VertexInfo vertices[MAX_VERTICES];
} Graph;

/* ============================================================================
 * DATA STRUCTURE 2: MIN-HEAP PRIORITY QUEUE FOR DIJKSTRA
 * ============================================================================ */

typedef struct MinHeapNode {
    int v;
    double dist;
} MinHeapNode;

typedef struct MinHeap {
    int size;
    int capacity;
    int* pos; // For decreaseKey in O(1) lookup
    MinHeapNode** array;
} MinHeap;

/* ============================================================================
 * DATA STRUCTURE 3: DRIVER & AMBULANCE PROFILE
 * ============================================================================ */

typedef struct DriverProfile {
    char driver_id[16];
    char driver_name[MAX_NAME_LEN];
    char contact[16];
    char badge_number[16];
    bool is_logged_in;
} DriverProfile;

typedef struct Ambulance {
    char ambulance_id[16];
    DriverProfile driver;
    int current_vertex;
    int destination_vertex;
    double current_speed_kmh;
    bool gps_connected;
    time_t last_gps_ping_time;
    double last_known_lat;
    double last_known_lng;
    bool is_emergency_active;
} Ambulance;

/* ============================================================================
 * FUNCTION PROTOTYPES
 * ============================================================================ */

Graph* create_graph(int vertices);
void add_vertex(Graph* g, int id, const char* name, double lat, double lng, bool in_forest, bool near_forest);
void add_edge(Graph* g, int src, int dest, double dist_km, double traffic, bool is_forest, const char* road_name);
void print_adjacency_list(const Graph* g);

MinHeap* create_min_heap(int capacity);
void swap_min_heap_node(MinHeapNode** a, MinHeapNode** b);
void min_heapify(MinHeap* min_heap, int idx);
bool is_heap_empty(const MinHeap* min_heap);
MinHeapNode* extract_min(MinHeap* min_heap);
void decrease_key(MinHeap* min_heap, int v, double dist);
bool is_in_min_heap(const MinHeap* min_heap, int v);

void dijkstra_shortest_path(const Graph* g, int src, int dest, bool avoid_forest, int* path_out, int* path_len, double* total_dist, double* total_time_mins);

void driver_login(Ambulance* amb);
void check_gps_watchdog(Ambulance* amb);
void simulate_gps_ping(Ambulance* amb);
void simulate_forest_warning(const Graph* g, Ambulance* amb, int next_vertex);

/* ============================================================================
 * GRAPH IMPLEMENTATION
 * ============================================================================ */

AdjListNode* new_adj_node(int dest, double dist, double traffic, bool is_forest, const char* road_name) {
    AdjListNode* node = (AdjListNode*)malloc(sizeof(AdjListNode));
    node->dest = dest;
    node->distance_km = dist;
    node->traffic_factor = traffic;
    node->is_forest_road = is_forest;
    strncpy(node->road_name, road_name, MAX_NAME_LEN - 1);
    node->road_name[MAX_NAME_LEN - 1] = '\0';
    node->next = NULL;
    return node;
}

Graph* create_graph(int vertices) {
    Graph* g = (Graph*)malloc(sizeof(Graph));
    g->num_vertices = vertices;
    for (int i = 0; i < vertices; i++) {
        g->adj_lists[i] = NULL;
        strcpy(g->vertices[i].name, "Unassigned");
        g->vertices[i].latitude = 0.0;
        g->vertices[i].longitude = 0.0;
        g->vertices[i].is_in_forest = false;
        g->vertices[i].is_near_forest = false;
    }
    return g;
}

void add_vertex(Graph* g, int id, const char* name, double lat, double lng, bool in_forest, bool near_forest) {
    if (id >= 0 && id < g->num_vertices) {
        strncpy(g->vertices[id].name, name, MAX_NAME_LEN - 1);
        g->vertices[id].latitude = lat;
        g->vertices[id].longitude = lng;
        g->vertices[id].is_in_forest = in_forest;
        g->vertices[id].is_near_forest = near_forest;
    }
}

void add_edge(Graph* g, int src, int dest, double dist_km, double traffic, bool is_forest, const char* road_name) {
    // Directed edge: src -> dest
    AdjListNode* node = new_adj_node(dest, dist_km, traffic, is_forest, road_name);
    node->next = g->adj_lists[src];
    g->adj_lists[src] = node;

    // For bi-directional roads, add reverse edge dest -> src
    AdjListNode* rev_node = new_adj_node(src, dist_km, traffic, is_forest, road_name);
    rev_node->next = g->adj_lists[dest];
    g->adj_lists[dest] = rev_node;
}

void print_adjacency_list(const Graph* g) {
    printf("\n========================================================================\n");
    printf("   DYNAMIC WEIGHTED DIRECTED GRAPH (ADJACENCY LIST REPRESENTATION)       \n");
    printf("========================================================================\n");
    for (int v = 0; v < g->num_vertices; v++) {
        printf("[%2d] %-24s -> ", v, g->vertices[v].name);
        AdjListNode* crawl = g->adj_lists[v];
        if (!crawl) {
            printf("None\n");
            continue;
        }
        while (crawl != NULL) {
            double eff_weight = crawl->distance_km * crawl->traffic_factor;
            const char* forest_tag = crawl->is_forest_road ? " [FOREST]" : "";
            printf("[%s -> %d (%.1f km, tr=%.1fx, w=%.2f)%s] ",
                   crawl->road_name, crawl->dest, crawl->distance_km,
                   crawl->traffic_factor, eff_weight, forest_tag);
            crawl = crawl->next;
        }
        printf("\n");
    }
    printf("========================================================================\n\n");
}

/* ============================================================================
 * MIN-HEAP PRIORITY QUEUE IMPLEMENTATION
 * ============================================================================ */

MinHeapNode* new_min_heap_node(int v, double dist) {
    MinHeapNode* node = (MinHeapNode*)malloc(sizeof(MinHeapNode));
    node->v = v;
    node->dist = dist;
    return node;
}

MinHeap* create_min_heap(int capacity) {
    MinHeap* min_heap = (MinHeap*)malloc(sizeof(MinHeap));
    min_heap->pos = (int*)malloc(capacity * sizeof(int));
    min_heap->size = 0;
    min_heap->capacity = capacity;
    min_heap->array = (MinHeapNode**)malloc(capacity * sizeof(MinHeapNode*));
    return min_heap;
}

void swap_min_heap_node(MinHeapNode** a, MinHeapNode** b) {
    MinHeapNode* t = *a;
    *a = *b;
    *b = t;
}

void min_heapify(MinHeap* min_heap, int idx) {
    int smallest = idx;
    int left = 2 * idx + 1;
    int right = 2 * idx + 2;

    if (left < min_heap->size && min_heap->array[left]->dist < min_heap->array[smallest]->dist)
        smallest = left;

    if (right < min_heap->size && min_heap->array[right]->dist < min_heap->array[smallest]->dist)
        smallest = right;

    if (smallest != idx) {
        MinHeapNode* smallest_node = min_heap->array[smallest];
        MinHeapNode* idx_node = min_heap->array[idx];

        min_heap->pos[smallest_node->v] = idx;
        min_heap->pos[idx_node->v] = smallest;

        swap_min_heap_node(&min_heap->array[smallest], &min_heap->array[idx]);
        min_heapify(min_heap, smallest);
    }
}

bool is_heap_empty(const MinHeap* min_heap) {
    return min_heap->size == 0;
}

MinHeapNode* extract_min(MinHeap* min_heap) {
    if (is_heap_empty(min_heap)) return NULL;

    MinHeapNode* root = min_heap->array[0];
    MinHeapNode* last_node = min_heap->array[min_heap->size - 1];
    min_heap->array[0] = last_node;

    min_heap->pos[root->v] = min_heap->size - 1;
    min_heap->pos[last_node->v] = 0;

    --min_heap->size;
    min_heapify(min_heap, 0);

    return root;
}

void decrease_key(MinHeap* min_heap, int v, double dist) {
    int i = min_heap->pos[v];
    min_heap->array[i]->dist = dist;

    while (i > 0 && min_heap->array[i]->dist < min_heap->array[(i - 1) / 2]->dist) {
        min_heap->pos[min_heap->array[i]->v] = (i - 1) / 2;
        min_heap->pos[min_heap->array[(i - 1) / 2]->v] = i;
        swap_min_heap_node(&min_heap->array[i], &min_heap->array[(i - 1) / 2]);
        i = (i - 1) / 2;
    }
}

bool is_in_min_heap(const MinHeap* min_heap, int v) {
    return min_heap->pos[v] < min_heap->size;
}

/* ============================================================================
 * DIJKSTRA'S ALGORITHM WITH DYNAMIC WEIGHTS
 * Time Complexity: O((V + E) log V)
 * Space Complexity: O(V)
 * ============================================================================ */

void dijkstra_shortest_path(const Graph* g, int src, int dest, bool avoid_forest, int* path_out, int* path_len, double* total_dist, double* total_time_mins) {
    int V = g->num_vertices;
    double dist[MAX_VERTICES];
    double actual_km[MAX_VERTICES];
    int parent[MAX_VERTICES];

    MinHeap* min_heap = create_min_heap(V);

    for (int v = 0; v < V; ++v) {
        dist[v] = DBL_MAX;
        actual_km[v] = 0.0;
        parent[v] = -1;
        min_heap->array[v] = new_min_heap_node(v, dist[v]);
        min_heap->pos[v] = v;
    }

    min_heap->array[src] = new_min_heap_node(src, dist[src]);
    min_heap->pos[src] = src;
    dist[src] = 0.0;
    decrease_key(min_heap, src, dist[src]);
    min_heap->size = V;

    while (!is_heap_empty(min_heap)) {
        MinHeapNode* min_node = extract_min(min_heap);
        int u = min_node->v;
        free(min_node);

        if (u == dest) break; // Reached target destination

        AdjListNode* crawl = g->adj_lists[u];
        while (crawl != NULL) {
            int v = crawl->dest;

            // Calculate dynamic edge weight
            // Formula: Weight = Distance * Traffic_Factor + Forest_Penalty
            double edge_weight = crawl->distance_km * crawl->traffic_factor;
            if (crawl->is_forest_road && avoid_forest) {
                edge_weight += FOREST_HAZARD_PENALTY; // Heavy penalty forces Dijkstra to find bypass highway
            }

            if (is_in_min_heap(min_heap, v) && dist[u] != DBL_MAX && (dist[u] + edge_weight < dist[v])) {
                dist[v] = dist[u] + edge_weight;
                actual_km[v] = actual_km[u] + crawl->distance_km;
                parent[v] = u;
                decrease_key(min_heap, v, dist[v]);
            }
            crawl = crawl->next;
        }
    }

    // Reconstruct path
    int curr = dest;
    int temp_path[MAX_VERTICES];
    int count = 0;

    while (curr != -1) {
        temp_path[count++] = curr;
        curr = parent[curr];
    }

    // Reverse to get path from src to dest
    *path_len = count;
    for (int i = 0; i < count; i++) {
        path_out[i] = temp_path[count - 1 - i];
    }

    *total_dist = actual_km[dest];
    // Average emergency vehicle speed: ~50 km/h with siren, adjusted by weight
    *total_time_mins = (dist[dest] / 50.0) * 60.0;

    // Free min heap structures
    free(min_heap->pos);
    free(min_heap->array);
    free(min_heap);
}

/* ============================================================================
 * DRIVER LOGIN & OPERATOR NOTIFICATION
 * ============================================================================ */

void driver_login(Ambulance* amb) {
    printf("\n--------------------------------------------------------\n");
    printf("   DRIVER CABIN LOGIN TERMINAL                           \n");
    printf("--------------------------------------------------------\n");
    printf("Enter Driver Name       : ");
    fgets(amb->driver.driver_name, MAX_NAME_LEN, stdin);
    amb->driver.driver_name[strcspn(amb->driver.driver_name, "\n")] = 0;

    printf("Enter Driver ID / Badge : ");
    fgets(amb->driver.driver_id, 16, stdin);
    amb->driver.driver_id[strcspn(amb->driver.driver_id, "\n")] = 0;

    amb->driver.is_logged_in = true;
    amb->gps_connected = true;
    amb->last_gps_ping_time = time(NULL);

    printf("\n[SUCCESS] Driver %s authenticated.\n", amb->driver.driver_name);
    
    // Operator notification
    printf("\n========================================================\n");
    printf(">> [OPERATOR NOTIFICATION CENTER] <<\n");
    printf("ALERT: Driver '%s' (ID: %s) logged in to Ambulance '%s'.\n",
           amb->driver.driver_name, amb->driver.driver_id, amb->ambulance_id);
    printf("Status: ON DUTY | GPS: CONNECTED | Ready for Dispatch.\n");
    printf("========================================================\n");
}

/* ============================================================================
 * GPS CONNECTION LOSS DETECTION SYSTEM (15-SECOND WATCHDOG)
 * ============================================================================ */

void check_gps_watchdog(Ambulance* amb) {
    time_t now = time(NULL);
    double elapsed = difftime(now, amb->last_gps_ping_time);

    printf("\n--- GPS WATCHDOG CHECK ---\n");
    printf("Time elapsed since last GPS ping: %.1f seconds\n", elapsed);

    if (elapsed >= GPS_TIMEOUT_SECONDS) {
        amb->gps_connected = false;
        printf("\n********************************************************\n");
        printf("!! CRITICAL WARNING: GPS CONNECTION LOST !!\n");
        printf("Ambulance ID        : %s\n", amb->ambulance_id);
        printf("Driver Name         : %s\n", amb->driver.driver_name);
        printf("Last Known Lat/Lng  : %.6f, %.6f\n", amb->last_known_lat, amb->last_known_lng);
        printf("Last Successful Ping: %ld (%.0fs ago)\n", (long)amb->last_gps_ping_time, elapsed);
        printf("Current Status      : CONNECTION LOST\n");
        printf("Operator Action     : Check cellular fallback or radio dispatch.\n");
        printf("********************************************************\n");
    } else {
        amb->gps_connected = true;
        printf("GPS Status: CONNECTED (Active Ping received %.1fs ago)\n", elapsed);
    }
}

void simulate_gps_ping(Ambulance* amb) {
    amb->gps_connected = true;
    amb->last_gps_ping_time = time(NULL);
    printf("\n[TELEMETRY] GPS ping received from %s. Coordinates updated.\n", amb->ambulance_id);
    printf(">> [OPERATOR] Status updated: CONNECTED.\n");
}

/* ============================================================================
 * FOREST AREA ENTRY WARNING SYSTEM (DRIVER DECISION)
 * ============================================================================ */

void simulate_forest_warning(const Graph* g, Ambulance* amb, int next_vertex) {
    const VertexInfo* next_v = &g->vertices[next_vertex];

    if (next_v->is_near_forest && !next_v->is_in_forest) {
        printf("\n--------------------------------------------------------\n");
        printf("âš ï¸  YELLOW WARNING: APPROACHING FOREST AREA\n");
        printf("Approaching '%s'.\n", next_v->name);
        printf("Notice: Cellular reception drops ahead. Please review route.\n");
        printf("--------------------------------------------------------\n");
    } else if (next_v->is_in_forest) {
        printf("\n========================================================\n");
        printf("ðŸš¨ RED ALERT: ENTERING FOREST REGION!\n");
        printf("Forest Name         : Nallamala / Eco-Sensitive Reserve\n");
        printf("Next Intersection   : %s\n", next_v->name);
        printf("Hazards Detected    : Wildlife crossing, poor network, unlit roads.\n");
        printf("\nDRIVER ROUTE OPTIONS:\n");
        printf("[1] Switch to Highway Bypass (Recommended - Avoid Forest)\n");
        printf("[2] Continue on Current Route (Driver Discretion)\n");
        printf("========================================================\n");
    }
}

/* ============================================================================
 * MAIN PROGRAM: COLLEGE DEMO & VIVA EVALUATION
 * ============================================================================ */

int main() {
    // 1. Initialize Graph with realistic intersections
    Graph* city_map = create_graph(8);

    // Add Vertices (Id, Name, Lat, Lng, in_forest, near_forest)
    add_vertex(city_map, 0, "Central Emergency Depot", 17.3850, 78.4867, false, false);
    add_vertex(city_map, 1, "North Junction",         17.3980, 78.4950, false, false);
    add_vertex(city_map, 2, "Forest Approach Point",   17.4120, 78.5100, false, true);
    add_vertex(city_map, 3, "Eco-Reserve North Gate",  17.4350, 78.5300, true,  false);
    add_vertex(city_map, 4, "Deep Forest Crossing",    17.4500, 78.5450, true,  false);
    add_vertex(city_map, 5, "Highway Bypass Cross",    17.4200, 78.4750, false, false);
    add_vertex(city_map, 6, "Outer Ring Road (ORR)",   17.4600, 78.4900, false, false);
    add_vertex(city_map, 7, "Metro Apollo Hospital",   17.4750, 78.5200, false, false);

    // Add Edges: (src, dest, dist_km, traffic_factor, is_forest, road_name)
    // Route A: Through Forest (shorter distance 11.2 km, but hazardous)
    add_edge(city_map, 0, 1, 3.2, 1.0, false, "MG Road");
    add_edge(city_map, 1, 2, 2.5, 1.2, false, "Hill Fort Road");
    add_edge(city_map, 2, 3, 2.8, 1.0, true,  "Forest Entry Cutoff");
    add_edge(city_map, 3, 4, 3.1, 1.0, true,  "Reserve Canopy Track");
    add_edge(city_map, 4, 7, 2.6, 1.1, false, "Hospital Link Road");

    // Route B: Highway Bypass around Forest (longer distance 14.5 km, but clear 4-lane highway)
    add_edge(city_map, 0, 5, 4.0, 1.1, false, "West Expressway");
    add_edge(city_map, 5, 6, 6.5, 1.0, false, "Express ORR Bypass");
    add_edge(city_map, 6, 7, 4.0, 1.2, false, "Hospital North Flyover");

    // Alternate connector between North Junction and Highway Bypass
    add_edge(city_map, 1, 5, 3.5, 1.5, false, "Radial Link Rd 2");

    // 2. Initialize Ambulance and Driver
    Ambulance amb;
    strcpy(amb.ambulance_id, "AMB-101");
    strcpy(amb.driver.driver_name, "Rajesh Kumar");
    strcpy(amb.driver.driver_id, "DRV-842");
    strcpy(amb.driver.contact, "+91 98765 43210");
    strcpy(amb.driver.badge_number, "AP-MED-09");
    amb.driver.is_logged_in = false;
    amb.current_vertex = 0;
    amb.destination_vertex = 7;
    amb.current_speed_kmh = 60.0;
    amb.gps_connected = true;
    amb.last_gps_ping_time = time(NULL);
    amb.last_known_lat = 17.3850;
    amb.last_known_lng = 78.4867;
    amb.is_emergency_active = true;

    int choice;
    do {
        printf("\n========================================================================\n");
        printf("   SMARTOUTE: EMERGENCY VEHICLE DYNAMIC GRAPH OPTIMIZATION SYSTEM        \n");
        printf("========================================================================\n");
        printf("1. Driver Cabin Login Profile\n");
        printf("2. Display Road Network Graph (Adjacency List)\n");
        printf("3. Calculate Optimal Route using Dijkstra (Min-Heap)\n");
        printf("4. Simulate Forest Area Approach & Entry Warning\n");
        printf("5. Simulate GPS Connection Loss (15-Second Watchdog)\n");
        printf("6. Restore GPS Connection\n");
        printf("7. Inject Heavy Traffic Congestion & Dynamic Recalculate\n");
        printf("8. Exit Program\n");
        printf("Enter your choice (1-8): ");
        if (scanf("%d", &choice) != 1) {
            break;
        }
        while (getchar() != '\n'); // Clear buffer

        switch (choice) {
            case 1:
                driver_login(&amb);
                break;

            case 2:
                print_adjacency_list(city_map);
                break;

            case 3: {
                int path[MAX_VERTICES];
                int path_len = 0;
                double dist = 0.0;
                double eta = 0.0;

                printf("\nCalculating Shortest Path from '%s' to '%s'...\n",
                       city_map->vertices[amb.current_vertex].name,
                       city_map->vertices[amb.destination_vertex].name);

                dijkstra_shortest_path(city_map, amb.current_vertex, amb.destination_vertex, false, path, &path_len, &dist, &eta);

                printf("\n--- OPTIMAL ROUTE (Standard Dijkstra) ---\n");
                for (int i = 0; i < path_len; i++) {
                    printf("[%d] %s %s", path[i], city_map->vertices[path[i]].name, (i < path_len - 1) ? "-> " : "");
                }
                printf("\nTotal Distance: %.2f km | Estimated Travel Time: %.1f mins\n", dist, eta);
                break;
            }

            case 4: {
                // Simulate approaching forest vertex 2 then 3
                simulate_forest_warning(city_map, &amb, 2);
                simulate_forest_warning(city_map, &amb, 3);

                printf("Driver choice: Enter 1 for Highway Bypass or 2 to Continue Forest: ");
                int drv_choice = 1;
                scanf("%d", &drv_choice);
                while (getchar() != '\n');

                int path[MAX_VERTICES];
                int path_len = 0;
                double dist = 0.0;
                double eta = 0.0;

                bool avoid = (drv_choice == 1);
                dijkstra_shortest_path(city_map, amb.current_vertex, amb.destination_vertex, avoid, path, &path_len, &dist, &eta);

                printf("\n--- RECALCULATED ROUTE BASED ON DRIVER SELECTION ---\n");
                printf("Driver Decision: %s\n", avoid ? "Switch to Highway Bypass" : "Continue Current Route");
                for (int i = 0; i < path_len; i++) {
                    printf("[%d] %s %s", path[i], city_map->vertices[path[i]].name, (i < path_len - 1) ? "-> " : "");
                }
                printf("\nTotal Distance: %.2f km | ETA: %.1f mins\n", dist, eta);
                break;
            }

            case 5: {
                printf("\nSimulating 16 seconds without GPS telemetry updates...\n");
                amb.last_gps_ping_time = time(NULL) - 16; // Set last ping to 16 seconds ago
                check_gps_watchdog(&amb);
                break;
            }

            case 6: {
                simulate_gps_ping(&amb);
                check_gps_watchdog(&amb);
                break;
            }

            case 7: {
                printf("\n[TRAFFIC INJECTION] Heavy traffic on MG Road (Vertex 0 -> 1)!\n");
                // Find edge 0 -> 1 and increase traffic factor to 4.0
                AdjListNode* crawl = city_map->adj_lists[0];
                while (crawl != NULL) {
                    if (crawl->dest == 1) {
                        crawl->traffic_factor = 4.0;
                        break;
                    }
                    crawl = crawl->next;
                }

                int path[MAX_VERTICES];
                int path_len = 0;
                double dist = 0.0;
                double eta = 0.0;

                dijkstra_shortest_path(city_map, amb.current_vertex, amb.destination_vertex, false, path, &path_len, &dist, &eta);

                printf("Traffic multiplier updated to 4.0x (Severe Congestion)\n");
                printf("Dijkstra automatically rerouted ambulance via West Expressway!\n");
                printf("\n--- NEW DYNAMICALLY RECALCULATED OPTIMAL ROUTE ---\n");
                for (int i = 0; i < path_len; i++) {
                    printf("[%d] %s %s", path[i], city_map->vertices[path[i]].name, (i < path_len - 1) ? "-> " : "");
                }
                printf("\nTotal Distance: %.2f km | ETA: %.1f mins\n", dist, eta);
                break;
            }

            case 8:
                printf("\nExiting SmartRoute system. Thank you!\n");
                break;

            default:
                printf("\nInvalid selection. Please choose 1-8.\n");
        }
    } while (choice != 8);

    // Clean up
    for (int i = 0; i < city_map->num_vertices; i++) {
        AdjListNode* crawl = city_map->adj_lists[i];
        while (crawl != NULL) {
            AdjListNode* temp = crawl;
            crawl = crawl->next;
            free(temp);
        }
    }
    free(city_map);

    return 0;
}
