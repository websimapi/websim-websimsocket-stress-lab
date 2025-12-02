export class TestSuite {
    constructor(room, ui) {
        this.room = room;
        this.ui = ui;

        // Latency
        this.latencyRunning = false;
        this.latencyInterval = null;

        // Throughput
        this.throughputRunning = false;
        this.throughputInterval = null;
        this.throughputStats = { sent: 0, bytes: 0, startTime: 0 };
        this.payloadSize = 100;

        // Setup Listeners
        this.room.onmessage = (e) => this.handleMessage(e);
    }

    handleMessage(e) {
        const data = e.data;

        // Handle Latency Pings
        if (data.type === 'test-ping' && data.sender === this.room.clientId) {
            const rtt = performance.now() - data.timestamp;
            this.ui.logLatency(`RTT: ${rtt.toFixed(2)}ms | Size: ${JSON.stringify(data).length} bytes`);
            this.ui.updateDashboardMetric('ping', rtt.toFixed(0));
            this.ui.recordChartData(rtt);
        }
    }

    // --- Latency Test ---
    startLatencyTest() {
        if (this.latencyRunning) return;
        this.latencyRunning = true;
        this.ui.logLatency("Starting latency test (5 pings/sec)...", "system");

        this.latencyInterval = setInterval(() => {
            this.room.send({
                type: 'test-ping',
                timestamp: performance.now(),
                sender: this.room.clientId,
                echo: true // Critical: we want to hear our own echo to measure RTT
            });
        }, 200);
    }

    stopLatencyTest() {
        this.latencyRunning = false;
        clearInterval(this.latencyInterval);
        this.ui.logLatency("Latency test stopped.", "system");
    }

    // --- Throughput Test ---
    startThroughputTest(sizeBytes, intervalMs) {
        if (this.throughputRunning) return;
        this.throughputRunning = true;
        this.throughputStats = { sent: 0, bytes: 0, startTime: Date.now() };

        // Create junk payload
        const filler = "X".repeat(Math.max(0, sizeBytes - 50)); // -50 for overhead

        this.throughputInterval = setInterval(() => {
            if (!this.throughputRunning) return;

            // Update presence with heavy payload
            this.room.updatePresence({
                test_mode: 'throughput',
                timestamp: Date.now(),
                payload: filler
            });

            // Update Stats
            this.throughputStats.sent++;
            this.throughputStats.bytes += sizeBytes;

            const elapsedSec = (Date.now() - this.throughputStats.startTime) / 1000;
            const pps = Math.round(this.throughputStats.sent / elapsedSec);
            const kbps = ((this.throughputStats.bytes / 1024) / elapsedSec).toFixed(1);
            const totalMb = (this.throughputStats.bytes / 1024 / 1024).toFixed(2);

            this.ui.updateThroughputStats({ pps, kbps, totalMb });
            this.ui.updateDashboardMetric('size', sizeBytes);
        }, intervalMs);
    }

    stopThroughputTest() {
        this.throughputRunning = false;
        clearInterval(this.throughputInterval);
        // Clean up presence
        this.room.updatePresence({ test_mode: null, payload: null });
        this.ui.updateThroughputStats(null); // Hide stats or keep them? Let's keep last known state actually, but maybe dim it.
        // For now, let's just leave the last values visible but maybe indicate stopped.
        // Actually, the app.js logic hides it if null. Let's not pass null if we want to see final results. 
        // But for cleaner UX indicating "active", let's pass null to fade it out as per my app.js logic (hidden class).
        // Wait, looking at styles, .hidden sets opacity 0.3. That's perfect for "stopped".
        this.ui.updateThroughputStats(null); 
    }

    // --- Stress Test (Room State) ---
    async addStressObjects(count) {
        const batch = {};
        const prefix = `stress_${this.room.clientId}_${Date.now()}_`;

        for (let i = 0; i < count; i++) {
            batch[`${prefix}${i}`] = {
                x: Math.random() * 1000,
                y: Math.random() * 1000,
                color: '#' + Math.floor(Math.random()*16777215).toString(16),
                updated: Date.now()
            };
        }

        // Note: Sending huge objects in one go might hit WebSocket frame limits.
        // Websim handles reasonably large JSONs, but let's see.
        this.room.updateRoomState({
            stress_objects: {
                ...(this.room.roomState.stress_objects || {}),
                ...batch
            }
        });
    }

    clearStressObjects() {
        // To delete, we set keys to null, or set the parent key to null if we want to wipe it all
        // Ideally we wipe the specific keys we created, but for a stress test, let's nuke the collection
        this.room.updateRoomState({
            stress_objects: null
        });
    }
}