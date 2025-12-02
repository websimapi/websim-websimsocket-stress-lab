export class TestSuite {
    constructor(room, ui) {
        this.room = room;
        this.ui = ui;

        // Latency & Jitter
        this.latencyRunning = false;
        this.latencyInterval = null;
        this.prevRtt = 0;
        this.jitter = 0;

        // Throughput
        this.throughputRunning = false;
        this.throughputInterval = null;
        this.throughputStats = { sent: 0, bytes: 0, startTime: 0 };
        this.payloadSize = 100;

        // Incoming Metrics
        this.rxCount = 0;
        this.lastRxCheck = Date.now();
        
        // Convergence
        this.convergenceStart = 0;
        this.convergenceKey = null;

        // Setup Listeners
        this.room.onmessage = (e) => this.handleMessage(e);
        
        // Start background monitor
        this.startBackgroundMonitor();
    }

    handleMessage(e) {
        const data = e.data;

        // Handle Latency Pings
        if (data.type === 'test-ping' && data.sender === this.room.clientId) {
            const now = performance.now();
            const rtt = now - data.timestamp;
            
            // Calculate Jitter (RFC 1889ish simplified)
            // J = J + (|RTT - prevRTT| - J) / 16
            const diff = Math.abs(rtt - this.prevRtt);
            this.jitter += (diff - this.jitter) / 16;
            this.prevRtt = rtt;

            this.ui.logLatency(`RTT: ${rtt.toFixed(2)}ms | Jitter: ${this.jitter.toFixed(2)}ms`);
            this.ui.updateDashboardMetric('ping', rtt.toFixed(0));
            this.ui.updateDashboardMetric('jitter', this.jitter.toFixed(1));
            this.ui.recordChartData(rtt);
        }
    }

    startBackgroundMonitor() {
        // Monitor RX Rate (Incoming updates)
        setInterval(() => {
            const now = Date.now();
            const elapsed = (now - this.lastRxCheck) / 1000;
            if (elapsed > 0) {
                const rxRate = Math.round(this.rxCount / elapsed);
                this.ui.updateDashboardMetric('rx', rxRate);
                this.rxCount = 0;
                this.lastRxCheck = now;
            }
        }, 1000);
    }

    // Called by app when presence updates arrive
    onPresenceUpdate() {
        this.rxCount++;
    }

    // Called by app when room state updates arrive
    onRoomStateUpdate(state) {
        // Check for convergence test key
        if (this.convergenceKey && state[this.convergenceKey]) {
            const end = performance.now();
            const duration = end - this.convergenceStart;
            
            this.ui.updateDashboardMetric('conv', duration.toFixed(0));
            this.ui.logLatency(`Convergence Confirmation: ${duration.toFixed(2)}ms`, 'success');
            
            // Cleanup
            this.room.updateRoomState({ [this.convergenceKey]: null });
            this.convergenceKey = null;
        }
    }

    // --- Latency Test ---
    startLatencyTest() {
        if (this.latencyRunning) return;
        this.latencyRunning = true;
        this.ui.logLatency("Starting latency test (5 pings/sec)...", "system");
        
        // Reset jitter
        this.jitter = 0;
        this.prevRtt = 0;

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
            this.ui.updateDashboardMetric('pps', pps);
            this.ui.updateDashboardMetric('bw', kbps);
        }, intervalMs);
    }

    stopThroughputTest() {
        this.throughputRunning = false;
        clearInterval(this.throughputInterval);
        // Clean up presence
        this.room.updatePresence({ test_mode: null, payload: null });
        this.ui.updateThroughputStats(null);
        this.ui.updateDashboardMetric('pps', 0);
        this.ui.updateDashboardMetric('bw', 0);
    }

    // --- Stress Test (Room State) ---
    async runConvergenceTest() {
        if (this.convergenceKey) return; // Already running
        
        const key = `conv_test_${this.room.clientId}_${Date.now()}`;
        this.convergenceKey = key;
        this.convergenceStart = performance.now();
        
        this.ui.logLatency("Starting convergence test...", "system");
        
        // Trigger update
        this.room.updateRoomState({
            [key]: { timestamp: Date.now() }
        });
    }

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