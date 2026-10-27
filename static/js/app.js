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

function navigateToPage(page) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    
    // Show target page
    const targetPage = document.getElementById(`page-${page}`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('nav-active');
        if (link.dataset.page === page) {
            link.classList.add('nav-active');
        }
    });

    // Update page title
    document.getElementById('page-title').textContent = pageTitleMap[page] || 'Dashboard';

    // Set current page
    currentPage = page;

    // Load page data
    loadPageData(page);
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
        // Placeholder pages - no data loading needed
        case 'config-paths':
        case 'config-defaults':
        case 'runtime-hls':
        case 'runtime-rtsp':
        case 'runtime-rtmp':
        case 'runtime-logs':
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
        if (health.success && config.success) renderServer(health.data, config.data);

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
}

function renderStreams(streams) {
    const tbody = document.getElementById('streams-table-body');
    const countEl = document.getElementById('streams-count');
    
    countEl.textContent = `${streams.length} stream${streams.length !== 1 ? 's' : ''}`;
    
    if (streams.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-12 text-center text-gray-500">No active streams</td></tr>';
        return;
    }

    tbody.innerHTML = streams.map(s => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 font-mono text-sm">${escapeHtml(s.name)}</td>
            <td class="px-6 py-4">
                <span class="status-badge ${s.ready ? 'status-online' : 'status-offline'}">
                    ${s.ready ? 'Online' : 'Offline'}
                </span>
            </td>
            <td class="px-6 py-4 text-sm text-gray-600 max-w-xs truncate block">
                ${s.tracks.map(t => `${t.codec}${t.width ? ` ${t.width}x${t.height}` : ''}${t.fps ? `@${t.fps}fps` : ''}`).join(', ') || '-'}
            </td>
            <td class="px-6 py-4 text-sm">${formatNumber(s.readers)}</td>
            <td class="px-6 py-4 text-sm font-mono">${formatBytes(s.bytes_received)}</td>
            <td class="px-6 py-4 text-sm font-mono">${formatBytes(s.bytes_sent)}</td>
        </tr>
    `).join('');
}

function renderSessions(sessions) {
    // Sessions are shown on dashboard now, could add a separate section if needed
    console.log('Sessions:', sessions);
}

function renderServer(health, config) {
    // Server info could be shown in a collapsible section
    console.log('Server health:', health);
    console.log('Server config:', config);
}

// --- Paths ---

async function loadPaths() {
    try {
        const paths = await fetchAPI('/paths');
        if (paths.success) {
            renderPaths(paths.data.items);
        }
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
    }
}

function renderPaths(paths) {
    const tbody = document.getElementById('paths-table-body');
    
    if (paths.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-12 text-center text-gray-500">No paths configured</td></tr>';
        return;
    }

    tbody.innerHTML = paths.map(p => `
        <tr class="hover:bg-gray-50">
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
        loadPaths();
    } catch (e) {
        showError(e.message);
        alert(`Failed to add path: ${e.message}`);
    }
});

// Config Global buttons
document.getElementById('config-global-save').addEventListener('click', saveConfigGlobal);
document.getElementById('config-global-reset').addEventListener('click', resetConfigGlobal);

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