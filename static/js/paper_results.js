/*
 * Paper results tab: the manuscript's computational figures, drawn from
 * paper_results.json (built by np-mt-rnm's scripts/build_paper_bundle.py).
 */
(function () {
  "use strict";

  var C = { Hypo: "#0000ff", Normal: "#009900", Hyper: "#ff0000" };
  var GREEN = "#2ca02c", RED = "#d62728", BLUE = "rgb(31,102,184)", DARKRED = "rgb(199,51,51)";
  var FGREEN = "rgb(0,176,36)", FRED = "rgb(235,19,24)", FGRAY = "rgb(199,204,209)";

  function diverging(v, vmax) {
    // blue (−) → white → red (+)
    var t = Math.max(-1, Math.min(1, v / vmax));
    return t < 0 ? [1 + t * 0.85, 1 + t * 0.6, 1] : [1, 1 - t * 0.75, 1 - t * 0.8];
  }

  function rgb(c) { return "rgb(" + c.map(function (x) { return Math.round(x * 255); }).join(",") + ")"; }
  function luminance(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }

  // 'SOX9↑ + ROS↓' -> 'SOX9-ROS', as RESCUE_NEW4_1_48_targets_HQ.m labels them
  // (labels in the bundle are already in this form).
  function shortLabel(s) {
    return s.replace(/↑/g, "").replace(/↓/g, "").replace(" + ", "-");
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  /* Error-bar plugin: dataset.errLow / dataset.errHigh hold absolute bounds
     for each data point (asymmetric CIs or mean ± SD). */
  var errorBars = {
    id: "errorBars",
    afterDatasetsDraw: function (c) {
      var ctx = c.ctx, horizontal = c.options.indexAxis === "y";
      c.data.datasets.forEach(function (ds, di) {
        if (!ds.errLow || !ds.errHigh) return;
        var meta = c.getDatasetMeta(di);
        if (meta.hidden) return;
        var vScale = horizontal ? c.scales.x : c.scales.y;
        ctx.save();
        ctx.strokeStyle = ds.errColor || "#1a1a1a"; ctx.lineWidth = ds.errWidth || 1;
        meta.data.forEach(function (el, i) {
          var lo = ds.errLow[i], hi = ds.errHigh[i];
          if (lo == null || hi == null) return;
          var a = vScale.getPixelForValue(lo), b = vScale.getPixelForValue(hi), cap = ds.errCap || 3;
          ctx.beginPath();
          if (horizontal) {
            ctx.moveTo(a, el.y); ctx.lineTo(b, el.y);
            ctx.moveTo(a, el.y - cap); ctx.lineTo(a, el.y + cap);
            ctx.moveTo(b, el.y - cap); ctx.lineTo(b, el.y + cap);
          } else {
            ctx.moveTo(el.x, a); ctx.lineTo(el.x, b);
            ctx.moveTo(el.x - cap, a); ctx.lineTo(el.x + cap, a);
            ctx.moveTo(el.x - cap, b); ctx.lineTo(el.x + cap, b);
          }
          ctx.stroke();
        });
        ctx.restore();
      });
    }
  };

  var FIG_BASE = "";

  /* Manuscript figure number + verbatim caption, and the manuscript-style image. */
  function setFigure(d, slotId, keys) {
    keys = [].concat(keys);
    var slot = document.getElementById(slotId);
    var f = d.figures[keys[0]];
    if (!slot || !f) return;
    slot.innerHTML = '<p class="fig-caption"><b>' + f.number + ".</b> " + f.caption + "</p>" +
      '<details class="mb-2"><summary>Manuscript figure (' + keys.map(function (k) { return k + ".png"; }).join(", ") +
      ')</summary>' + keys.map(function (k) {
        return '<img class="img-fluid border mt-2" loading="lazy" alt="' + f.number + '" src="' + FIG_BASE + k + '.png">';
      }).join("") + "</details>";
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
    document.getElementById("baseline-note").textContent = d.baseline_note || "";
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
        o.plugins.tooltip = { callbacks: { label: function (ctx) {
          var reg = ctx.dataset.label, i = ctx.dataIndex;
          var t = reg + ": " + ctx.parsed.y.toFixed(3) + " (95% CI " + p.ci_low[reg][i].toFixed(3) + "–" +
            p.ci_high[reg][i].toFixed(3) + "; SD " + p.sd[reg][i].toFixed(3) + ")";
          if (reg === "Hyper" && p.q_nl_hl[i] != null) t += "; NL–HL q = " + p.q_nl_hl[i].toExponential(2);
          return t;
        } } };
        chart(id, {
          type: "bar",
          plugins: [errorBars],
          data: {
            labels: p.nodes,
            datasets: ["Hypo", "Normal", "Hyper"].map(function (reg) {
              return { label: reg, data: p.series[reg], backgroundColor: C[reg],
                       errLow: p.ci_low[reg], errHigh: p.ci_high[reg], errCap: 2 };
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

  var thresholdLines = {
    id: "thresholdLines",
    afterDraw: function (c, _, opts) {
      if (!opts || !opts.lines) return;
      var ctx = c.ctx, area = c.chartArea;
      opts.lines.forEach(function (l) {
        var scale = c.scales[opts.axis];
        var p = scale.getPixelForValue(l.value);
        ctx.save();
        ctx.strokeStyle = l.color; ctx.setLineDash(l.solid ? [] : [3, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (opts.axis === "y") { ctx.moveTo(area.left, p); ctx.lineTo(area.right, p); }
        else { ctx.moveTo(p, area.top); ctx.lineTo(p, area.bottom); }
        ctx.stroke(); ctx.restore();
      });
    }
  };

  function renderFalsification(d) {
    var F = d.falsification;
    var rules = F.rules.slice().sort(function (a, b) { return b.delta - a.delta; });
    var bad = rules.filter(function (r) { return r.outcome !== "Concordant"; });
    document.getElementById("fals-score").textContent =
      F.counts.Concordant + " / " + rules.length + " concordant (" +
      (100 * F.counts.Concordant / rules.length).toFixed(1) + "%)" +
      (bad.length ? " · " + bad.map(function (r) { return r.node + " " + r.outcome.toLowerCase(); }).join(", ") : "") +
      " · indeterminate " + F.counts.Indeterminate;
    document.getElementById("fals-summary").textContent = d.falsification_summary || "";
    var labels = rules.map(function (r) { return r.node; });

    // (A) NL / HL mean activation with 95% CIs, as Figure_A_NL_HL_Parallel_v12.
    var o = baseOpts("(A) Mean steady-state activation, NL and HL (95% CI of the mean)");
    o.indexAxis = "y";
    o.plugins.legend = { display: true, position: "top" };
    o.scales = { x: { min: 0, max: 1, title: { display: true, text: "Mean steady-state activation (0–1)" } },
                 y: { ticks: { autoSkip: false, font: { size: 11 } } } };
    chart("fals-profiles", { type: "bar", plugins: [errorBars],
      data: { labels: labels, datasets: [
        { label: "NL", data: rules.map(function (r) { return r.mean_normal; }), backgroundColor: FGREEN,
          errLow: rules.map(function (r) { return r.nl_ci[0]; }), errHigh: rules.map(function (r) { return r.nl_ci[1]; }),
          errColor: "rgb(0,87,15)", errCap: 2 },
        { label: "HL", data: rules.map(function (r) { return r.mean_hyper; }), backgroundColor: FRED,
          errLow: rules.map(function (r) { return r.hl_ci[0]; }), errHigh: rules.map(function (r) { return r.hl_ci[1]; }),
          errColor: "rgb(148,0,10)", errCap: 2 }
      ] }, options: o });

    // (B) sign grid: upper-left = simulation, lower-right = literature.
    function col(dir, code) {
      if (dir === 0) return FGRAY;
      return (dir === 1 && code === "NL") || (dir === -1 && code === "HL") ? FGREEN : FRED;
    }
    function tri(sim, exp) {
      return '<td class="tri" style="background:linear-gradient(to bottom right,' + sim + " 0 50%," + exp + ' 50% 100%)"></td>';
    }
    var html = '<table><thead><tr><th></th><th>NL</th><th>HL</th></tr></thead><tbody>';
    rules.forEach(function (r) {
      var exp = r.literature_direction === "+" ? 1 : -1;
      var sim = r.ci_lower > 0 ? 1 : (r.ci_upper < 0 ? -1 : 0);
      html += "<tr><th>" + esc(r.node) + "</th>" + tri(col(sim, "NL"), col(exp, "NL")) + tri(col(sim, "HL"), col(exp, "HL")) + "</tr>";
    });
    document.getElementById("fals-signs").innerHTML = html + "</tbody></table>" +
      '<p class="small mt-2 mb-0"><b>Supported:</b> ' + F.counts.Concordant + " · <b>Contradicted:</b> " +
      F.counts.Contradictory + " · <b>Inconclusive:</b> " + F.counts.Indeterminate + "</p>";

    // (C) forest plot: tested nodes on x, vertical CIs, squares = contradictory.
    var colors = rules.map(function (r) { return r["class"] === "anabolic" ? GREEN : RED; });
    var f = baseOpts("(C) Falsification forest plot (Normal − Hyper, 95% CI)");
    f.scales = { y: { min: -1.02, max: 1.02, title: { display: true, text: "Mean difference (Normal − Hyper)" } },
                 x: { type: "category", labels: labels, ticks: { autoSkip: false, maxRotation: 90, minRotation: 90 },
                      title: { display: true, text: "Tested nodes" } } };
    f.plugins.thresholdLines = { axis: "y", lines: [{ value: 0, color: "#000", solid: true }] };
    f.plugins.tooltip = { callbacks: { label: function (ctx) {
      var r = rules[ctx.dataIndex];
      return r.node + ": Δ = " + r.delta.toFixed(4) + ", CI [" + r.ci_lower.toFixed(4) + ", " + r.ci_upper.toFixed(4) + "] — " + r.outcome;
    } } };
    chart("fals-forest", { type: "scatter", plugins: [thresholdLines, errorBars],
      data: { datasets: [{ data: rules.map(function (r) { return { x: r.node, y: r.delta }; }),
        backgroundColor: colors, borderColor: "#000", borderWidth: 1.2,
        pointStyle: rules.map(function (r) { return r.outcome === "Contradictory" ? "rect" : "circle"; }),
        pointRadius: 6, errLow: rules.map(function (r) { return r.ci_lower; }),
        errHigh: rules.map(function (r) { return r.ci_upper; }), errColor: "#8c8c8c", errWidth: 1.5 }] },
      options: f });
    setFigure(d, "slot-falsification", ["NP_MT_FALS_RECT", "NP_MT_FALS"]);

    // Registry table.
    var t = '<thead><tr><th>Node</th><th>Lit. dir.</th><th>Benchmarks</th><th>Mean NL</th><th>Mean HL</th>' +
      "<th>Δ</th><th>95% bootstrap CI</th><th>Outcome</th><th>References</th></tr></thead><tbody>";
    F.rules.forEach(function (r) {
      t += "<tr><td>" + esc(r.node) + "</td><td>" + (r.literature_direction === "+" ? "+" : "−") + "</td><td>" +
        esc(r.benchmark_ids.join(", ")) + "</td><td>" + r.mean_normal.toFixed(5) + "</td><td>" + r.mean_hyper.toFixed(5) +
        "</td><td>" + (r.delta >= 0 ? "+" : "") + r.delta.toFixed(5) + "</td><td>[" + r.ci_lower.toFixed(5) + ", " +
        r.ci_upper.toFixed(5) + "]</td><td>" + (r.passed ? r.outcome : "<b>" + r.outcome + "</b>") + "</td><td>" +
        esc(r.references.join("; ")) + "</td></tr>";
    });
    document.getElementById("fals-table").innerHTML = t + "</tbody>";
  }

  function renderRescue(d, idx) {
    var m = d.rescue[idx];
    var top = m.top20;
    var o = baseOpts([m.figure + " (" + m.panel + ") · Top 20 Rescue Strategies — " + m.title, "Hyper → Normal Profile Restoration"]);
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

    // Node-resolved responses of the two highest-ranked interventions
    // (Supplementary Figs. S2-S3): mean paired Δ ± SD across 100 replicates.
    var nodes = m.nodes;
    var series = m.top2.map(function (lab, k) {
      var j = m.perturbations.indexOf(lab);
      var pct = m.all48[lab];
      return {
        label: (k + 1) + "  " + lab + "  (" + pct.toFixed(1) + "%)",
        data: nodes.map(function (n, i) { return { x: m.mean_delta[j][i], y: n }; }),
        errLow: nodes.map(function (n, i) { return m.mean_delta[j][i] - m.sd_delta[j][i]; }),
        errHigh: nodes.map(function (n, i) { return m.mean_delta[j][i] + m.sd_delta[j][i]; }),
        backgroundColor: k === 0 ? "rgb(33,92,176)" : "#fff",
        borderColor: k === 0 ? "rgb(33,92,176)" : "rgb(217,94,31)",
        errColor: k === 0 ? "rgb(33,92,176)" : "rgb(217,94,31)", errWidth: 1.5,
        pointStyle: k === 0 ? "circle" : "rect", pointRadius: k === 0 ? 6 : 5, borderWidth: 1.6
      };
    });
    var o2 = baseOpts("Node-resolved responses: two highest-ranked interventions");
    o2.indexAxis = "y";
    o2.plugins.legend = { display: true, position: "bottom" };
    o2.scales = { x: { title: { display: true, text: "Paired change from HL (activation, a.u.)" } },
                  y: { type: "category", labels: nodes, offset: true, ticks: { autoSkip: false } } };
    o2.plugins.thresholdLines = { axis: "x", lines: [{ value: 0, color: "#777", solid: true }] };
    chart("rescue-pairs", { type: "scatter", plugins: [thresholdLines, errorBars],
      data: { datasets: series }, options: o2 });

    var vmax = 0;
    m.mean_delta.forEach(function (row) { row.forEach(function (v) { vmax = Math.max(vmax, Math.abs(v)); }); });
    vmax = vmax || 1;
    heatTable("rescue-heat", m.nodes, m.perturbations.map(shortLabel),
      function (i, j) { return m.mean_delta[j][i]; },
      function (v) { return diverging(v, vmax); },
      function (v) { return Math.abs(v) < 0.005 ? "" : v.toFixed(2); });
    setFigure(d, "slot-rescue", m.figure_file);
    setFigure(d, "slot-rescue1", ["ECM", "GF", "TF", "CYT"].indexOf(m.tag) >= 0 ?
      "NodeResolved_ECM_GF_TF_CYT" : "NodeResolved_MET_ION_SURV_OXI");
    document.getElementById("node-resolved-intro").textContent = d.node_resolved_intro;
  }

  function renderRescueStatic(d) {
    var R = d.rescue_design;
    document.getElementById("rescue-summary").textContent = d.rescue_summary || "";
    document.getElementById("rescue-design").innerHTML =
      "Suppression (clamp 0): " + esc(R.suppression.join(", ")) + ". Activation (clamp 1): " + esc(R.activation.join(", ")) +
      ". " + R.n_singles + " single-node + " + R.n_duals + " dual-node (one activation + one suppression) = " +
      (R.n_singles + R.n_duals) + " interventions. Rescue % = 100 × (1 − D<sub>p</sub> / D<sub>Hyper</sub>).";
    document.getElementById("pheno-note").textContent =
      "Mean activation of the eight-marker anabolic panel (" + R.anabolic_panel.join(", ") +
      ") and the ten-marker catabolic panel (" + R.catabolic_panel.join(", ") +
      ") under NL, HL and each intervention. Rank columns: position in the ECM and cytokine/chemokine/protease Top-20 rankings.";
    var rankOf = {};
    d.rescue.forEach(function (m) {
      rankOf[m.category] = {};
      m.top20.forEach(function (r, i) { rankOf[m.category][r.strategy] = i + 1; });
    });
    var t = "<thead><tr><th>Regime / intervention</th><th>ECM rank</th><th>Cytokine rank</th>" +
      "<th>Anabolic mean</th><th>Catabolic mean</th></tr></thead><tbody>";
    d.phenotype_panels.forEach(function (r) {
      var lab = r.regime_or_intervention;
      var e = (rankOf.ecm_matrix || {})[lab], c = (rankOf.cytokines_chemokines_proteases || {})[lab];
      t += "<tr><td>" + esc(lab) + "</td><td>" + (e || "–") + "</td><td>" + (c || "–") + "</td><td>" +
        r.anabolic_mean.toFixed(3) + "</td><td>" + r.catabolic_mean.toFixed(3) + "</td></tr>";
    });
    document.getElementById("pheno-table").innerHTML = t + "</tbody>";
  }

  function fillSelect(id, items, onChange) {
    var sel = document.getElementById(id);
    sel.innerHTML = items.map(function (m, i) {
      return '<option value="' + i + '">' + (m.figure ? m.figure + " (" + m.panel + ") — " : "") + m.title + "</option>";
    }).join("");
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
        "#paper-falsification": function () { renderFalsification(d); },
        "#paper-rescue": function () { renderRescueStatic(d); renderRescue(d, 0); }
      };
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
