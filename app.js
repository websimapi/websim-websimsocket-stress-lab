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
        headerPeerCount: document.getElementById('active-peers'),
        ping: document.getElementById('dash-ping'),
        jitter: document.getElementById('dash-jitter'),
        conv: document.getElementById('dash-conv'),
        pps: document.getElementById('dash-pps'),
        rx: document.getElementById('dash-rx'),
        hostRx: document.getElementById('dash-host-rx'),
        p2pRtt: document.getElementById('dash-p2p-rtt'),
        keys: document.getElementById('dash-keys'),
        bw: document.getElementById('dash-bw'),
        stressCount: document.getElementById('stress-count'),
        stressSize: document.getElementById('stress-size'),
        stressVis: document.getElementById('stress-visualizer'),
        log: document.getElementById('latency-log'),
        
        // Connection Manager
        hostCount: document.getElementById('host-count'),
        peerCount: document.getElementById('peer-count'),
        hostsList: document.getElementById('hosts-list'),
        peersList: document.getElementById('peers-list'),
        roleToggle: document.getElementById('role-toggle'),
        currentRole: document.getElementById('current-role'),

        // Throughput Elements
        tpStats: document.getElementById('throughput-stats'),
        tpRate: document.getElementById('tp-rate'),
        tpBandwidth: document.getElementById('tp-bandwidth'),
        tpTotal: document.getElementById('tp-total')
    },

    // Throttle for connection list updates to prevent DOM thrashing
    lastConnUpdate: 0,

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

        // Connection Manager Controls
        this.els.roleToggle.addEventListener('change', (e) => {
            const newRole = e.target.checked ? 'host' : 'peer';
            // Reset hostId if we become a host, otherwise keep it (or null it? let's null it to be clean)
            const update = { role: newRole };
            if (newRole === 'host') update.hostId = null;
            
            room.updatePresence(update);
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

    updateConnectionManager(peers, presence, myId) {
        // Throttle updates to ~2fps to save CPU during stress tests
        const now = Date.now();
        if (now - this.lastConnUpdate < 500) return;
        this.lastConnUpdate = now;

        // Update Header Count
        this.els.headerPeerCount.textContent = Object.keys(peers).length;

        const myPresence = presence[myId] || {};
        const myRole = myPresence.role || 'peer';
        const myHostId = myPresence.hostId;

        // Sync local controls
        this.els.roleToggle.checked = (myRole === 'host');
        this.els.currentRole.textContent = myRole;
        this.els.currentRole.className = myRole;

        // Sort peers
        const hosts = [];
        const ordinaryPeers = [];

        Object.entries(peers).forEach(([id, peerInfo]) => {
            const p = presence[id] || {};
            // Default to peer if undefined
            const r = p.role || 'peer';
            
            const entry = { id, ...peerInfo, hostId: p.hostId };
            if (r === 'host') hosts.push(entry);
            else ordinaryPeers.push(entry);
        });

        this.els.hostCount.textContent = hosts.length;
        this.els.peerCount.textContent = ordinaryPeers.length;

        // Render Hosts
        if (hosts.length === 0) {
            this.els.hostsList.innerHTML = '<div class="empty-msg">No active hosts</div>';
        } else {
            this.els.hostsList.innerHTML = '';
            hosts.forEach(h => {
                const el = document.createElement('div');
                el.className = 'list-item';
                
                let action = '';
                if (h.id === myId) {
                    action = `<span class="badge me">You</span>`;
                } else if (myRole === 'peer') {
                    if (myHostId === h.id) {
                        action = `<button class="btn-xs success" disabled>Connected</button>`;
                    } else {
                        const btn = document.createElement('button');
                        btn.className = 'btn-xs primary';
                        btn.textContent = 'Connect';
                        btn.onclick = () => room.updatePresence({ hostId: h.id });
                        action = btn; // append element later
                    }
                }

                el.innerHTML = `
                    <div class="user-info">
                        <img src="${h.avatarUrl}" class="avatar-xs">
                        <span class="username">${h.username}</span>
                    </div>
                `;
                
                if (typeof action === 'string') el.innerHTML += action;
                else el.appendChild(action);

                this.els.hostsList.appendChild(el);
            });
        }

        // Render Peers
        if (ordinaryPeers.length === 0) {
            this.els.peersList.innerHTML = '<div class="empty-msg">No other peers</div>';
        } else {
            this.els.peersList.innerHTML = '';
            ordinaryPeers.forEach(p => {
                const el = document.createElement('div');
                el.className = 'list-item';
                
                let status = '';
                if (p.id === myId) status += `<span class="badge me">You</span> `;
                
                if (p.hostId) {
                    const hostName = peers[p.hostId]?.username || 'Unknown';
                    status += `<span class="status-text">→ ${hostName}</span>`;
                } else {
                    status += `<span class="status-text muted">Idle</span>`;
                }

                el.innerHTML = `
                    <div class="user-info">
                        <img src="${p.avatarUrl}" class="avatar-xs">
                        <span class="username">${p.username}</span>
                    </div>
                    <div>${status}</div>
                `;
                this.els.peersList.appendChild(el);
            });
        }
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
    ui.updateConnectionManager(room.peers, room.presence, room.clientId);

    const testSuite = new TestSuite(room, ui);

    // --- Subscriptions ---
    room.subscribePresence((p) => {
        ui.updateConnectionManager(room.peers, room.presence, room.clientId);
        
        // Update Test Suite Topology
        const myP = p[room.clientId] || {};
        testSuite.updateTopology(myP.role || 'peer', myP.hostId);
        
        testSuite.onPresenceUpdate();
    });

    room.subscribeRoomState((s) => {
        ui.updateRoomStats(s);
        testSuite.onRoomStateUpdate(s);
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
    document.getElementById('btn-stress-conv').onclick = () => testSuite.runConvergenceTest();
    document.getElementById('btn-stress-clear').onclick = () => testSuite.clearStressObjects();
}

main();