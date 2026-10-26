/* Konsol MediaMTX: frontend tanpa framework.
   Semua data diambil dari backend FastAPI (/api/...).
   Navigasi memakai alamat hash (#/kamera, #/protokol/rtsp, ...), jadi setiap
   halaman bisa dibuka langsung, di tab baru, atau di jendela tersendiri (?solo=1). */

"use strict";

const REFRESH_MS = 5000;
const TOKEN_KEY = "mtx_token";
const SOLO = new URLSearchParams(location.search).has("solo");

const state = {
  token: null,
  user: null,
  info: { webrtc_url: "http://localhost:8889" },
  overview: null,
  cameras: [],
  streams: [],
  filter: "all",
  watching: new Set(),     // kamera yang sedang ditonton di dinding
  editing: null,           // nama kamera yang sedang diedit (null = tambah baru)
  route: null,
  page: null,
  timer: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ================= util ================= */

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function pathUrl(name) {
  return name.split("/").map(encodeURIComponent).join("/");
}

function bytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function since(iso) {
  if (!iso) return "–";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function dateTime(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function uptime(iso) {
  if (!iso) return "–";
  let s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d) return `${d} hari ${h} jam`;
  if (h) return `${h} jam ${m} menit`;
  return `${m} menit`;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 3000);
}

function showFormError(form, msg) {
  const el = $(".form-error", form);
  el.textContent = msg || "";
  el.hidden = !msg;
}

function isAdmin() {
  return state.user?.role === "admin";
}

function labelFor(path) {
  const cam = state.cameras.find(c => c.name === path);
  return cam?.label || "";
}

function pathCell(path) {
  if (!path) return "–";
  const label = labelFor(path);
  return label ? `${esc(label)} <span class="you">(${esc(path)})</span>` : esc(path);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand("copy"); } finally { ta.remove(); }
  }
  toast("Disalin");
}

/* ================= API ================= */

class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

async function api(method, url, body) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Backend tidak bisa dihubungi. Pastikan uvicorn masih berjalan.", 0);
  }

  let json = null;
  try { json = await res.json(); } catch { /* bukan JSON */ }

  if (res.status === 401 && url !== "/api/auth/login") {
    logout("Sesi login berakhir. Silakan masuk lagi.");
    throw new ApiError("Belum login", 401);
  }
  if (!res.ok || (json && json.success === false)) {
    let msg = json?.message || `Permintaan gagal (${res.status})`;
    if (Array.isArray(json?.data) && json.data[0]?.message) {
      msg += ": " + json.data.map(e => `${e.field || "data"} ${e.message}`).join("; ");
    }
    throw new ApiError(msg, res.status, json?.data);
  }
  return json?.data;
}

/* ================= login ================= */

function setToken(token) {
  state.token = token;
  try {
    token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY);
  } catch { /* penyimpanan browser tidak tersedia */ }
}

function showLogin(message) {
  stopRefresh();
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
  showFormError($("#login-form"), message || "");
  $("#login-username").focus();
}

function logout(message) {
  setToken(null);
  state.user = null;
  state.watching.clear();
  state.route = null;
  $("#page").innerHTML = "";
  showLogin(message);
}

$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = $("button[type=submit]", form);
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  if (!username || !password) return showFormError(form, "Isi username dan password.");

  btn.disabled = true;
  try {
    const data = await api("POST", "/api/auth/login", { username, password });
    setToken(data.access_token);
    $("#login-password").value = "";
    await startApp();
  } catch (err) {
    showFormError(form, err.message);
  } finally {
    btn.disabled = false;
  }
});

$("#btn-logout").addEventListener("click", () => logout());

/* ================= kerangka & navigasi ================= */

async function startApp() {
  state.user = await api("GET", "/api/auth/me");
  try { state.info = { ...state.info, ...(await api("GET", "/api/info")) }; } catch { /* pakai default */ }

  document.body.classList.toggle("solo", SOLO);
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  $("#account-name").innerHTML = `<b>${esc(state.user.username)}</b> (${isAdmin() ? "admin" : "viewer"})`;
  $$(".admin-only").forEach(el => (el.hidden = !isAdmin()));
  onRoute();
  startRefresh();
}

function parseRoute() {
  const r = location.hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  return r || "ringkasan";
}

function onRoute() {
  if (!state.user) return;
  let route = parseRoute();
  let page = resolvePage(route);
  if (!page || (page.adminOnly && !isAdmin())) { route = "ringkasan"; page = resolvePage(route); }

  state.route = route;
  state.page = page;
  closeMenu();

  $$(".side-nav a").forEach(a => {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  document.title = `${page.title} · Konsol MediaMTX`;
  $("#mobile-title").textContent = page.title;
  $("#page-title").innerHTML = esc(page.title) + (page.titleExtra ? page.titleExtra() : "");
  $("#page-desc").textContent = page.desc || "";

  const actions = $("#page-actions");
  actions.innerHTML = (page.actions ? page.actions() : "") +
    (SOLO ? "" : `<button class="btn btn-quiet" id="btn-popout" title="Buka halaman ini di jendela tersendiri tanpa panel kiri">Buka di jendela baru</button>`);
  const pop = $("#btn-popout");
  if (pop) pop.addEventListener("click", () => {
    const url = `${location.pathname}?solo=1${location.hash || "#/"}`;
    window.open(url, `mtx-${route.replace(/\W/g, "-")}`, "popup,width=1180,height=800");
  });

  const el = $("#page");
  el.innerHTML = "";
  page.mount(el);
  $("#main").scrollTop = 0;
  window.scrollTo(0, 0);
  refreshNow();
}

window.addEventListener("hashchange", onRoute);

function startRefresh() {
  stopRefresh();
  state.timer = setInterval(() => { if (!document.hidden) refreshNow(); }, REFRESH_MS);
}
function stopRefresh() {
  clearInterval(state.timer);
  state.timer = null;
}

async function refreshNow() {
  const page = state.page;
  const route = state.route;
  const tasks = [refreshSidebar()];
  if (page?.refresh) tasks.push(page.refresh().catch(err => {
    if (err.status !== 401 && state.route === route) toast(err.message, true);
  }));
  await Promise.all(tasks);
}

async function refreshSidebar() {
  const el = $("#server-state");
  try {
    const [ov, cams] = await Promise.all([api("GET", "/api/overview"), api("GET", "/api/cameras")]);
    state.overview = ov;
    state.cameras = cams;
    const on = ov.mediamtx_reachable;
    el.className = "server-state " + (on ? "on" : "off");
    const ver = ov.info?.version ? ` ${ov.info.version}` : "";
    $(".text", el).textContent = on
      ? (state.info.mock ? "Mode data tiruan" : `MediaMTX${ver} terhubung`)
      : "MediaMTX tidak terhubung";
    el.title = ov.error || "";

    const set = (key, val) => { const c = $(`[data-count="${key}"]`); if (c) c.textContent = val; };
    set("kamera", ov.cameras.live ? String(ov.cameras.live) : "");
    set("path", ov.paths.total ? String(ov.paths.total) : "");
    ov.protocols.forEach(p => {
      set(p.id, p.active ? String(p.active) : "");
      const lamp = $(`[data-lamp="${p.id}"]`);
      if (lamp) {
        lamp.className = "lamp " + (p.enabled === false ? "off" : p.enabled ? "on" : "");
        lamp.title = p.enabled === false ? "Nonaktif" : p.enabled ? "Aktif" : "";
      }
    });
  } catch (err) {
    if (err.status === 401) return;
    el.className = "server-state off";
    $(".text", el).textContent = "Backend tidak terhubung";
  }
}

/* menu panel kiri di layar kecil */
function closeMenu() {
  $("#sidebar").classList.remove("open");
  $("#scrim").hidden = true;
  $("#btn-menu").setAttribute("aria-expanded", "false");
}
$("#btn-menu").addEventListener("click", () => {
  const open = !$("#sidebar").classList.contains("open");
  $("#sidebar").classList.toggle("open", open);
  $("#scrim").hidden = !open;
  $("#btn-menu").setAttribute("aria-expanded", String(open));
});
$("#scrim").addEventListener("click", closeMenu);

/* tombol aksi di kepala halaman (dipasang per halaman) */
$("#page-actions").addEventListener("click", e => {
  const btn = e.target.closest("[data-action]");
  if (btn && state.page?.onAction) state.page.onAction(btn.dataset.action, btn);
});

/* ================= daftar halaman ================= */

function resolvePage(route) {
  if (route.startsWith("protokol/")) {
    const id = route.slice("protokol/".length);
    return PROTO_INFO[id] ? protocolPage(id) : null;
  }
  return PAGES[route] || null;
}

const SOURCE_TYPES = {
  rtspSession: "Dikirim lewat RTSP", rtspsSession: "Dikirim lewat RTSPS",
  rtmpConn: "Dikirim lewat RTMP", rtmpsConn: "Dikirim lewat RTMPS",
  srtConn: "Dikirim lewat SRT", webRTCSession: "Dikirim lewat WebRTC",
  rtspSource: "Ditarik dari RTSP", rtspsSource: "Ditarik dari RTSPS",
  rtmpSource: "Ditarik dari RTMP", rtmpsSource: "Ditarik dari RTMPS",
  srtSource: "Ditarik dari SRT", hlsSource: "Ditarik dari HLS",
  udpSource: "Diterima lewat UDP", mpegtsSource: "Diterima lewat UDP",
  webRTCSource: "Ditarik dari WebRTC", rpiCameraSource: "Kamera Raspberry Pi",
};
function sourceLabel(t) { return t ? (SOURCE_TYPES[t] || t) : "Belum ada sumber"; }

/* ================= ringkasan ================= */

const PAGES = {};

PAGES.ringkasan = {
  title: "Ringkasan",
  desc: "Keadaan server MediaMTX, protokol, dan kamera saat ini.",
  mount(el) {
    el.innerHTML = `
      <div class="instance" id="ov-instance"></div>
      <section class="section">
        <div class="section-head"><h2>Protokol</h2></div>
        <p class="section-note">Angka besar adalah koneksi atau sesi yang sedang aktif. Klik untuk membuka halaman protokolnya.</p>
        <div class="patchbay" id="ov-patchbay"></div>
      </section>
      <div class="two-col section">
        <section>
          <div class="section-head"><h2>Kamera</h2><a href="#/kamera">Buka dinding kamera</a></div>
          <ul class="live-list" id="ov-cams"></ul>
        </section>
        <section>
          <div class="section-head"><h2>Path aktif</h2><a href="#/path">Semua path</a></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Path</th><th>Status</th><th>Sumber</th><th class="num">Penonton</th></tr></thead>
            <tbody id="ov-paths"></tbody>
          </table></div>
        </section>
      </div>`;
  },
  async refresh() {
    const streams = await api("GET", "/api/streams").catch(() => []);
    state.streams = streams;
    const ov = state.overview;
    if (!ov || state.route !== "ringkasan") return;

    $("#ov-instance").innerHTML = ov.mediamtx_reachable ? `
      <div>Versi MediaMTX<b>${esc(ov.info?.version || "tidak diketahui")}</b></div>
      <div>Berjalan sejak<b>${ov.info?.started ? esc(uptime(ov.info.started)) : "–"}</b></div>
      <div>Kamera live<b>${ov.cameras.live} dari ${ov.cameras.total}</b></div>
      <div>Path online<b>${ov.paths.online} dari ${ov.paths.total}</b></div>
      <div>Penonton<b>${ov.paths.readers}</b></div>`
      : `<div class="unavailable">MediaMTX tidak bisa dihubungi. Pastikan mediamtx.exe berjalan dan <code>api: yes</code> di mediamtx.yml.</div>`;

    $("#ov-patchbay").innerHTML = ov.protocols.map(p => {
      const lamp = p.enabled === false ? "off" : p.enabled ? "on" : "";
      const addr = p.addresses.map(a => a.address).join("  ");
      return `<a class="jack" href="#/protokol/${p.id}">
        <span class="jack-name"><span class="lamp ${lamp}"></span>${esc(p.title)}</span>
        <span class="jack-num ${p.active ? "" : "zero"}">${p.available ? p.active : "–"}</span>
        <span class="jack-label">${p.enabled === false ? "Nonaktif" : p.available ? "aktif sekarang" : "Tidak tersedia di versi ini"}</span>
        <span class="jack-addr">${esc(addr || " ")}</span>
      </a>`;
    }).join("") || `<p class="unavailable" style="grid-column:1/-1;margin:1rem">Data protokol belum tersedia.</p>`;

    const cams = [...state.cameras].sort((a, b) => (b.status.online - a.status.online) || a.name.localeCompare(b.name));
    $("#ov-cams").innerHTML = cams.length ? cams.slice(0, 8).map(c => `
      <li>
        <span class="tag ${c.status.online ? "live" : ""}">${c.status.online ? "Live" : c.enabled ? "Offline" : "Nonaktif"}</span>
        <span class="who">${esc(c.label || c.name)}</span>
        <span class="sub">${c.status.online ? `${c.status.readers} menonton` : ""}</span>
      </li>`).join("")
      : `<li><span class="sub" style="margin:0">Belum ada kamera. <a href="#/kamera">Tambah kamera</a></span></li>`;

    const top = [...streams].sort((a, b) => (b.online - a.online) || (b.readers - a.readers)).slice(0, 8);
    $("#ov-paths").innerHTML = top.length ? top.map(s => `
      <tr>
        <td>${pathCell(s.name)}</td>
        <td><span class="badge ${s.online ? "live" : ""}">${s.online ? "Online" : "Offline"}</span></td>
        <td>${esc(sourceLabel(s.source_type))}</td>
        <td class="num">${s.readers}</td>
      </tr>`).join("") : `<tr><td colspan="4" class="you">Belum ada path di MediaMTX.</td></tr>`;
  },
};

/* ================= kamera ================= */

PAGES.kamera = {
  title: "Kamera",
  desc: "Dinding monitor semua kamera yang tersimpan. Lampu merah menandakan stream sedang masuk.",
  actions() {
    return isAdmin()
      ? `<button class="btn btn-quiet" data-action="sync" title="Daftarkan ulang semua kamera ke MediaMTX">Daftarkan ulang</button>
         <button class="btn btn-primary" data-action="add">Tambah kamera</button>`
      : "";
  },
  mount(el) {
    el.innerHTML = `
      <div class="toolbar">
        <div class="filter" role="group" aria-label="Saring kamera">
          <button class="chip" data-filter="all">Semua</button>
          <button class="chip" data-filter="live">Live</button>
          <button class="chip" data-filter="offline">Tidak live</button>
        </div>
      </div>
      <div id="wall" class="wall"></div>
      <div id="wall-empty" class="empty" hidden></div>
      <div id="other-streams" class="other" hidden>
        <h2>Stream lain di server</h2>
        <p class="hint">Stream ini aktif di MediaMTX tapi belum tersimpan sebagai kamera, misalnya ditulis langsung di mediamtx.yml.</p>
        <ul id="other-list" class="other-list"></ul>
      </div>`;
    $$(".chip", el).forEach(c => c.setAttribute("aria-pressed", String(c.dataset.filter === state.filter)));

    el.addEventListener("click", async e => {
      const chip = e.target.closest(".chip");
      if (chip) {
        state.filter = chip.dataset.filter;
        $$(".chip", el).forEach(c => c.setAttribute("aria-pressed", String(c === chip)));
        return renderWall();
      }
      if (e.target.closest("#wall-empty [data-act=add]")) return openCameraDialog();

      const save = e.target.closest("#other-list button[data-name]");
      if (save) return saveStreamAsCamera(save);

      const btn = e.target.closest(".tile [data-act]");
      if (!btn) return;
      const tile = btn.closest(".tile");
      const cam = state.cameras.find(c => c.name === tile.dataset.name);
      const act = btn.dataset.act;
      if (act === "watch") { state.watching.add(cam.name); updateTile(tile, cam); }
      else if (act === "stop") {
        state.watching.delete(cam.name);
        $(".screen-body", tile).dataset.key = "";
        updateTile(tile, cam);
      }
      else if (act === "edit") openCameraDialog(cam);
      else if (act === "delete") deleteCamera(cam);
    });
  },
  async refresh() {
    const [cameras, streams] = await Promise.all([
      api("GET", "/api/cameras"),
      api("GET", "/api/streams").catch(() => []),
    ]);
    if (state.route !== "kamera") return;
    state.cameras = cameras;
    state.streams = streams;
    renderWall();
    renderOtherStreams();
  },
  async onAction(action, btn) {
    if (action === "add") return openCameraDialog();
    if (action === "sync") {
      btn.disabled = true;
      try {
        const r = await api("POST", "/api/cameras/sync?full=true");
        const failed = r.failed.length ? `, ${r.failed.length} gagal: ${r.failed.map(f => f.name).join(", ")}` : "";
        toast(`Didaftarkan ulang: ${r.added.length} ditambah, ${r.updated.length} diperbarui${failed}`, r.failed.length > 0);
        await refreshNow();
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    }
  },
};

function cameraVisible(c) {
  if (state.filter === "live") return c.status.online;
  if (state.filter === "offline") return !c.status.online;
  return true;
}

function screenMessage(c) {
  if (!c.enabled) return `<div class="screen-msg"><strong>Dinonaktifkan</strong>Kamera tersimpan tapi tidak didaftarkan ke MediaMTX.</div>`;
  if (!c.status.mediamtx_reachable) return `<div class="screen-msg"><strong>Server tidak terhubung</strong>Status kamera belum bisa dibaca.</div>`;
  if (!c.status.registered) return `<div class="screen-msg"><strong>Belum terdaftar</strong>Akan didaftarkan otomatis dalam beberapa detik.</div>`;
  if (!c.status.online) {
    return c.source === "publisher"
      ? `<div class="screen-msg"><strong>Tidak ada sinyal</strong>Menunggu stream dikirim ke path <code>${esc(c.name)}</code>.</div>`
      : `<div class="screen-msg"><strong>Tidak ada sinyal</strong>${c.source_on_demand ? "Kamera dihubungkan saat ada yang menonton." : "Kamera belum terhubung."}</div>`;
  }
  return `<button class="watch" data-act="watch">Tonton</button>`;
}

function tileHtml() {
  const actions = isAdmin()
    ? `<div class="tile-actions">
         <button class="btn btn-link" data-act="edit">Ubah</button>
         <button class="btn btn-link danger" data-act="delete">Hapus</button>
       </div>`
    : "";
  return `
    <div class="screen">
      <span class="tally"></span>
      <span class="viewers" hidden></span>
      <div class="screen-body"></div>
    </div>
    <div class="tile-info">
      <div>
        <h3 class="tile-title"></h3>
        <p class="tile-meta"></p>
      </div>
      ${actions}
    </div>`;
}

/* Tile diperbarui di tempat (tidak dibuat ulang) supaya video yang sedang
   ditonton tidak ikut ter-reload setiap kali data di-refresh. */
function renderWall() {
  const wall = $("#wall");
  if (!wall) return;
  const shown = state.cameras.filter(cameraVisible);
  const keep = new Set(shown.map(c => c.name));

  $$(".tile", wall).forEach(t => { if (!keep.has(t.dataset.name)) t.remove(); });

  shown.forEach((c, i) => {
    let tile = $$(".tile", wall).find(t => t.dataset.name === c.name);
    if (!tile) {
      tile = document.createElement("article");
      tile.className = "tile";
      tile.dataset.name = c.name;
      tile.innerHTML = tileHtml();
    }
    if (wall.children[i] !== tile) wall.insertBefore(tile, wall.children[i] || null);
    updateTile(tile, c);
  });

  const empty = $("#wall-empty");
  if (state.cameras.length === 0) {
    empty.innerHTML = `<strong>Belum ada kamera</strong>
      Tambahkan kamera IP atau path untuk stream dari OBS/FFmpeg, lalu statusnya akan tampil di sini.
      ${isAdmin() ? `<br><button class="btn btn-primary" data-act="add">Tambah kamera</button>` : ""}`;
    empty.hidden = false;
  } else if (shown.length === 0) {
    empty.innerHTML = state.filter === "live"
      ? "<strong>Tidak ada kamera yang live</strong>Kamera muncul di sini begitu stream-nya masuk."
      : "<strong>Semua kamera sedang live</strong>";
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
}

function updateTile(tile, c) {
  const online = c.status.online;
  tile.classList.toggle("live", online);
  tile.classList.toggle("disabled", !c.enabled);
  $(".tally", tile).textContent = online ? "Live" : (c.enabled ? "Offline" : "Nonaktif");

  const v = $(".viewers", tile);
  v.hidden = !online;
  v.textContent = `${c.status.readers} menonton`;

  $(".tile-title", tile).textContent = c.label || c.name;
  const metaParts = [];
  if (c.label) metaParts.push(`<code>${esc(c.name)}</code>`);
  if (c.location) metaParts.push(esc(c.location));
  if (!c.label && !c.location) metaParts.push(c.source === "publisher" ? "Dikirim ke server" : "Kamera IP");
  $(".tile-meta", tile).innerHTML = metaParts.join(", ");

  const body = $(".screen-body", tile);
  const watching = state.watching.has(c.name) && online;
  if (watching) {
    if (!$("iframe", tile)) {
      const src = `${state.info.webrtc_url.replace(/\/$/, "")}/${pathUrl(c.name)}/?controls=false&muted=true&autoplay=true&playsinline=true`;
      body.innerHTML = `<iframe src="${esc(src)}" title="Video ${esc(c.label || c.name)}" allow="autoplay; fullscreen"></iframe>
        <button class="stop" data-act="stop">Berhenti menonton</button>`;
    }
  } else {
    if (!online) state.watching.delete(c.name);
    const key = `${online}|${c.enabled}|${c.status.registered}|${c.status.mediamtx_reachable}`;
    if (body.dataset.key !== key || $("iframe", tile)) {
      body.innerHTML = screenMessage(c);
      body.dataset.key = key;
    }
  }
}

function renderOtherStreams() {
  const known = new Set(state.cameras.map(c => c.name));
  const others = state.streams.filter(s => !known.has(s.name));
  $("#other-streams").hidden = others.length === 0;
  $("#other-list").innerHTML = others.map(s => `
    <li>
      <span class="name">${esc(s.name)}</span>
      <span class="state ${s.online ? "live" : ""}">${s.online ? `Live, ${s.readers} menonton` : "Tidak live"}</span>
      ${isAdmin() ? `<button class="btn btn-quiet" data-name="${esc(s.name)}">Simpan sebagai kamera</button>` : ""}
    </li>`).join("");
}

async function saveStreamAsCamera(btn) {
  btn.disabled = true;
  try {
    await api("POST", "/api/cameras", { name: btn.dataset.name, label: btn.dataset.name });
    toast(`Kamera "${btn.dataset.name}" disimpan`);
    await refreshNow();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
  }
}

/* ================= path ================= */

PAGES.path = {
  title: "Path",
  desc: "Semua path yang dikenal MediaMTX saat ini, termasuk yang ditulis langsung di mediamtx.yml.",
  mount(el) {
    el.innerHTML = `
      <div class="table-wrap"><table class="table">
        <thead><tr>
          <th>Path</th><th>Status</th><th>Sumber</th><th>Codec</th>
          <th class="num">Penonton</th><th class="num">Diterima</th><th class="num">Dikirim</th><th>Online sejak</th>
          <th><span class="sr-only">Aksi</span></th>
        </tr></thead>
        <tbody id="path-rows"></tbody>
      </table></div>
      <div id="path-empty" class="empty" hidden><strong>Belum ada path</strong>Path muncul di sini saat kamera ditambahkan atau stream dikirim ke MediaMTX.</div>`;
    el.addEventListener("click", e => {
      const save = e.target.closest("button[data-name]");
      if (save) saveStreamAsCamera(save);
    });
  },
  async refresh() {
    const streams = await api("GET", "/api/streams");
    if (state.route !== "path") return;
    state.streams = streams;
    const saved = new Set(state.cameras.map(c => c.name));
    $("#path-empty").hidden = streams.length > 0;
    $("#path-rows").closest(".table-wrap").hidden = streams.length === 0;
    $("#path-rows").innerHTML = streams.map(s => `
      <tr>
        <td>${pathCell(s.name)}</td>
        <td><span class="badge ${s.online ? "live" : ""}">${s.online ? "Online" : "Offline"}</span></td>
        <td>${esc(sourceLabel(s.source_type))}</td>
        <td>${esc(s.tracks.join(", ") || "–")}</td>
        <td class="num">${s.readers}</td>
        <td class="num">${esc(bytes(s.bytes_received))}</td>
        <td class="num">${esc(bytes(s.bytes_sent))}</td>
        <td>${s.online ? esc(since(s.online_since)) : "–"}</td>
        <td class="actions">
          ${s.online ? `<a class="btn btn-link" href="${esc(s.urls.webrtc)}" target="_blank" rel="noopener">Tonton</a>` : ""}
          ${isAdmin() && !saved.has(s.name) ? `<button class="btn btn-link" data-name="${esc(s.name)}">Simpan sebagai kamera</button>` : ""}
        </td>
      </tr>`).join("");
  },
};

/* ================= rekaman ================= */

PAGES.rekaman = {
  title: "Rekaman",
  desc: "Path yang punya file rekaman di disk server.",
  mount(el) {
    el.innerHTML = `<div id="rec-body"></div>`;
  },
  async refresh() {
    const r = await api("GET", "/api/recordings");
    if (state.route !== "rekaman") return;
    const body = $("#rec-body");
    if (!r.available) {
      body.innerHTML = `<p class="unavailable">Versi MediaMTX ini belum menyediakan daftar rekaman lewat API.</p>`;
      return;
    }
    if (!r.items.length) {
      body.innerHTML = `<div class="empty"><strong>Belum ada rekaman</strong>Centang "Rekam ke disk server" saat mengubah kamera. File rekaman tersimpan di folder recordings di samping mediamtx.exe.</div>`;
      return;
    }
    body.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Path</th><th class="num">Jumlah segmen</th><th>Segmen pertama</th><th>Segmen terakhir</th></tr></thead>
      <tbody>${r.items.map(it => {
        const segs = it.segments || [];
        const first = segs[0]?.start, last = segs[segs.length - 1]?.start;
        return `<tr><td>${pathCell(it.name)}</td><td class="num">${segs.length}</td>
          <td>${esc(dateTime(first))}</td><td>${esc(dateTime(last))} <span class="you">(${esc(since(last))})</span></td></tr>`;
      }).join("")}</tbody></table></div>`;
  },
};

/* ================= halaman per protokol ================= */

const PROTO_INFO = {
  rtsp: {
    desc: "Protokol utama kamera IP / CCTV. Dipakai untuk mengirim dan menonton stream.",
    howto: port => [
      ["Kirim / tonton", `rtsp://${host()}:${port("RTSP", 8554)}/nama-path`],
      ...(port("RTSPS") ? [["Terenkripsi", `rtsps://${host()}:${port("RTSPS")}/nama-path`]] : []),
    ],
  },
  rtmp: {
    desc: "Biasa dipakai OBS dan aplikasi live streaming untuk mengirim stream.",
    howto: port => [
      ["Kirim (OBS)", `rtmp://${host()}:${port("RTMP", 1935)}/nama-path`],
      ["Tonton", `rtmp://${host()}:${port("RTMP", 1935)}/nama-path`],
    ],
  },
  srt: {
    desc: "Protokol tahan gangguan jaringan, cocok untuk kirim stream lewat internet.",
    howto: port => [
      ["Kirim", `srt://${host()}:${port("SRT", 8890)}?streamid=publish:nama-path`],
      ["Tonton", `srt://${host()}:${port("SRT", 8890)}?streamid=read:nama-path`],
    ],
  },
  webrtc: {
    desc: "Menonton langsung di browser dengan jeda paling kecil. Dipakai tombol Tonton di dinding kamera.",
    howto: port => [
      ["Tonton di browser", `http://${host()}:${port("HTTP", 8889)}/nama-path`],
      ["Kirim dari browser", `http://${host()}:${port("HTTP", 8889)}/nama-path/publish`],
    ],
  },
  hls: {
    desc: "Menonton lewat HTTP. Didukung hampir semua perangkat, dengan jeda beberapa detik.",
    howto: port => [
      ["Tonton di browser", `http://${host()}:${port("HTTP", 8888)}/nama-path`],
      ["Playlist (VLC)", `http://${host()}:${port("HTTP", 8888)}/nama-path/index.m3u8`],
    ],
  },
  moq: {
    desc: "Media over QUIC, protokol baru untuk streaming jeda rendah.",
    howto: () => [],
  },
};

function host() { return location.hostname || "localhost"; }

const COLS = {
  path:   ["Kamera", s => pathCell(s.path)],
  state:  ["Peran", s => s.state === "publish" ? `<span class="badge send">Mengirim</span>`
                       : s.state === "read" ? `<span class="badge">Menonton</span>` : esc(s.state || "–")],
  remote: ["Alamat klien", s => esc(s.remoteAddr || "–")],
  trans:  ["Transport", s => esc(s.transport || "–")],
  rx:     ["Diterima", s => esc(bytes(s.bytesReceived)), "num"],
  tx:     ["Dikirim", s => esc(bytes(s.bytesSent)), "num"],
  since:  ["Sejak", s => esc(since(s.created))],
  lastreq:["Diminta terakhir", s => esc(since(s.lastRequest))],
};
const LIST_COLS = {
  rtspsessions: ["path", "state", "remote", "trans", "rx", "tx", "since"],
  rtspssessions: ["path", "state", "remote", "trans", "rx", "tx", "since"],
  rtspconns: ["remote", "rx", "tx", "since"],
  rtspsconns: ["remote", "rx", "tx", "since"],
  hlsmuxers: ["path", "lastreq", "tx", "since"],
};
const DEFAULT_COLS = ["path", "state", "remote", "rx", "tx", "since"];

function protocolPage(id) {
  const info = PROTO_INFO[id];
  const route = `protokol/${id}`;
  let detail = null;
  return {
    title: { rtsp: "RTSP", rtmp: "RTMP", srt: "SRT", webrtc: "WebRTC", hls: "HLS", moq: "MoQ" }[id],
    titleExtra: () => `<span class="state-pill" id="proto-state">…</span>`,
    desc: info.desc,
    mount(el) {
      el.innerHTML = `
        <section class="section">
          <div class="section-head"><h2>Alamat</h2></div>
          <div class="addr-list" id="proto-addr"></div>
        </section>
        <section class="section" id="proto-howto-sec">
          <div class="section-head"><h2>Cara terhubung</h2></div>
          <p class="section-note">Ganti <code>nama-path</code> dengan path kamera. Alamat memakai host yang sedang Anda buka (${esc(host())}).</p>
          <div class="howto" id="proto-howto"></div>
        </section>
        <div id="proto-lists"></div>`;
      el.addEventListener("click", async e => {
        const copy = e.target.closest("[data-copy]");
        if (copy) return copyText(copy.dataset.copy);
        const kick = e.target.closest("[data-kick]");
        if (kick) return kickClient(kick.dataset.kick, kick.dataset.id);
      });
    },
    async refresh() {
      detail = await api("GET", `/api/protocols/${id}`);
      if (state.route !== route) return;

      const pill = $("#proto-state");
      pill.className = "state-pill " + (detail.enabled === false ? "off" : detail.enabled ? "on" : "");
      pill.textContent = detail.enabled === false ? "Nonaktif" : detail.enabled ? "Aktif" : "Status tidak diketahui";

      $("#proto-addr").innerHTML = detail.addresses.length
        ? detail.addresses.map(a => `<span class="addr">${esc(a.label)} <b>${esc(a.address)}</b></span>`).join("")
        : `<span class="you">Alamat hanya terlihat oleh admin atau tidak diatur.</span>`;

      const portOf = (label, fallback) => {
        const a = detail.addresses.find(x => x.label === label);
        const m = a && /:(\d+)$/.exec(a.address);
        return m ? m[1] : fallback;
      };
      const rows = info.howto(portOf);
      $("#proto-howto-sec").hidden = rows.length === 0 || detail.enabled === false;
      $("#proto-howto").innerHTML = rows.map(([label, url]) => `
        <div class="howto-row"><span>${esc(label)}</span><code>${esc(url)}</code>
          <button class="btn btn-link" data-copy="${esc(url)}">Salin</button></div>`).join("");

      const lists = Object.entries(detail.lists);
      $("#proto-lists").innerHTML = lists.map(([name, l]) => {
        const cols = (LIST_COLS[name] || DEFAULT_COLS).map(k => COLS[k]);
        const kick = l.kick && isAdmin();
        let body;
        if (!l.available) body = `<p class="unavailable">Daftar ini tidak tersedia di versi MediaMTX yang dipakai.</p>`;
        else if (!l.items.length) body = `<p class="unavailable">Tidak ada yang terhubung saat ini.</p>`;
        else body = `<div class="table-wrap"><table class="table">
          <thead><tr>${cols.map(c => `<th class="${c[2] || ""}">${c[0]}</th>`).join("")}${kick ? `<th><span class="sr-only">Aksi</span></th>` : ""}</tr></thead>
          <tbody>${l.items.map(s => `<tr>${cols.map(c => `<td class="${c[2] || ""}">${c[1](s)}</td>`).join("")}
            ${kick ? `<td class="actions"><button class="btn btn-link danger" data-kick="${esc(name)}" data-id="${esc(s.id)}">Putuskan</button></td>` : ""}</tr>`).join("")}
          </tbody></table></div>`;
        return `<section class="section"><div class="section-head"><h2>${esc(l.label)} <span class="you">${l.available ? l.items.length : ""}</span></h2></div>${body}</section>`;
      }).join("");
    },
  };
}

async function kickClient(type, id) {
  const ok = await confirmBox("Putuskan koneksi ini?", "Klien bisa terhubung lagi kapan saja.", "Putuskan");
  if (!ok) return;
  try {
    await api("POST", `/api/sessions/${encodeURIComponent(type)}/${encodeURIComponent(id)}/kick`);
    toast("Koneksi diputus");
    await refreshNow();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ================= server (admin) ================= */

const TOGGLES = [
  ["rtsp", "RTSP"], ["rtmp", "RTMP"], ["srt", "SRT"], ["webrtc", "WebRTC"], ["hls", "HLS"], ["moq", "MoQ"],
  ["record", "Rekam semua path (bawaan)"], ["playback", "Server pemutar rekaman"], ["metrics", "Metrics (Prometheus)"],
];

function maskSecrets(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) =>
    typeof v === "string" && /pass|secret|key|token/i.test(k) && v ? "***" : v));
}

PAGES.server = {
  title: "Server",
  desc: "Pengaturan global MediaMTX. Perubahan langsung berlaku tanpa restart, tapi hilang jika MediaMTX di-restart kecuali ditulis juga di mediamtx.yml.",
  adminOnly: true,
  mount(el) {
    el.innerHTML = `
      <section class="section">
        <div class="section-head"><h2>Fitur</h2></div>
        <div class="table-wrap"><table class="table"><tbody id="srv-toggles"></tbody></table></div>
      </section>
      <section class="section">
        <div class="section-head"><h2>Log</h2></div>
        <div class="field-inline">
          <label for="srv-log">Tingkat log</label>
          <select id="srv-log">
            <option value="error">error: hanya kesalahan</option>
            <option value="warn">warn: kesalahan dan peringatan</option>
            <option value="info">info: normal</option>
            <option value="debug">debug: sangat rinci</option>
          </select>
        </div>
      </section>
      <section class="section">
        <details class="raw">
          <summary>Lihat konfigurasi lengkap</summary>
          <pre id="srv-raw"></pre>
        </details>
      </section>`;

    el.addEventListener("change", async e => {
      const t = e.target;
      if (t.matches("[data-key]")) {
        const on = t.checked;
        if (!on && !(await confirmBox(`Matikan ${t.dataset.label}?`, "Semua koneksi lewat fitur ini akan terputus.", "Matikan"))) {
          t.checked = true; return;
        }
        await patchServer({ [t.dataset.key]: on }, `${t.dataset.label} ${on ? "dinyalakan" : "dimatikan"}`);
      } else if (t.id === "srv-log") {
        await patchServer({ logLevel: t.value }, `Tingkat log diubah ke ${t.value}`);
      }
    });
  },
  async refresh() {
    if (document.activeElement?.closest("#page select, #page input")) return; // jangan ganggu saat sedang memilih
    const cfg = await api("GET", "/api/server/config");
    if (state.route !== "server") return;
    $("#srv-toggles").innerHTML = TOGGLES.filter(([k]) => typeof cfg[k] === "boolean").map(([k, label]) => `
      <tr><td>${esc(label)}</td>
        <td class="actions"><label class="switch"><input type="checkbox" data-key="${k}" data-label="${esc(label)}" ${cfg[k] ? "checked" : ""}>
        <span>${cfg[k] ? "Aktif" : "Mati"}</span></label></td></tr>`).join("");
    if (cfg.logLevel) $("#srv-log").value = cfg.logLevel;
    const details = $(".raw");
    if (!details.open) $("#srv-raw").textContent = JSON.stringify(maskSecrets(cfg), null, 2);
  },
};

async function patchServer(data, msg) {
  try {
    await api("PATCH", "/api/server/config", data);
    toast(msg);
  } catch (err) {
    toast(err.message, true);
  }
  await refreshNow();
}

/* ================= pengguna (admin) ================= */

PAGES.pengguna = {
  title: "Pengguna",
  desc: "Akun yang bisa masuk ke konsol. Viewer hanya bisa melihat, admin bisa mengubah semua.",
  adminOnly: true,
  mount(el) {
    el.innerHTML = `
      <div class="users-layout">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Username</th><th>Peran</th><th>Dibuat</th><th><span class="sr-only">Aksi</span></th></tr></thead>
            <tbody id="user-rows"></tbody>
          </table>
        </div>
        <form id="user-form" class="side-form" novalidate autocomplete="off">
          <h2>Tambah pengguna</h2>
          <label for="nu-username">Username</label>
          <input id="nu-username" name="new_username" required autocomplete="off" data-protonpass-ignore="true" data-bwignore data-1p-ignore data-lpignore="true">
          <label for="nu-password">Password</label>
          <input id="nu-password" name="new_password" type="password" minlength="6" required autocomplete="new-password">
          <label for="nu-role">Peran</label>
          <select id="nu-role" name="role">
            <option value="viewer">Viewer: hanya melihat</option>
            <option value="admin">Admin: bisa mengubah semua</option>
          </select>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">Tambah pengguna</button>
        </form>
      </div>`;

    $("#user-rows").addEventListener("click", async e => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const username = btn.closest("tr").dataset.username;
      try {
        if (btn.dataset.act === "role") {
          await api("PATCH", `/api/users/${encodeURIComponent(username)}`, { role: btn.dataset.role });
          toast(`Peran ${username} diubah`);
        } else {
          const ok = await confirmBox(`Hapus pengguna ${username}?`, "Pengguna ini tidak bisa masuk lagi.", "Hapus pengguna");
          if (!ok) return;
          await api("DELETE", `/api/users/${encodeURIComponent(username)}`);
          toast("Pengguna dihapus");
        }
        await refreshNow();
      } catch (err) {
        toast(err.message, true);
      }
    });

    $("#user-form").addEventListener("submit", async e => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = form.elements;
      const body = { username: f.new_username.value.trim(), password: f.new_password.value, role: f.role.value };
      if (!body.username || body.password.length < 6) {
        return showFormError(form, "Isi username, dan password minimal 6 karakter.");
      }
      try {
        await api("POST", "/api/users", body);
        form.reset();
        showFormError(form, "");
        toast(`Pengguna ${body.username} ditambahkan`);
        await refreshNow();
      } catch (err) {
        showFormError(form, err.message);
      }
    });
  },
  async refresh() {
    const users = await api("GET", "/api/users");
    if (state.route !== "pengguna") return;
    $("#user-rows").innerHTML = users.map(u => {
      const me = u.username === state.user.username;
      const roleBtn = u.role === "admin"
        ? `<button class="btn btn-link" data-act="role" data-role="viewer">Jadikan viewer</button>`
        : `<button class="btn btn-link" data-act="role" data-role="admin">Jadikan admin</button>`;
      return `<tr data-username="${esc(u.username)}">
        <td>${esc(u.username)} ${me ? `<span class="you">(Anda)</span>` : ""}</td>
        <td><span class="badge ${u.role === "admin" ? "admin" : ""}">${u.role === "admin" ? "Admin" : "Viewer"}</span></td>
        <td>${esc(since(u.created_at))}</td>
        <td class="actions">${me ? "" : `${roleBtn}<button class="btn btn-link danger" data-act="delete">Hapus</button>`}</td>
      </tr>`;
    }).join("");
  },
};

/* ---------- dialog tambah/ubah kamera ---------- */

const camDialog = $("#camera-dialog");
const camForm = $("#camera-form");

/* Aturan tiap protokol: skema URL, port bawaan, dan isian yang dibutuhkan.
   path: "path" = path stream biasa, "streamid" = Stream ID SRT, null = tidak ada. */
const PROTOCOLS = {
  rtsp:  { scheme: "rtsp",       port: 554,  cred: true,  path: "path",
           hint: "Untuk kamera IP / CCTV. Path stream tergantung merek kamera, cek manual atau aplikasi kameranya." },
  rtsps: { scheme: "rtsps",      port: 322,  cred: true,  path: "path",
           hint: "RTSP dengan enkripsi TLS." },
  rtmp:  { scheme: "rtmp",       port: 1935, cred: false, path: "path",
           hint: "Menarik stream dari server RTMP lain. Path biasanya berbentuk aplikasi/stream-key." },
  srt:   { scheme: "srt",        port: null, cred: false, path: "streamid",
           hint: "Menarik stream dari server atau encoder SRT." },
  http:  { scheme: "http",       port: 80,   cred: false, path: "path",
           hint: "Menarik stream HLS. Path menuju file .m3u8." },
  udp:   { scheme: "udp+mpegts", port: null, cred: false, path: null,
           hint: "Menerima MPEG-TS lewat UDP. Alamat bisa IP multicast atau IP server ini." },
};

const SCHEME_TO_PROTOCOL = { rtsp: "rtsp", rtsps: "rtsps", rtmp: "rtmp", srt: "srt", http: "http", udp: "udp", "udp+mpegts": "udp" };

function parseSourceUrl(src) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(?:([^:@/]*)(?::([^@]*))?@)?(\[[^\]]+\]|[^:/?#]+)(?::(\d+))?(.*)$/i.exec(src || "");
  if (!m) return null;
  const protocol = SCHEME_TO_PROTOCOL[m[1].toLowerCase()];
  if (!protocol) return null;
  const dec = v => { try { return decodeURIComponent(v || ""); } catch { return v || ""; } };
  let rest = m[6] || "";
  let streamPath = rest.replace(/^\//, "");
  if (protocol === "srt") {
    streamPath = new URLSearchParams(rest.replace(/^\/?\?/, "")).get("streamid") || "";
  }
  return { protocol, user: dec(m[2]), pass: m[3] || "", host: m[4], port: m[5] || "", streamPath };
}

function buildSourceUrl(f, protocol) {
  const p = PROTOCOLS[protocol];
  const host = f.src_host.value.trim();
  const port = f.src_port.value.trim();
  const sp = f.src_path.value.trim().replace(/^\/+/, "");

  if (!host) throw new Error("Isi alamat IP / host.");
  if (!/^(\[[0-9a-f:.]+\]|[A-Za-z0-9.-]+)$/i.test(host)) throw new Error("Alamat IP / host tidak valid. Tulis tanpa protokol, misalnya 192.168.1.20");
  if (port && !(/^\d+$/.test(port) && +port >= 1 && +port <= 65535)) throw new Error("Port harus angka 1 sampai 65535.");
  if (!port && !p.port) throw new Error("Isi port, protokol ini tidak punya port bawaan.");

  let auth = "";
  if (p.cred) {
    const user = f.src_user.value.trim();
    let pass = f.src_secret.value;
    if (!pass && state.editing && camForm.dataset.hasPass === "1" && user === camForm.dataset.origUser) {
      pass = "***"; // backend mengganti *** dengan password yang tersimpan
    } else {
      pass = pass ? encodeURIComponent(pass) : "";
    }
    if (user) auth = encodeURIComponent(user) + (pass ? `:${pass}` : "") + "@";
    else if (pass) throw new Error("Isi username kamera jika memakai password.");
  }

  let url = `${p.scheme}://${auth}${host}${port ? ":" + port : ""}`;
  if (p.path === "path" && sp) url += "/" + sp;
  if (p.path === "streamid" && sp) url += "?streamid=" + encodeURIComponent(sp).replace(/%3A/gi, ":");
  return url;
}

function maskedPreview(url) {
  return url.replace(/^([a-z0-9+.-]+:\/\/[^:/@]+):[^@]+@/i, "$1:***@");
}

function applyProtocol(protocol) {
  const p = PROTOCOLS[protocol];
  const isUrl = protocol === "url";
  const pulled = protocol !== "publisher";

  $("#cf-addr-group").hidden = !p;
  $("#cf-url-group").hidden = !isUrl;
  $("#cf-ondemand-group").hidden = !pulled;
  $("#cf-protocol-hint").textContent = protocol === "publisher"
    ? "Kamera/aplikasi mengirim stream ke path ini, misalnya rtsp://alamat-server:8554/nama-path."
    : isUrl ? "Untuk protokol yang tidak ada di daftar, tulis URL sumber lengkap." : p.hint;

  if (p) {
    $("#cf-port-hint").textContent = p.port ? `Kosongkan untuk memakai port bawaan ${p.port}.` : "Wajib diisi.";
    $("#cf-streampath-group").hidden = !p.path;
    $("#cf-streampath-label").textContent = p.path === "streamid" ? "Stream ID" : "Path stream di kamera";
    $("#cf-streampath-hint").textContent = p.path === "streamid"
      ? "Sesuai pengaturan server SRT sumber. Kosongkan jika tidak dipakai."
      : "Bagian alamat setelah port, tanpa garis miring di depan.";
    $("#cf-cred-group").hidden = !p.cred;
    $("#cf-pass-hint").hidden = !(p.cred && state.editing && camForm.dataset.hasPass === "1");
  }
  updatePreview();
}

function updatePreview() {
  const f = camForm.elements;
  const protocol = f.src_protocol.value;
  const box = $("#cf-preview");
  if (!PROTOCOLS[protocol]) { box.hidden = true; return; }
  try {
    $("#cf-preview-url").textContent = maskedPreview(buildSourceUrl(f, protocol));
    box.hidden = false;
  } catch {
    box.hidden = true;
  }
}

function fillPathOptions(current) {
  const saved = new Set(state.cameras.map(c => c.name));
  const options = state.streams.map(s => s.name).filter(n => !saved.has(n) || n === current);
  $("#cf-path-options").innerHTML = options.map(n => `<option value="${esc(n)}"></option>`).join("");
}

function openCameraDialog(cam) {
  camForm.reset();
  showFormError(camForm, "");
  state.editing = cam ? cam.name : null;

  $("#camera-dialog-title").textContent = cam ? "Ubah kamera" : "Tambah kamera";
  $("#cf-submit").textContent = cam ? "Simpan perubahan" : "Simpan kamera";
  $("#cf-name").readOnly = !!cam;
  $("#cf-name-hint").hidden = !!cam;
  fillPathOptions(cam?.name);

  const f = camForm.elements;
  f.mtx_path.value = cam?.name || "";
  f.cam_label.value = cam?.label || "";
  f.record.checked = !!cam?.record;
  f.enabled.checked = cam ? cam.enabled : true;
  f.source_on_demand.checked = !!cam?.source_on_demand;

  camForm.dataset.hasPass = "";
  camForm.dataset.origUser = "";
  camForm.dataset.origSource = cam?.source || "";

  let protocol = "publisher";
  if (cam && cam.source !== "publisher") {
    const parsed = parseSourceUrl(cam.source);
    if (parsed) {
      protocol = parsed.protocol;
      f.src_host.value = parsed.host;
      f.src_port.value = parsed.port;
      f.src_path.value = parsed.streamPath;
      f.src_user.value = parsed.user;
      camForm.dataset.origUser = parsed.user;
      camForm.dataset.hasPass = parsed.pass ? "1" : "";
    } else {
      protocol = "url";
      f.src_url.value = cam.source.includes(":***@") ? "" : cam.source;
      if (!f.src_url.value) $("#cf-source-hint").textContent = "URL tersimpan berisi password. Tulis ulang URL lengkap untuk mengubahnya, atau kosongkan untuk tetap memakai yang lama.";
    }
  } else {
    $("#cf-source-hint").textContent = "Contoh format: protokol://user:password@alamat:port/path";
  }
  f.src_protocol.value = protocol;
  applyProtocol(protocol);

  camDialog.showModal();
  f.cam_label.focus();
}

$("#cf-protocol").addEventListener("change", e => applyProtocol(e.target.value));
["cf-host", "cf-port", "cf-streampath", "cf-user", "cf-pass"].forEach(id =>
  $("#" + id).addEventListener("input", updatePreview));

camForm.addEventListener("submit", async e => {
  e.preventDefault();
  const f = camForm.elements;
  const protocol = f.src_protocol.value;
  const editing = state.editing;

  const body = {
    label: f.cam_label.value.trim(),
    record: f.record.checked,
    enabled: f.enabled.checked,
    source_on_demand: protocol !== "publisher" && f.source_on_demand.checked,
  };

  try {
    if (protocol === "publisher") {
      body.source = "publisher";
    } else if (protocol === "url") {
      const url = f.src_url.value.trim();
      if (url) {
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) throw new Error("URL harus diawali protokol, misalnya rtsp://");
        body.source = url;
      } else if (!editing || camForm.dataset.origSource === "publisher") {
        throw new Error("Isi URL lengkap.");
      }
    } else {
      body.source = buildSourceUrl(f, protocol);
    }
  } catch (err) {
    return showFormError(camForm, err.message);
  }

  if (!editing) {
    const name = f.mtx_path.value.trim().replace(/^\/+|\/+$/g, "");
    if (!name) return showFormError(camForm, "Pilih atau ketik path.");
    if (!/^[A-Za-z0-9_\-.~/]+$/.test(name)) return showFormError(camForm, "Path hanya boleh huruf, angka, dan - _ . ~ /");
    body.name = name;
  }

  const btn = $("#cf-submit");
  btn.disabled = true;
  try {
    if (editing) {
      await api("PATCH", `/api/cameras/${pathUrl(editing)}`, body);
      toast("Perubahan disimpan");
    } else {
      await api("POST", "/api/cameras", body);
      toast(`Kamera "${body.label || body.name}" disimpan`);
    }
    camDialog.close();
    await refreshNow();
  } catch (err) {
    showFormError(camForm, err.message);
  } finally {
    btn.disabled = false;
  }
});

async function deleteCamera(cam) {
  const ok = await confirmBox(
    `Hapus ${cam.label || cam.name}?`,
    "Kamera dihapus dari database dan dilepas dari MediaMTX. Penonton yang sedang terhubung akan terputus.",
    "Hapus kamera",
  );
  if (!ok) return;
  try {
    await api("DELETE", `/api/cameras/${pathUrl(cam.name)}`);
    state.watching.delete(cam.name);
    toast("Kamera dihapus");
    await refreshNow();
  } catch (err) {
    toast(err.message, true);
  }
}


/* ================= ganti password ================= */

const pwDialog = $("#password-dialog");
const pwForm = $("#password-form");

$("#btn-password").addEventListener("click", () => {
  pwForm.reset();
  pwForm.elements.username.value = state.user?.username || "";
  showFormError(pwForm, "");
  pwDialog.showModal();
});

pwForm.addEventListener("submit", async e => {
  e.preventDefault();
  const f = pwForm.elements;
  if (f.new_password.value.length < 6) return showFormError(pwForm, "Password baru minimal 6 karakter.");
  try {
    await api("POST", "/api/auth/change-password", {
      old_password: f.old_password.value,
      new_password: f.new_password.value,
    });
    pwDialog.close();
    toast("Password diganti");
  } catch (err) {
    showFormError(pwForm, err.message);
  }
});

/* ================= dialog umum ================= */

$$("[data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

function confirmBox(title, text, okLabel) {
  const d = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-ok").textContent = okLabel;
  d.returnValue = "";
  d.showModal();
  return new Promise(resolve => {
    d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true });
  });
}

/* ================= mulai ================= */

(async function init() {
  try { state.token = localStorage.getItem(TOKEN_KEY); } catch { state.token = null; }
  if (!state.token) return showLogin();
  try {
    await startApp();
  } catch {
    logout();
  }
})();
