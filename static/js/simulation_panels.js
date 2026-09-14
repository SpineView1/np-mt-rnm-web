/*
 * Simulation tab: the Figure 4 panels, driven by the Node Tray.
 *
 * With nothing clamped the panels show the published Hypo/Normal/Hyper
 * baselines. Clamping nodes in the tray and running adds the resulting state as
 * a further series, so a degeneration and an attempted rescue can be read
 * against the baselines and against each other, node by node.
 *
 * Every run is a 100-replicate ensemble (see EnsembleView), not a single
 * trajectory, so it is the same statistic as the baselines it sits next to.
 */
(function () {
  "use strict";

  // Distinct from the three regime colours, which are reserved for baselines.
  var RUN_COLORS = ["#7b52ab", "#e08b1f", "#00838f", "#c2185b", "#5d4037"];

  var panelGroup = null;
  var runCount = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function csrfToken() {
    var input = document.querySelector("[name=csrfmiddlewaretoken]");
    return input ? input.value : "";
  }

  function setStatus(text, busy) {
    var node = el("sim_status");
    if (node) {
      node.textContent = text || "";
    }
    var run = el("sim_run_ensemble");
    if (run) {
      run.disabled = !!busy;
    }
  }

  /* Name a run after what the tray actually holds, e.g.
   * "HL=0.8, NL=0.1" or "SOX9=1, FAK-E=0". */
  function labelForClamps(clamped) {
    var keys = Object.keys(clamped || {});
    if (!keys.length) {
      return "Unclamped run";
    }
    keys.sort();
    var parts = keys.map(function (k) {
      return k + "=" + Number(clamped[k]).toString();
    });
    var label = parts.join(", ");
    return label.length > 48 ? parts.length + " clamped nodes" : label;
  }

  function describeClamps(clamped) {
    var keys = Object.keys(clamped || {});
    if (!keys.length) {
      return "nothing clamped — showing baselines only.";
    }
    keys.sort();
    return keys
      .map(function (k) {
        return k + " = " + Number(clamped[k]).toString();
      })
      .join(", ");
  }

  function toMeans(nodes) {
    var means = {};
    var stds = {};
    Object.keys(nodes).forEach(function (name) {
      means[name] = nodes[name].mean;
      stds[name] = nodes[name].std;
    });
    return { means: means, stds: stds };
  }

  function downloadCsv(rows) {
    var text = rows
      .map(function (r) {
        return r
          .map(function (cell) {
            var v = String(cell);
            return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
          })
          .join(",");
      })
      .join("\n");

    var stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    var blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "np_mt_rnm_panels_" + stamp + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function runEnsemble() {
    if (!panelGroup) {
      return;
    }
    setStatus("Running 100 replicates…", true);

    fetch("/network-model/ensemble/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken()
      },
      body: JSON.stringify({ n_reps: 100, seed: runCount })
    })
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok || !body.success) {
            throw new Error(body.message || "HTTP " + r.status);
          }
          return body;
        });
      })
      .then(function (body) {
        var split = toMeans(body.nodes);
        runCount += 1;

        var summary = el("sim_clamp_text");
        if (summary) {
          summary.textContent = describeClamps(body.clamped);
        }

        panelGroup.addSeries({
          key: "run" + runCount,
          label: labelForClamps(body.clamped),
          color: RUN_COLORS[(runCount - 1) % RUN_COLORS.length],
          values: split.means,
          stds: split.stds,
          userRun: true
        });

        var clear = el("sim_clear_runs");
        if (clear) {
          clear.disabled = panelGroup.countUserRuns() === 0;
        }
        setStatus("Added run " + runCount + " (" + body.n_reps + " replicates).", false);
      })
      .catch(function (err) {
        setStatus("Run failed: " + err.message, false);
      });
  }

  function start(bundle) {
    panelGroup = window.NPMT.createPanelGroup({
      containerId: "sim-panels",
      togglesId: "sim-series-toggles",
      bundle: bundle,
      showRescuePercent: true
    });
    if (!panelGroup) {
      return;
    }

    // Baselines first, so an unclamped tray shows exactly the published figure.
    bundle.regimes.forEach(function (regime) {
      var values = {};
      var stds = {};
      Object.keys(bundle.groups).forEach(function (categoryId) {
        var group = bundle.groups[categoryId];
        group.nodes.forEach(function (node, i) {
          values[node] = group.series[regime].mean[i];
          stds[node] = group.series[regime].std[i];
        });
      });
      panelGroup.addSeries({
        key: "baseline-" + regime,
        label: regime + " (baseline)",
        color: bundle.regime_colors[regime],
        values: values,
        stds: stds
      });
    });

    var run = el("sim_run_ensemble");
    if (run) {
      run.addEventListener("click", runEnsemble);
    }
    var csv = el("sim_download_csv");
    if (csv) {
      csv.addEventListener("click", function () {
        downloadCsv(panelGroup.exportRows());
      });
    }

    var clear = el("sim_clear_runs");
    if (clear) {
      clear.addEventListener("click", function () {
        panelGroup.removeUserRuns();
        runCount = 0;
        clear.disabled = true;
        var summary = el("sim_clamp_text");
        if (summary) {
          summary.textContent = "nothing clamped — showing baselines only.";
        }
        setStatus("", false);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var urlHolder = el("baseline-data-url");
    if (!urlHolder || typeof Chart === "undefined" || !window.NPMT) {
      return;
    }
    window.NPMT.loadBundle(urlHolder.getAttribute("data-url"))
      .then(start)
      .catch(function (err) {
        setStatus("Could not load baseline data: " + err.message, false);
      });
  });
})();
