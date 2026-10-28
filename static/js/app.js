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
    const knownPages = ['dashboard', 'paths', 'config-global', 'config-defaults', 'runtime-hls', 'runtime-rtsp', 'runtime-rtmp', 'runtime-logs', 'config-paths'];
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
        document.getElementById('config-global-save-form')?.addEventListener('click', saveConfigGlobalForm);
        document.getElementById('config-global-save-json')?.addEventListener('click', saveConfigGlobalJSON);
        document.getElementById('config-global-reset')?.addEventListener('click', resetConfigGlobal);
    }
    if (page === 'config-defaults') {
        document.getElementById('config-defaults-form')?.addEventListener('submit', (event) => {
            event.preventDefault();
            saveConfigDefaults();
        });
        document.getElementById('config-defaults-reset')?.addEventListener('click', resetConfigDefaults);
        document.getElementById('config-defaults-form')?.addEventListener('input', (event) => {
            if (event.target.matches('[data-config-key]')) {
                event.currentTarget.dataset.dirty = 'true';
            }
        });
    }
    if (page === 'runtime-logs') {
        document.getElementById('logs-search')?.addEventListener('input', () => renderLogs(allLogs));
        document.getElementById('logs-level-filter')?.addEventListener('change', () => renderLogs(allLogs));
        document.getElementById('logs-refresh')?.addEventListener('click', loadRuntimeLogs);
    }
    if (page === 'config-paths') {
        document.getElementById('config-paths-add-btn')?.addEventListener('click', () => openConfigPathModal());
        document.getElementById('config-paths-search')?.addEventListener('input', () => renderConfigPaths(allConfigPaths));
        document.getElementById('config-paths-refresh')?.addEventListener('click', loadConfigPaths);
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
            await loadConfigPaths();
            break;
    }
}

function formatUptimeFromStart(started) {
    if (!started) return '-';
    const startTime = new Date(started).getTime();
    const now = Date.now();
    const diffMs = now - startTime;
    if (diffMs <= 0) return '-';
    return formatUptime(Math.floor(diffMs / 1000));
}

// --- Dashboard ---

async function loadDashboard() {
    let anySuccess = false;
    
    // 1. Streams summary (Total/Online/Offline streams, viewers, traffic)
    try {
        const summary = await fetchAPI('/streams/summary');
        if (summary.success) {
            renderSummary(summary.data);
            anySuccess = true;
        } else {
            renderSummaryError();
        }
    } catch (e) {
        showError('streams/summary: ' + e.message);
        renderSummaryError();
    }

    // 2. Streams list (table)
    try {
        const streams = await fetchAPI('/streams');
        if (streams.success) {
            renderStreams(streams.data.items);
        } else {
            renderStreamsError();
        }
    } catch (e) {
        showError('streams: ' + e.message);
        renderStreamsError();
    }

    // 3. Sessions from all protocols (table)
    try {
        const sessions = await fetchAPI('/sessions');
        if (sessions.success) {
            renderSessions(sessions.data.items);
        } else {
            renderSessionsError();
        }
    } catch (e) {
        showError('sessions: ' + e.message);
        renderSessionsError();
    }

    // 4. Server health (version, connection status, uptime from started)
    try {
        const health = await fetchAPI('/server/health');
        if (health.success) {
            renderServerStatus(health.data);
        } else {
            renderServerStatusError();
        }
    } catch (e) {
        showError('server/health: ' + e.message);
        renderServerStatusError();
    }

    // 5. Total Paths from config paths endpoint
    try {
        const paths = await fetchAPI('/paths');
        if (paths.success) {
            const pathCount = (paths.data.items || []).length;
            document.getElementById('server-total-paths').textContent = formatNumber(pathCount);
        } else {
            document.getElementById('server-total-paths').textContent = '-';
        }
    } catch (e) {
        showError('paths: ' + e.message);
        document.getElementById('server-total-paths').textContent = '-';
    }

    // 6. Active paths and total readers already rendered by summary
    // (server-active-paths, server-total-readers, server-traffic)
    
    setConnectionStatus(anySuccess);
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

function renderSummaryError() {
    document.getElementById('stat-total').textContent = '-';
    document.getElementById('stat-online').textContent = '-';
    document.getElementById('stat-offline').textContent = '-';
    document.getElementById('stat-viewers').textContent = '-';
    document.getElementById('server-traffic').textContent = '- / -';
    document.getElementById('server-total-readers').textContent = '-';
    document.getElementById('server-active-paths').textContent = '-';
}

function renderStreamsError() {
    const tbody = document.getElementById('streams-table-body');
    const countEl = document.getElementById('streams-count');
    countEl.textContent = 'Error';
    tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-12 text-center text-red-600">Failed to load streams</td></tr>';
}

function renderSessionsError() {
    const tbody = document.getElementById('sessions-table-body');
    const countEl = document.getElementById('sessions-count');
    countEl.textContent = 'Error';
    tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-12 text-center text-red-600">Failed to load sessions</td></tr>';
}

function renderServerStatusError() {
    const statusEl = document.getElementById('server-connection-status');
    statusEl.textContent = 'Error';
    statusEl.className = 'px-3 py-1 text-sm rounded-lg bg-red-100 text-red-800';
    document.getElementById('server-version').textContent = '-';
    document.getElementById('server-uptime').textContent = '-';
}

function renderServerStatus(health) {
    const connected = health.connected === true;
    const statusEl = document.getElementById('server-connection-status');
    statusEl.textContent = connected ? 'Connected' : 'Disconnected';
    statusEl.className = `px-3 py-1 text-sm rounded-lg ${connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`;
    
    document.getElementById('server-version').textContent = health.version || 'unknown';
    // Use 'started' field from MediaMTX /info endpoint to calculate uptime
    document.getElementById('server-uptime').textContent = formatUptimeFromStart(health.started);
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
    const title = document.getElementById('path-modal-title');
    const submitBtn = document.getElementById('path-submit-btn');
    
    form.reset();
    editingPathName = null;
    
    // Reset field visibility
    updateSourceTypeFields('publisher');
    
    if (path) {
        title.textContent = 'Edit Path';
        submitBtn.textContent = 'Save Changes';
        editingPathName = path.name;
        
        const nameInput = document.querySelector('input[name="name"]');
        nameInput.value = path.name;
        nameInput.disabled = true;
        
        // Determine source type from existing path data
        let sourceType = 'publisher';
        if (path.source_redirect) {
            sourceType = 'redirect';
        } else if (path.source) {
            sourceType = 'url';
        }
        
        document.getElementById('path-source-type').value = sourceType;
        updateSourceTypeFields(sourceType);
        
        // Fill in the fields
        if (path.source) {
            // Only fill source if it's not a masked password URL
            const sourceInput = document.querySelector('input[name="source"]');
            if (!path.source.includes(':***@')) {
                sourceInput.value = path.source;
            }
        }
        if (path.source_redirect) {
            document.querySelector('input[name="source_redirect"]').value = path.source_redirect;
        }
        document.querySelector('input[name="source_on_demand"]').checked = path.source_on_demand !== false;
        if (path.source_on_demand_start_timeout) {
            document.querySelector('input[name="source_on_demand_start_timeout"]').value = path.source_on_demand_start_timeout;
        }
        if (path.source_on_demand_close_after) {
            document.querySelector('input[name="source_on_demand_close_after"]').value = path.source_on_demand_close_after;
        }
        if (path.max_readers !== null && path.max_readers !== undefined) {
            document.querySelector('input[name="max_readers"]').value = path.max_readers;
        }
        if (path.fallback) {
            document.querySelector('input[name="fallback"]').value = path.fallback;
        }
    } else {
        title.textContent = 'Add New Path';
        submitBtn.textContent = 'Add Path';
        document.querySelector('input[name="name"]').disabled = false;
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function updateSourceTypeFields(sourceType) {
    const sourceUrlField = document.getElementById('source-url-field');
    const redirectTargetField = document.getElementById('redirect-target-field');
    const onDemandFieldset = document.getElementById('on-demand-fieldset');
    const onDemandTimeoutField = document.getElementById('on-demand-timeout-field');
    const onDemandCloseField = document.getElementById('on-demand-close-field');
    const sourceOnDemandCheckbox = document.getElementById('source_on_demand');
    
    // Guard: elements may not exist if modal not yet rendered
    if (!sourceUrlField || !redirectTargetField || !onDemandFieldset || !sourceOnDemandCheckbox) {
        return;
    }
    
    // Hide all conditional fields first
    sourceUrlField.classList.add('hidden');
    redirectTargetField.classList.add('hidden');
    onDemandFieldset.classList.add('hidden');
    if (onDemandTimeoutField) onDemandTimeoutField.classList.add('hidden');
    if (onDemandCloseField) onDemandCloseField.classList.add('hidden');
    
    // Remove required attributes
    sourceUrlField.querySelector('input')?.removeAttribute('required');
    redirectTargetField.querySelector('input')?.removeAttribute('required');
    
    if (sourceType === 'url') {
        sourceUrlField.classList.remove('hidden');
        sourceUrlField.querySelector('input')?.setAttribute('required', 'true');
        onDemandFieldset.classList.remove('hidden');
        
        // Show/hide timeout fields based on checkbox
        if (sourceOnDemandCheckbox.checked) {
            if (onDemandTimeoutField) onDemandTimeoutField.classList.remove('hidden');
            if (onDemandCloseField) onDemandCloseField.classList.remove('hidden');
        }
    } else if (sourceType === 'redirect') {
        redirectTargetField.classList.remove('hidden');
        redirectTargetField.querySelector('input')?.setAttribute('required', 'true');
    }
    // For publisher, no extra fields needed
}

// Event listeners for modal fields (initialized after DOM ready)
function initPathModalEvents() {
    const sourceTypeSelect = document.getElementById('path-source-type');
    const sourceOnDemandCheckbox = document.getElementById('source_on_demand');
    
    if (sourceTypeSelect) {
        sourceTypeSelect.addEventListener('change', (e) => {
            updateSourceTypeFields(e.target.value);
        });
    }
    
    if (sourceOnDemandCheckbox) {
        sourceOnDemandCheckbox.addEventListener('change', (e) => {
            const onDemandTimeoutField = document.getElementById('on-demand-timeout-field');
            const onDemandCloseField = document.getElementById('on-demand-close-field');
            if (e.target.checked) {
                onDemandTimeoutField?.classList.remove('hidden');
                onDemandCloseField?.classList.remove('hidden');
            } else {
                onDemandTimeoutField?.classList.add('hidden');
                onDemandCloseField?.classList.add('hidden');
            }
        });
    }
}

window.editPath = function(name) {
    const path = allPaths.find(p => p.name === name);
    if (path) {
        openPathModal(path);
    }
};

// --- Config Path Modal (Add/Edit) ---

let editingConfigPathName = null;

function openConfigPathModal(path = null) {
    // Reuse the same modal but with config-paths context
    const modal = document.getElementById('add-path-modal');
    const form = document.getElementById('add-path-form');
    const title = document.getElementById('path-modal-title');
    const submitBtn = document.getElementById('path-submit-btn');
    
    form.reset();
    editingConfigPathName = null;
    
    // Reset field visibility
    updateSourceTypeFields('publisher');
    
    if (path) {
        title.textContent = 'Edit Path Configuration';
        submitBtn.textContent = 'Save Changes';
        editingConfigPathName = path.name;
        
        const nameInput = document.querySelector('input[name="name"]');
        nameInput.value = path.name;
        nameInput.disabled = true;
        
        // Determine source type from existing path data
        let sourceType = 'publisher';
        if (path.source_redirect) {
            sourceType = 'redirect';
        } else if (path.source) {
            sourceType = 'url';
        }
        
        document.getElementById('path-source-type').value = sourceType;
        updateSourceTypeFields(sourceType);
        
        // Fill in the fields
        if (path.source && !path.source.includes(':***@')) {
            document.querySelector('input[name="source"]').value = path.source;
        }
        if (path.source_redirect) {
            document.querySelector('input[name="source_redirect"]').value = path.source_redirect;
        }
        document.querySelector('input[name="source_on_demand"]').checked = path.source_on_demand !== false;
        if (path.source_on_demand_start_timeout) {
            document.querySelector('input[name="source_on_demand_start_timeout"]').value = path.source_on_demand_start_timeout;
        }
        if (path.source_on_demand_close_after) {
            document.querySelector('input[name="source_on_demand_close_after"]').value = path.source_on_demand_close_after;
        }
        if (path.max_readers !== null && path.max_readers !== undefined) {
            document.querySelector('input[name="max_readers"]').value = path.max_readers;
        }
        if (path.fallback) {
            document.querySelector('input[name="fallback"]').value = path.fallback;
        }
    } else {
        title.textContent = 'Add Path Configuration';
        submitBtn.textContent = 'Add Path';
        document.querySelector('input[name="name"]').disabled = false;
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// --- Config Global ---

let originalConfig = null;
let originalDefaults = null;

function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in current) || current[key] === null || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((o, k) => (o || {})[k], obj);
}

function parseFormValue(name, value) {
    // Handle special types
    if (name === 'logDestinations' || name === 'rtspTransports' || name === 'api.trustedProxies' || name === 'api.corsOrigin') {
        if (name === 'api.trustedProxies' || name === 'api.corsOrigin') {
            return value.split(',').map(s => s.trim()).filter(Boolean);
        }
        return value; // already array from multi-select
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === '' || value === null) return null;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;
    return value;
}

async function loadConfigGlobal() {
    try {
        const res = await fetchAPI('/server/config');
        if (res.success) {
            originalConfig = res.data;
            
            // Populate form fields
            populateConfigGlobalForm(res.data);
            
            // Populate JSON editor
            document.getElementById('config-global-editor').value = JSON.stringify(res.data, null, 2);
            document.getElementById('config-global-form-status').classList.add('hidden');
            document.getElementById('config-global-json-status').classList.add('hidden');
        }
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
        document.getElementById('config-global-editor').value = 'Failed to load configuration';
    }
}

function populateConfigGlobalForm(config) {
    const form = document.querySelector('#page-config-global');
    if (!form) return;
    
    // Simple fields
    const simpleFields = [
        'logLevel', 'logFormat', 'readTimeout', 'writeTimeout', 'readHeaderTimeout',
        'rtspAddress', 'rtmpAddress', 'hlsAddress', 'webrtcAddress', 'srtAddress', 'playbackAddress',
        'rtpAddress', 'rtcpAddress',
        'webrtcICEHostNAT1To1', 'webrtcICEUDPMulticastAddress', 'webrtcICEPortRange', 'webrtcAdditionalHosts',
        'srtLatency', 'srtMaxBandwidth',
        'hlsAllowOrigin', 'hlsSegmentCount', 'hlsSegmentDuration', 'hlsPartDuration'
    ];
    
    simpleFields.forEach(name => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el) {
            const value = getNestedValue(config, name);
            if (value !== undefined && value !== null) {
                if (el.type === 'checkbox') {
                    el.checked = value;
                } else if (el.multiple) {
                    // multi-select handled separately
                } else {
                    el.value = value;
                }
            }
        }
    });
    
    // Multi-select fields
    ['logDestinations', 'rtspTransports'].forEach(name => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el) {
            const value = getNestedValue(config, name);
            if (Array.isArray(value)) {
                Array.from(el.options).forEach(opt => {
                    opt.selected = value.includes(opt.value);
                });
            }
        }
    });
    
    // Nested API fields
    const apiFields = ['enabled', 'address', 'encryption', 'authentication', 'trustedProxies', 'corsOrigin'];
    apiFields.forEach(name => {
        const el = form.querySelector(`[name="api.${name}"]`);
        if (el) {
            const value = getNestedValue(config, `api.${name}`);
            if (value !== undefined && value !== null) {
                if (el.multiple || name === 'trustedProxies' || name === 'corsOrigin') {
                    if (Array.isArray(value)) {
                        el.value = value.join(', ');
                    } else if (typeof value === 'string') {
                        el.value = value;
                    }
                } else {
                    el.value = value;
                }
            }
        }
    });
    
    // Metrics
    ['metrics.enabled', 'metrics.address', 'metrics.encryption'].forEach(name => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el) {
            const value = getNestedValue(config, name);
            if (value !== undefined && value !== null) {
                el.value = value;
            }
        }
    });
    
    // PPROF
    ['pprof.enabled', 'pprof.address'].forEach(name => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el) {
            const value = getNestedValue(config, name);
            if (value !== undefined && value !== null) {
                el.value = value;
            }
        }
    });
    
    // WebRTC encryption
    const webrtcEncEl = form.querySelector('[name="webrtcEncryption"]');
    if (webrtcEncEl) {
        const value = getNestedValue(config, 'webrtcEncryption');
        if (value !== undefined && value !== null) {
            webrtcEncEl.value = value;
        }
    }
    
    // SRT encryption
    const srtEncEl = form.querySelector('[name="srtEncryption"]');
    if (srtEncEl) {
        const value = getNestedValue(config, 'srtEncryption');
        if (value !== undefined && value !== null) {
            srtEncEl.value = value;
        }
    }
    
    // HLS encryption
    const hlsEncEl = form.querySelector('[name="hlsEncryption"]');
    if (hlsEncEl) {
        const value = getNestedValue(config, 'hlsEncryption');
        if (value !== undefined && value !== null) {
            hlsEncEl.value = value;
        }
    }
}

function collectConfigGlobalForm() {
    const form = document.querySelector('#page-config-global');
    if (!form) return {};
    
    const formData = new FormData(form);
    const updates = {};
    
    for (const [name, value] of formData.entries()) {
        const parsed = parseFormValue(name, value);
        if (parsed !== null) {
            setNestedValue(updates, name, parsed);
        }
    }
    
    // Handle multi-selects that FormData doesn't capture well
    ['logDestinations', 'rtspTransports'].forEach(name => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el) {
            const selected = Array.from(el.selectedOptions).map(o => o.value);
            if (selected.length > 0) {
                setNestedValue(updates, name, selected);
            }
        }
    });
    
    // Handle comma-separated fields
    ['api.trustedProxies', 'api.corsOrigin'].forEach(name => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el && el.value.trim()) {
            setNestedValue(updates, name, el.value.split(',').map(s => s.trim()).filter(Boolean));
        }
    });
    
    return updates;
}

async function saveConfigGlobalForm() {
    const statusEl = document.getElementById('config-global-form-status');
    const btn = document.getElementById('config-global-save-form');
    
    btn.disabled = true;
    btn.textContent = 'Saving...';
    
    try {
        const updates = collectConfigGlobalForm();
        const mergedConfig = { ...originalConfig, ...updates };
        
        const res = await fetchAPI('/server/config', {
            method: 'PATCH',
            body: JSON.stringify(mergedConfig),
        });
        
        if (res.success) {
            originalConfig = res.data;
            populateConfigGlobalForm(res.data);
            document.getElementById('config-global-editor').value = JSON.stringify(res.data, null, 2);
            statusEl.textContent = 'Configuration saved successfully';
            statusEl.className = 'mt-4 text-sm text-green-600';
        } else {
            throw new Error('Failed to save');
        }
    } catch (e) {
        statusEl.textContent = `Error: ${e.message}`;
        statusEl.className = 'mt-4 text-sm text-red-600';
    } finally {
        statusEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Save Form';
    }
}

async function saveConfigGlobalJSON() {
    const editor = document.getElementById('config-global-editor');
    const statusEl = document.getElementById('config-global-json-status');
    const btn = document.getElementById('config-global-save-json');
    
    btn.disabled = true;
    btn.textContent = 'Saving...';
    
    try {
        const config = JSON.parse(editor.value);
        const res = await fetchAPI('/server/config', {
            method: 'PATCH',
            body: JSON.stringify(config),
        });
        
        if (res.success) {
            originalConfig = res.data;
            populateConfigGlobalForm(res.data);
            editor.value = JSON.stringify(res.data, null, 2);
            statusEl.textContent = 'Configuration saved successfully';
            statusEl.className = 'mt-3 text-sm text-green-600';
        } else {
            throw new Error('Failed to save');
        }
    } catch (e) {
        statusEl.textContent = `Error: ${e.message}`;
        statusEl.className = 'mt-3 text-sm text-red-600';
    } finally {
        statusEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Save JSON';
    }
}

function resetConfigGlobal() {
    if (originalConfig) {
        populateConfigGlobalForm(originalConfig);
        document.getElementById('config-global-editor').value = JSON.stringify(originalConfig, null, 2);
        document.getElementById('config-global-form-status').classList.add('hidden');
        document.getElementById('config-global-json-status').classList.add('hidden');
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
    const sourceType = fd.get('source_type');
    
    // Build payload based on source type
    const payload = {
        name,
        source_type: sourceType,
    };
    
    if (sourceType === 'url') {
        const source = fd.get('source');
        if (!source) {
            alert('Source URL is required for URL Source type');
            return;
        }
        payload.source = source;
        payload.source_on_demand = fd.get('source_on_demand') === 'on';
        if (payload.source_on_demand) {
            const startTimeout = fd.get('source_on_demand_start_timeout');
            const closeAfter = fd.get('source_on_demand_close_after');
            if (startTimeout) payload.source_on_demand_start_timeout = startTimeout;
            if (closeAfter) payload.source_on_demand_close_after = closeAfter;
        }
    } else if (sourceType === 'redirect') {
        const redirectTarget = fd.get('source_redirect');
        if (!redirectTarget) {
            alert('Redirect target is required for Redirect type');
            return;
        }
        payload.source_redirect = redirectTarget;
    }
    // For publisher, no source needed
    
    // Common optional fields
    const maxReaders = fd.get('max_readers');
    if (maxReaders !== '' && maxReaders !== null) {
        const val = parseInt(maxReaders, 10);
        if (isNaN(val) || val < 0) {
            alert('Max readers must be a non-negative integer');
            return;
        }
        payload.max_readers = val;
    }
    
    const fallback = fd.get('fallback');
    if (fallback) payload.fallback = fallback;
    
    try {
        const isEditing = editingPathName || editingConfigPathName;
        const editingName = editingPathName || editingConfigPathName;
        
        if (isEditing) {
            // Edit existing path - don't send name, and don't send source if it wasn't changed (to preserve masked passwords)
            const editPayload = { ...payload };
            delete editPayload.name;
            delete editPayload.source_type;
            
            // If source is a masked password, don't send it
            if (editPayload.source && editPayload.source.includes(':***@')) {
                delete editPayload.source;
            }
            if (editPayload.source_redirect && editPayload.source_redirect.includes(':***@')) {
                delete editPayload.source_redirect;
            }
            if (editPayload.fallback && editPayload.fallback.includes(':***@')) {
                delete editPayload.fallback;
            }
            
            await fetchAPI(`/paths/${encodeURIComponent(editingName)}`, {
                method: 'PATCH',
                body: JSON.stringify(editPayload),
            });
        } else {
            // Add new path
            await fetchAPI('/paths', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
        }
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        loadPaths();
        // Also refresh config-paths if that's the current page
        if (currentPage === 'config-paths') {
            loadConfigPaths();
        }
    } catch (e) {
        showError(e.message);
        const isEditing = editingPathName || editingConfigPathName;
        alert(`Failed to ${isEditing ? 'update' : 'add'} path: ${e.message}`);
    }
});

// Paths search
// Handled by bindPageEvents

// Config Global buttons
// Handled by bindPageEvents

// --- Config Paths ---

let allConfigPaths = [];

async function loadConfigPaths() {
    try {
        const paths = await fetchAPI('/paths');
        if (paths.success) {
            allConfigPaths = paths.data.items;
            renderConfigPaths(allConfigPaths);
        }
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
    }
}

function renderConfigPaths(paths) {
    const tbody = document.getElementById('config-paths-table-body');
    const searchTerm = document.getElementById('config-paths-search')?.value.toLowerCase() || '';
    
    const filtered = paths.filter(p => 
        p.name.toLowerCase().includes(searchTerm) || 
        (p.source && p.source.toLowerCase().includes(searchTerm)) ||
        (p.fallback && p.fallback.toLowerCase().includes(searchTerm)) ||
        (p.source_redirect && p.source_redirect.toLowerCase().includes(searchTerm))
    );
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-12 text-center text-gray-500">No paths found</td></tr>';
        return;
    }

    const columnsFromHeaders = Array.from(
        tbody.closest('table').querySelectorAll('thead [data-config-path-column]'),
        header => header.dataset.configPathColumn,
    );
    const columns = columnsFromHeaders.length
        ? columnsFromHeaders
        : ['name', 'type', 'source', 'fallback', 'on-demand', 'max-readers', 'actions'];

    tbody.innerHTML = filtered.map(p => {
        // Determine source type for display
        let sourceType = 'Publisher';
        let sourceDisplay = '(publisher)';
        if (p.source_redirect) {
            sourceType = 'Redirect';
            sourceDisplay = p.source_redirect;
        } else if (p.source) {
            sourceType = 'URL Source';
            sourceDisplay = p.source;
        }
        
        const cellRenderers = {
            name: path => `<td class="px-6 py-4 font-mono text-sm">${escapeHtml(path.name)}</td>`,
            type: () => `
                <td class="px-6 py-4 text-sm">
                    <span class="status-badge ${sourceType === 'Publisher' ? 'status-offline' : sourceType === 'URL Source' ? 'status-online' : 'bg-purple-100 text-purple-800'}">
                        ${sourceType}
                    </span>
                </td>`,
            source: () => `<td class="px-6 py-4 text-sm text-gray-600 max-w-xs overflow-hidden"><span class="block truncate">${escapeHtml(sourceDisplay)}</span></td>`,
            fallback: path => `<td class="px-6 py-4 text-sm text-gray-600 max-w-xs overflow-hidden"><span class="block truncate">${escapeHtml(path.fallback || '-')}</span></td>`,
            'on-demand': path => `
                <td class="px-6 py-4 text-sm">
                    <span class="status-badge ${path.source_on_demand ? 'status-online' : 'status-offline'}">
                        ${path.source_on_demand ? 'Yes' : 'No'}
                    </span>
                </td>`,
            'max-readers': path => `<td class="px-6 py-4 text-sm">${path.max_readers !== null && path.max_readers !== undefined ? path.max_readers : 'Unlimited'}</td>`,
            actions: path => `
                <td class="px-6 py-4 text-right whitespace-nowrap">
                    <button onclick="editConfigPath('${escapeHtml(path.name)}')" class="btn-icon btn-primary mr-2">Edit</button>
                    <button onclick="deleteConfigPath('${escapeHtml(path.name)}')" class="btn-icon btn-danger">Delete</button>
                </td>`,
        };

        return `
            <tr class="hover:bg-gray-50">
                ${columns.map(column => cellRenderers[column]?.(p) || '<td></td>').join('')}
            </tr>
        `;
    }).join('');
}

window.editConfigPath = function(name) {
    const path = allConfigPaths.find(p => p.name === name);
    if (path) {
        openConfigPathModal(path);
    }
};

window.deleteConfigPath = async function(name) {
    if (!confirm(`Delete path "${name}"?`)) return;
    try {
        await fetchAPI(`/paths/${encodeURIComponent(name)}`, { method: 'DELETE' });
        loadConfigPaths();
    } catch (e) {
        showError(e.message);
        alert(`Failed to delete: ${e.message}`);
    }
};

async function loadConfigDefaults() {
    try {
        const res = await fetchAPI('/config/path-defaults');
        if (!res.success || !res.data || typeof res.data !== 'object' || Array.isArray(res.data)) {
            throw new Error(res.message || 'MediaMTX returned an invalid Path Defaults configuration');
        }

        const form = document.getElementById('config-defaults-form');
        const hasUnsavedChanges = form?.dataset.dirty === 'true';
        const changedOnServer = JSON.stringify(res.data) !== JSON.stringify(originalDefaults);
        if (!hasUnsavedChanges && (originalDefaults === null || changedOnServer)) {
            originalDefaults = res.data;
            renderConfigDefaults(res.data);
            if (form) form.dataset.dirty = 'false';
            setConfigDefaultsStatus('', '');
        }
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConnectionStatus(false);
        setConfigDefaultsStatus(`Failed to load Path Defaults: ${e.message}`, 'error');
    }
}

function getPathDefaultsGroup(key) {
    if (key.startsWith('runOn')) return 'Lifecycle Commands';
    if (key.startsWith('record')) return 'Recording';
    if (key.startsWith('alwaysAvailable') || key === 'maxReaders' || key === 'useAbsoluteTimestamp' || key === 'srtReadPassphrase') {
        return 'Readers & Tracks';
    }
    if (key.startsWith('rpiCamera')) return 'Raspberry Pi Camera';
    if (key === 'name' || key === 'source' || key.startsWith('source') || key === 'forward') {
        return 'Source';
    }
    if (key.startsWith('rtsp') || key.startsWith('rtmp') || key.startsWith('srt') || key.startsWith('whep') || key.startsWith('moq') || key === 'rtpSDP') {
        return 'Protocol Options';
    }
    return 'General';
}

function getPathDefaultsLabel(key) {
    if (key === 'runOnUnDemand') return 'Run On Un-Demand';
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (character) => character.toUpperCase());
}

function getPathDefaultsKind(key, value) {
    if (Array.isArray(value)) return 'array';
    if (value !== null && typeof value === 'object') return 'object';
    if (value === null) return 'null';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    throw new Error(`Unsupported Path Defaults value for "${key}"`);
}

function isPathDefaultsDuration(key, value) {
    return typeof value === 'string' &&
        (/timeout|closeafter|duration/i.test(key) || /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:ns|us|µs|μs|ms|s|m|h)/.test(value));
}

function renderPathDefaultsField(key, value) {
    const kind = getPathDefaultsKind(key, value);
    const label = getPathDefaultsLabel(key);
    const tooltip = `MediaMTX field: ${key} (${kind})`;
    const attributes = `data-config-key="${escapeHtml(key)}" data-config-kind="${kind}"`;

    if (kind === 'boolean') {
        return `
            <div class="min-w-0">
                <label class="inline-flex cursor-pointer items-center gap-3 pt-2">
                    <input type="checkbox" ${attributes} ${value ? 'checked' : ''} class="peer sr-only">
                    <span class="relative h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5"></span>
                    <span class="text-sm font-medium text-gray-700">${escapeHtml(label)}</span>
                    <span class="cursor-help text-gray-400" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">
                        <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM9 8a1 1 0 1 1 2 0c0 .55-.25.79-.71 1.16-.58.46-1.29 1.04-1.29 2.34a1 1 0 1 0 2 0c0-.34.08-.48.54-.85C12.12 10.1 13 9.39 13 8a3 3 0 1 0-6 0 1 1 0 1 0 2 0Zm1 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"></path>
                        </svg>
                    </span>
                </label>
            </div>
        `;
    }

    const valueText = kind === 'array' || kind === 'object'
        ? JSON.stringify(value, null, 2)
        : value === null ? '' : String(value);
    const duration = kind === 'string' && isPathDefaultsDuration(key, value);
    const inputClass = 'w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
    let control;

    if (kind === 'array' || kind === 'object' || key.startsWith('runOn') || key === 'rtpSDP') {
        control = `<textarea ${attributes} rows="${kind === 'array' || kind === 'object' ? 4 : 3}" class="${inputClass} font-mono" spellcheck="false">${escapeHtml(valueText)}</textarea>`;
    } else if (kind === 'number') {
        const step = Number.isInteger(value) ? '1' : 'any';
        control = `<input ${attributes} type="number" step="${step}" value="${escapeHtml(valueText)}" class="${inputClass}">`;
    } else {
        const placeholder = duration ? 'e.g. 10s or 1h30m' : '';
        control = `<input ${attributes} type="text" value="${escapeHtml(valueText)}" placeholder="${placeholder}" ${kind === 'null' ? 'data-config-null="true"' : ''} class="${inputClass}">`;
    }

    return `
        <label class="block min-w-0">
            <span class="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                ${escapeHtml(label)}
                <span class="cursor-help text-gray-400" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">
                    <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM9 8a1 1 0 1 1 2 0c0 .55-.25.79-.71 1.16-.58.46-1.29 1.04-1.29 2.34a1 1 0 1 0 2 0c0-.34.08-.48.54-.85C12.12 10.1 13 9.39 13 8a3 3 0 1 0-6 0 1 1 0 1 0 2 0Zm1 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"></path>
                    </svg>
                </span>
            </span>
            ${control}
            ${duration ? '<span class="mt-1 block text-xs text-gray-500">Enter a MediaMTX duration, such as 10s or 1h30m.</span>' : ''}
        </label>
    `;
}

function renderConfigDefaults(config) {
    const container = document.getElementById('config-defaults-fields');
    if (!container) return;

    const groups = new Map();
    Object.entries(config).forEach(([key, value]) => {
        const group = getPathDefaultsGroup(key);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push([key, value]);
    });

    if (groups.size === 0) {
        container.innerHTML = '<div class="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">MediaMTX returned no Path Defaults fields.</div>';
        return;
    }

    container.innerHTML = Array.from(groups.entries()).map(([group, fields]) => `
        <section class="min-w-0 rounded-lg border border-gray-200 bg-white p-5 sm:p-6">
            <h3 class="mb-5 text-lg font-semibold text-gray-900">${escapeHtml(group)}</h3>
            <div class="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                ${fields.map(([key, value]) => renderPathDefaultsField(key, value)).join('')}
            </div>
        </section>
    `).join('');
}

function setConfigDefaultsStatus(message, type) {
    const status = document.getElementById('config-defaults-status');
    if (!status) return;
    status.textContent = message;
    status.className = `text-sm ${type === 'error' ? 'text-red-600' : type === 'success' ? 'text-green-700' : 'hidden'}`;
}

function parsePathDefaultsDuration(value, key) {
    const durationPattern = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:ns|us|µs|μs|ms|s|m|h)/g;
    const parts = value.match(durationPattern);
    if (!parts || parts.join('') !== value) {
        throw new Error(`${getPathDefaultsLabel(key)} must be a valid duration, such as 10s or 1h30m.`);
    }
    return value;
}

function validatePathDefaultsValueShape(expected, value, path) {
    if (Array.isArray(expected)) {
        if (!Array.isArray(value)) throw new Error(`${path} must be a JSON array.`);
        if (expected.length > 0) {
            value.forEach((item, index) => validatePathDefaultsValueShape(expected[0], item, `${path}[${index}]`));
        }
        return;
    }

    if (expected !== null && typeof expected === 'object') {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`${path} must be a JSON object.`);
        }
        Object.entries(expected).forEach(([key, expectedValue]) => {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                validatePathDefaultsValueShape(expectedValue, value[key], `${path}.${key}`);
            }
        });
        return;
    }

    if (expected === null ? value !== null : typeof value !== typeof expected) {
        throw new Error(`${path} must have the same value type as the loaded MediaMTX configuration.`);
    }
    if (typeof expected === 'number' && Number.isInteger(expected) && !Number.isInteger(value)) {
        throw new Error(`${path} must be an integer.`);
    }
}

function collectConfigDefaults() {
    const form = document.getElementById('config-defaults-form');
    const controls = Array.from(form.querySelectorAll('[data-config-key]'));
    const values = {};

    Object.entries(originalDefaults).forEach(([key, originalValue]) => {
        const control = controls.find((candidate) => candidate.dataset.configKey === key);
        if (!control) throw new Error(`Missing form field for "${key}".`);

        const kind = control.dataset.configKind;
        if (kind === 'boolean') {
            values[key] = control.checked;
        } else if (kind === 'number') {
            if (control.value.trim() === '') {
                throw new Error(`${getPathDefaultsLabel(key)} must be a number.`);
            }
            const numberValue = Number(control.value);
            if (!Number.isFinite(numberValue) || (Number.isInteger(originalValue) && !Number.isInteger(numberValue))) {
                throw new Error(`${getPathDefaultsLabel(key)} must be a valid ${Number.isInteger(originalValue) ? 'integer' : 'number'}.`);
            }
            values[key] = numberValue;
        } else if (kind === 'array' || kind === 'object') {
            let parsed;
            try {
                parsed = JSON.parse(control.value);
            } catch {
                throw new Error(`${getPathDefaultsLabel(key)} must contain valid JSON.`);
            }
            if (kind === 'array' ? !Array.isArray(parsed) : parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error(`${getPathDefaultsLabel(key)} must remain a JSON ${kind}.`);
            }
            validatePathDefaultsValueShape(originalValue, parsed, getPathDefaultsLabel(key));
            values[key] = parsed;
        } else if (kind === 'null' && control.dataset.configNull === 'true' && control.value === '') {
            values[key] = null;
        } else {
            const value = control.value;
            values[key] = isPathDefaultsDuration(key, originalValue)
                ? parsePathDefaultsDuration(value, key)
                : value;
        }
    });

    return values;
}

async function saveConfigDefaults() {
    const form = document.getElementById('config-defaults-form');
    const saveButton = document.getElementById('config-defaults-save');

    try {
        const config = collectConfigDefaults();
        saveButton.disabled = true;
        saveButton.classList.add('opacity-60', 'cursor-not-allowed');

        const res = await fetchAPI('/config/path-defaults', {
            method: 'PATCH',
            body: JSON.stringify(config),
        });
        if (!res.success) throw new Error(res.message || 'MediaMTX did not apply the Path Defaults configuration');

        const latest = await fetchAPI('/config/path-defaults');
        if (!latest.success || !latest.data || typeof latest.data !== 'object' || Array.isArray(latest.data)) {
            throw new Error('The runtime accepted the update, but the updated values could not be reloaded for confirmation.');
        }

        originalDefaults = latest.data;
        renderConfigDefaults(originalDefaults);
        form.dataset.dirty = 'false';
        setConfigDefaultsStatus(
            'Path Defaults updated in the MediaMTX runtime. This change is not written to mediamtx.yml and will be lost after a MediaMTX restart.',
            'success'
        );
        setConnectionStatus(true);
    } catch (e) {
        showError(e.message);
        setConfigDefaultsStatus(`Unable to update Path Defaults: ${e.message}`, 'error');
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.classList.remove('opacity-60', 'cursor-not-allowed');
        }
    }
}

function resetConfigDefaults() {
    if (originalDefaults !== null) {
        renderConfigDefaults(originalDefaults);
        document.getElementById('config-defaults-form').dataset.dirty = 'false';
        setConfigDefaultsStatus('', '');
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
    initPathModalEvents();
    
    // Handle hash changes
    window.addEventListener('hashchange', handleHashChange);
    
    // Initial page load
    const initialPage = getPageFromHash();
    navigateToPage(initialPage);
    
    startAutoRefresh();
});

// Cleanup on page unload
window.addEventListener('beforeunload', stopAutoRefresh);
