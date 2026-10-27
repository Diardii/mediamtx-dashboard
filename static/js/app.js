// MediaMTX Dashboard Frontend Logic

const API_BASE = '/api';
let refreshInterval = null;

// --- Utility Functions ---

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatNumber(num) {
    return num.toLocaleString();
}

async function fetchAPI(endpoint, options = {}) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
}

function showError(message) {
    console.error(message);
    // Could add toast notification here
}

function setConnectionStatus(connected) {
    const el = document.getElementById('connection-status');
    el.textContent = connected ? 'Connected' : 'Disconnected';
    el.classList.toggle('connected', connected);
    el.classList.toggle('disconnected', !connected);
}

// --- Render Functions ---

function renderSummary(data) {
    document.getElementById('stat-total').textContent = formatNumber(data.total);
    document.getElementById('stat-online').textContent = formatNumber(data.online);
    document.getElementById('stat-offline').textContent = formatNumber(data.offline);
    document.getElementById('stat-viewers').textContent = formatNumber(data.total_readers);
}

function renderStreams(streams) {
    const tbody = document.getElementById('streams-table-body');
    tbody.innerHTML = streams.map(s => `
        <tr>
            <td class="px-6 py-4 font-mono text-sm">${escapeHtml(s.name)}</td>
            <td class="px-6 py-4">
                <span class="status-badge ${s.ready ? 'status-online' : 'status-offline'}">
                    ${s.ready ? 'Online' : 'Offline'}
                </span>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600">
                ${s.tracks.map(t => `${t.codec}${t.width ? ` ${t.width}x${t.height}` : ''}${t.fps ? `@${t.fps}fps` : ''}`).join(', ') || '-'}
            </td>
            <td class="px-6 py-4 text-sm">${formatNumber(s.readers)}</td>
            <td class="px-6 py-4 text-sm font-mono">${formatBytes(s.bytes_received)}</td>
            <td class="px-6 py-4 text-sm font-mono">${formatBytes(s.bytes_sent)}</td>
        </tr>
    `).join('');
}

function renderPaths(paths) {
    const tbody = document.getElementById('paths-table-body');
    tbody.innerHTML = paths.map(p => `
        <tr>
            <td class="px-6 py-4 font-mono text-sm">${escapeHtml(p.name)}</td>
            <td class="px-6 py-4 text-sm text-gray-600 max-w-xs truncate block">${escapeHtml(p.source || '(publisher)')}</td>
            <td class="px-6 py-4 text-sm">
                <span class="status-badge ${p.source_on_demand ? 'status-online' : 'status-offline'}">
                    ${p.source_on_demand ? 'Yes' : 'No'}
                </span>
            </td>
            <td class="px-6 py-4">
                <button onclick="deletePath('${escapeHtml(p.name)}')" class="btn-icon btn-danger">Delete</button>
            </td>
        </tr>
    `).join('');
}

function renderSessions(sessions) {
    const tbody = document.getElementById('sessions-table-body');
    tbody.innerHTML = sessions.map(s => `
        <tr>
            <td class="px-6 py-4 font-mono text-sm">${escapeHtml(s.id)}</td>
            <td class="px-6 py-4 text-sm">
                <span class="status-badge status-online">${escapeHtml(s.type.toUpperCase())}</span>
            </td>
            <td class="px-6 py-4 font-mono text-sm">${escapeHtml(s.path)}</td>
            <td class="px-6 py-4 text-sm text-gray-600">${escapeHtml(s.remote_addr)}</td>
            <td class="px-6 py-4 text-sm font-mono">${formatBytes(s.bytes_received)}</td>
            <td class="px-6 py-4 text-sm font-mono">${formatBytes(s.bytes_sent)}</td>
            <td class="px-6 py-4">
                <button onclick="kickSession('${escapeHtml(s.type)}', '${escapeHtml(s.id)}')" class="btn-icon btn-danger">Kick</button>
            </td>
        </tr>
    `).join('');
}

function renderServer(health, config) {
    document.getElementById('server-health').textContent = JSON.stringify(health, null, 2);
    document.getElementById('server-config').textContent = JSON.stringify(config, null, 2);
}

// --- Data Loading ---

async function loadAll() {
    try {
        const [summary, streams, paths, sessions, health, config] = await Promise.all([
            fetchAPI('/streams/summary'),
            fetchAPI('/streams'),
            fetchAPI('/paths'),
            fetchAPI('/sessions'),
            fetchAPI('/server/health'),
            fetchAPI('/server/config'),
        ]);

        if (summary.success) renderSummary(summary.data);
        if (streams.success) renderStreams(streams.data.items);
        if (paths.success) renderPaths(paths.data.items);
        if (sessions.success) renderSessions(sessions.data.items);
        if (health.success && config.success) renderServer(health.data, config.data);

        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
    }
}

// --- Actions ---

window.deletePath = async function(name) {
    if (!confirm(`Delete path "${name}"?`)) return;
    try {
        await fetchAPI(`/paths/${encodeURIComponent(name)}`, { method: 'DELETE' });
        loadAll();
    } catch (e) {
        showError(e.message);
        alert(`Failed to delete: ${e.message}`);
    }
};

window.kickSession = async function(type, id) {
    if (!confirm(`Kick session ${type}/${id}?`)) return;
    try {
        await fetchAPI(`/sessions/${type}/${id}/kick`, { method: 'POST' });
        loadAll();
    } catch (e) {
        showError(e.message);
        alert(`Failed to kick: ${e.message}`);
    }
};

// --- Modal Handling ---

const modal = document.getElementById('add-path-modal');
const form = document.getElementById('add-path-form');

document.getElementById('add-path-btn').addEventListener('click', () => {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    form.reset();
});

document.getElementById('cancel-path-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
        await fetchAPI('/paths', {
            method: 'POST',
            body: JSON.stringify({
                name: fd.get('name'),
                source: fd.get('source') || null,
                source_on_demand: fd.get('source_on_demand') === 'on',
            }),
        });
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        loadAll();
    } catch (e) {
        showError(e.message);
        alert(`Failed to add path: ${e.message}`);
    }
});

// --- Tab Handling ---

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    });
});

// --- Auto Refresh ---

function startAutoRefresh() {
    stopAutoRefresh();
    refreshInterval = setInterval(loadAll, 5000);
}

function stopAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
}

document.getElementById('refresh-btn').addEventListener('click', loadAll);

// --- Init ---

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    startAutoRefresh();
});

// Cleanup on page unload
window.addEventListener('beforeunload', stopAutoRefresh);