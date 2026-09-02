# 🧭 Macro Lab

Système automatisé d'analyse de l'actualité macroéconomique : détecte les
informations susceptibles d'impacter les marchés financiers, calcule un
score d'impact dynamique, et affiche le tout sur un dashboard statique
(sombre/clair) inspiré d'un terminal financier.

100% gratuit à faire tourner : **GitHub Actions** (scraping + scoring
horaire) + **Vercel** (hébergement statique du dashboard).

---

## ✨ Fonctionnalités

- 🔎 Scraping automatique d'articles internationaux (NYT, Reuters, AP…) toutes les heures
- 📄 Analyse du **contenu complet** de chaque article (pas juste le titre), via `trafilatura`
- 📊 Scoring dynamique : poids finance / géopolitique / politique monétaire, normalisé par un **z-score glissant sur 7 jours**
- 🏷️ Détection de thèmes critiques : guerre, sanctions, crash de marché, urgence Fed, récession, inflation, crise bancaire, énergie, banque centrale, volatilité, défaut souverain, choc géopolitique
- 🗂️ Historique glissant léger (7 jours, purge automatique)
- 📈 Prédictions en série temporelle : **or, EUR/USD, bitcoin, S&P 500, CAC 40** (régression pondérée par le climat macro détecté)
- 🖥️ Dashboard statique HTML/Tailwind, **mode sombre et clair**, filtres par thème, recherche, ticker d'alertes défilant

---

## 🗂️ Structure du dépôt

```
macro-lab/
├── .github/workflows/scrape.yml   # Automatisation horaire (cron)
├── scraper/                       # Pipeline Python
│   ├── config.py                  # Sources RSS, chemins, tickers suivis
│   ├── lexicon.py                 # Dictionnaire de poids (finance/géopo/politique monétaire)
│   ├── scraper.py                 # Récupération RSS + contenu complet
│   ├── scoring.py                 # Score brut + normalisation z-score 7j
│   ├── themes.py                  # Détection des thèmes critiques
│   ├── storage.py                 # Historique glissant + snapshot public
│   ├── predict.py                 # Prédictions séries temporelles
│   ├── run.py                     # Orchestrateur (point d'entrée)
│   └── requirements.txt
├── data/history/                  # Historique interne (7 jours glissants, committé par le bot)
├── public/                        # Site statique déployé sur Vercel
│   ├── index.html
│   ├── css/styles.css
│   ├── js/app.js
│   └── data/                      # Snapshots publics (articles.json, predictions.json)
├── vercel.json
└── README.md
```

---

## 🚀 Mise en route (5 minutes)

### 1. Cloner et pousser sur GitHub

```bash
git init
git add .
git commit -m "init: Macro Lab"
git branch -M main
git remote add origin https://github.com/<votre-user>/macro-lab.git
git push -u origin main
```

### 2. Activer GitHub Actions

Rien à faire : le workflow `.github/workflows/scrape.yml` se déclenche
automatiquement toutes les heures (`cron: "5 * * * *"`). Vous pouvez
aussi le lancer manuellement depuis l'onglet **Actions** → *Macro Lab —
Scraping horaire* → **Run workflow**.

> Le workflow a besoin de la permission `contents: write` (déjà
> configurée) pour committer `data/` et `public/data/` automatiquement.

### 3. Déployer le dashboard sur Vercel

1. Allez sur [vercel.com/new](https://vercel.com/new) et importez le dépôt GitHub.
2. Vercel détecte `vercel.json` : **aucune configuration de build nécessaire**
   (site 100% statique, `outputDirectory: "public"`).
3. Déployez. Le site se met à jour automatiquement à chaque `git push`
   déclenché par le bot horaire.

### 4. Tester en local

```bash
# Backend / pipeline (depuis la racine macro-lab/)
pip install -r scraper/requirements.txt
python -m scraper.run

# Frontend (serveur statique simple)
cd public
python -m http.server 8000
# puis ouvrez http://localhost:8000
```

Tant que `public/data/articles.json` est vide (avant le premier run),
le dashboard affiche automatiquement des **données de démonstration**
pour que l'interface reste présentable.

---

## ⚙️ Personnalisation

- **Sources RSS** : `scraper/config.py` → `RSS_SOURCES`
- **Poids du scoring** : `scraper/lexicon.py` → `FINANCE_WEIGHTS`, `MONETARY_POLICY_WEIGHTS`, `GEOPOLITICS_WEIGHTS`, `MARKET_WEIGHTS`
- **Thèmes critiques** : `scraper/lexicon.py` → `THEMES`
- **Seuil d'alerte** : `scraper/scoring.py` → `SEUIL_ALERTE`
- **Fenêtre d'historique** : `scraper/config.py` → `HISTORY_WINDOW_DAYS`
- **Tickers suivis pour les prédictions** : `scraper/config.py` → `TICKERS`
- **Fréquence du cron** : `.github/workflows/scrape.yml` → `cron: "5 * * * *"`

---

## 🧮 Comment fonctionne le score ?

1. **Score brut** (`scoring.raw_score`) : somme des poids des mots-clés
   trouvés dans le texte complet (bonus si le mot apparaît dans le titre),
   normalisée par la longueur de l'article.
2. **Normalisation dynamique** (`scoring.normalized_scores`) : le score
   brut est transformé en **z-score** par rapport à la moyenne et
   l'écart-type des scores des 7 derniers jours, puis remis à l'échelle
   sur `[0, 15]`. Cela permet de faire ressortir les événements
   **atypiques** plutôt que de simplement récompenser les mots-clés
   fréquents.
3. **Seuil d'alerte** : tout article avec un score normalisé ≥ 5.0 est
   marqué comme "alerte critique" et apparaît dans le ticker défilant.

## 📈 Prédictions de marché — comment ça marche, et limites à connaître

Le module `scraper/predict.py` utilise un modèle **ARIMA**
(AutoRegressive Integrated Moving Average, via `statsmodels`) ajusté sur
les **90 derniers jours** de clôtures quotidiennes (`yfinance`) :

1. **Sélection d'ordre automatique** : une petite grille d'ordres
   `(p, d, q)` (avec `d=1`, les prix financiers étant quasi toujours des
   marches aléatoires non-stationnaires) est testée, et celle qui
   minimise l'**AIC** (Akaike Information Criterion) est retenue.
2. **Prévision à 5 jours + intervalle de confiance à 90%**, calculé
   statistiquement par `statsmodels` (pas une simple marge arbitraire).
3. **Biais macro post-hoc** : si le score macro moyen des dernières 24h
   dépasse le seuil d'alerte (5.0), la tendance déjà détectée par ARIMA
   est légèrement amplifiée (jamais inversée), proportionnellement à la
   tension détectée — un overlay transparent et borné, pas un second
   modèle qui écraserait le signal statistique.

Le dashboard affiche, pour chaque actif suivi (or, EUR/USD, bitcoin,
S&P 500, CAC 40), une mini-trajectoire avec sa bande de confiance
(elle s'élargit avec l'horizon, comme attendu d'un ARIMA), l'ordre du
modèle retenu et son AIC (au survol).

**Pourquoi ARIMA et pas un modèle plus lourd (Prophet, LSTM,
`pmdarima.auto_arima`) ?** Le pipeline tourne gratuitement, toutes les
heures, sur un runner GitHub Actions sans GPU — ARIMA s'ajuste en
quelques centaines de ms par ticker, ce qui reste dans ce budget.
Pour aller plus loin :
- `pmdarima.auto_arima` pour une recherche d'ordre plus exhaustive,
- un `SARIMAX` avec le score macro quotidien comme **variable exogène**
  historisée (nécessite de conserver un historique du score, pas
  seulement le score instantané),
- un modèle de volatilité (GARCH) en complément pour mieux calibrer les
  intervalles de confiance en période de forte tension macro.

**⚠️ Ces prévisions sont indicatives et ne constituent en aucun cas un
conseil en investissement.**

### 🩺 « Prédictions indisponibles pour le moment » après plusieurs heures

Ce n'est pas normal si le workflow tourne bien depuis un moment. Causes
les plus fréquentes, dans l'ordre de probabilité :

1. **Yahoo Finance bloque/rate-limite les IP partagées de GitHub
   Actions** — très courant. Le module retente 3 fois avec backoff, puis
   **bascule automatiquement sur Stooq** (source gratuite sans clé) pour
   les tickers mappés dans `STOOQ_FALLBACK`. Si les deux échouent en même
   temps, le fichier `predictions.json` précédent est **conservé tel
   quel** (jamais écrasé par un état vide) — regardez son champ
   `"failures"` pour voir quels tickers ont posé problème au dernier run.
2. **Le workflow n'a jamais réussi à s'exécuter jusqu'au bout** :
   ouvrez l'onglet **Actions** du dépôt GitHub, cliquez sur le dernier
   run de *Macro Lab — Scraping horaire*, et regardez l'étape *Exécution
   du pipeline* — les lignes `yfinance indisponible pour ... repli
   Stooq` ou `Aucune prédiction générée` indiquent précisément où ça
   coince.
3. **Le fichier n'a jamais été committé** : vérifiez que l'étape *Commit
   et push des données mises à jour* du workflow s'exécute sans erreur
   de permission (le workflow doit avoir `permissions: contents: write`,
   déjà configuré dans `scrape.yml`).

Le dashboard distingue désormais deux cas dans son message : *le
pipeline n'a jamais réussi* (aucun `generated_at` dans le fichier) vs
*le dernier run a échoué mais un run précédent avait réussi* (auquel cas
vous continuez à voir les données du dernier run réussi, pas un message
d'erreur).

---

## 📜 Licence

Projet fourni tel quel, à des fins pédagogiques et de recherche. Respectez
les conditions d'utilisation (robots.txt, ToS) des sites scrapés.
