/**
 * app.js — Macro Lab dashboard
 * ------------------------------------------------------------------
 * Site 100% statique : lit data/articles.json et data/predictions.json
 * (générés par scraper/run.py via GitHub Actions) et affiche le
 * dashboard, sans backend serveur (compatible Vercel gratuit).
 */

const DATA_URL = "data/articles.json";
const PREDICTIONS_URL = "data/predictions.json";
const HISTORY_URL = "data/history.json";

const ASSET_LABELS_FR = {
  "Gold": "Or",
  "EUR/USD": "EUR/USD",
  "Bitcoin": "Bitcoin",
  "S&P 500": "S&P 500",
  "CAC 40": "CAC 40",
};
const ASSET_ORDER = ["Gold", "EUR/USD", "Bitcoin", "S&P 500", "CAC 40"];

// Plages façon or.fr — `days` = nombre de points (jours de cotation)
// gardés depuis la fin de la série ; null = tout l'historique disponible.
const RANGES = [
  { key: "5j", label: "5 jours", days: 5 },
  { key: "1m", label: "1 mois", days: 22 },
  { key: "1a", label: "1 an", days: 252 },
  { key: "5a", label: "5 ans", days: 1260 },
  { key: "10a", label: "10 ans", days: 2520 },
  { key: "max", label: "Max", days: null },
];

const THEME_COLORS = {
  "War/Conflict": "#ef4444",
  "Sanctions": "#f59e0b",
  "Market Crash": "#dc2626",
  "Fed Emergency": "#3b82f6",
  "Recession": "#f97316",
  "Inflation": "#eab308",
  "Banking Crisis": "#8b5cf6",
  "Oil/Energy": "#22c55e",
  "Central Bank": "#06b6d4",
  "Volatility": "#a78bfa",
  "Default": "#f43f5e",
  "Geo Shock": "#38bdf8",
};

let state = {
  articles: [],
  meta: {},
  activeThemes: new Set(),
  search: "",
  view: "top20", // top20 | historique | compact
  history: {},         // { "Gold": {ticker, dates:[], close:[]}, ... }
  predictions: {},      // { "Gold": {last_price, forecast, backtest, ...}, ... }
  predictionsFailures: {},
  selectedAsset: "Gold",
  selectedRange: "1a",
  chartScale: null,     // {xAt(i), yAt(v), dates, close} — recalculé à chaque render du graphe marché
};

/* ------------------------------------------------------------------ */
/* Thème clair / sombre                                                */
/* ------------------------------------------------------------------ */

function initTheme() {
  const saved = localStorage.getItem("macro-lab-theme");
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  const isLight = saved ? saved === "light" : prefersLight === false ? false : prefersLight;
  setTheme(saved === "light" ? "light" : saved === "dark" ? "dark" : (prefersLight ? "light" : "dark"));

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const isCurrentlyLight = document.documentElement.classList.contains("light");
    setTheme(isCurrentlyLight ? "dark" : "light");
  });
}

function setTheme(mode) {
  document.documentElement.classList.toggle("light", mode === "light");
  document.getElementById("icon-sun").classList.toggle("hidden", mode !== "light");
  document.getElementById("icon-moon").classList.toggle("hidden", mode === "light");
  localStorage.setItem("macro-lab-theme", mode);
}

/* ------------------------------------------------------------------ */
/* Chargement des données                                              */
/* ------------------------------------------------------------------ */

async function loadData() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("fichier introuvable");
    const json = await res.json();
    if (!json.articles || json.articles.length === 0) {
      throw new Error("snapshot vide (pipeline pas encore exécuté)");
    }
    state.articles = json.articles;
    state.meta = json.meta || {};
    document.getElementById("last-updated").textContent =
      "Mis à jour " + formatRelativeTime(json.generated_at);
  } catch (err) {
    console.warn("Impossible de charger data/articles.json, utilisation de données de démonstration.", err);
    const demo = demoData();
    state.articles = demo.articles;
    state.meta = demo.meta;
    document.getElementById("last-updated").textContent = "Données de démonstration";
  }

  renderStats();
  renderBarChart();
  renderDonutChart();
  renderThemeFilters();
  renderArticles();
  loadMarkets();
}

async function loadPredictions() {
  try {
    const res = await fetch(PREDICTIONS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("introuvable");
    const json = await res.json();
    const hasData = json.predictions && Object.keys(json.predictions).length > 0;
    if (!hasData) {
      renderPredictionsEmpty(json.generated_at ? "run" : "never");
      return;
    }
    renderPredictions(json.predictions, json.failures || {});
  } catch (err) {
    renderPredictions(demoPredictions(), {});
  }
}

function renderPredictionsEmpty(reason) {
  const grid = document.getElementById("predictions-grid");
  const msg = reason === "never"
    ? "Le pipeline de prédiction ne s'est pas encore exécuté avec succès — vérifiez les logs GitHub Actions (onglet Actions du dépôt) après le prochain run."
    : "Le dernier run n'a récupéré aucune donnée de marché (Yahoo Finance et Stooq indisponibles). Le prochain run réessaiera automatiquement.";
  grid.innerHTML = `<div class="text-xs font-mono text-muted col-span-full">${msg}</div>`;
}

/* ------------------------------------------------------------------ */
/* Stat cards                                                          */
/* ------------------------------------------------------------------ */

function renderStats() {
  const m = state.meta;
  document.getElementById("stat-articles").textContent = m.total_articles_7j ?? state.articles.length;
  document.getElementById("stat-top").textContent = Math.min(20, state.articles.length);
  document.getElementById("stat-alerts").textContent = m.alerts_critiques ?? state.articles.filter(a => a.is_alert).length;
  document.getElementById("stat-score").textContent = (m.score_moyen ?? 0).toFixed(1);
  document.getElementById("stat-threshold").textContent = (m.seuil_alerte ?? 5.0).toFixed(1);
}

/* ------------------------------------------------------------------ */
/* Bar chart — articles par jour (7 jours), SVG fait main               */
/* ------------------------------------------------------------------ */

function renderBarChart() {
  const svg = document.getElementById("chart-bars");
  const counts = countByDay(state.articles, 7);
  const max = Math.max(...counts.map(c => c.count), 1);

  const width = 700, height = 220;
  const padLeft = 34, padBottom = 26, padTop = 10;
  const chartW = width - padLeft - 10;
  const chartH = height - padBottom - padTop;
  const barGap = 14;
  const barW = (chartW / counts.length) - barGap;

  let gridLines = "";
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const y = padTop + chartH - (chartH * i) / steps;
    const val = Math.round((max * i) / steps);
    gridLines += `<line x1="${padLeft}" y1="${y}" x2="${width - 10}" y2="${y}" stroke="var(--edge)" stroke-width="1" />`;
    gridLines += `<text x="${padLeft - 8}" y="${y + 3}" text-anchor="end" font-size="9" font-family="JetBrains Mono" fill="var(--muted)">${val}</text>`;
  }

  let bars = "";
  counts.forEach((c, i) => {
    const barH = (c.count / max) * chartH;
    const x = padLeft + i * (barW + barGap) + barGap / 2;
    const y = padTop + chartH - barH;
    bars += `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4"
        fill="url(#barGradient)" opacity="0.95">
        <title>${c.label}: ${c.count} articles</title>
      </rect>
      <text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" font-size="9.5"
        font-family="JetBrains Mono" fill="var(--muted)">${c.label}</text>
      <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="10" font-weight="700"
        font-family="JetBrains Mono" fill="var(--ink)">${c.count}</text>
    `;
  });

  svg.innerHTML = `
    <defs>
      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#60a5fa" />
        <stop offset="100%" stop-color="#3b82f6" />
      </linearGradient>
    </defs>
    ${gridLines}
    ${bars}
  `;

  document.getElementById("chart-bar-caption").textContent =
    counts.reduce((s, c) => s + c.count, 0) + " articles sur 7 jours";
}

function countByDay(articles, days) {
  const buckets = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.push({ key, label: key.slice(5), count: 0 });
  }
  const map = Object.fromEntries(buckets.map(b => [b.key, b]));
  articles.forEach(a => {
    const key = (a.published_at || "").slice(0, 10);
    if (map[key]) map[key].count += 1;
  });
  return buckets;
}

/* ------------------------------------------------------------------ */
/* Donut chart — thèmes critiques, SVG fait main                        */
/* ------------------------------------------------------------------ */

function renderDonutChart() {
  const svg = document.getElementById("chart-donut");
  const legend = document.getElementById("donut-legend");
  const counts = state.meta.themes || computeThemeCounts(state.articles);
  const entries = Object.entries(counts);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  const cx = 100, cy = 100, r = 80, stroke = 26;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  let arcs = "";

  entries.forEach(([theme, count]) => {
    const frac = count / total;
    const dash = frac * circumference;
    const color = THEME_COLORS[theme] || "#94a3b8";
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}"
      stroke-width="${stroke}" stroke-dasharray="${dash} ${circumference - dash}"
      stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})">
      <title>${theme}: ${count}</title>
    </circle>`;
    offset += dash;
  });

  svg.innerHTML = arcs || `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--edge)" stroke-width="${stroke}" />`;

  legend.innerHTML = entries.map(([theme, count]) => `
    <li class="flex items-center justify-between gap-2">
      <span class="flex items-center gap-1.5 truncate">
        <span class="w-2 h-2 rounded-full shrink-0" style="background:${THEME_COLORS[theme] || '#94a3b8'}"></span>
        <span class="truncate">${theme}</span>
      </span>
      <span class="text-muted">${count}</span>
    </li>
  `).join("") || `<li class="text-muted">Aucun thème détecté</li>`;
}

function computeThemeCounts(articles) {
  const counts = {};
  articles.forEach(a => (a.themes || []).forEach(t => (counts[t] = (counts[t] || 0) + 1)));
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

/* ------------------------------------------------------------------ */
/* Filtres par thème                                                   */
/* ------------------------------------------------------------------ */

function renderThemeFilters() {
  const container = document.getElementById("theme-filters");
  const counts = computeThemeCounts(state.articles);
  const themes = Object.keys(counts);

  const allBtn = `<button class="theme-pill ${state.activeThemes.size === 0 ? "active" : ""}" data-theme="__all__">Tous</button>`;
  const pills = themes.map(t => `
    <button class="theme-pill ${state.activeThemes.has(t) ? "active" : ""}" data-theme="${t}">
      <span class="dot" style="background:${THEME_COLORS[t] || "#94a3b8"}"></span>${t}
    </button>
  `).join("");

  container.innerHTML = allBtn + pills;

  container.querySelectorAll(".theme-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme;
      if (theme === "__all__") {
        state.activeThemes.clear();
      } else if (state.activeThemes.has(theme)) {
        state.activeThemes.delete(theme);
      } else {
        state.activeThemes.add(theme);
      }
      renderThemeFilters();
      renderArticles();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Liste des articles                                                  */
/* ------------------------------------------------------------------ */

function getFilteredArticles() {
  let list = [...state.articles];

  if (state.activeThemes.size > 0) {
    list = list.filter(a => (a.themes || []).some(t => state.activeThemes.has(t)));
  }
  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    list = list.filter(a =>
      (a.title || "").toLowerCase().includes(q) ||
      (a.summary || "").toLowerCase().includes(q) ||
      (a.source || "").toLowerCase().includes(q)
    );
  }
  if (state.view === "top20") list = list.slice(0, 20);
  return list;
}

function renderArticles() {
  const container = document.getElementById("article-list");
  const list = getFilteredArticles();
  document.getElementById("results-count").textContent = `${list.length} article${list.length > 1 ? "s" : ""} affiché${list.length > 1 ? "s" : ""}`;

  if (list.length === 0) {
    container.innerHTML = `<div class="py-8 text-center text-sm font-mono text-muted">Aucun article ne correspond aux filtres.</div>`;
    return;
  }

  const compact = state.view === "compact";

  container.innerHTML = list.map((a, i) => `
    <a href="${a.url}" target="_blank" rel="noopener noreferrer" class="article-row group">
      <div class="score-badge shrink-0" style="--ring-color:${scoreColor(a.score)}">
        <svg width="42" height="42" viewBox="0 0 42 42">
          <circle cx="21" cy="21" r="17" fill="none" stroke="var(--edge)" stroke-width="4"/>
          <circle cx="21" cy="21" r="17" fill="none" stroke="${scoreColor(a.score)}" stroke-width="4"
            stroke-dasharray="${((a.score || 0) / 15) * 106.8} 106.8" stroke-linecap="round"
            transform="rotate(-90 21 21)"/>
        </svg>
        <span class="score-ring-label absolute inset-0 flex items-center justify-center text-[11px]">${(a.score ?? 0).toFixed(1)}</span>
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          ${(a.themes || []).slice(0, compact ? 1 : 3).map(t => `
            <span class="text-[9px] font-mono font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style="background:${THEME_COLORS[t] || '#94a3b8'}22; color:${THEME_COLORS[t] || '#94a3b8'}">${t}</span>
          `).join("")}
          ${a.is_alert ? `<span class="text-[9px] font-mono font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">Alerte</span>` : ""}
        </div>
        <h3 class="text-sm font-semibold leading-snug group-hover:text-blue-400 transition truncate-2">${escapeHtml(a.title)}</h3>
        ${!compact ? `<p class="text-xs text-muted mt-1 truncate-2">${escapeHtml(a.summary || "")}</p>` : ""}
        <div class="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-muted">
          <span>${a.source || ""}</span>
          <span>·</span>
          <span>${formatRelativeTime(a.published_at)}</span>
        </div>
      </div>
    </a>
  `).join("");
}

function scoreColor(score) {
  if (score >= 10) return "#ef4444";
  if (score >= 7) return "#f59e0b";
  if (score >= 5) return "#3b82f6";
  return "#64748b";
}

/* ------------------------------------------------------------------ */
/* Ticker (alertes critiques défilantes)                               */
/* ------------------------------------------------------------------ */

function renderTicker() {
  const alerts = state.articles.filter(a => a.is_alert).slice(0, 12);
  const ticker = document.getElementById("ticker");
  if (alerts.length === 0) {
    ticker.innerHTML = `<span class="px-6 text-muted">Aucune alerte critique active pour le moment.</span>`;
    return;
  }
  ticker.innerHTML = alerts.map(a => `
    <span class="px-6 inline-flex items-center gap-2">
      <span class="w-1.5 h-1.5 rounded-full" style="background:${scoreColor(a.score)}"></span>
      <span class="text-ink font-semibold">${(a.score ?? 0).toFixed(1)}</span>
      <span class="text-muted">${escapeHtml(a.title)}</span>
    </span>
  `).join("");
}

/* ------------------------------------------------------------------ */
/* Marchés — historique de prix (sélecteur d'actif + de plage,          */
/* façon or.fr) + prévisions ARIMA + backtest attendu/prédit            */
/* ------------------------------------------------------------------ */

async function loadMarkets() {
  // Historique complet des prix
  try {
    const res = await fetch(HISTORY_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("introuvable");
    const json = await res.json();
    if (!json.series || Object.keys(json.series).length === 0) {
      throw new Error("historique vide (pipeline pas encore exécuté)");
    }
    state.history = json.series;
  } catch (err) {
    state.history = demoHistory();
  }

  // Prévisions ARIMA + backtest
  try {
    const res = await fetch(PREDICTIONS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("introuvable");
    const json = await res.json();
    if (!json.predictions || Object.keys(json.predictions).length === 0) {
      throw new Error("prédictions vides");
    }
    state.predictions = json.predictions;
    state.predictionsFailures = json.failures || {};
  } catch (err) {
    state.predictions = demoPredictions();
    state.predictionsFailures = {};
  }

  const available = ASSET_ORDER.filter(a => state.history[a]);
  if (!available.includes(state.selectedAsset)) {
    state.selectedAsset = available[0] || ASSET_ORDER[0];
  }

  renderAssetTabs();
  renderRangeTabs();
  renderMarketChart();
  renderArimaSummary();
  renderBacktestChart();
}

function renderAssetTabs() {
  const container = document.getElementById("asset-tabs");
  const assets = ASSET_ORDER.filter(a => state.history[a] || state.predictions[a]);
  container.innerHTML = assets.map(a => `
    <button class="asset-tab ${a === state.selectedAsset ? "active" : ""}" data-asset="${a}">${ASSET_LABELS_FR[a] || a}</button>
  `).join("");

  container.querySelectorAll(".asset-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedAsset = btn.dataset.asset;
      container.querySelectorAll(".asset-tab").forEach(b => b.classList.toggle("active", b === btn));
      renderMarketChart();
      renderArimaSummary();
      renderBacktestChart();
    });
  });
}

function renderRangeTabs() {
  const container = document.getElementById("range-tabs");
  container.innerHTML = RANGES.map(r => `
    <button class="range-tab ${r.key === state.selectedRange ? "active" : ""}" data-range="${r.key}">${r.label}</button>
  `).join("");

  container.querySelectorAll(".range-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedRange = btn.dataset.range;
      container.querySelectorAll(".range-tab").forEach(b => b.classList.toggle("active", b === btn));
      renderMarketChart();
    });
  });
}

function getSlicedSeries() {
  const series = state.history[state.selectedAsset];
  if (!series || !series.close || series.close.length === 0) return { dates: [], close: [] };

  const range = RANGES.find(r => r.key === state.selectedRange);
  if (!range || range.days == null) return series;

  const n = series.close.length;
  const start = Math.max(0, n - range.days);
  return { dates: series.dates.slice(start), close: series.close.slice(start) };
}

function renderMarketChart() {
  const svg = document.getElementById("chart-market");
  const { dates, close } = getSlicedSeries();

  if (close.length < 2) {
    svg.innerHTML = `<text x="450" y="130" text-anchor="middle" font-size="12" font-family="JetBrains Mono" fill="var(--muted)">Historique indisponible pour cet actif</text>`;
    document.getElementById("asset-price").textContent = "—";
    document.getElementById("asset-change").textContent = "";
    document.getElementById("asset-source").textContent = "";
    state.chartScale = null;
    return;
  }

  const w = 900, h = 260, padL = 54, padR = 12, padT = 16, padB = 26;
  const min = Math.min(...close), max = Math.max(...close);
  const pad = (max - min) * 0.08 || max * 0.01 || 1;
  const yMin = min - pad, yMax = max + pad;

  const xAt = i => padL + (i / (close.length - 1)) * (w - padL - padR);
  const yAt = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);

  const changePct = ((close[close.length - 1] - close[0]) / close[0]) * 100;
  const up = changePct >= 0;
  const lineColor = up ? "#10b981" : "#ef4444";

  // Grille horizontale + labels d'axe Y
  let grid = "";
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const val = yMin + ((yMax - yMin) * i) / steps;
    const y = yAt(val);
    grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--edge)" stroke-width="1"/>`;
    grid += `<text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="9" font-family="JetBrains Mono" fill="var(--muted)">${formatPrice(val)}</text>`;
  }

  // Labels d'axe X (quelques dates réparties)
  let xLabels = "";
  const labelCount = Math.min(6, dates.length);
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round((i / (labelCount - 1 || 1)) * (dates.length - 1));
    xLabels += `<text x="${xAt(idx)}" y="${h - 6}" text-anchor="middle" font-size="9" font-family="JetBrains Mono" fill="var(--muted)">${formatDateShort(dates[idx])}</text>`;
  }

  const linePts = close.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
  const areaPts = `${xAt(0)},${yAt(yMin)} ${linePts} ${xAt(close.length - 1)},${yAt(yMin)}`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    <polygon points="${areaPts}" fill="url(#areaGradient)"/>
    <polyline points="${linePts}" fill="none" stroke="${lineColor}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    ${xLabels}
    <line id="hover-line" class="crosshair-line" x1="0" y1="${padT}" x2="0" y2="${h - padB}" opacity="0"/>
    <circle id="hover-dot" r="3.5" fill="${lineColor}" stroke="var(--panel)" stroke-width="1.5" opacity="0"/>
  `;

  state.chartScale = { xAt, yAt, dates, close, padL, padR, w };

  const last = close[close.length - 1];
  document.getElementById("asset-price").textContent = formatPrice(last);
  const changeEl = document.getElementById("asset-change");
  changeEl.textContent = `${up ? "▲" : "▼"} ${Math.abs(changePct).toFixed(2)}%`;
  changeEl.className = `font-mono text-sm font-semibold px-1.5 py-0.5 rounded ${up ? "text-emerald-500 bg-emerald-500/10" : "text-red-500 bg-red-500/10"}`;

  const pred = state.predictions[state.selectedAsset];
  const sourceLabel = pred?.source ? `Source : ${pred.source}` : "";
  const rangeLabel = RANGES.find(r => r.key === state.selectedRange)?.label || "";
  document.getElementById("asset-source").textContent = [sourceLabel, rangeLabel].filter(Boolean).join(" · ");
}

/** Crosshair + tooltip au survol du graphique marché (écouteurs attachés
 * une seule fois à l'init ; lisent state.chartScale mis à jour à chaque
 * render, donc pas besoin de ré-attacher après un changement d'actif/plage). */
function initMarketChartHover() {
  const svg = document.getElementById("chart-market");
  const tooltip = document.getElementById("chart-tooltip");

  svg.addEventListener("mousemove", (e) => {
    const scale = state.chartScale;
    if (!scale || scale.close.length === 0) return;

    const rect = svg.getBoundingClientRect();
    const fracX = (e.clientX - rect.left) / rect.width;
    const userX = fracX * scale.w;
    const n = scale.close.length;
    const rawIdx = ((userX - scale.padL) / (scale.w - scale.padL - scale.padR)) * (n - 1);
    const idx = Math.max(0, Math.min(n - 1, Math.round(rawIdx)));

    const x = scale.xAt(idx), y = scale.yAt(scale.close[idx]);
    const hoverLine = document.getElementById("hover-line");
    const hoverDot = document.getElementById("hover-dot");
    if (hoverLine && hoverDot) {
      hoverLine.setAttribute("x1", x); hoverLine.setAttribute("x2", x);
      hoverLine.setAttribute("opacity", "1");
      hoverDot.setAttribute("cx", x); hoverDot.setAttribute("cy", y);
      hoverDot.setAttribute("opacity", "1");
    }

    tooltip.classList.remove("hidden");
    tooltip.style.left = `${Math.min(rect.width - 110, Math.max(0, (fracX * rect.width) + 10))}px`;
    tooltip.style.top = `${(y / 260) * rect.height - 10}px`;
    tooltip.innerHTML = `<strong>${formatPrice(scale.close[idx])}</strong><br/><span style="color:var(--muted)">${formatDateShort(scale.dates[idx])}</span>`;
  });

  svg.addEventListener("mouseleave", () => {
    tooltip.classList.add("hidden");
    const hoverLine = document.getElementById("hover-line");
    const hoverDot = document.getElementById("hover-dot");
    if (hoverLine) hoverLine.setAttribute("opacity", "0");
    if (hoverDot) hoverDot.setAttribute("opacity", "0");
  });
}

/* ------------------------------------------------------------------ */
/* Résumé prévision ARIMA (pour l'actif sélectionné)                    */
/* ------------------------------------------------------------------ */

function renderArimaSummary() {
  const container = document.getElementById("arima-summary");
  const p = state.predictions[state.selectedAsset];

  if (!p) {
    const reason = state.predictionsFailures[state.selectedAsset];
    container.innerHTML = `<div class="col-span-full text-muted">Prévision indisponible pour cet actif${reason ? " — " + reason : ""}.</div>`;
    return;
  }

  const up = p.predicted_change_pct >= 0;
  const order = p.model?.order ? `(${p.model.order.join(",")})` : "";
  const horizonEnd = p.forecast?.[p.forecast.length - 1];
  const lowerEnd = p.forecast_lower?.[p.forecast_lower.length - 1];
  const upperEnd = p.forecast_upper?.[p.forecast_upper.length - 1];
  const sourceTag = p.source && p.source !== "stooq" ? ` (repli ${p.source})` : "";

  container.innerHTML = `
    <div>
      <p class="text-muted text-[10px] uppercase tracking-wide mb-1">Prévision à ${p.horizon_days}j</p>
      <p class="font-bold ${up ? "text-emerald-500" : "text-red-500"}">${formatPrice(horizonEnd)} (${up ? "+" : ""}${p.predicted_change_pct}%)</p>
    </div>
    <div>
      <p class="text-muted text-[10px] uppercase tracking-wide mb-1">Intervalle de confiance ${p.model?.confidence_level || "90%"}</p>
      <p>${formatPrice(lowerEnd)} – ${formatPrice(upperEnd)}</p>
    </div>
    <div>
      <p class="text-muted text-[10px] uppercase tracking-wide mb-1">Modèle</p>
      <p>ARIMA${order}${sourceTag}</p>
    </div>
    <div>
      <p class="text-muted text-[10px] uppercase tracking-wide mb-1">AIC</p>
      <p>${p.model?.aic ?? "—"}</p>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Backtest — valeurs attendues vs valeurs prédites                     */
/* ------------------------------------------------------------------ */

function renderBacktestChart() {
  const svg = document.getElementById("chart-backtest");
  const metricsEl = document.getElementById("backtest-metrics");
  const orderEl = document.getElementById("backtest-order");
  const p = state.predictions[state.selectedAsset];
  const bt = p?.backtest;

  if (!bt || !bt.expected || bt.expected.length === 0) {
    svg.innerHTML = `<text x="450" y="130" text-anchor="middle" font-size="12" font-family="JetBrains Mono" fill="var(--muted)">Backtest indisponible pour cet actif</text>`;
    metricsEl.innerHTML = "";
    orderEl.textContent = "";
    return;
  }

  const { expected, predicted, horizon_labels } = bt;
  document.getElementById("backtest-horizon-label").textContent = expected.length;
  orderEl.textContent = bt.order ? `ARIMA(${bt.order.join(",")})` : "";

  const w = 900, h = 260, padL = 44, padR = 16, padT = 20, padB = 30;
  const allVals = [...expected, ...predicted];
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const pad = (max - min) * 0.15 || 0.5;
  const yMin = min - pad, yMax = max + pad;

  const xAt = i => padL + (i / (expected.length - 1)) * (w - padL - padR);
  const yAt = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);

  let grid = "";
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const val = yMin + ((yMax - yMin) * i) / steps;
    const y = yAt(val);
    grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--edge)" stroke-width="1"/>`;
    grid += `<text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="9" font-family="JetBrains Mono" fill="var(--muted)">${val.toFixed(1)}</text>`;
  }

  let xLabels = "";
  horizon_labels.forEach((lbl, i) => {
    xLabels += `<text x="${xAt(i)}" y="${h - 8}" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono" fill="var(--muted)">${lbl}</text>`;
  });

  const expectedPts = expected.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
  const predictedPts = predicted.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
  const expectedDots = expected.map((v, i) => `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="3" fill="#10b981"/>`).join("");
  const predictedDots = predicted.map((v, i) => `<circle cx="${xAt(i)}" cy="${yAt(v)}" r="3" fill="#ef4444"/>`).join("");

  svg.innerHTML = `
    ${grid}
    <polyline points="${expectedPts}" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="${predictedPts}" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round"/>
    ${expectedDots}
    ${predictedDots}
    ${xLabels}
  `;

  metricsEl.innerHTML = `
    <span><span class="text-muted">RMSE</span> = <span class="text-ink font-semibold">${bt.rmse.toFixed(5)}</span></span>
    <span><span class="text-muted">MAE</span> = <span class="text-ink font-semibold">${bt.mae.toFixed(5)}</span></span>
  `;
}

function formatDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: state.selectedRange === "5j" || state.selectedRange === "1m" ? undefined : "2-digit" });
}

function formatPrice(v) {
  if (v == null || isNaN(v)) return "—";
  return v >= 100 ? v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) : v.toFixed(4);
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function formatRelativeTime(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

/* ------------------------------------------------------------------ */
/* View toggle + recherche                                             */
/* ------------------------------------------------------------------ */

function initControls() {
  document.querySelectorAll(".view-btn").forEach(btn => {
    if (btn.dataset.view === state.view) btn.classList.add("active");
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      document.querySelectorAll(".view-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderArticles();
    });
  });

  document.getElementById("search").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderArticles();
  });

  initMarketChartHover();
}

/* ------------------------------------------------------------------ */
/* Données de démonstration (utilisées si data/articles.json absent)   */
/* ------------------------------------------------------------------ */

function demoData() {
  const themesPool = Object.keys(THEME_COLORS);
  const sources = ["NYT World", "NYT Business", "Reuters World", "Reuters Business", "AP Top News"];
  const titles = [
    "La BCE convoque une réunion d'urgence face à la flambée des taux",
    "Le S&P 500 chute de 3% après un signal de récession",
    "Nouvelles sanctions occidentales visant le secteur énergétique",
    "Tensions militaires en mer Rouge, l'OPEP réduit sa production",
    "La Fed évoque une hausse de taux surprise en réponse à l'inflation",
    "Une grande banque régionale sollicite un plan de sauvetage",
    "Le bitcoin plonge de 12% dans un mouvement de vente panique",
    "Le dollar se renforce face à l'euro sur fond d'incertitude géopolitique",
    "Dégradation de la note souveraine d'un pays émergent",
    "Vague de volatilité sur les marchés obligataires mondiaux",
  ];
  const articles = Array.from({ length: 40 }).map((_, i) => {
    const daysAgo = Math.floor(Math.random() * 7);
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(Math.floor(Math.random() * 24));
    const themes = [themesPool[Math.floor(Math.random() * themesPool.length)]];
    if (Math.random() > 0.6) themes.push(themesPool[Math.floor(Math.random() * themesPool.length)]);
    const score = Math.round((Math.random() * 15) * 10) / 10;
    return {
      id: "demo-" + i,
      title: titles[i % titles.length],
      url: "#",
      source: sources[i % sources.length],
      published_at: d.toISOString(),
      summary: "Résumé de démonstration — connectez data/articles.json pour afficher les vraies actualités scrapées.",
      themes,
      score,
      is_alert: score >= 5,
    };
  });
  const meta = {
    total_articles_7j: articles.length,
    alerts_critiques: articles.filter(a => a.is_alert).length,
    score_moyen: Number((articles.reduce((s, a) => s + a.score, 0) / articles.length).toFixed(2)),
    seuil_alerte: 5.0,
    themes: computeThemeCounts(articles),
  };
  return { articles, meta };
}

function demoPredictions() {
  // Génère une trajectoire ARIMA plausible (moyenne + bande de confiance
  // qui s'élargit avec l'horizon) ainsi qu'un backtest attendu/prédit
  // (façon image de référence), pour illustrer le rendu sans backend
  // connecté à data/predictions.json.
  const build = (last, changePct, horizon, order, aic, volPct) => {
    const target = last * (1 + changePct / 100);
    const step = (target - last) / horizon;
    const forecast = [], lower = [], upper = [];
    for (let i = 1; i <= horizon; i++) {
      const mean = last + step * i;
      const band = last * (volPct / 100) * Math.sqrt(i);
      forecast.push(Math.round(mean * 10000) / 10000);
      lower.push(Math.round((mean - band) * 10000) / 10000);
      upper.push(Math.round((mean + band) * 10000) / 10000);
    }

    // Backtest synthétique en z-score, dans l'esprit du graphique de
    // référence (expected en trait plein, predicted légèrement décalé).
    const wave = [-0.5, 0.35, 0.7, 0.42, 0.97, -0.18, 1.27, -1.28, -0.83, -0.36];
    const expected = wave.slice(0, horizon >= 10 ? 10 : horizon);
    const predicted = expected.map((v, i) => Math.round((v + (i % 2 === 0 ? 0.18 : -0.1) - 0.05) * 100000) / 100000);
    const diffs = expected.map((v, i) => v - predicted[i]);
    const rmse = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
    const mae = diffs.reduce((s, d) => s + Math.abs(d), 0) / diffs.length;

    return {
      last_price: last,
      forecast, forecast_lower: lower, forecast_upper: upper,
      predicted_change_pct: changePct,
      horizon_days: horizon,
      source: "démo",
      model: { type: "ARIMA", order, aic, confidence_level: "90%" },
      backtest: {
        horizon_labels: expected.map((_, i) => `n+${i + 1}`),
        expected, predicted,
        rmse: Math.round(rmse * 100000) / 100000,
        mae: Math.round(mae * 100000) / 100000,
        order,
      },
    };
  };

  return {
    "Gold": build(2734.5, 1.8, 5, [1, 1, 1], 612.4, 1.1),
    "EUR/USD": build(1.0842, -0.6, 5, [0, 1, 1], -845.2, 0.5),
    "Bitcoin": build(68210, -3.2, 5, [2, 1, 1], 1584.9, 3.4),
    "S&P 500": build(5320, -1.1, 5, [1, 1, 0], 720.1, 1.3),
    "CAC 40": build(8120, 0.4, 5, [0, 1, 2], 705.6, 0.9),
  };
}

/** Historique de prix synthétique (marche aléatoire plausible sur ~10 ans)
 * utilisé quand data/history.json est absent ou pas encore généré. */
function demoHistory() {
  const configs = {
    "Gold": { start: 1200, drift: 0.00045, vol: 0.009 },
    "EUR/USD": { start: 1.10, drift: -0.00003, vol: 0.004 },
    "Bitcoin": { start: 6000, drift: 0.0009, vol: 0.035 },
    "S&P 500": { start: 2100, drift: 0.00035, vol: 0.011 },
    "CAC 40": { start: 4400, drift: 0.00022, vol: 0.010 },
  };

  const series = {};
  const days = 2600; // ~10 ans de jours de cotation
  const end = new Date();

  Object.entries(configs).forEach(([label, cfg]) => {
    let price = cfg.start;
    const dates = [], close = [];
    // seed pseudo-aléatoire simple et déterministe pour un rendu stable
    let seed = label.length * 7919;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

    for (let i = days; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const ret = cfg.drift + (rand() - 0.5) * 2 * cfg.vol;
      price = Math.max(price * (1 + ret), 0.01);
      dates.push(d.toISOString().slice(0, 10));
      close.push(Math.round(price * 10000) / 10000);
    }
    series[label] = { ticker: label, dates, close };
  });

  return series;
}

/* ------------------------------------------------------------------ */
/* Init                                                                 */
/* ------------------------------------------------------------------ */

(async function init() {
  initTheme();
  initControls();
  await loadData();
  renderTicker();
})();
