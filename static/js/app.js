// MediaMTX Dashboard Frontend Logic

const API_BASE = '/api';
let refreshInterval = null;
let currentPage = 'dashboard';
let sidebarCollapsed = false;

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

function formatUptime(seconds) {
    if (!seconds) return '-';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
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
}

function setConnectionStatus(connected) {
    const el = document.getElementById('connection-status');
    el.textContent = connected ? 'Connected' : 'Disconnected';
    el.classList.toggle('text-green-600', connected);
    el.classList.toggle('text-red-600', !connected);
    el.classList.toggle('text-gray-500', !connected);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Sidebar Functions ---

function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const sidebarLogo = document.getElementById('sidebar-logo');

    // Load collapsed state from localStorage
    const savedCollapsed = localStorage.getItem('sidebarCollapsed');
    if (savedCollapsed === 'true') {
        sidebarCollapsed = true;
        sidebar.classList.add('sidebar-collapsed');
        mainContent.classList.add('sidebar-collapsed');
        sidebarLogo.textContent = 'M';
    }

    // Toggle sidebar collapse (desktop)
    sidebarToggle.addEventListener('click', () => {
        sidebarCollapsed = !sidebarCollapsed;
        sidebar.classList.toggle('sidebar-collapsed');
        mainContent.classList.toggle('sidebar-collapsed');
        sidebarLogo.textContent = sidebarCollapsed ? 'M' : 'MediaMTX Dashboard';
        localStorage.setItem('sidebarCollapsed', sidebarCollapsed);
    });

    // Mobile menu button
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.add('mobile-open');
        sidebarOverlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    });

    // Close mobile sidebar on overlay click
    sidebarOverlay.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        sidebarOverlay.classList.add('hidden');
        document.body.style.overflow = '';
    });

    // Close mobile sidebar on nav link click
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth < 1024) {
                sidebar.classList.remove('mobile-open');
                sidebarOverlay.classList.add('hidden');
                document.body.style.overflow = '';
            }
        });
    });
}

// --- Page Routing ---

const pageTitleMap = {
    'dashboard': 'Dashboard',
    'paths': 'Paths',
    'config-global': 'Configuration - Global',
    'config-paths': 'Configuration - Paths',
    'config-defaults': 'Configuration - Path Defaults',
    'runtime-hls': 'Runtime - HLS',
    'runtime-rtsp': 'Runtime - RTSP',
    'runtime-rtmp': 'Runtime - RTMP',
    'runtime-logs': 'Runtime - Logs',
};

function getPageFromHash() {
    const hash = window.location.hash.slice(1);
    return hash || 'dashboard';
}

async function navigateToPage(page) {
    const knownPages = ['dashboard', 'paths', 'config-global', 'config-defaults', 'runtime-hls', 'runtime-rtsp', 'runtime-rtmp', 'runtime-logs'];
    const template = knownPages.includes(page) ? page : 'placeholder';
    const content = document.getElementById('page-content');

    content.innerHTML = '<div class="flex items-center justify-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>';

    try {
        const response = await fetch(`/static/pages/${template}.html`);
        if (!response.ok) throw new Error(`Unable to load ${template} page`);
        
        content.innerHTML = await response.text();
        
        if (template === 'placeholder') {
            document.getElementById('placeholder-title').textContent = pageTitleMap[page] || page;
        }

        // Re-bind events for the newly loaded content
        bindPageEvents(page);
        
        // Update UI state
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('nav-active', link.dataset.page === page);
        });
        document.getElementById('page-title').textContent = pageTitleMap[page] || 'Dashboard';
        
        currentPage = page;
        await loadPageData(page);
    } catch (error) {
        content.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">Error: ${escapeHtml(error.message)}</div>`;
        setConnectionStatus(false);
    }
}

function bindPageEvents(page) {
    if (page === 'paths') {
        document.getElementById('add-path-btn')?.addEventListener('click', () => {
            openPathModal();
        });
        document.getElementById('paths-search')?.addEventListener('input', () => {
            renderPaths(allPaths);
        });
    }
    if (page === 'config-global') {
        document.getElementById('config-global-save')?.addEventListener('click', saveConfigGlobal);
        document.getElementById('config-global-reset')?.addEventListener('click', resetConfigGlobal);
    }
    if (page === 'config-defaults') {
        document.getElementById('config-defaults-save')?.addEventListener('click', saveConfigDefaults);
        document.getElementById('config-defaults-reset')?.addEventListener('click', resetConfigDefaults);
    }
    if (page === 'runtime-logs') {
        document.getElementById('logs-search')?.addEventListener('input', () => renderLogs(allLogs));
        document.getElementById('logs-level-filter')?.addEventListener('change', () => renderLogs(allLogs));
        document.getElementById('logs-refresh')?.addEventListener('click', loadRuntimeLogs);
    }
}

function handleHashChange() {
    const page = getPageFromHash();
    if (page !== currentPage) {
        navigateToPage(page);
    }
}

// --- Page Data Loading ---

async function loadPageData(page) {
    switch (page) {
        case 'dashboard':
            await loadDashboard();
            break;
        case 'paths':
            await loadPaths();
            break;
        case 'config-global':
            await loadConfigGlobal();
            break;
        case 'config-defaults':
            await loadConfigDefaults();
            break;
        case 'runtime-hls':
            await loadRuntimeHLS();
            break;
        case 'runtime-rtsp':
            await loadRuntimeRTSP();
            break;
        case 'runtime-rtmp':
            await loadRuntimeRTMP();
            break;
        case 'runtime-logs':
            await loadRuntimeLogs();
            break;
        case 'config-paths':
            // Placeholder - backend integration not yet available
            break;
    }
}

// --- Dashboard ---

async function loadDashboard() {
    try {
        const [summary, streams, sessions, health, config] = await Promise.all([
            fetchAPI('/streams/summary'),
            fetchAPI('/streams'),
            fetchAPI('/sessions'),
            fetchAPI('/server/health'),
            fetchAPI('/server/config'),
        ]);

        if (summary.success) renderSummary(summary.data);
        if (streams.success) renderStreams(streams.data.items);
        if (sessions.success) renderSessions(sessions.data.items);
        if (health.success) renderServerStatus(health.data);
        if (config.success) renderServerConfig(config.data);

        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
    }
}

function renderSummary(data) {
    document.getElementById('stat-total').textContent = formatNumber(data.total);
    document.getElementById('stat-online').textContent = formatNumber(data.online);
    document.getElementById('stat-offline').textContent = formatNumber(data.offline);
    document.getElementById('stat-viewers').textContent = formatNumber(data.total_readers);
    
    // Update server traffic in the status card
    document.getElementById('server-traffic').textContent = 
        `${formatBytes(data.total_bytes_received)} / ${formatBytes(data.total_bytes_sent)}`;
    document.getElementById('server-total-readers').textContent = formatNumber(data.total_readers);
    document.getElementById('server-active-paths').textContent = formatNumber(data.online);
}

function renderStreams(streams) {
    const tbody = document.getElementById('streams-table-body');
    const countEl = document.getElementById('streams-count');
    
    countEl.textContent = `${streams.length} stream${streams.length !== 1 ? 's' : ''}`;
    
    if (streams.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-12 text-center text-gray-500">No active streams</td></tr>';
        return;
    }

    tbody.innerHTML = streams.map(s => {
        const tracks = Array.isArray(s.tracks) ? s.tracks : [];
        const trackInfo = tracks.map(t => {
            if (typeof t !== 'object' || t === null) return 'Unknown Track';
            const codec = t.codec || 'Unknown';
            const resolution = t.width && t.height ? ` ${t.width}x${t.height}` : '';
            const fps = t.fps ? `@${t.fps}fps` : '';
            return `${codec}${resolution}${fps}`;
        }).join(', ') || '-';

        return `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 font-mono text-sm">${escapeHtml(s.name)}</td>
                <td class="px-6 py-4">
                    <span class="status-badge ${s.ready ? 'status-online' : 'status-offline'}">
                        ${s.ready ? 'Online' : 'Offline'}
                    </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">
                    ${escapeHtml(trackInfo)}
                </td>
                <td class="px-6 py-4 text-sm">${formatNumber(s.readers)}</td>
                <td class="px-6 py-4 text-sm font-mono">${formatBytes(s.bytes_received)}</td>
                <td class="px-6 py-4 text-sm font-mono">${formatBytes(s.bytes_sent)}</td>
            </tr>
        `;
    }).join('');
}

function renderSessions(sessions) {
    const tbody = document.getElementById('sessions-table-body');
    const countEl = document.getElementById('sessions-count');
    
    countEl.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;
    
    if (sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-12 text-center text-gray-500">No active sessions</td></tr>';
        return;
    }

    tbody.innerHTML = sessions.map(s => `
        <tr class="hover:bg-gray-50">
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

function renderServerStatus(health) {
    const connected = health.connected === true;
    const statusEl = document.getElementById('server-connection-status');
    statusEl.textContent = connected ? 'Connected' : 'Disconnected';
    statusEl.className = `px-3 py-1 text-sm rounded-lg ${connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`;
    
    document.getElementById('server-version').textContent = health.version || 'unknown';
    document.getElementById('server-uptime').textContent = formatUptime(health.uptime);
}

function renderServerConfig(config) {
    // Extract path count from config if available
    const paths = config.paths || {};
    const pathCount = Object.keys(paths).length;
    
    // We'll get active paths and readers from the streams summary instead
    // This is just for static config info
    document.getElementById('server-total-paths').textContent = pathCount;
}

// --- Paths ---

let allPaths = [];

async function loadPaths() {
    try {
        const paths = await fetchAPI('/paths');
        if (paths.success) {
            allPaths = paths.data.items;
            renderPaths(allPaths);
        }
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
    }
}

function renderPaths(paths) {
    const tbody = document.getElementById('paths-table-body');
    const searchTerm = document.getElementById('paths-search')?.value.toLowerCase() || '';
    
    const filtered = paths.filter(p => 
        p.name.toLowerCase().includes(searchTerm) || 
        (p.source && p.source.toLowerCase().includes(searchTerm))
    );
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-12 text-center text-gray-500">No paths found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(p => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 font-mono text-sm">${escapeHtml(p.name)}</td>
            <td class="px-6 py-4 text-sm text-gray-600 max-w-xs truncate block">${escapeHtml(p.source || '(publisher)')}</td>
            <td class="px-6 py-4 text-sm">
                <span class="status-badge ${p.source_on_demand ? 'status-online' : 'status-offline'}">
                    ${p.source_on_demand ? 'Yes' : 'No'}
                </span>
            </td>
            <td class="px-6 py-4">
                <button onclick="editPath('${escapeHtml(p.name)}')" class="btn-icon btn-primary mr-2">Edit</button>
                <button onclick="deletePath('${escapeHtml(p.name)}')" class="btn-icon btn-danger">Delete</button>
            </td>
        </tr>
    `).join('');
}

// --- Path Modal (Add/Edit) ---

let editingPathName = null;

function openPathModal(path = null) {
    const modal = document.getElementById('add-path-modal');
    const form = document.getElementById('add-path-form');
    const title = document.querySelector('#add-path-modal h3');
    
    form.reset();
    editingPathName = null;
    
    if (path) {
        title.textContent = 'Edit Path';
        editingPathName = path.name;
        document.querySelector('input[name="name"]').value = path.name;
        document.querySelector('input[name="name"]').disabled = true;
        document.querySelector('input[name="source"]').value = path.source || '';
        document.querySelector('input[name="source_on_demand"]').checked = path.source_on_demand !== false;
    } else {
        title.textContent = 'Add New Path';
        document.querySelector('input[name="name"]').disabled = false;
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

window.editPath = function(name) {
    const path = allPaths.find(p => p.name === name);
    if (path) {
        openPathModal(path);
    }
};

// --- Config Global ---

let originalConfig = null;

async function loadConfigGlobal() {
    try {
        const res = await fetchAPI('/server/config');
        if (res.success) {
            originalConfig = res.data;
            document.getElementById('config-global-editor').value = JSON.stringify(res.data, null, 2);
            document.getElementById('config-global-status').classList.add('hidden');
        }
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
        document.getElementById('config-global-editor').value = 'Failed to load configuration';
    }
}

function saveConfigGlobal() {
    const editor = document.getElementById('config-global-editor');
    const statusEl = document.getElementById('config-global-status');
    
    try {
        const config = JSON.parse(editor.value);
        
        fetchAPI('/server/config', {
            method: 'PATCH',
            body: JSON.stringify(config),
        }).then(res => {
            if (res.success) {
                originalConfig = config;
                statusEl.textContent = 'Configuration saved successfully';
                statusEl.className = 'mt-4 text-sm text-green-600';
                statusEl.classList.remove('hidden');
            } else {
                throw new Error('Failed to save');
            }
        }).catch(err => {
            statusEl.textContent = `Error: ${err.message}`;
            statusEl.className = 'mt-4 text-sm text-red-600';
            statusEl.classList.remove('hidden');
        });
    } catch (e) {
        statusEl.textContent = 'Invalid JSON format';
        statusEl.className = 'mt-4 text-sm text-red-600';
        statusEl.classList.remove('hidden');
    }
}

function resetConfigGlobal() {
    if (originalConfig) {
        document.getElementById('config-global-editor').value = JSON.stringify(originalConfig, null, 2);
        document.getElementById('config-global-status').classList.add('hidden');
    }
}

// --- Actions ---

window.deletePath = async function(name) {
    if (!confirm(`Delete path "${name}"?`)) return;
    try {
        await fetchAPI(`/paths/${encodeURIComponent(name)}`, { method: 'DELETE' });
        loadPaths();
    } catch (e) {
        showError(e.message);
        alert(`Failed to delete: ${e.message}`);
    }
};

window.kickSession = async function(type, id) {
    if (!confirm(`Kick session ${type}/${id}?`)) return;
    try {
        await fetchAPI(`/sessions/${type}/${id}/kick`, { method: 'POST' });
        loadDashboard();
    } catch (e) {
        showError(e.message);
        alert(`Failed to kick: ${e.message}`);
    }
};

// --- Modal Handling ---

const modal = document.getElementById('add-path-modal');
const form = document.getElementById('add-path-form');


document.getElementById('cancel-path-btn')?.addEventListener('click', () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
});

form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = fd.get('name');
    const source = fd.get('source') || null;
    const source_on_demand = fd.get('source_on_demand') === 'on';
    
    try {
        if (editingPathName) {
            // Edit existing path
            await fetchAPI(`/paths/${encodeURIComponent(editingPathName)}`, {
                method: 'PATCH',
                body: JSON.stringify({ source, source_on_demand }),
            });
        } else {
            // Add new path
            await fetchAPI('/paths', {
                method: 'POST',
                body: JSON.stringify({ name, source, source_on_demand }),
            });
        }
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        loadPaths();
    } catch (e) {
        showError(e.message);
        alert(`Failed to ${editingPathName ? 'update' : 'add'} path: ${e.message}`);
    }
});

// Paths search
// Handled by bindPageEvents

// Config Global buttons
// Handled by bindPageEvents

// --- Config Path Defaults ---

let originalDefaults = null;

async function loadConfigDefaults() {
    try {
        const res = await fetchAPI('/config/path-defaults');
        if (res.success) {
            originalDefaults = res.data;
            document.getElementById('config-defaults-editor').value = JSON.stringify(res.data, null, 2);
            document.getElementById('config-defaults-status').classList.add('hidden');
        }
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
        document.getElementById('config-defaults-editor').value = 'Failed to load configuration';
    }
}

function saveConfigDefaults() {
    const editor = document.getElementById('config-defaults-editor');
    const statusEl = document.getElementById('config-defaults-status');
    
    try {
        const config = JSON.parse(editor.value);
        
        fetchAPI('/config/path-defaults', {
            method: 'PATCH',
            body: JSON.stringify(config),
        }).then(res => {
            if (res.success) {
                originalDefaults = config;
                statusEl.textContent = 'Configuration saved successfully';
                statusEl.className = 'mt-4 text-sm text-green-600';
                statusEl.classList.remove('hidden');
            } else {
                throw new Error('Failed to save');
            }
        }).catch(err => {
            statusEl.textContent = `Error: ${err.message}`;
            statusEl.className = 'mt-4 text-sm text-red-600';
            statusEl.classList.remove('hidden');
        });
    } catch (e) {
        statusEl.textContent = 'Invalid JSON format';
        statusEl.className = 'mt-4 text-sm text-red-600';
        statusEl.classList.remove('hidden');
    }
}

function resetConfigDefaults() {
    if (originalDefaults) {
        document.getElementById('config-defaults-editor').value = JSON.stringify(originalDefaults, null, 2);
        document.getElementById('config-defaults-status').classList.add('hidden');
    }
}

// --- Runtime Pages ---

function renderConnections(tbodyId, connections) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (!connections || connections.length === 0) {
        const cols = tbody.closest('table')?.querySelector('thead tr')?.children.length || 1;
        tbody.innerHTML = `<tr><td colspan="${cols}" class="px-6 py-12 text-center text-gray-500">No connections</td></tr>`;
        return;
    }

    tbody.innerHTML = connections.map(c => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 font-mono text-sm">${escapeHtml(c.id || '-')}</td>
            <td class="px-6 py-4 text-sm text-gray-600">${escapeHtml(c.remoteAddr || c.remote_addr || '-')}</td>
            <td class="px-6 py-4 font-mono text-sm">${escapeHtml(c.path || '-')}</td>
            <td class="px-6 py-4 text-sm font-mono">${formatBytes(c.bytesReceived || c.bytes_received || 0)}</td>
            <td class="px-6 py-4 text-sm font-mono">${formatBytes(c.bytesSent || c.bytes_sent || 0)}</td>
        </tr>
    `).join('');
}

function renderSessions(tbodyId, sessions) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (!sessions || sessions.length === 0) {
        const cols = tbody.closest('table')?.querySelector('thead tr')?.children.length || 1;
        tbody.innerHTML = `<tr><td colspan="${cols}" class="px-6 py-12 text-center text-gray-500">No sessions</td></tr>`;
        return;
    }

    tbody.innerHTML = sessions.map(s => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 font-mono text-sm">${escapeHtml(s.id || '-')}</td>
            <td class="px-6 py-4 text-sm text-gray-600">${escapeHtml(s.remoteAddr || s.remote_addr || '-')}</td>
            <td class="px-6 py-4 font-mono text-sm">${escapeHtml(s.path || '-')}</td>
            <td class="px-6 py-4 text-sm">
                <span class="status-badge ${s.ready ? 'status-online' : 'status-offline'}">
                    ${s.ready ? 'Ready' : s.state || 'Unknown'}
                </span>
            </td>
        </tr>
    `).join('');
}

async function loadRuntimeHLS() {
    try {
        const [connections, sessions] = await Promise.all([
            fetchAPI('/runtime/hls/connections'),
            fetchAPI('/runtime/hls/sessions'),
        ]);
        
        if (connections.success) renderConnections('hls-connections-body', connections.data.items || []);
        if (sessions.success) renderSessions('hls-sessions-body', sessions.data.items || []);
        
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
    }
}

async function loadRuntimeRTSP() {
    try {
        const [connections, sessions] = await Promise.all([
            fetchAPI('/runtime/rtsp/connections'),
            fetchAPI('/runtime/rtsp/sessions'),
        ]);
        
        if (connections.success) renderConnections('rtsp-connections-body', connections.data.items || []);
        if (sessions.success) renderSessions('rtsp-sessions-body', sessions.data.items || []);
        
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
    }
}

async function loadRuntimeRTMP() {
    try {
        const [connections, sessions] = await Promise.all([
            fetchAPI('/runtime/rtmp/connections'),
            fetchAPI('/runtime/rtmp/sessions'),
        ]);
        
        if (connections.success) renderConnections('rtmp-connections-body', connections.data.items || []);
        if (sessions.success) renderSessions('rtmp-sessions-body', sessions.data.items || []);
        
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
    }
}

// --- Runtime Logs ---

let allLogs = [];

async function loadRuntimeLogs() {
    try {
        const res = await fetchAPI('/logs?lines=500');
        if (res.success) {
            allLogs = res.data.lines || [];
            renderLogs(allLogs);
        }
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
        document.getElementById('logs-body').innerHTML = '<tr><td colspan="3" class="px-6 py-12 text-center text-red-600">Failed to load logs</td></tr>';
    }
}

function renderLogs(logs) {
    const tbody = document.getElementById('logs-body');
    const searchTerm = document.getElementById('logs-search')?.value.toLowerCase() || '';
    const levelFilter = document.getElementById('logs-level-filter')?.value || '';
    
    const filtered = logs.filter(log => {
        const message = (log.message || '').toLowerCase();
        const level = (log.level || '').toUpperCase();
        const matchesSearch = !searchTerm || message.includes(searchTerm);
        const matchesLevel = !levelFilter || level === levelFilter;
        return matchesSearch && matchesLevel;
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="px-6 py-12 text-center text-gray-500">No log entries found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(log => {
        const level = (log.level || '').toUpperCase();
        let levelClass = 'text-gray-600';
        if (level === 'ERROR') levelClass = 'text-red-600';
        else if (level === 'WARN') levelClass = 'text-yellow-600';
        else if (level === 'INFO') levelClass = 'text-blue-600';
        else if (level === 'DEBUG') levelClass = 'text-gray-500';
        
        return `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-3 text-gray-500 whitespace-nowrap">${escapeHtml(log.timestamp || '-')}</td>
                <td class="px-6 py-3"><span class="font-medium ${levelClass}">${escapeHtml(level)}</span></td>
                <td class="px-6 py-3 text-gray-900 max-w-2xl truncate block">${escapeHtml(log.message || '-')}</td>
            </tr>
        `;
    }).join('');
}

// Fragment-specific controls are registered by bindPageEvents() after loading.

// --- Auto Refresh ---

function startAutoRefresh() {
    stopAutoRefresh();
    refreshInterval = setInterval(() => {
        loadPageData(currentPage);
    }, 5000);
}

function stopAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
}

document.getElementById('refresh-btn').addEventListener('click', () => {
    loadPageData(currentPage);
});

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    
    // Handle hash changes
    window.addEventListener('hashchange', handleHashChange);
    
    // Initial page load
    const initialPage = getPageFromHash();
    navigateToPage(initialPage);
    
    startAutoRefresh();
});

// Cleanup on page unload
window.addEventListener('beforeunload', stopAutoRefresh);