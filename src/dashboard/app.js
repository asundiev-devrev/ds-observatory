/* ============================================================
   Design System Observatory — Dashboard Application
   ============================================================ */

(function () {
  'use strict';

  // ---- Constants ----
  // Arcade fruit-named palette (from devrev-web arcade-tokens.css)
  var COLORS = {
    arcade:   'hsl(89, 85%, 46%)',      // hardy-500
    dls:      'hsl(198, 94%, 57%)',     // shuiguo-500
    detached: 'hsl(13, 90%, 54%)',      // persimmon-500
    local:    'hsl(259, 94%, 44%)',     // jabuticaba-400
    raw:      'hsl(0, 0%, 81%)',        // husk-500
    other:    'hsl(320, 2%, 64%)',      // husk-600
    bang:     'hsl(48, 100%, 51%)',     // banginapalli-400
  };

  // ---- State ----
  var state = {
    analytics: null,
    audit: null,
    canonical: null,
    snapshots: [],       // { timestamp, analytics, audit } sorted oldest→newest
    inventorySort: { key: 'insertions', dir: 'desc' },
    inventoryFilter: 'all',
    selectedFileKey: null,
    expandedRow: null,
  };

  // ---- Data Loading ----

  function loadData() {
    if (window.__DS_OBSERVATORY_DATA__) {
      return Promise.resolve(window.__DS_OBSERVATORY_DATA__);
    }
    return Promise.all([
      fetch('/data/library-analytics.json').then(function (r) { return r.json(); }),
      fetch('/data/hot-file-audit.json').then(function (r) { return r.json(); }),
      fetch('/data/canonical-components.json').then(function (r) { return r.json(); }),
    ]).then(function (results) {
      return { analytics: results[0], audit: results[1], canonical: results[2] };
    });
  }

  function loadSnapshots() {
    return fetch('/data/snapshots/').then(function (r) { return r.json(); }).then(function (files) {
      // Group by truncated timestamp (strip milliseconds) so pairs match
      var analytics = [];
      var audits = [];
      files.forEach(function (f) {
        var m = f.match(/^(library-analytics|hot-file-audit)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
        if (!m) return;
        if (m[1] === 'library-analytics') analytics.push({ ts: m[2], file: f });
        else audits.push({ ts: m[2], file: f });
      });

      // Match pairs by truncated timestamp
      var auditMap = {};
      audits.forEach(function (a) { auditMap[a.ts] = a.file; });
      var pairs = analytics
        .filter(function (a) { return auditMap[a.ts]; })
        .map(function (a) { return { ts: a.ts, analyticsFile: a.file, auditFile: auditMap[a.ts] }; })
        .sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });

      // Load each pair
      return Promise.all(pairs.map(function (p) {
        return Promise.all([
          fetch('/data/snapshots/' + p.analyticsFile).then(function (r) { return r.json(); }),
          fetch('/data/snapshots/' + p.auditFile).then(function (r) { return r.json(); }),
        ]).then(function (results) {
          // p.ts = "2026-04-14T16-59-03" → "2026-04-14 16:59"
          var label = p.ts.slice(0, 10) + ' ' + p.ts.slice(11).replace(/-/g, ':').slice(0, 5);
          return { timestamp: label, analytics: results[0], audit: results[1] };
        });
      }));
    }).catch(function () { return []; });
  }

  // ---- Helpers ----

  function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
  function suspectedCount(file) {
    if (typeof file.suspectedDetachmentCount === 'number') return file.suspectedDetachmentCount;
    return (file.suspectedDetachments || []).length;
  }
  function fmtPct(v) { return v.toFixed(1) + '%'; }
  function fmtNum(n) { return n.toLocaleString(); }
  var _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function _ord(d) { if (d > 3 && d < 21) return 'th'; switch (d % 10) { case 1: return 'st'; case 2: return 'nd'; case 3: return 'rd'; default: return 'th'; } }
  function fmtDate(iso) {
    var parts = iso.slice(0, 10).split('-');
    var mon = _MONTHS[parseInt(parts[1], 10) - 1] || parts[1];
    var day = parseInt(parts[2], 10);
    return mon + ' ' + day + _ord(day);
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'className') e.className = attrs[k];
        else if (k === 'textContent') e.textContent = attrs[k];
        else if (k === 'innerHTML') e.innerHTML = attrs[k];
        else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (k === 'dataset') Object.assign(e.dataset, attrs[k]);
        else e.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
    }
    return e;
  }

  // ---- Tab Navigation ----

  function initTabs() {
    var tabBar = document.querySelector('.tab-bar');
    var tabs = Array.from(tabBar.querySelectorAll('[role="tab"]'));

    function activate(tab) {
      tabs.forEach(function (t) {
        var selected = t === tab;
        t.setAttribute('aria-selected', selected ? 'true' : 'false');
        t.setAttribute('tabindex', selected ? '0' : '-1');
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) {
          if (selected) {
            panel.classList.remove('hidden');
            panel.removeAttribute('hidden');
          } else {
            panel.classList.add('hidden');
            panel.setAttribute('hidden', '');
          }
        }
      });
      tab.focus();
    }

    tabBar.addEventListener('click', function (e) {
      var tab = e.target.closest('[role="tab"]');
      if (tab) activate(tab);
    });

    tabBar.addEventListener('keydown', function (e) {
      var current = document.activeElement;
      var idx = tabs.indexOf(current);
      if (idx < 0) return;
      var next;
      if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(idx - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        activate(next);
      }
    });
  }

  // ---- Metric Computation ----

  function computeMetrics(analytics, audit) {
    var files = audit && audit.files ? audit.files : [];
    var totalDS = 0;
    var totalArcade = 0;
    var totalDetached = 0;
    var totalComponentSurface = 0;
    var totalNodes = 0;

    files.forEach(function (f) {
      var b = f.breakdown;
      var suspected = suspectedCount(f);
      totalDS += b.dsArcade + b.dsDls + b.dsOther;
      totalArcade += b.dsArcade;
      totalDetached += b.detached + suspected;
      totalComponentSurface += f.componentSurface + suspected;
      totalNodes += f.totalNodes;
    });

    var dsCoverage = pct(totalDS, totalComponentSurface);
    var arcadeAdoption = pct(totalArcade, totalDS || 1);
    var detachRate = pct(totalDetached, totalComponentSurface || 1);

    var healthScore = Math.round(0.4 * dsCoverage + 0.35 * arcadeAdoption + 0.25 * (100 - detachRate));

    return {
      dsCoverage: dsCoverage,
      arcadeAdoption: arcadeAdoption,
      detachRate: detachRate,
      healthScore: healthScore,
      totalDS: totalDS,
      totalArcade: totalArcade,
      totalDetached: totalDetached,
      totalComponentSurface: totalComponentSurface,
      totalNodes: totalNodes,
    };
  }

  function computeFileHealth(file) {
    var b = file.breakdown;
    var suspected = suspectedCount(file);
    var surface = (file.componentSurface + suspected) || 1;
    var dsTotal = b.dsArcade + b.dsDls + b.dsOther;
    var dsCoverage = pct(dsTotal, surface);
    var arcadeAdoption = pct(b.dsArcade, dsTotal || 1);
    var detachRate = pct(b.detached + suspected, surface);
    var healthScore = Math.round(0.4 * dsCoverage + 0.35 * arcadeAdoption + 0.25 * (100 - detachRate));
    return {
      fileKey: file.fileKey,
      fileName: file.fileName,
      dsCoverage: dsCoverage,
      arcadeAdoption: arcadeAdoption,
      detachRate: detachRate,
      healthScore: healthScore,
      surface: surface,
    };
  }

  // ---- Tab 1: Design Coverage ----

  function scoreColor(score) {
    if (score >= 70) return COLORS.arcade;
    if (score >= 50) return COLORS.bang;
    return COLORS.detached;
  }

  function renderHealthHero(metrics, prevMetrics) {
    var container = document.getElementById('health-hero');
    if (!container) return;
    container.innerHTML = '';

    var items = [
      { label: 'Health score', value: String(metrics.healthScore), prev: prevMetrics ? prevMetrics.healthScore : null, color: scoreColor(metrics.healthScore) },
      { label: 'DS coverage', value: fmtPct(metrics.dsCoverage), prev: prevMetrics ? prevMetrics.dsCoverage : null },
      { label: 'Arcade adoption', value: fmtPct(metrics.arcadeAdoption), prev: prevMetrics ? prevMetrics.arcadeAdoption : null },
      { label: 'Detachment rate', value: '~' + fmtPct(metrics.detachRate), prev: prevMetrics ? prevMetrics.detachRate : null, invert: true },
    ];

    items.forEach(function (item) {
      var trendHtml = '';
      if (item.prev !== null && item.prev !== undefined) {
        var curr = parseFloat(item.value);
        var diff = item.invert ? item.prev - curr : curr - item.prev;
        if (Math.abs(diff) > 0.5) {
          var cls = diff > 0 ? 'trend-up' : 'trend-down';
          var arrow = diff > 0 ? '\u2191' : '\u2193';
          trendHtml = ' <span class="' + cls + '">' + arrow + '</span>';
        }
      }
      var valueStyle = item.color ? 'color:' + item.color : '';
      container.appendChild(el('div', { className: 'health-card' }, [
        el('div', { className: 'health-card-label', textContent: item.label }),
        el('div', { className: 'health-card-value', innerHTML: item.value + trendHtml, style: valueStyle }),
      ]));
    });
  }

  function renderLeaderboard(audit, snapshots) {
    var container = document.getElementById('leaderboard');
    if (!container) return;
    container.innerHTML = '';

    var files = audit && audit.files ? audit.files : [];
    if (!files.length) {
      container.innerHTML = '<div class="heatmap-empty">No file data available</div>';
      return;
    }

    // Compute health scores for current files
    var fileScores = files.map(function (f) { return computeFileHealth(f); });
    fileScores.sort(function (a, b) { return b.healthScore - a.healthScore; });

    // Get previous snapshot's file scores for trend
    var prevScoreMap = {};
    if (snapshots && snapshots.length >= 2) {
      var prevSnap = snapshots[snapshots.length - 2];
      if (prevSnap && prevSnap.audit && prevSnap.audit.files) {
        prevSnap.audit.files.forEach(function (f) {
          var h = computeFileHealth(f);
          prevScoreMap[h.fileKey] = h.healthScore;
        });
      }
    }

    // Legend
    var legend = el('div', { className: 'leaderboard-legend' });
    [{ label: 'Arcade', color: COLORS.arcade }, { label: 'DLS', color: COLORS.dls }, { label: 'Other', color: COLORS.other }].forEach(function (item) {
      legend.appendChild(el('span', { className: 'heatmap-legend-item' }, [
        el('span', { className: 'heatmap-legend-dot', style: 'background:' + item.color }),
        el('span', { textContent: item.label }),
      ]));
    });
    container.appendChild(legend);

    fileScores.forEach(function (fs, i) {
      var prevScore = prevScoreMap[fs.fileKey];
      var trendEl;
      if (prevScore !== undefined) {
        var diff = fs.healthScore - prevScore;
        if (diff > 1) trendEl = el('span', { className: 'leaderboard-trend trend-up', textContent: '\u2191' });
        else if (diff < -1) trendEl = el('span', { className: 'leaderboard-trend trend-down', textContent: '\u2193' });
        else trendEl = el('span', { className: 'leaderboard-trend trend-flat', textContent: '\u2014' });
      } else {
        trendEl = el('span', { className: 'leaderboard-trend', textContent: '' });
      }

      // Mini bar showing arcade/dls/other proportions of DS instances
      var file = files.find(function (f) { return f.fileKey === fs.fileKey; });
      var bar = el('div', { className: 'leaderboard-bar-wrap' });
      if (file) {
        var b = file.breakdown;
        var dsTotal = b.dsArcade + b.dsDls + b.dsOther;
        if (dsTotal > 0) {
          bar.appendChild(el('div', { style: 'width:' + pct(b.dsArcade, dsTotal) + '%;background:' + COLORS.arcade }));
          bar.appendChild(el('div', { style: 'width:' + pct(b.dsDls, dsTotal) + '%;background:' + COLORS.dls }));
          bar.appendChild(el('div', { style: 'width:' + pct(b.dsOther, dsTotal) + '%;background:' + COLORS.other }));
        }
      }

      var row = el('div', { className: 'leaderboard-row' }, [
        el('span', { className: 'leaderboard-rank', textContent: String(i + 1) }),
        el('span', { className: 'leaderboard-name', textContent: fs.fileName, title: fs.fileName }),
        bar,
        el('span', { className: 'leaderboard-score', textContent: String(fs.healthScore), style: 'color:' + scoreColor(fs.healthScore) }),
        trendEl,
        el('span', { className: 'leaderboard-details' }, [
          el('span', { className: 'leaderboard-detail', textContent: fmtPct(fs.dsCoverage) + ' cov' }),
          el('span', { className: 'leaderboard-detail', textContent: fmtPct(fs.arcadeAdoption) + ' arc' }),
          el('span', { className: 'leaderboard-detail', textContent: '~' + fmtPct(fs.detachRate) + ' det' }),
        ]),
      ]);
      container.appendChild(row);
    });
  }

  function renderActivityGrid(snapshots) {
    var card = document.getElementById('activity-card');
    var container = document.getElementById('activity-grid');
    if (!container || !card) return;

    var snapsToUse = snapshots.filter(function (s) {
      return s.audit && s.audit.files && s.audit.files.length > 0;
    });
    if (snapsToUse.length < 2) { card.style.display = 'none'; return; }
    card.style.display = '';

    // Build 52 weekly columns ending on current week
    var now = new Date();
    var weeks = [];
    // Start from 51 weeks ago (Monday of that week)
    var startDay = new Date(now);
    startDay.setDate(startDay.getDate() - startDay.getDay() + 1 - 51 * 7); // Monday 51 weeks ago
    for (var w = 0; w < 52; w++) {
      var weekStart = new Date(startDay);
      weekStart.setDate(weekStart.getDate() + w * 7);
      var weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      var key = weekStart.toISOString().slice(0, 10);
      weeks.push({
        key: key,
        start: weekStart,
        end: weekEnd,
        month: weekStart.getMonth(),
        year: weekStart.getFullYear(),
      });
    }

    // Determine month label positions (first week of each month)
    var monthLabels = []; // { index, label }
    var prevMonth = -1;
    weeks.forEach(function (wk, i) {
      if (wk.month !== prevMonth) {
        monthLabels.push({ index: i, label: _MONTHS[wk.month] });
        prevMonth = wk.month;
      }
    });

    // Bucket snapshots into weeks — latest per file per week
    // weekData[weekIndex][fileName] = { level, health }
    var weekData = [];
    for (var wi = 0; wi < 52; wi++) weekData.push({});

    var allFiles = {};
    snapsToUse.forEach(function (snap) {
      var snapDate = new Date(snap.timestamp.slice(0, 10).replace(/-/g, '/'));
      // Find which week this snapshot belongs to
      for (var i = 51; i >= 0; i--) {
        if (snapDate >= weeks[i].start && snapDate <= weeks[i].end) {
          snap.audit.files.forEach(function (f) {
            var name = f.fileName || f.fileKey;
            allFiles[name] = true;
            var h = computeFileHealth(f);
            var level = 0;
            if (h.healthScore >= 75) level = 4;
            else if (h.healthScore >= 60) level = 3;
            else if (h.healthScore >= 45) level = 2;
            else level = 1;
            weekData[i][name] = { level: level, health: h };
          });
          break;
        }
      }
    });
    var fileNames = Object.keys(allFiles).sort();

    container.innerHTML = '';

    // Month labels header
    var headerRow = el('div', { className: 'activity-row' });
    headerRow.appendChild(el('span', { className: 'activity-label', textContent: '' }));
    var headerCells = el('div', { className: 'activity-cells' });
    weeks.forEach(function (wk, i) {
      var mlabel = monthLabels.find(function (m) { return m.index === i; });
      headerCells.appendChild(el('span', {
        className: 'activity-month-label',
        textContent: mlabel ? mlabel.label : '',
      }));
    });
    headerRow.appendChild(headerCells);
    container.appendChild(headerRow);

    // One row per file
    fileNames.forEach(function (fileName) {
      var row = el('div', { className: 'activity-row' });
      row.appendChild(el('span', { className: 'activity-label', textContent: fileName, title: fileName }));
      var cells = el('div', { className: 'activity-cells' });

      weeks.forEach(function (wk, i) {
        var entry = weekData[i][fileName];
        var level = entry ? entry.level : 0;
        var weekLabel = fmtDate(wk.key);
        var tip;
        if (entry) {
          var h = entry.health;
          tip = fileName + '\nWeek of ' + weekLabel + '\nHealth: ' + h.healthScore + ' \u2014 DS ' + fmtPct(h.dsCoverage) + ', Arcade ' + fmtPct(h.arcadeAdoption) + ', Detach ' + fmtPct(h.detachRate);
        } else {
          tip = fileName + '\nWeek of ' + weekLabel + '\nNo data';
        }
        cells.appendChild(el('div', {
          className: 'activity-cell',
          dataset: { level: String(level), tip: tip },
        }));
      });
      row.appendChild(cells);
      container.appendChild(row);
    });

    // Legend
    var legend = el('div', { className: 'activity-grid-legend' });
    legend.appendChild(el('span', { textContent: 'Less' }));
    [0, 1, 2, 3, 4].forEach(function (lvl) {
      legend.appendChild(el('div', { className: 'activity-cell', dataset: { level: String(lvl) } }));
    });
    legend.appendChild(el('span', { textContent: 'More healthy' }));
    container.appendChild(legend);
  }

  // Instant tooltip for activity grid cells and leaderboard rows
  (function initGridTooltip() {
    var tip = document.getElementById('grid-tooltip');
    if (!tip) return;
    document.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('[data-tip]');
      if (!cell) { tip.classList.remove('visible'); return; }
      tip.textContent = cell.dataset.tip;
      tip.classList.add('visible');
      var rect = cell.getBoundingClientRect();
      var tipRect = tip.getBoundingClientRect();
      var left = rect.left + rect.width / 2 - tipRect.width / 2;
      var top = rect.top - tipRect.height - 6;
      if (top < 4) top = rect.bottom + 6;
      if (left < 4) left = 4;
      if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - tipRect.width - 4;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    });
    document.addEventListener('mouseout', function (e) {
      if (e.target.closest('[data-tip]')) tip.classList.remove('visible');
    });
  })();

  function renderMetricCards(metrics) {
    var container = document.getElementById('metric-cards');
    container.innerHTML = '';

    var cards = [
      {
        label: 'DS coverage',
        value: fmtPct(metrics.dsCoverage),
        detail: fmtNum(metrics.totalDS) + ' of ' + fmtNum(metrics.totalComponentSurface) + ' component instances',
        tint: metrics.dsCoverage >= 70 ? 'green' : metrics.dsCoverage < 50 ? 'orange' : 'neutral',
        tip: 'Percentage of component instances from any design system library',
      },
      {
        label: 'Arcade adoption',
        value: fmtPct(metrics.arcadeAdoption),
        detail: fmtNum(metrics.totalArcade) + ' Arcade instances',
        tint: 'yellow',
        tip: 'Percentage of DS instances that are from the Arcade library',
      },
      {
        label: 'Detachment rate',
        value: '~' + fmtPct(metrics.detachRate),
        detail: fmtNum(metrics.totalDetached) + ' detached instances',
        tint: metrics.detachRate > 15 ? 'orange' : 'green',
        tip: 'Estimated detachments: includes broken refs + frames matching DS component names. Approximate — Figma does not expose true detachment data via API.',
      },
    ];

    cards.forEach(function (c) {
      var card = el('div', { className: 'metric-card ' + c.tint }, [
        el('div', { className: 'metric-label' }, [
          c.label,
          el('span', { className: 'tooltip-trigger', tabindex: '0', 'aria-label': c.tip }, [
            '?',
            el('span', { className: 'tooltip', textContent: c.tip }),
          ]),
        ]),
        el('div', { className: 'metric-value', textContent: c.value }),
        el('div', { className: 'metric-detail', textContent: c.detail }),
      ]);
      container.appendChild(card);
    });
  }

  function renderHeatmap(audit) {
    var container = document.getElementById('heatmap');
    if (!container) return;
    container.innerHTML = '';

    var files = audit && audit.files ? audit.files : [];
    if (!files.length) {
      container.innerHTML = '<div class="heatmap-empty">No file data available</div>';
      return;
    }

    // Sort by DS coverage descending
    var sorted = files.slice().sort(function (a, b) {
      var aDS = a.breakdown.dsArcade + a.breakdown.dsDls + a.breakdown.dsOther;
      var bDS = b.breakdown.dsArcade + b.breakdown.dsDls + b.breakdown.dsOther;
      return pct(bDS, b.componentSurface) - pct(aDS, a.componentSurface);
    });

    var legendItems = [
      { label: 'Arcade', color: COLORS.arcade },
      { label: 'DLS', color: COLORS.dls },
      { label: 'Other DS', color: COLORS.other },
      { label: 'Detached', color: COLORS.detached },
      { label: 'Local', color: COLORS.local },
    ];
    var legend = el('div', { className: 'heatmap-legend' });
    legendItems.forEach(function (item) {
      legend.appendChild(el('span', { className: 'heatmap-legend-item' }, [
        el('span', { className: 'heatmap-legend-dot', style: 'background:' + item.color }),
        el('span', { textContent: item.label }),
      ]));
    });
    container.appendChild(legend);

    sorted.forEach(function (file) {
      var b = file.breakdown;
      var suspected = suspectedCount(file);
      var total = (file.componentSurface + suspected) || 1;
      var dsTotal = b.dsArcade + b.dsDls + b.dsOther;
      var coverage = pct(dsTotal, total);

      var segments = [
        { value: b.dsArcade, color: COLORS.arcade },
        { value: b.dsDls, color: COLORS.dls },
        { value: b.dsOther, color: COLORS.other },
        { value: b.detached + suspected, color: COLORS.detached },
        { value: b.localComponent, color: COLORS.local },
      ];
      var barTotal = segments.reduce(function (s, seg) { return s + seg.value; }, 0) || 1;

      var bar = el('div', { className: 'heatmap-bar-track' });
      segments.forEach(function (seg) {
        if (seg.value > 0) {
          bar.appendChild(el('div', {
            style: 'width:' + pct(seg.value, barTotal) + '%;background:' + seg.color,
            title: fmtNum(seg.value) + ' instances',
          }));
        }
      });

      container.appendChild(el('div', { className: 'heatmap-row' }, [
        el('div', { className: 'heatmap-label', textContent: file.fileName, title: file.fileName }),
        bar,
        el('div', { className: 'heatmap-pct', textContent: fmtPct(coverage) }),
      ]));
    });
  }

  // ---- Canonical Component Matching ----

  function matchCanonical(name, canonical) {
    if (!canonical) return null;
    var lower = name.toLowerCase();

    // Check exclude patterns first
    var excludes = canonical.excludePatterns || [];
    for (var i = 0; i < excludes.length; i++) {
      if (lower.startsWith(excludes[i].toLowerCase())) return '__excluded__';
    }

    // Match against canonical component patterns
    var comps = canonical.components || {};
    var keys = Object.keys(comps);
    for (var j = 0; j < keys.length; j++) {
      var patterns = comps[keys[j]];
      for (var k = 0; k < patterns.length; k++) {
        if (lower.startsWith(patterns[k].toLowerCase())) return keys[j];
      }
    }

    return null; // unclassified
  }

  // ---- Trend Chart ----

  function renderTrendChart(snapshots) {
    var card = document.getElementById('trend-card');
    var canvas = document.getElementById('trend-chart');
    var legendEl = document.getElementById('trend-legend');
    if (!canvas || !card) return;

    var points;

    // Use pre-computed snapshotMetrics if available (static report)
    if (state.snapshotMetrics && state.snapshotMetrics.length > 0) {
      points = state.snapshotMetrics.map(function (m) {
        return { label: m.timestamp, metrics: m };
      });
    } else {
      // Compute from full snapshot data (local server)
      points = snapshots.map(function (snap) {
        var m = computeMetrics(snap.analytics, snap.audit);
        return { label: snap.timestamp, metrics: m };
      }).filter(function (p) {
        return p.metrics.totalComponentSurface > 100;
      });
    }

    if (points.length < 2) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';

    var series = [
      { key: 'dsCoverage', label: 'DS coverage', color: COLORS.arcade },
      { key: 'arcadeAdoption', label: 'Arcade adoption', color: COLORS.bang },
      { key: 'detachRate', label: 'Detachment rate', color: COLORS.detached },
    ];

    // Legend
    legendEl.innerHTML = '';
    series.forEach(function (s) {
      legendEl.appendChild(el('span', { className: 'legend-item' }, [
        el('span', { className: 'legend-dot', style: 'background:' + s.color }),
        el('span', { textContent: s.label }),
      ]));
    });

    // Draw
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.parentElement.clientWidth || 800;
    var h = 240;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    var padL = 48, padR = 56, padT = 20, padB = 44;
    var cw = w - padL - padR;
    var ch = h - padT - padB;

    // Y axis: 0–100%
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'hsl(320, 2%, 64%)';
    ctx.textAlign = 'right';
    for (var y = 0; y <= 4; y++) {
      var val = y * 25;
      var py = padT + ch - (y / 4) * ch;
      ctx.fillText(val + '%', padL - 8, py + 4);
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(w - padR, py);
      ctx.strokeStyle = 'hsl(0, 0%, 91%)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // X labels
    ctx.textAlign = 'center';
    var xStep = Math.max(1, Math.floor(points.length / 5));
    points.forEach(function (p, i) {
      if (i % xStep === 0 || i === points.length - 1) {
        var px = padL + (i / (points.length - 1)) * cw;
        ctx.fillText(fmtDate(p.label), px, h - padB + 20);
      }
    });

    // Draw each series line
    series.forEach(function (s) {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      points.forEach(function (p, i) {
        var px = padL + (i / Math.max(1, points.length - 1)) * cw;
        var py = padT + ch - (p.metrics[s.key] / 100) * ch;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // End dot
      var last = points[points.length - 1];
      var lpx = padL + cw;
      var lpy = padT + ch - (last.metrics[s.key] / 100) * ch;
      ctx.beginPath();
      ctx.arc(lpx, lpy, 4, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();

      // Value label at end
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = s.color;
      ctx.textAlign = 'left';
      ctx.fillText(fmtPct(last.metrics[s.key]), lpx + 8, lpy + 4);
    });
  }

  // ---- Tab 2: Component Inventory ----

  function buildInventory(analytics, canonical) {
    if (!analytics) return [];
    var map = {};

    function addComps(lib, libLabel) {
      if (!lib || !lib.components) return;
      lib.components.forEach(function (c) {
        var canonicalName = matchCanonical(c.name, canonical);
        if (canonicalName === '__excluded__') return;
        if (!canonicalName) return; // skip unclassified

        if (!map[canonicalName]) {
          map[canonicalName] = {
            name: canonicalName,
            libraries: [],
            insertions: 0,
            files: [],
            variants: [],
          };
        }
        var entry = map[canonicalName];
        if (entry.libraries.indexOf(libLabel) < 0) entry.libraries.push(libLabel);
        entry.insertions += c.insertions;
        entry.variants.push({ name: c.name, library: libLabel, insertions: c.insertions });
        c.files.forEach(function (f) {
          if (entry.files.indexOf(f) < 0) entry.files.push(f);
        });
      });
    }

    addComps(analytics.dls, 'dls');
    addComps(analytics.arcade, 'arcade');

    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function filterInventory(items, filter) {
    if (filter === 'all') return items;
    if (filter === 'both') return items.filter(function (i) { return i.libraries.length > 1; });
    if (filter === 'friction') return items.filter(function (i) {
      if (i.libraries.indexOf('arcade') < 0 && i.insertions > 5) return true;
      if (i.libraries.length > 1) {
        var arcIns = 0;
        i.variants.forEach(function (v) { if (v.library === 'arcade') arcIns += v.insertions; });
        if (arcIns / i.insertions < 0.3) return true;
      }
      return false;
    });
    return items.filter(function (i) { return i.libraries.indexOf(filter) >= 0 && i.libraries.length === 1; });
  }

  function sortInventory(items, key, dir) {
    var mult = dir === 'asc' ? 1 : -1;
    return items.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); return av < bv ? -1 * mult : av > bv ? mult : 0; }
      if (key === 'library') { av = a.libraries.join(','); bv = b.libraries.join(','); return av < bv ? -1 * mult : av > bv ? mult : 0; }
      if (key === 'variants') { av = a.variants.length; bv = b.variants.length; }
      else if (key === 'insertions') { av = a.insertions; bv = b.insertions; }
      else if (key === 'files') { av = a.files.length; bv = b.files.length; }
      else { av = 0; bv = 0; }
      return (av - bv) * mult;
    });
  }

  function renderInventory(analytics, canonical) {
    var allItems = buildInventory(analytics, canonical);
    var filtered = filterInventory(allItems, state.inventoryFilter);
    var sorted = sortInventory(filtered, state.inventorySort.key, state.inventorySort.dir);

    var tbody = document.getElementById('inventory-body');
    tbody.innerHTML = '';

    // Update sort icons
    var table = document.getElementById('inventory-table');
    table.querySelectorAll('.sort-icon').forEach(function (icon) {
      icon.className = 'sort-icon';
    });
    var activeHeader = table.querySelector('[data-sort="' + state.inventorySort.key + '"] .sort-icon');
    if (activeHeader) activeHeader.className = 'sort-icon ' + state.inventorySort.dir;

    sorted.forEach(function (item) {
      var libBadge = item.libraries.length > 1
        ? '<span class="badge both">Overlap</span>'
        : item.libraries[0] === 'arcade'
          ? '<span class="badge arcade">Arcade</span>'
          : '<span class="badge dls">DLS</span>';

      // Friction hotspot indicator
      var frictionBadge = '';
      var arcadeInsertions = 0;
      item.variants.forEach(function (v) { if (v.library === 'arcade') arcadeInsertions += v.insertions; });
      var arcadeRatio = item.insertions > 0 ? arcadeInsertions / item.insertions : 0;

      if (item.libraries.indexOf('arcade') < 0 && item.insertions > 5) {
        frictionBadge = '<span class="friction-badge friction-high" data-tip="No Arcade equivalent exists.\n' + fmtNum(item.insertions) + ' DLS insertions across ' + item.files.length + ' files need migration.">DLS only</span>';
      } else if (item.libraries.length > 1 && arcadeRatio < 0.3) {
        frictionBadge = '<span class="friction-badge friction-medium" data-tip="Arcade variant exists but accounts for only ' + Math.round(arcadeRatio * 100) + '% of usage.\n' + fmtNum(arcadeInsertions) + ' Arcade vs ' + fmtNum(item.insertions - arcadeInsertions) + ' DLS insertions.">' + Math.round(arcadeRatio * 100) + '% Arcade</span>';
      }

      var tr = el('tr', {
        className: state.expandedRow === item.name ? 'expanded-parent' : '',
        style: 'cursor:pointer',
      });

      tr.innerHTML =
        '<td>' + escapeHtml(item.name) + frictionBadge + '</td>' +
        '<td>' + libBadge + '</td>' +
        '<td class="num">' + item.variants.length + '</td>' +
        '<td class="num">' + fmtNum(item.insertions) + '</td>' +
        '<td class="num">' + item.files.length + '</td>';

      tr.addEventListener('click', function () {
        state.expandedRow = state.expandedRow === item.name ? null : item.name;
        renderInventory(analytics, canonical);
      });

      tbody.appendChild(tr);

      // Expand row — show variants + files
      if (state.expandedRow === item.name) {
        var expandTr = el('tr', { className: 'expand-row' });
        var td = el('td', { colspan: '5' });

        // Variant list
        var variantsSorted = item.variants.slice().sort(function (a, b) { return b.insertions - a.insertions; });
        var variantHeader = el('div', {
          style: 'font-size:11px;font-variation-settings:\"wght\" 660;text-transform:uppercase;letter-spacing:0.04em;color:hsl(var(--text-color-tertiary));margin-bottom:4px',
          textContent: 'Variants',
        });
        td.appendChild(variantHeader);

        variantsSorted.forEach(function (v) {
          var badge = v.library === 'arcade'
            ? '<span class="badge arcade" style="font-size:10px;padding:1px 5px;margin-left:6px">Arcade</span>'
            : '<span class="badge dls" style="font-size:10px;padding:1px 5px;margin-left:6px">DLS</span>';
          var row = el('div', {
            style: 'display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:12px;color:hsl(var(--text-color-secondary))',
          });
          row.innerHTML =
            '<span>' + escapeHtml(v.name) + badge + '</span>' +
            '<span style="color:hsl(var(--text-color-tertiary));font-variant-numeric:tabular-nums">' + fmtNum(v.insertions) + '</span>';
          td.appendChild(row);
        });

        // Files section
        if (item.files.length > 0) {
          var filesHeader = el('div', {
            style: 'font-size:11px;font-variation-settings:\"wght\" 660;text-transform:uppercase;letter-spacing:0.04em;color:hsl(var(--text-color-tertiary));margin-top:10px;margin-bottom:4px',
            textContent: 'Files',
          });
          td.appendChild(filesHeader);
          var filesWrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px' });
          item.files.forEach(function (f) {
            var name = (state.fileKeyToName && state.fileKeyToName[f]) || f;
            filesWrap.appendChild(el('a', {
              className: 'file-chip',
              textContent: name,
              href: 'https://www.figma.com/file/' + f,
              target: '_blank',
              rel: 'noopener',
            }));
          });
          td.appendChild(filesWrap);
        }

        expandTr.appendChild(td);
        tbody.appendChild(expandTr);
      }
    });

    if (sorted.length === 0) {
      var empty = el('tr');
      empty.innerHTML = '<td colspan="5" style="text-align:center;padding:24px;color:hsl(320, 2%, 64%);">No components match this filter</td>';
      tbody.appendChild(empty);
    }
  }

  function initInventoryControls(analytics, canonical) {
    // Filter pills
    var filterBar = document.getElementById('filter-bar');
    filterBar.addEventListener('click', function (e) {
      var pill = e.target.closest('.pill');
      if (!pill) return;
      filterBar.querySelectorAll('.pill').forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      state.inventoryFilter = pill.dataset.filter;
      state.expandedRow = null;
      renderInventory(analytics, canonical);
    });

    // Sortable headers
    var table = document.getElementById('inventory-table');
    table.querySelectorAll('.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        if (state.inventorySort.key === key) {
          state.inventorySort.dir = state.inventorySort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.inventorySort.key = key;
          state.inventorySort.dir = key === 'name' ? 'asc' : 'desc';
        }
        renderInventory(analytics, canonical);
      });
    });
  }

  // ---- Tab 3: File Health ----

  function renderFileSelector(audit) {
    var container = document.getElementById('file-selector');
    container.innerHTML = '';
    var files = audit && audit.files ? audit.files : [];

    if (!files.length) {
      container.innerHTML = '<div class="no-detail">No file data available</div>';
      return;
    }

    files.forEach(function (file) {
      var b = file.breakdown;
      var suspected = suspectedCount(file);
      var surface = file.componentSurface + suspected;
      var dsTotal = b.dsArcade + b.dsDls + b.dsOther;
      var coverage = pct(dsTotal, surface);
      var tile = el('div', {
        className: 'file-tile' + (state.selectedFileKey === file.fileKey ? ' selected' : ''),
        onClick: function () {
          state.selectedFileKey = file.fileKey;
          renderFileSelector(audit);
          renderFileDetail(file);
        },
      }, [
        el('div', { className: 'file-tile-name', textContent: file.fileName, title: file.fileName }),
        el('div', { className: 'file-tile-pct', textContent: fmtPct(coverage) }),
        el('div', { className: 'file-tile-label', textContent: 'DS coverage' }),
      ]);
      container.appendChild(tile);
    });

    // Auto-select first
    if (!state.selectedFileKey && files.length > 0) {
      state.selectedFileKey = files[0].fileKey;
      container.querySelector('.file-tile').classList.add('selected');
      renderFileDetail(files[0]);
    } else if (state.selectedFileKey) {
      var sel = files.find(function (f) { return f.fileKey === state.selectedFileKey; });
      if (sel) renderFileDetail(sel);
    }
  }

  function renderFileDetail(file) {
    var container = document.getElementById('file-detail');
    container.innerHTML = '';

    if (!file) {
      container.innerHTML = '<div class="no-detail">Select a file to see details</div>';
      return;
    }

    var card = el('div', { className: 'card' });

    // Inner grid
    var inner = el('div', { className: 'file-detail-inner' });

    // Donut
    var donutWrap = el('div', { className: 'donut-wrap' });
    var donutCanvas = el('canvas', { width: '200', height: '200' });
    donutCanvas.style.width = '200px';
    donutCanvas.style.height = '200px';
    donutWrap.appendChild(donutCanvas);

    var b = file.breakdown;
    var suspected = suspectedCount(file);
    var segments = [
      { label: 'Arcade', value: b.dsArcade, color: COLORS.arcade },
      { label: 'DLS', value: b.dsDls, color: COLORS.dls },
      { label: 'Other DS', value: b.dsOther, color: COLORS.other },
      { label: 'Detached', value: b.detached + suspected, color: COLORS.detached },
      { label: 'Local', value: b.localComponent, color: COLORS.local },
      { label: 'Raw', value: Math.max(0, b.raw - suspected), color: COLORS.raw },
    ].filter(function (s) { return s.value > 0; });

    // Legend for donut
    var donutLegend = el('div', { className: 'donut-legend' });
    segments.forEach(function (seg) {
      donutLegend.appendChild(el('div', { className: 'donut-legend-item' }, [
        el('span', { className: 'donut-legend-dot', style: 'background:' + seg.color }),
        seg.label + ' ' + fmtNum(seg.value),
      ]));
    });
    donutWrap.appendChild(donutLegend);

    // Right col
    var rightCol = el('div');

    // Stats row
    var statsRow = el('div', { className: 'stats-row' });
    var stats = [
      { label: 'Total nodes', value: fmtNum(file.totalNodes) },
      { label: 'Component surface', value: fmtNum(file.componentSurface + suspectedCount(file)) },
      { label: 'Versions', value: fmtNum(file.versionCount) },
      { label: 'Last modified', value: file.lastModified ? file.lastModified.slice(0, 10) : '—' },
    ];
    stats.forEach(function (s) {
      statsRow.appendChild(el('div', { className: 'stat-item' }, [
        el('div', { className: 'stat-value', textContent: s.value }),
        el('div', { className: 'stat-label', textContent: s.label }),
      ]));
    });
    rightCol.appendChild(statsRow);

    // Detached instances
    rightCol.appendChild(el('div', { className: 'detail-section-title', textContent: 'Detached instances' }));
    var detachedList = el('ul', { className: 'detail-list' });
    var detached = file.detachedInstances || [];
    if (detached.length === 0) {
      detachedList.appendChild(el('li', { textContent: 'None detected', style: 'color:hsl(320, 2%, 64%);border:none;' }));
    } else {
      detached.slice(0, 20).forEach(function (d) {
        detachedList.appendChild(el('li', {}, [
          el('span', { textContent: d.name }),
          el('span', { textContent: d.originalComponent }),
        ]));
      });
      if (detached.length > 20) {
        detachedList.appendChild(el('li', { textContent: '+ ' + (detached.length - 20) + ' more...', style: 'color:hsl(320, 2%, 64%);border:none;' }));
      }
    }
    rightCol.appendChild(detachedList);

    // Local components
    rightCol.appendChild(el('div', { className: 'detail-section-title', textContent: 'Local components' }));
    var localList = el('ul', { className: 'detail-list' });
    var locals = file.localComponents || [];
    if (locals.length === 0) {
      localList.appendChild(el('li', { textContent: 'None detected', style: 'color:hsl(320, 2%, 64%);border:none;' }));
    } else {
      locals.slice(0, 20).forEach(function (lc) {
        localList.appendChild(el('li', {}, [
          el('span', { textContent: lc.name }),
          el('span', { textContent: fmtNum(lc.instanceCount) + ' instances' }),
        ]));
      });
      if (locals.length > 20) {
        localList.appendChild(el('li', { textContent: '+ ' + (locals.length - 20) + ' more...', style: 'color:hsl(320, 2%, 64%);border:none;' }));
      }
    }
    rightCol.appendChild(localList);

    inner.appendChild(donutWrap);
    inner.appendChild(rightCol);
    card.appendChild(inner);
    container.appendChild(card);

    // Draw donut
    drawDonut(donutCanvas, segments);
  }

  function drawDonut(canvas, segments) {
    var dpr = window.devicePixelRatio || 1;
    var size = 200;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    var total = segments.reduce(function (sum, s) { return sum + s.value; }, 0);
    if (total === 0) return;

    var cx = size / 2, cy = size / 2;
    var outerR = 90, innerR = 58;
    var startAngle = -Math.PI / 2;

    segments.forEach(function (seg) {
      var sliceAngle = (seg.value / total) * Math.PI * 2;
      var endAngle = startAngle + sliceAngle;

      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();

      startAngle = endAngle;
    });

    // Center text
    var dsTotal = segments.reduce(function (sum, s) {
      return s.label === 'Raw' || s.label === 'Local' || s.label === 'Detached' ? sum : sum + s.value;
    }, 0);
    var coverage = pct(dsTotal, total);
    ctx.fillStyle = 'hsl(330, 2%, 24%)';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtPct(coverage), cx, cy - 6);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'hsl(320, 2%, 64%)';
    ctx.fillText('DS coverage', cx, cy + 14);
  }

  // ---- Tab 4: Migration Tracker ----

  function renderMigrationChart(analytics) {
    var canvas = document.getElementById('migration-chart');
    if (!canvas) return;
    var chartCard = canvas.closest('.card');
    var ctx = canvas.getContext('2d');

    var weeks = [];
    if (analytics && analytics.arcade && analytics.arcade.weeklyTrend) {
      weeks = analytics.arcade.weeklyTrend.slice();
    }

    if (weeks.length < 2) {
      if (chartCard) chartCard.style.display = 'none';
      return;
    }
    if (chartCard) chartCard.style.display = '';

    var series = weeks.map(function (w) {
      return { label: w.week, value: w.insertions };
    });

    var dpr = window.devicePixelRatio || 1;
    var w = canvas.parentElement.clientWidth || 800;
    var h = 240;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    var padL = 56, padR = 20, padT = 20, padB = 40;
    var cw = w - padL - padR;
    var ch = h - padT - padB;

    ctx.clearRect(0, 0, w, h);

    var maxVal = Math.max.apply(null, series.map(function (s) { return s.value; })) || 1;

    // Grid
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'hsl(320, 2%, 64%)';
    ctx.textAlign = 'right';
    for (var y = 0; y <= 4; y++) {
      var val = Math.round(maxVal * y / 4);
      var py = padT + ch - (y / 4) * ch;
      ctx.fillText(fmtNum(val), padL - 8, py + 4);
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(w - padR, py);
      ctx.strokeStyle = 'hsl(0, 0%, 91%)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // X labels
    ctx.textAlign = 'center';
    var step = Math.max(1, Math.floor(series.length / 6));
    series.forEach(function (s, i) {
      if (i % step === 0 || i === series.length - 1) {
        var px = padL + (i / (series.length - 1)) * cw;
        ctx.fillText(s.label.slice(5), px, h - padB + 20);
      }
    });

    // Area fill
    ctx.beginPath();
    ctx.moveTo(padL, padT + ch);
    series.forEach(function (s, i) {
      var px = padL + (i / (series.length - 1)) * cw;
      var py = padT + ch - (s.value / maxVal) * ch;
      ctx.lineTo(px, py);
    });
    ctx.lineTo(padL + cw, padT + ch);
    ctx.closePath();
    ctx.fillStyle = 'rgba(245, 197, 24, 0.12)';
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = COLORS.bang;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    series.forEach(function (s, i) {
      var px = padL + (i / (series.length - 1)) * cw;
      var py = padT + ch - (s.value / maxVal) * ch;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // End dot
    var last = series[series.length - 1];
    ctx.beginPath();
    ctx.arc(padL + cw, padT + ch - (last.value / maxVal) * ch, 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.bang;
    ctx.fill();
  }

  function renderMigrationTable(analytics) {
    var tbody = document.getElementById('migration-body');
    tbody.innerHTML = '';

    if (!analytics) return;

    // Build a map of components by name across both libraries
    var map = {};
    function index(lib, label) {
      if (!lib || !lib.components) return;
      lib.components.forEach(function (c) {
        var key = c.name.toLowerCase();
        if (!map[key]) map[key] = { name: c.name, dls: 0, arcade: 0 };
        map[key][label] += c.insertions;
      });
    }
    index(analytics.dls, 'dls');
    index(analytics.arcade, 'arcade');

    // Only show components that exist in both
    var both = Object.keys(map)
      .map(function (k) { return map[k]; })
      .filter(function (c) { return c.dls > 0 && c.arcade > 0; })
      .sort(function (a, b) {
        var aR = a.arcade / (a.dls + a.arcade);
        var bR = b.arcade / (b.dls + b.arcade);
        return bR - aR;
      });

    if (both.length === 0) {
      var tr = el('tr');
      tr.innerHTML = '<td colspan="4" style="text-align:center;padding:24px;color:hsl(320, 2%, 64%);">No overlapping components detected yet</td>';
      tbody.appendChild(tr);
      return;
    }

    both.forEach(function (c) {
      var total = c.dls + c.arcade;
      var arcadePct = pct(c.arcade, total);
      var tr = el('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(c.name) + '</td>' +
        '<td>' + fmtNum(c.dls) + '</td>' +
        '<td>' + fmtNum(c.arcade) + '</td>' +
        '<td><div class="progress-bar-wrap">' +
          '<div style="width:' + pct(c.dls, total) + '%;background:' + COLORS.dls + '"></div>' +
          '<div style="width:' + arcadePct + '%;background:' + COLORS.arcade + '"></div>' +
        '</div></td>';
      tbody.appendChild(tr);
    });
  }

  function renderDLSOnlyList(analytics) {
    var list = document.getElementById('dls-only-list');
    list.innerHTML = '';

    if (!analytics) return;

    var arcadeNames = {};
    if (analytics.arcade && analytics.arcade.components) {
      analytics.arcade.components.forEach(function (c) {
        arcadeNames[c.name.toLowerCase()] = true;
      });
    }

    var dlsOnly = [];
    if (analytics.dls && analytics.dls.components) {
      analytics.dls.components.forEach(function (c) {
        if (!arcadeNames[c.name.toLowerCase()]) {
          dlsOnly.push(c);
        }
      });
    }

    dlsOnly.sort(function (a, b) { return b.insertions - a.insertions; });

    if (dlsOnly.length === 0) {
      list.appendChild(el('li', { textContent: 'All DLS components have Arcade equivalents', style: 'color:hsl(320, 2%, 64%);border:none;' }));
      return;
    }

    dlsOnly.slice(0, 25).forEach(function (c) {
      list.appendChild(el('li', {}, [
        el('span', { textContent: c.name }),
        el('span', { className: 'count', textContent: fmtNum(c.insertions) + ' ins.' }),
      ]));
    });
    if (dlsOnly.length > 25) {
      list.appendChild(el('li', { style: 'color:hsl(320, 2%, 64%);border:none;', textContent: '+ ' + (dlsOnly.length - 25) + ' more...' }));
    }
  }

  function renderDLSRatioBars(analytics) {
    var container = document.getElementById('dls-ratio-bars');
    container.innerHTML = '';

    var breakdown = analytics && analytics.fileBreakdown ? analytics.fileBreakdown : [];
    if (!breakdown.length) {
      container.innerHTML = '<div class="heatmap-empty">No file breakdown data available</div>';
      return;
    }

    // Sort by highest DLS ratio (lowest arcadeRatio)
    var sorted = breakdown.slice().sort(function (a, b) { return a.arcadeRatio - b.arcadeRatio; });

    sorted.forEach(function (file) {
      var dlsPct = ((1 - file.arcadeRatio) * 100);
      var arcPct = (file.arcadeRatio * 100);

      container.appendChild(el('div', { className: 'dls-ratio-row' }, [
        el('div', { className: 'dls-ratio-label', textContent: file.fileName, title: file.fileName }),
        el('div', { className: 'dls-ratio-track' }, [
          el('div', { style: 'width:' + dlsPct + '%;background:' + COLORS.dls }),
          el('div', { style: 'width:' + arcPct + '%;background:' + COLORS.arcade }),
        ]),
        el('div', { className: 'dls-ratio-pct', textContent: Math.round(dlsPct) + '%' }),
      ]));
    });
  }

  // ---- Utility ----

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Initialization ----

  function showEmpty() {
    // Hide all panels, show empty state
    var panels = document.querySelectorAll('.panel');
    panels.forEach(function (p) { p.classList.add('hidden'); p.setAttribute('hidden', ''); });
    document.getElementById('empty-state').classList.remove('hidden');
    // Disable tabs
    document.querySelectorAll('[role="tab"]').forEach(function (t) {
      t.setAttribute('disabled', 'true');
      t.style.opacity = '0.4';
      t.style.cursor = 'default';
    });
  }

  function renderHeaderMeta(analytics, audit) {
    var meta = document.getElementById('header-meta');
    // Don't overwrite if snapshot selector is present
    if (meta.querySelector('select')) return;
    var parts = [];
    if (analytics && analytics.collectedAt) {
      parts.push('Collected ' + fmtDate(analytics.collectedAt));
    }
    if (audit && audit.files) {
      parts.push(audit.files.length + ' files');
    }
    meta.textContent = parts.join(' \u00b7 ');
  }

  function renderDashboard(analytics, audit, canonical) {
    state.analytics = analytics;
    state.audit = audit;
    state.canonical = canonical;

    // Build file key → name lookup
    state.fileKeyToName = {};
    if (audit && audit.files) {
      audit.files.forEach(function (f) {
        state.fileKeyToName[f.fileKey] = f.fileName;
      });
    }

    renderHeaderMeta(analytics, audit);

    // Tab 1: Design Coverage
    var metrics = computeMetrics(analytics, audit);

    // Compute previous metrics for trend arrows
    var prevMetrics = null;
    if (state.snapshots && state.snapshots.length >= 2) {
      var prevSnap = state.snapshots[state.snapshots.length - 2];
      if (prevSnap && prevSnap.audit) {
        prevMetrics = computeMetrics(prevSnap.analytics, prevSnap.audit);
      }
    }

    renderHealthHero(metrics, prevMetrics);
    renderLeaderboard(audit, state.snapshots);
    renderTrendChart(state.snapshots);
    renderActivityGrid(state.snapshots);

    // Tab 2: Component Inventory
    state.expandedRow = null;
    renderInventory(analytics, canonical);

    // Tab 3: Migration Tracker
    renderMigrationChart(analytics);
    renderMigrationTable(analytics);
    renderDLSOnlyList(analytics);
    renderDLSRatioBars(analytics);
  }

  function initSnapshotSelector(snapshots, canonical) {
    var meta = document.getElementById('header-meta');
    if (!meta || snapshots.length < 2) return;

    // Replace plain text with a dropdown
    meta.innerHTML = '';

    var select = el('select', { className: 'snapshot-select', 'aria-label': 'Select collection snapshot' });

    // "Latest" option
    var latestDate = state._latestAnalytics && state._latestAnalytics.collectedAt
      ? fmtDate(state._latestAnalytics.collectedAt)
      : 'latest';
    var fileCount = state._latestAudit && state._latestAudit.files ? state._latestAudit.files.length : 0;
    select.appendChild(el('option', { value: 'latest', textContent: latestDate + ' \u00b7 ' + fileCount + ' files (latest)' }));

    // Snapshot options newest-first
    snapshots.slice().reverse().forEach(function (snap, i) {
      var idx = snapshots.length - 1 - i;
      var snapFiles = snap.audit && snap.audit.files ? snap.audit.files.length : 0;
      select.appendChild(el('option', { value: String(idx), textContent: fmtDate(snap.timestamp) + ' \u00b7 ' + snapFiles + ' files' }));
    });

    select.addEventListener('change', function () {
      var val = select.value;
      if (val === 'latest') {
        renderDashboard(state._latestAnalytics, state._latestAudit, canonical);
      } else {
        var snap = snapshots[parseInt(val, 10)];
        if (snap) renderDashboard(snap.analytics, snap.audit, canonical);
      }
    });

    meta.appendChild(select);
  }

  function init() {
    initTabs();

    loadData()
      .then(function (data) {
        var analytics = data.analytics;
        var audit = data.audit;
        var canonical = data.canonical;

        state._latestAnalytics = analytics;
        state._latestAudit = audit;
        state.canonical = canonical;
        state.snapshotMetrics = data.snapshotMetrics || null;

        var hasData = (audit && audit.files && audit.files.length > 0) ||
                      (analytics && (analytics.dls || analytics.arcade));

        if (!hasData) {
          showEmpty();
          return;
        }

        // Load snapshots: use embedded data or fetch from server
        var snapshotsReady;
        if (data.snapshots && data.snapshots.length > 0) {
          snapshotsReady = Promise.resolve(data.snapshots);
        } else {
          snapshotsReady = loadSnapshots();
        }

        snapshotsReady.then(function (snapshots) {
          state.snapshots = snapshots;
          initSnapshotSelector(snapshots, canonical);
          initInventoryControls(analytics, canonical);
          renderDashboard(analytics, audit, canonical);

          // Resize handler for charts
          var resizeTimer;
          window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
              renderMigrationChart(state.analytics);
              renderTrendChart(state.snapshots);
            }, 200);
          });
        });
      })
      .catch(function () {
        showEmpty();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
