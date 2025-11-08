/* ========= Global Auto-Discovery + API helpers ========= */

// Hard default: your Render backend
const HARD_DEFAULT_API = "https://crc-guidelines-bot-server.onrender.com";

// Keys in localStorage
const LS_API_BASE = "apiBaseUrl";
const LS_ADMIN_SECRET = "adminSecret";

// Try a quick /api/health probe with a short timeout
async function probeHealth(base, ms = 3500) {
  if (!base) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(base.replace(/\/+$/,"") + "/api/health", {
      signal: ctrl.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    return !!(j && j.ok);
  } catch {
    clearTimeout(t);
    return false;
  }
}

// Resolve API base in this order:
// 1) localStorage (user/admin override)
// 2) <meta name="default-api-base">
// 3) same origin (for self-hosted fullstack deployments)
// 4) HARD_DEFAULT_API (Render URL)
// Cache the first working one into localStorage.
async function resolveApiBase() {
  const saved = localStorage.getItem(LS_API_BASE);

  const metaDefault =
    document
      .querySelector('meta[name="default-api-base"]')
      ?.getAttribute("content") || "";

  const sameOrigin = `${location.origin}`; // if backend & frontend are same host

  const candidates = [
    saved,
    metaDefault,
    sameOrigin,
    HARD_DEFAULT_API,
  ]
    .filter(Boolean)
    .map((u) => u.replace(/\/+$/, "")); // normalize

  for (const base of candidates) {
    const ok = await probeHealth(base);
    if (ok) {
      // Persist the first working candidate
      if (base !== saved) {
        localStorage.setItem(LS_API_BASE, base);
      }
      return base;
    }
  }

  // Nothing worked; keep last saved (even if wrong) to allow manual override
  return saved || HARD_DEFAULT_API;
}

let API_BASE = null;

// lazy getter (ensures resolve done once)
async function getApiBase() {
  if (API_BASE) return API_BASE;
  API_BASE = await resolveApiBase();
  return API_BASE;
}

function showToast(msg, isError = false) {
  console[isError ? "error" : "log"](msg);
}

/* ========= Chat (index.html) ========= */

async function sendQuestion(q) {
  const base = await getApiBase();
  try {
    const r = await fetch(base + "/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
    if (!r.ok) throw new Error("bad status " + r.status);
    const j = await r.json();
    return j?.answer || "No answer.";
  } catch (e) {
    showToast("Network error to API: " + e.message, true);
    throw e;
  }
}

function addBubble(who, text) {
  const wrap = document.getElementById("chatWindow");
  const b = document.createElement("div");
  b.className = "bubble " + who;
  b.textContent = text;
  wrap.appendChild(b);
  wrap.scrollTop = wrap.scrollHeight;
}

async function initChatPage() {
  // pre-warm resolver so first click is snappy
  getApiBase().then((b) => console.log("[API] Using:", b));

  const form = document.getElementById("askForm");
  const input = document.getElementById("askInput");
  const btn = document.getElementById("askBtn");
  const chat = document.getElementById("chatWindow");

  if (!form || !input || !btn || !chat) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = (input.value || "").trim();
    if (!q) return;
    addBubble("user", q);
    input.value = "";
    btn.disabled = true;

    try {
      const ans = await sendQuestion(q);
      addBubble("bot", ans);
    } catch {
      addBubble("bot", "Network error. Please try again later.");
    } finally {
      btn.disabled = false;
    }
  });
}

/* ========= Admin (admin.html) ========= */

function setInputValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || "";
}

function getInputValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

async function uploadGuideline() {
  const base = await getApiBase();
  const title = getInputValue("titleInput").trim();
  const langs = getInputValue("langsInput").trim();
  const fileEl = document.getElementById("fileInput");
  const out = document.getElementById("uploadOutput");

  if (!fileEl || !fileEl.files || !fileEl.files[0]) {
    out.textContent = JSON.stringify({ error: "No file chosen" }, null, 2);
    return;
  }
  if (!title) {
    out.textContent = JSON.stringify({ error: "Missing title" }, null, 2);
    return;
  }

  const fd = new FormData();
  fd.append("title", title);
  fd.append("langs", langs || "eng");
  fd.append("document", fileEl.files[0]);

  try {
    const r = await fetch(base + "/api/upload", { method: "POST", body: fd });
    const j = await r.json();
    out.textContent = JSON.stringify(j, null, 2);
  } catch (e) {
    out.textContent = JSON.stringify(
      { error: "Network error", detail: String(e) },
      null,
      2
    );
  }
}

async function refreshGuidelines() {
  const base = await getApiBase();
  const list = document.getElementById("guidelineList");
  if (!list) return;
  list.innerHTML = "<div class='muted'>Loading…</div>";
  try {
    const r = await fetch(base + "/api/sources");
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error("bad response");

    if (!j.length) {
      list.innerHTML = "<div class='muted'>No guidelines uploaded yet.</div>";
      return;
    }

    const frag = document.createDocumentFragment();
    j.forEach((doc) => {
      const row = document.createElement("div");
      row.className = "doc-row";
      row.innerHTML = `
        <div class="doc-main">
          <div class="doc-title">${escapeHtml(doc.title || "Untitled")}</div>
          <div class="doc-meta">
            <code>${doc.sourceId}</code> • ${escapeHtml(
              doc.filename || ""
            )} • chunks: ${doc.chunks ?? 0}
          </div>
        </div>
        <div class="doc-actions">
          <button data-del="${doc.sourceId}">Delete</button>
        </div>
      `;
      frag.appendChild(row);
    });
    list.innerHTML = "";
    list.appendChild(frag);

    list.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => deleteGuideline(btn.dataset.del));
    });
  } catch (e) {
    list.innerHTML =
      "<div class='error'>Failed to load list. " + escapeHtml(e.message) + "</div>";
  }
}

async function deleteGuideline(sourceId) {
  const base = await getApiBase();
  const secret = localStorage.getItem(LS_ADMIN_SECRET) || "";
  if (!secret) {
    alert("Admin secret not set. Save it in the Connection section first.");
    return;
  }
  const ok = confirm("Delete this guideline and its chunks?");
  if (!ok) return;

  try {
    const r = await fetch(base + "/api/source/" + encodeURIComponent(sourceId), {
      method: "DELETE",
      headers: { "x-admin-secret": secret },
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(JSON.stringify(j));
    await refreshGuidelines();
  } catch (e) {
    alert("Delete failed: " + e.message);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function initAdminPage() {
  // resolve/cached api base first
  const base = await getApiBase();
  console.log("[API] Using:", base);

  // Preload inputs from storage or defaults
  const savedBase = localStorage.getItem(LS_API_BASE) || base;
  setInputValue("apiBaseInput", savedBase);
  setInputValue(
    "adminSecretInput",
    localStorage.getItem(LS_ADMIN_SECRET) || ""
  );

  document.getElementById("saveConnBtn")?.addEventListener("click", async () => {
    const b = getInputValue("apiBaseInput").trim();
    const s = getInputValue("adminSecretInput");
    if (b) localStorage.setItem(LS_API_BASE, b);
    if (s) localStorage.setItem(LS_ADMIN_SECRET, s);
    document.getElementById("connSaveMsg").textContent = "Saved connection settings.";
    API_BASE = null; // force re-resolve next call
  });

  document.getElementById("uploadBtn")?.addEventListener("click", uploadGuideline);
  document.getElementById("refreshBtn")?.addEventListener("click", refreshGuidelines);

  await refreshGuidelines();
}

/* ========= Page router ========= */

document.addEventListener("DOMContentLoaded", () => {
  const isAdmin = /admin\.html(\?|#|$)/i.test(location.pathname);
  if (isAdmin) {
    initAdminPage();
  } else {
    initChatPage();
  }
});

