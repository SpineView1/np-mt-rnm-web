/*
 * Baseline tab: the paper's Figure 4, read-only.
 *
 * Steady-state activation under Hypo / Normal / Hyper chronic loading, in the
 * four panels of the published caption. The Simulation tab shows the same
 * panels but lets the Node Tray drive additional states onto them.
 */
(function () {
  "use strict";

  function start(bundle) {
    var panelGroup = window.NPMT.createPanelGroup({
      containerId: "baseline-panels",
      togglesId: "baseline-regime-toggles",
      bundle: bundle
    });
    if (!panelGroup) {
      return;
    }

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
        label: regime,
        color: bundle.regime_colors[regime],
        values: values,
        stds: stds
      });
    });

    var prov = document.getElementById("baseline-provenance");
    if (prov && bundle.provenance) {
      prov.textContent = bundle.provenance.statistic + ". " + bundle.provenance.note;
    }
  }

  function showError(message) {
    var panels = document.getElementById("baseline-panels");
    if (!panels) {
      return;
    }
    panels.innerHTML =
      '<div class="col-12"><div class="alert alert-warning mb-0"></div></div>';
    panels.querySelector(".alert").textContent =
      "Could not load the baseline data: " + message;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var urlHolder = document.getElementById("baseline-data-url");
    if (!urlHolder) {
      showError("data URL not found on the page.");
      return;
    }
    if (typeof Chart === "undefined" || !window.NPMT) {
      showError("charting library failed to load.");
      return;
    }
    window.NPMT.loadBundle(urlHolder.getAttribute("data-url"))
      .then(start)
      .catch(function (err) {
        showError(err.message);
      });
  });
})();
