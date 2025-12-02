import { TestSuite } from './tests.js';
import { systemInfoHTML } from './info.js';
import Chart from 'chart.js/auto';

const room = new WebsimSocket();

// --- UI Management ---
const ui = {
    tabs: document.querySelectorAll('.nav-btn'),
    views: document.querySelectorAll('.view'),

    // Dashboard Elements
    els: {
        statusDot: document.getElementById('connection-status'),
        statusText: document.getElementById('connection-text'),
        peerCount: document.getElementById('active-peers'),
        ping: document.getElementById('dash-ping'),
        eps: document.getElementById('dash-eps'),
        keys: document.getElementById('dash-keys'),
        size: document.getElementById('dash-size'),
        stressCount: document.getElementById('stress-count'),
        stressSize: document.getElementById('stress-size'),
        stressVis: document.getElementById('stress-visualizer'),
        log: document.getElementById('latency-log'),
        
        // Throughput Elements
        tpStats: document.getElementById('throughput-stats'),
        tpRate: document.getElementById('tp-rate'),
        tpBandwidth: document.getElementById('tp-bandwidth'),
        tpTotal: document.getElementById('tp-total')
    },

    init() {
        // Tab Switching
        this.tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                this.tabs.forEach(b => b.classList.remove('active'));
                this.views.forEach(v => v.classList.remove('active'));

                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });

        // Load Static Info
        document.getElementById('info-content').innerHTML = systemInfoHTML;

        // Init Chart
        const ctx = document.getElementById('liveChart').getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array(20).fill(''),
                datasets: [{
                    label: 'Latency (ms)',
                    data: Array(20).fill(0),
                    borderColor: '#3b82f6',
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, grid: { color: '#2d3748' } },
                    x: { display: false }
                },
                plugins: { legend: { display: false } },
                animation: false
            }
        });
    },

    updateConnection(isConnected) {
        if (isConnected) {
            this.els.statusDot.className = 'dot connected';
            this.els.statusText.textContent = 'Connected';
            this.els.statusText.style.color = '#22c55e';
        } else {
            this.els.statusDot.className = 'dot disconnected';
            this.els.statusText.textContent = 'Disconnected';
            this.els.statusText.style.color = '#ef4444';
        }
    },

    updatePeers(peers) {
        const count = Object.keys(peers).length;
        this.els.peerCount.textContent = count;
    },

    updateRoomStats(state) {
        let keys = 0;
        let stressObjects = 0;

        if (state) {
            keys = Object.keys(state).length;
            if (state.stress_objects) {
                stressObjects = Object.keys(state.stress_objects).length;
            }
        }

        this.els.keys.textContent = keys;
        this.els.stressCount.textContent = stressObjects;

        // Estimate Size
        const size = new Blob([JSON.stringify(state)]).size;
        this.els.stressSize.textContent = (size / 1024).toFixed(2);

        // Visualizer for stress
        this.els.stressVis.innerHTML = '';
        for(let i=0; i<Math.min(stressObjects, 500); i++) {
            const div = document.createElement('div');
            div.className = 'stress-node ' + (Math.random() > 0.5 ? 'active' : '');
            this.els.stressVis.appendChild(div);
        }
    },

    logLatency(msg, type='info') {
        const div = document.createElement('div');
        div.className = `log-entry ${type}`;
        div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        this.els.log.prepend(div);
        if (this.els.log.children.length > 50) this.els.log.lastChild.remove();
    },

    updateDashboardMetric(id, val) {
        if (this.els[id]) this.els[id].textContent = val;
    },

    recordChartData(ping) {
        const data = this.chart.data.datasets[0].data;
        data.push(ping);
        data.shift();
        this.chart.update();
    },

    updateThroughputStats(stats) {
        if (!stats) {
            this.els.tpStats.classList.add('hidden');
            return;
        }
        this.els.tpStats.classList.remove('hidden');
        this.els.tpRate.textContent = `${stats.pps} pps`;
        this.els.tpBandwidth.textContent = `${stats.kbps} KB/s`;
        this.els.tpTotal.textContent = `${stats.totalMb} MB`;
    }
};

// --- Initialization ---
async function main() {
    ui.init();

    // Connect
    await room.initialize();
    ui.updateConnection(true);
    ui.updatePeers(room.peers);

    const testSuite = new TestSuite(room, ui);

    // --- Subscriptions ---
    room.subscribePresence((p) => {
        ui.updatePeers(room.peers);
    });

    room.subscribeRoomState((s) => {
        ui.updateRoomStats(s);
    });

    // --- Event Listeners for Controls ---

    // Latency
    document.getElementById('btn-latency-start').onclick = (e) => {
        testSuite.startLatencyTest();
        e.target.disabled = true;
        document.getElementById('btn-latency-stop').disabled = false;
    };
    document.getElementById('btn-latency-stop').onclick = (e) => {
        testSuite.stopLatencyTest();
        e.target.disabled = true;
        document.getElementById('btn-latency-start').disabled = false;
    };

    // Throughput
    const pSlider = document.getElementById('payload-slider');
    const fSlider = document.getElementById('freq-slider');

    pSlider.oninput = (e) => document.getElementById('payload-val').textContent = e.target.value + ' B';
    fSlider.oninput = (e) => document.getElementById('freq-val').textContent = e.target.value + ' ms';

    document.getElementById('btn-thru-start').onclick = (e) => {
        testSuite.startThroughputTest(parseInt(pSlider.value), parseInt(fSlider.value));
        e.target.disabled = true;
        document.getElementById('btn-thru-stop').disabled = false;
        pSlider.disabled = true;
        fSlider.disabled = true;
    };
    document.getElementById('btn-thru-stop').onclick = (e) => {
        testSuite.stopThroughputTest();
        e.target.disabled = true;
        document.getElementById('btn-thru-start').disabled = false;
        pSlider.disabled = false;
        fSlider.disabled = false;
    };

    // Stress
    document.getElementById('btn-stress-100').onclick = () => testSuite.addStressObjects(100);
    document.getElementById('btn-stress-500').onclick = () => testSuite.addStressObjects(500);
    document.getElementById('btn-stress-clear').onclick = () => testSuite.clearStressObjects();
}

main();