/*
 * Paper results tab: the manuscript's computational figures, drawn from
 * paper_results.json (built by np-mt-rnm's scripts/build_paper_bundle.py).
 */
(function () {
  "use strict";

  var C = { Hypo: "#0000ff", Normal: "#009900", Hyper: "#ff0000" };
  var GREEN = "#2ca02c", RED = "#d62728", BLUE = "rgb(31,102,184)", DARKRED = "rgb(199,51,51)";
  var KD = ["RhoA-E", "PIEZO1", "PI3K-E", "FAK-E", "ROS"];

  // MATLAB parula anchors.
  var PARULA = [
    [0.2422, 0.1504, 0.6603], [0.2810, 0.3228, 0.9579], [0.1786, 0.5289, 0.9682],
    [0.0689, 0.6948, 0.8394], [0.2161, 0.7843, 0.5923], [0.6720, 0.7793, 0.2227],
    [0.9970, 0.7659, 0.2199], [0.9657, 0.9494, 0.1734], [0.9769, 0.9839, 0.0805]
  ];

  function parula(t) {
    t = Math.max(0, Math.min(1, t)) * (PARULA.length - 1);
    var i = Math.min(Math.floor(t), PARULA.length - 2), f = t - i;
    return PARULA[i].map(function (a, k) { return a + f * (PARULA[i + 1][k] - a); });
  }

  function diverging(v, vmax) {
    // blue (−) → white → red (+)
    var t = Math.max(-1, Math.min(1, v / vmax));
    return t < 0 ? [1 + t * 0.85, 1 + t * 0.6, 1] : [1, 1 - t * 0.75, 1 - t * 0.8];
  }

  function rgb(c) { return "rgb(" + c.map(function (x) { return Math.round(x * 255); }).join(",") + ")"; }
  function luminance(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }

  // MATLAB %.3g.
  function g3(v) {
    if (v === 0) return "0";
    var a = Math.abs(v);
    if (a < 1e-4 || a >= 1e3) {
      var s = v.toExponential(2).replace(/\.?0+e/, "e");
      return s.replace(/e([+-])(\d)$/, "e$10$2");
    }
    return String(parseFloat(v.toPrecision(3)));
  }

  // 'SOX9↑ + FAK-E↓' -> 'SOX9-FAK-E', as RESCUE_NEW4_1_final.m labels them.
  function shortLabel(s) {
    return s.replace(/↑/g, "").replace(/↓/g, "").replace(" + ", "-");
  }

  var FIG_BASE = "";

  /* Manuscript figure number + verbatim caption, and the manuscript-style image. */
  function setFigure(d, slotId, key) {
    var slot = document.getElementById(slotId);
    var f = d.figures[key];
    if (!slot || !f) return;
    slot.innerHTML = '<p class="fig-caption"><b>' + f.number + ".</b> " + f.caption + "</p>" +
      '<details class="mb-2"><summary>Manuscript figure (' + key + '.png)</summary>' +
      '<img class="img-fluid border mt-2" loading="lazy" alt="' + f.number + '" src="' + FIG_BASE + key + '.png"></details>';
  }

  var charts = {};
  function chart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    var el = document.getElementById(id);
    if (!el) return null;
    charts[id] = new Chart(el, cfg);
    return charts[id];
  }

  function baseOpts(title) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        title: { display: !!title, text: title, font: { weight: "bold", size: 14 } },
        legend: { display: false }
      }
    };
  }

  function rankedBar(id, title, rows, valueKey, color) {
    var top = rows.slice().sort(function (a, b) { return b[valueKey] - a[valueKey]; }).slice(0, 20);
    var o = baseOpts(title);
    o.indexAxis = "y";
    chart(id, {
      type: "bar",
      data: { labels: top.map(function (r) { return r.node; }),
              datasets: [{ data: top.map(function (r) { return r[valueKey]; }), backgroundColor: color }] },
      options: o
    });
  }

  function renderTopology(d) {
    var rows = d.topology.map(function (r) {
      return Object.assign({ total: r.out_activating + r.out_inhibiting }, r);
    });
    var top = rows.slice().sort(function (a, b) { return b.total - a.total; }).slice(0, 20);
    var o = baseOpts("A) Signed out-degree");
    o.indexAxis = "y";
    o.scales = { x: { stacked: true, title: { display: true, text: "Outgoing edges" } }, y: { stacked: true } };
    o.plugins.legend = { display: true, position: "bottom" };
    chart("topo-out", {
      type: "bar",
      data: {
        labels: top.map(function (r) { return r.node; }),
        datasets: [
          { label: "Activating", data: top.map(function (r) { return r.out_activating; }), backgroundColor: GREEN },
          { label: "Inhibiting", data: top.map(function (r) { return r.out_inhibiting; }), backgroundColor: RED }
        ]
      },
      options: o
    });
    rankedBar("topo-bc", "B) Betweenness centrality", rows, "betweenness", "#4c72b0");
    rankedBar("topo-hc", "C) Harmonic closeness centrality", rows, "harmonic_closeness", "#8172b2");
    setFigure(d, "slot-topology", "TOPO_STATS");
  }

  function renderBaseline(d) {
    var host = document.getElementById("paper-baseline-figs");
    host.innerHTML = "";
    var letters = "ABCD";
    d.baseline_figures.forEach(function (fig, fi) {
      var sec = document.createElement("div");
      sec.className = "mb-4";
      sec.innerHTML = '<p class="small mb-1"><span style="color:' + C.Hypo + '">■ Hypo</span> <span style="color:' + C.Normal +
        '">■ Normal</span> <span style="color:' + C.Hyper + '">■ Hyper</span></p><div class="row g-3"></div>' +
        '<div class="fig-slot mt-2" id="slot-' + fig.id + '"></div>';
      var row = sec.querySelector(".row");
      host.appendChild(sec);
      fig.panels.forEach(function (p, pi) {
        var id = "bsl-" + fi + "-" + pi;
        var col = document.createElement("div");
        col.className = p.nodes.length > 20 ? "col-12" : "col-xl-6";
        col.innerHTML = '<div class="paper-chart"><canvas id="' + id + '"></canvas></div>';
        row.appendChild(col);
        var o = baseOpts(letters[pi] + ") " + p.title);
        o.scales = { y: { min: 0, max: 1, title: { display: true, text: "Activation (a.u.)" } },
                     x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 45 } } };
        chart(id, {
          type: "bar",
          data: {
            labels: p.nodes,
            datasets: ["Hypo", "Normal", "Hyper"].map(function (reg) {
              return { label: reg, data: p.series[reg], backgroundColor: C[reg] };
            })
          },
          options: o
        });
      });
      setFigure(d, "slot-" + fig.id, fig.id);
    });
  }

  function heatTable(hostId, rowLabels, colLabels, valueAt, colorOf, cellFmt) {
    var html = '<table class="heat"><tbody>';
    rowLabels.forEach(function (rl, i) {
      html += '<tr><th class="rl">' + rl + "</th>";
      colLabels.forEach(function (_, j) {
        var v = valueAt(i, j), c = colorOf(v);
        html += '<td style="background:' + rgb(c) + ";color:" + (luminance(c) < 0.55 ? "#fff" : "#000") +
          '" title="' + rl + " · " + colLabels[j] + ": " + v + '">' + cellFmt(v) + "</td>";
      });
      html += "</tr>";
    });
    html += '</tbody><tfoot><tr><th></th>' + colLabels.map(function (c) { return "<th>" + c + "</th>"; }).join("") +
      "</tr></tfoot></table>";
    document.getElementById(hostId).innerHTML = html;
  }

  function renderTransitions(d, moduleIdx) {
    var mod = d.transition_modules[moduleIdx];
    document.querySelectorAll(".trans-title").forEach(function (el) { el.textContent = mod.title; });
    // Rows bottom-to-top as in the MATLAB heatmaps (first node at the bottom).
    var nodes = mod.nodes.slice().reverse();
    var steps = ["1", "2", "3", "4", "5", "6"];
    [["hypo_to_normal", "trans-heat-h2n"], ["normal_to_hyper", "trans-heat-n2h"]].forEach(function (pair) {
      var means = d.transitions[pair[0]].means;
      heatTable(pair[1], nodes, steps,
        function (i, j) { return means[nodes[i]][j]; },
        function (v) { return parula(v); }, g3);
    });
    setFigure(d, "slot-transition", mod.tag + "_transition");
  }

  function renderRepresentative(d) {
    var palette = { COL2A1: "#0072bd", ACAN: "#77ac30", TIMP3: "#edb120", COL1A1: "#0072bd",
      COL10A1: "#77ac30", SOX9: "#000000", "NF-κB": "#edb120", ROS: "#000000", IGF1: "#ff00ff",
      VEGF: "#ff00ff", Bcl2: "#4dbeee", CASP3: "#4dbeee" };
    var anab = d.representative.anabolic;
    [["hypo_to_normal", "rep-h2n", "A) Hypo to Normal transition path"],
     ["normal_to_hyper", "rep-n2h", "B) Normal to Hyper transition path"]].forEach(function (t) {
      var means = d.transitions[t[0]].means;
      var o = baseOpts(t[2]);
      o.plugins.legend = { display: true, position: "right", labels: { boxWidth: 24 } };
      o.scales = { y: { min: 0, max: 1, title: { display: true, text: "Steady-state activation" } },
                   x: { title: { display: true, text: "Path step" } } };
      chart(t[1], {
        type: "line",
        data: {
          labels: [1, 2, 3, 4, 5, 6],
          datasets: d.representative.nodes.map(function (n) {
            return { label: n, data: means[n], borderColor: palette[n] || "#333", backgroundColor: palette[n] || "#333",
              borderWidth: 2.5, pointRadius: 0, tension: 0, borderDash: anab.indexOf(n) >= 0 ? [] : [6, 4] };
          })
        },
        options: o
      });
    });
    setFigure(d, "slot-representative", "Representative_transition_paths");
  }

  var thresholdLines = {
    id: "thresholdLines",
    afterDraw: function (c, _, opts) {
      if (!opts || !opts.lines) return;
      var ctx = c.ctx, area = c.chartArea;
      opts.lines.forEach(function (l) {
        var scale = c.scales[opts.axis];
        var p = scale.getPixelForValue(l.value);
        ctx.save();
        ctx.strokeStyle = l.color; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (opts.axis === "y") { ctx.moveTo(area.left, p); ctx.lineTo(area.right, p); }
        else { ctx.moveTo(p, area.top); ctx.lineTo(p, area.bottom); }
        ctx.stroke(); ctx.restore();
      });
    }
  };

  function renderFalsification(d) {
    var rules = d.falsification.rules.slice().sort(function (a, b) { return b.delta - a.delta; });
    var passed = rules.filter(function (r) { return r.passed; }).length;
    var failed = rules.filter(function (r) { return !r.passed; }).map(function (r) { return r.node; });
    document.getElementById("fals-score").textContent =
      passed + " / " + rules.length + " rules satisfied" + (failed.length ? " (fail: " + failed.join(", ") + ")" : "");
    // As in NP_MT_FALS.png: colour by marker class (anabolic green, catabolic
    // red), so a failing rule shows as a red bar on the positive side.
    var colors = rules.map(function (r) { return r["class"] === "anabolic" ? GREEN : RED; });
    var o = baseOpts("A) Directional effects by node (Normal − Hyper)");
    o.scales = { y: { min: -1, max: 1, title: { display: true, text: "Δ (Normal − Hyper)" } },
                 x: { ticks: { autoSkip: false, maxRotation: 70, minRotation: 60 } } };
    o.plugins.thresholdLines = { axis: "y", lines: [{ value: 0.02, color: GREEN }, { value: -0.02, color: RED }] };
    chart("fals-bars", { type: "bar", plugins: [thresholdLines],
      data: { labels: rules.map(function (r) { return r.node; }), datasets: [{ data: rules.map(function (r) { return r.delta; }), backgroundColor: colors }] },
      options: o });

    var f = baseOpts("B) Falsification forest plot (Normal − Hyper, 95% CI)");
    f.indexAxis = "y";
    f.scales = { x: { min: -1.05, max: 1.05, title: { display: true, text: "Mean difference (Normal − Hyper)" } },
                 y: { ticks: { autoSkip: false } } };
    f.plugins.thresholdLines = { axis: "x", lines: [{ value: 0.02, color: GREEN }, { value: -0.02, color: RED }] };
    f.plugins.tooltip = { callbacks: { label: function (ctx) {
      var r = rules[ctx.dataIndex];
      return "Δ = " + r.delta.toFixed(3) + ", CI [" + r.ci_lower.toFixed(3) + ", " + r.ci_upper.toFixed(3) + "]";
    } } };
    chart("fals-forest", { type: "bar", plugins: [thresholdLines],
      data: { labels: rules.map(function (r) { return r.node; }),
        datasets: [
          { type: "bar", data: rules.map(function (r) { return [r.ci_lower, r.ci_upper]; }), backgroundColor: "#999", barThickness: 3 },
          { type: "scatter", data: rules.map(function (r, i) { return { x: r.delta, y: r.node }; }),
            backgroundColor: colors, borderColor: "#000", pointRadius: 5 }
        ] },
      options: f });
    setFigure(d, "slot-falsification", "NP_MT_FALS");
  }

  function renderRescue(d, idx) {
    var m = d.rescue[idx];
    var top = m.top20;
    var o = baseOpts(["Top 20 Rescue Strategies — " + m.title, "Hyper → Normal Profile Restoration"]);
    o.indexAxis = "y";
    var best = Math.max.apply(null, top.map(function (r) { return r.rescue_percent; }));
    var minV = Math.min(0, Math.min.apply(null, top.map(function (r) { return r.rescue_percent; })));
    var xUpper = Math.max(Math.ceil(best * 1.15 / 10) * 10, 10);
    if (best >= 80) xUpper = Math.max(xUpper, 105);
    o.scales = { x: { min: minV < 0 ? Math.floor(minV * 1.15 / 10) * 10 : 0, max: xUpper,
                      title: { display: true, text: "Rescue toward Normal profile (%)" } },
                 y: { ticks: { autoSkip: false } } };
    o.plugins.thresholdLines = { axis: "x", lines: best >= 80 ? [{ value: 100, color: "#000" }, { value: 0, color: "#000" }] : [{ value: 0, color: "#000" }] };
    o.plugins.tooltip = { callbacks: { label: function (ctx) { return ctx.parsed.x.toFixed(1) + "%"; } } };
    var valueLabels = {
      id: "valueLabels",
      afterDatasetsDraw: function (c) {
        var meta = c.getDatasetMeta(0), ctx = c.ctx;
        ctx.save(); ctx.font = "bold 12px Arial"; ctx.fillStyle = "#000"; ctx.textBaseline = "middle";
        meta.data.forEach(function (bar, i) {
          var v = top[i].rescue_percent;
          ctx.textAlign = v >= 0 ? "left" : "right";
          ctx.fillText(v.toFixed(1) + "%", bar.x + (v >= 0 ? 6 : -6), bar.y);
        });
        ctx.restore();
      }
    };
    chart("rescue-top20", { type: "bar", plugins: [thresholdLines, valueLabels],
      data: { labels: top.map(function (r) { return shortLabel(r.strategy); }),
        datasets: [{ data: top.map(function (r) { return r.rescue_percent; }),
          backgroundColor: top.map(function (r) { return r.rescue_percent >= 0 ? BLUE : DARKRED; }) }] },
      options: o });

    // Top 10 by mean |Δ| within the module (Supplementary S3, M_{p,C}).
    var M = m.perturbations.map(function (p, i) {
      var row = m.mean_delta[i], s = 0;
      row.forEach(function (v) { s += Math.abs(v); });
      return { p: p, v: s / row.length };
    }).sort(function (a, b) { return b.v - a.v; }).slice(0, 10);
    var o2 = baseOpts("Top 10 perturbations by mean |Δ| within module");
    o2.indexAxis = "y";
    o2.scales = { x: { title: { display: true, text: "Mean absolute change |Δ|" } }, y: { ticks: { autoSkip: false } } };
    chart("rescue-m10", { type: "bar",
      data: { labels: M.map(function (r) { return shortLabel(r.p); }), datasets: [{ data: M.map(function (r) { return r.v; }), backgroundColor: "#4c72b0" }] },
      options: o2 });

    var vmax = 0;
    m.mean_delta.forEach(function (row) { row.forEach(function (v) { vmax = Math.max(vmax, Math.abs(v)); }); });
    vmax = vmax || 1;
    heatTable("rescue-heat", m.nodes, m.perturbations.map(shortLabel),
      function (i, j) { return m.mean_delta[j][i]; },
      function (v) { return diverging(v, vmax); },
      function (v) { return Math.abs(v) < 0.005 ? "" : v.toFixed(2); });
    setFigure(d, "slot-rescue", m.tag + "_rescue");
    setFigure(d, "slot-rescue1", m.tag + "_rescue1");
    document.getElementById("node-resolved-intro").textContent = d.node_resolved_intro;
  }

  function fillSelect(id, items, onChange) {
    var sel = document.getElementById(id);
    sel.innerHTML = items.map(function (m, i) { return '<option value="' + i + '">' + m.title + "</option>"; }).join("");
    sel.addEventListener("change", function () { onChange(parseInt(sel.value, 10)); });
  }

  function init() {
    var holder = document.getElementById("paper-data-url");
    if (!holder) return;
    var rendered = {};
    FIG_BASE = holder.dataset.figures || "";
    fetch(holder.dataset.url).then(function (r) { return r.json(); }).then(function (d) {
      var renderers = {
        "#paper-topology": function () { renderTopology(d); },
        "#paper-baseline": function () { renderBaseline(d); },
        "#paper-transitions": function () { renderTransitions(d, 0); renderRepresentative(d); },
        "#paper-falsification": function () { renderFalsification(d); },
        "#paper-rescue": function () { renderRescue(d, 0); }
      };
      fillSelect("trans-module", d.transition_modules, function (i) { renderTransitions(d, i); });
      fillSelect("rescue-module", d.rescue, function (i) { renderRescue(d, i); });
      // Charts need a visible canvas; draw each section the first time it is shown.
      function show(target) {
        if (!rendered[target] && renderers[target]) { rendered[target] = true; renderers[target](); }
      }
      document.querySelectorAll('#paper-subtabs button').forEach(function (b) {
        b.addEventListener("shown.bs.tab", function () { show(b.dataset.bsTarget); });
      });
      var outer = document.getElementById("paper-tab");
      outer.addEventListener("shown.bs.tab", function () {
        var active = document.querySelector("#paper-subtabs .nav-link.active");
        show(active.dataset.bsTarget);
      });
      if (outer.classList.contains("active")) show("#paper-topology");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
