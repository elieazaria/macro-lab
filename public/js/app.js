/**
 * app.js — Macro Lab dashboard
 * ------------------------------------------------------------------
 * Site 100% statique : lit data/articles.json et data/predictions.json
 * (générés par scraper/run.py via GitHub Actions) et affiche le
 * dashboard, sans backend serveur (compatible Vercel gratuit).
 */

const DATA_URL = "data/articles.json";
const PREDICTIONS_URL = "data/predictions.json";

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
  loadPredictions();
}

async function loadPredictions() {
  const grid = document.getElementById("predictions-grid");
  try {
    const res = await fetch(PREDICTIONS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("introuvable");
    const json = await res.json();
    renderPredictions(json.predictions || {});
  } catch (err) {
    renderPredictions(demoPredictions());
  }
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
/* Prédictions marchés                                                 */
/* ------------------------------------------------------------------ */

function renderPredictions(predictions) {
  const grid = document.getElementById("predictions-grid");
  const entries = Object.entries(predictions);
  if (entries.length === 0) {
    grid.innerHTML = `<div class="text-xs font-mono text-muted col-span-full">Prédictions indisponibles pour le moment.</div>`;
    return;
  }
  grid.innerHTML = entries.map(([label, p]) => {
    const up = p.predicted_change_pct >= 0;
    const order = p.model?.order ? `(${p.model.order.join(",")})` : "";
    const conf = p.model?.confidence_level || "90%";
    return `
      <div class="rounded-lg border border-edge bg-panel-alt p-3">
        <div class="flex items-center justify-between mb-1">
          <p class="text-[10px] font-mono uppercase tracking-wide text-muted">${label}</p>
          <span class="text-[9px] font-mono text-muted" title="Modèle ARIMA${order}, AIC ${p.model?.aic ?? "—"}, IC ${conf}">ARIMA${order}</span>
        </div>
        <p class="font-mono text-lg font-bold">${formatPrice(p.last_price)}</p>
        <p class="text-xs font-mono font-semibold mt-0.5 ${up ? "text-emerald-500" : "text-red-500"}">
          ${up ? "▲" : "▼"} ${Math.abs(p.predicted_change_pct)}% / ${p.horizon_days}j
        </p>
        ${renderForecastSparkline(p)}
        <p class="text-[9px] font-mono text-muted mt-1">IC ${conf} : ${formatPrice(p.forecast_lower?.[p.forecast_lower.length - 1])} – ${formatPrice(p.forecast_upper?.[p.forecast_upper.length - 1])}</p>
      </div>
    `;
  }).join("");
}

/**
 * Mini sparkline SVG : trajectoire moyenne ARIMA + bande d'intervalle
 * de confiance (forecast_lower / forecast_upper), point de départ =
 * dernier prix observé.
 */
function renderForecastSparkline(p) {
  const forecast = p.forecast || [];
  const lower = p.forecast_lower || [];
  const upper = p.forecast_upper || [];
  if (forecast.length === 0) return "";

  const allVals = [p.last_price, ...forecast, ...lower, ...upper].filter(v => typeof v === "number");
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;

  const w = 220, h = 46, padX = 4;
  const n = forecast.length;
  const stepX = (w - padX * 2) / n;
  const xAt = i => padX + stepX * i;
  const yAt = v => h - ((v - min) / range) * (h - 6) - 3;

  const startX = padX, startY = yAt(p.last_price);
  const meanPts = [`${startX},${startY}`, ...forecast.map((v, i) => `${xAt(i + 1)},${yAt(v)}`)].join(" ");

  const upperPts = upper.map((v, i) => `${xAt(i + 1)},${yAt(v)}`).join(" ");
  const lowerPts = lower.map((v, i) => `${xAt(i + 1)},${yAt(v)}`).reverse().join(" ");
  const bandPts = `${startX},${startY} ${upperPts} ${lowerPts}`;

  const up = p.predicted_change_pct >= 0;
  const lineColor = up ? "#10b981" : "#ef4444";

  return `
    <svg viewBox="0 0 ${w} ${h}" class="w-full h-[46px] mt-2">
      <polygon points="${bandPts}" fill="${lineColor}" opacity="0.12" />
      <polyline points="${meanPts}" fill="none" stroke="${lineColor}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx="${startX}" cy="${startY}" r="2.2" fill="var(--ink)" />
    </svg>
  `;
}

function formatPrice(v) {
  if (v == null) return "—";
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
    score_moyen: (articles.reduce((s, a) => s + a.score, 0) / articles.length).toFixed(2),
    seuil_alerte: 5.0,
    themes: computeThemeCounts(articles),
  };
  return { articles, meta };
}

function demoPredictions() {
  // Génère une trajectoire ARIMA plausible (moyenne + bande de confiance
  // qui s'élargit avec l'horizon) à partir d'un prix de départ et d'une
  // dérive cible, pour illustrer le rendu sans backend connecté.
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
    return {
      last_price: last,
      forecast, forecast_lower: lower, forecast_upper: upper,
      predicted_change_pct: changePct,
      horizon_days: horizon,
      model: { type: "ARIMA", order, aic, confidence_level: "90%" },
    };
  };

  return {
    "Or": build(2734.5, 1.8, 5, [1, 1, 1], 612.4, 1.1),
    "EUR/USD": build(1.0842, -0.6, 5, [0, 1, 1], -845.2, 0.5),
    "Bitcoin": build(68210, -3.2, 5, [2, 1, 1], 1584.9, 3.4),
    "S&P 500": build(5320, -1.1, 5, [1, 1, 0], 720.1, 1.3),
    "CAC 40": build(8120, 0.4, 5, [0, 1, 2], 705.6, 0.9),
  };
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
