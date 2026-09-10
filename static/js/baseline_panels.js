/*
 * Paper Figure 4 — baseline steady-state activation, grouped by biological
 * category, one bar series per chronic loading regime.
 *
 * Mirrors plot_grouped_bars_no_errors in NP_MT_RNM_FALSIFY4_1.m: grouped bars,
 * no error bars, y axis fixed to [0, 1] (YLIM_ACTIVATION), and the same
 * Hypo/Normal/Hyper colours the matplotlib figures use.
 *
 * Node membership, ordering and colours all come from baseline_groups.json,
 * which build_web_bundle.py derives from the MATLAB group_categories. Nothing
 * about the grouping is duplicated here.
 */
(function () {
  "use strict";

  var PANEL_LETTERS = ["A", "B", "C", "D"];
  var charts = [];
  var hiddenRegimes = Object.create(null);

  function dataUrl() {
    var el = document.getElementById("baseline-data-url");
    return el ? el.getAttribute("data-url") : null;
  }

  function panelTitle(categoryId, group, bundle) {
    // Prefer the paper's Figure 4 caption wording; fall back to the internal
    // category label if the bundle predates figure4_titles.
    var titles = bundle.figure4_titles || {};
    return titles[categoryId] || group.label;
  }

  function makePanel(container, letter, categoryId, group, bundle) {
    var col = document.createElement("div");
    // Two panels per row on wide screens, one per row on small ones.
    col.className = "col-12 col-xl-6";

    var card = document.createElement("div");
    card.className = "card h-100";

    var body = document.createElement("div");
    body.className = "card-body";

    var title = document.createElement("h6");
    title.className = "card-title";
    title.textContent =
      "(" + letter + ") " + panelTitle(categoryId, group, bundle);

    var wrap = document.createElement("div");
    // Give taller groups more room so the node labels stay readable.
    wrap.style.position = "relative";
    wrap.style.height = group.nodes.length > 12 ? "380px" : "300px";

    var canvas = document.createElement("canvas");
    wrap.appendChild(canvas);

    body.appendChild(title);
    body.appendChild(wrap);
    card.appendChild(body);
    col.appendChild(card);
    container.appendChild(col);

    var datasets = bundle.regimes.map(function (regime) {
      return {
        label: regime,
        data: group.series[regime].mean,
        backgroundColor: bundle.regime_colors[regime],
        borderWidth: 0,
        hidden: !!hiddenRegimes[regime]
      };
    });

    return new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: group.nodes, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          y: {
            min: 0,
            max: 1,
            title: { display: true, text: "Activation (a.u.)" },
            grid: { color: "rgba(0,0,0,0.08)" }
          },
          x: {
            ticks: { autoSkip: false, maxRotation: 60, minRotation: 60 },
            grid: { display: false }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var sd = group.series[ctx.dataset.label].std[ctx.dataIndex];
                return (
                  ctx.dataset.label +
                  ": " +
                  ctx.parsed.y.toFixed(3) +
                  " (SD " +
                  sd.toFixed(3) +
                  ")"
                );
              }
            }
          }
        }
      }
    });
  }

  function buildToggles(container, bundle) {
    bundle.regimes.forEach(function (regime) {
      var id = "baseline-toggle-" + regime;

      var wrapper = document.createElement("div");
      wrapper.className = "form-check form-check-inline m-0";

      var input = document.createElement("input");
      input.className = "form-check-input";
      input.type = "checkbox";
      input.id = id;
      input.checked = true;

      var label = document.createElement("label");
      label.className = "form-check-label d-inline-flex align-items-center gap-1";
      label.setAttribute("for", id);

      var swatch = document.createElement("span");
      swatch.style.display = "inline-block";
      swatch.style.width = "0.9rem";
      swatch.style.height = "0.9rem";
      swatch.style.borderRadius = "2px";
      swatch.style.backgroundColor = bundle.regime_colors[regime];

      var text = document.createElement("span");
      text.textContent = regime;

      label.appendChild(swatch);
      label.appendChild(text);

      input.addEventListener("change", function () {
        hiddenRegimes[regime] = !input.checked;
        // One toggle drives every panel, so the four charts always show the
        // same comparison.
        charts.forEach(function (chart) {
          chart.data.datasets.forEach(function (ds) {
            if (ds.label === regime) {
              ds.hidden = !input.checked;
            }
          });
          chart.update();
        });
      });

      wrapper.appendChild(input);
      wrapper.appendChild(label);
      container.appendChild(wrapper);
    });
  }

  function render(bundle) {
    var panels = document.getElementById("baseline-panels");
    var toggles = document.getElementById("baseline-regime-toggles");
    if (!panels || !toggles) {
      return;
    }

    buildToggles(toggles, bundle);

    bundle.figure4_panels.forEach(function (categoryId, i) {
      var group = bundle.groups[categoryId];
      if (!group) {
        return;
      }
      charts.push(
        makePanel(panels, PANEL_LETTERS[i] || "?", categoryId, group, bundle)
      );
    });

    var prov = document.getElementById("baseline-provenance");
    if (prov && bundle.provenance) {
      prov.textContent =
        bundle.provenance.statistic + ". " + bundle.provenance.note;
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
    var url = dataUrl();
    if (!url) {
      showError("data URL not found on the page.");
      return;
    }
    if (typeof Chart === "undefined") {
      showError("charting library failed to load.");
      return;
    }
    fetch(url)
      .then(function (r) {
        if (!r.ok) {
          throw new Error("HTTP " + r.status);
        }
        return r.json();
      })
      .then(render)
      .catch(function (err) {
        showError(err.message);
      });
  });
})();
