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

  // ---- Helpers ----

  function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
  function fmtPct(v) { return v.toFixed(1) + '%'; }
  function fmtNum(n) { return n.toLocaleString(); }

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
      var suspected = (f.suspectedDetachments || []).length;
      totalDS += b.dsArcade + b.dsDls + b.dsOther;
      totalArcade += b.dsArcade;
      totalDetached += b.detached + suspected;
      totalComponentSurface += f.componentSurface + suspected;
      totalNodes += f.totalNodes;
    });

    var dsCoverage = pct(totalDS, totalComponentSurface);
    var arcadeAdoption = pct(totalArcade, totalDS || 1);
    var detachRate = pct(totalDetached, totalComponentSurface || 1);

    return {
      dsCoverage: dsCoverage,
      arcadeAdoption: arcadeAdoption,
      detachRate: detachRate,
      totalDS: totalDS,
      totalArcade: totalArcade,
      totalDetached: totalDetached,
      totalComponentSurface: totalComponentSurface,
      totalNodes: totalNodes,
    };
  }

  // ---- Tab 1: Design Coverage ----

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
      { label: 'Raw nodes', color: COLORS.raw },
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
      var suspected = (file.suspectedDetachments || []).length;
      var total = (file.componentSurface + suspected) || 1;
      var dsTotal = b.dsArcade + b.dsDls + b.dsOther;
      var coverage = pct(dsTotal, total);

      var segments = [
        { value: b.dsArcade, color: COLORS.arcade },
        { value: b.dsDls, color: COLORS.dls },
        { value: b.dsOther, color: COLORS.other },
        { value: b.detached + suspected, color: COLORS.detached },
        { value: b.localComponent, color: COLORS.local },
        { value: Math.max(0, b.raw - suspected), color: COLORS.raw },
      ];

      var bar = el('div', { className: 'heatmap-bar-track' });
      segments.forEach(function (seg) {
        if (seg.value > 0) {
          bar.appendChild(el('div', {
            style: 'width:' + pct(seg.value, total) + '%;background:' + seg.color,
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
    return items.filter(function (i) { return i.libraries.indexOf(filter) >= 0 && i.libraries.length === 1; });
  }

  function sortInventory(items, key, dir) {
    var mult = dir === 'asc' ? 1 : -1;
    return items.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); return av < bv ? -1 * mult : av > bv ? mult : 0; }
      if (key === 'library') { av = a.libraries.join(','); bv = b.libraries.join(','); return av < bv ? -1 * mult : av > bv ? mult : 0; }
      if (key === 'insertions') { av = a.insertions; bv = b.insertions; }
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

      var tr = el('tr', {
        className: state.expandedRow === item.name ? 'expanded-parent' : '',
        style: 'cursor:pointer',
      });

      tr.innerHTML =
        '<td>' + escapeHtml(item.name) +
          '<span style="color:hsl(320,2%,64%);font-size:11px;margin-left:6px">' +
          item.variants.length + (item.variants.length === 1 ? ' variant' : ' variants') +
          '</span></td>' +
        '<td>' + libBadge + '</td>' +
        '<td>' + fmtNum(item.insertions) + '</td>' +
        '<td>' + item.files.length + '</td>';

      tr.addEventListener('click', function () {
        state.expandedRow = state.expandedRow === item.name ? null : item.name;
        renderInventory(analytics, canonical);
      });

      tbody.appendChild(tr);

      // Expand row — show variants + files
      if (state.expandedRow === item.name) {
        var expandTr = el('tr', { className: 'expand-row' });
        var td = el('td', { colspan: '4' });

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
      empty.innerHTML = '<td colspan="4" style="text-align:center;padding:24px;color:hsl(320, 2%, 64%);">No components match this filter</td>';
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
      var suspected = (file.suspectedDetachments || []).length;
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
    var suspected = (file.suspectedDetachments || []).length;
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
      { label: 'Component surface', value: fmtNum(file.componentSurface + (file.suspectedDetachments || []).length) },
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
    var ctx = canvas.getContext('2d');

    var weeks = [];
    if (analytics && analytics.arcade && analytics.arcade.weeklyTrend) {
      weeks = analytics.arcade.weeklyTrend.slice();
    }

    if (weeks.length < 2) {
      // Placeholder
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillStyle = 'hsl(320, 2%, 64%)';
      ctx.textAlign = 'center';
      var dpr = window.devicePixelRatio || 1;
      var w = canvas.parentElement.clientWidth || 800;
      canvas.width = w * dpr;
      canvas.height = 240 * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = '240px';
      ctx.scale(dpr, dpr);
      ctx.fillText('Trend data will appear after multiple collection runs', w / 2, 120);
      return;
    }

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
    var parts = [];
    if (analytics && analytics.collectedAt) {
      parts.push('Collected ' + analytics.collectedAt.slice(0, 10));
    }
    if (audit && audit.files) {
      parts.push(audit.files.length + ' files');
    }
    meta.textContent = parts.join(' \u00b7 ');
  }

  function init() {
    initTabs();

    loadData()
      .then(function (data) {
        var analytics = data.analytics;
        var audit = data.audit;
        var canonical = data.canonical;

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

        var hasData = (audit && audit.files && audit.files.length > 0) ||
                      (analytics && (analytics.dls || analytics.arcade));

        if (!hasData) {
          showEmpty();
          return;
        }

        renderHeaderMeta(analytics, audit);

        // Tab 1: Design Coverage
        var metrics = computeMetrics(analytics, audit);
        renderMetricCards(metrics);
        renderHeatmap(audit);

        // Tab 2: Component Inventory
        renderInventory(analytics, canonical);
        initInventoryControls(analytics, canonical);

        // Tab 3: File Health
        renderFileSelector(audit);

        // Tab 4: Migration Tracker
        renderMigrationChart(analytics);
        renderMigrationTable(analytics);
        renderDLSOnlyList(analytics);
        renderDLSRatioBars(analytics);

        // Resize handler for charts
        var resizeTimer;
        window.addEventListener('resize', function () {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(function () {
            renderMigrationChart(analytics);
            if (state.selectedFileKey && audit && audit.files) {
              var file = audit.files.find(function (f) { return f.fileKey === state.selectedFileKey; });
              if (file) renderFileDetail(file);
            }
          }, 200);
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
