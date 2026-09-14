/*
 * Shared grouped-bar panels for the NP-MT-RNM webapp.
 *
 * One panel per biological category, one bar series per model state, drawn the
 * way plot_grouped_bars_no_errors does in NP_MT_RNM_FALSIFY4_1.m: grouped bars,
 * no error bars, activation axis pinned to [0, 1].
 *
 * Node membership, ordering, colours and panel titles all come from
 * baseline_groups.json (built by np-mt-rnm's build_web_bundle.py), so the
 * MATLAB group_categories definitions are never restated in JavaScript.
 *
 * Exposes window.NPMT.
 */
(function () {
  "use strict";

  var PANEL_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

  function loadBundle(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) {
        throw new Error("HTTP " + r.status);
      }
      return r.json();
    });
  }

  function panelTitle(bundle, categoryId, group) {
    var titles = bundle.figure4_titles || {};
    return titles[categoryId] || group.label;
  }

  /* Euclidean % restoration from the Hyper profile toward Normal, over one
   * group's nodes. Same metric as analyze_group_true_rescue in
   * RESCUE_NEW4_1_final.m:
   *     100 * (D_Hyper - D_State) / D_Hyper
   * 100% = reaches Normal, 0% = no better than Hyper, <0% = further away. */
  function rescuePercent(group, values) {
    var normal = group.series.Normal;
    var hyper = group.series.Hyper;
    if (!normal || !hyper) {
      return null;
    }
    var dHyper = 0;
    var dState = 0;
    for (var i = 0; i < group.nodes.length; i++) {
      var target = normal.mean[i];
      var h = hyper.mean[i] - target;
      dHyper += h * h;
      var v = values[group.nodes[i]];
      if (typeof v !== "number") {
        return null;
      }
      var d = v - target;
      dState += d * d;
    }
    dHyper = Math.sqrt(dHyper);
    if (dHyper < 1e-12) {
      return null;
    }
    return (100 * (dHyper - Math.sqrt(dState))) / dHyper;
  }

  function createPanelGroup(opts) {
    var bundle = opts.bundle;
    var container = document.getElementById(opts.containerId);
    var toggleBox = document.getElementById(opts.togglesId);
    var showRescue = !!opts.showRescuePercent;
    if (!container || !toggleBox) {
      return null;
    }

    var categoryIds = opts.panels || bundle.figure4_panels;
    var panels = [];
    var series = []; // {key, label, color, values, stds}

    categoryIds.forEach(function (categoryId, i) {
      var group = bundle.groups[categoryId];
      if (!group) {
        return;
      }

      var col = document.createElement("div");
      col.className = "col-12 col-xl-6";

      var card = document.createElement("div");
      card.className = "card h-100";

      var body = document.createElement("div");
      body.className = "card-body";

      var title = document.createElement("h6");
      title.className = "card-title mb-1";
      title.textContent =
        "(" + (PANEL_LETTERS[i] || "?") + ") " + panelTitle(bundle, categoryId, group);

      var note = document.createElement("div");
      note.className = "small text-muted mb-1";
      note.style.minHeight = showRescue ? "1.2rem" : "0";

      var wrap = document.createElement("div");
      wrap.style.position = "relative";
      wrap.style.height = group.nodes.length > 12 ? "380px" : "300px";

      var canvas = document.createElement("canvas");
      wrap.appendChild(canvas);

      body.appendChild(title);
      if (showRescue) {
        body.appendChild(note);
      }
      body.appendChild(wrap);
      card.appendChild(body);
      col.appendChild(card);
      container.appendChild(col);

      var chart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: { labels: group.nodes, datasets: [] },
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
                  var s = series[ctx.datasetIndex];
                  var node = group.nodes[ctx.dataIndex];
                  var sd = s && s.stds ? s.stds[node] : undefined;
                  var text = ctx.dataset.label + ": " + ctx.parsed.y.toFixed(3);
                  if (typeof sd === "number") {
                    text += " (SD " + sd.toFixed(3) + ")";
                  }
                  return text;
                }
              }
            }
          }
        }
      });

      panels.push({ categoryId: categoryId, group: group, chart: chart, note: note });
    });

    function refresh() {
      panels.forEach(function (panel) {
        panel.chart.data.datasets = series.map(function (s) {
          return {
            label: s.label,
            data: panel.group.nodes.map(function (n) {
              var v = s.values[n];
              return typeof v === "number" ? v : null;
            }),
            backgroundColor: s.color,
            borderWidth: 0,
            hidden: !!s.hidden
          };
        });
        panel.chart.update();

        if (showRescue) {
          // Annotate with the most recent visible user-added state.
          var annotated = null;
          for (var i = series.length - 1; i >= 0; i--) {
            if (series[i].userRun && !series[i].hidden) {
              annotated = series[i];
              break;
            }
          }
          if (!annotated) {
            panel.note.textContent = "";
          } else {
            var pct = rescuePercent(panel.group, annotated.values);
            panel.note.textContent =
              pct === null
                ? ""
                : annotated.label +
                  ": " +
                  pct.toFixed(1) +
                  "% restoration from Hyper toward Normal";
          }
        }
      });
    }

    function rebuildToggles() {
      toggleBox.querySelectorAll("[data-series-toggle]").forEach(function (el) {
        el.remove();
      });
      series.forEach(function (s) {
        var wrapper = document.createElement("div");
        wrapper.className = "form-check form-check-inline m-0";
        wrapper.setAttribute("data-series-toggle", s.key);

        var input = document.createElement("input");
        input.className = "form-check-input";
        input.type = "checkbox";
        input.id = "series-toggle-" + s.key;
        input.checked = !s.hidden;
        input.addEventListener("change", function () {
          s.hidden = !input.checked;
          refresh();
        });

        var label = document.createElement("label");
        label.className =
          "form-check-label d-inline-flex align-items-center gap-1";
        label.setAttribute("for", input.id);

        var swatch = document.createElement("span");
        swatch.style.display = "inline-block";
        swatch.style.width = "0.9rem";
        swatch.style.height = "0.9rem";
        swatch.style.borderRadius = "2px";
        swatch.style.backgroundColor = s.color;

        var text = document.createElement("span");
        text.textContent = s.label;

        label.appendChild(swatch);
        label.appendChild(text);
        wrapper.appendChild(input);
        wrapper.appendChild(label);
        toggleBox.appendChild(wrapper);
      });
    }

    return {
      addSeries: function (s) {
        var existing = series.findIndex(function (x) {
          return x.key === s.key;
        });
        var entry = {
          key: s.key,
          label: s.label,
          color: s.color,
          values: s.values,
          stds: s.stds || null,
          userRun: !!s.userRun,
          hidden: !!s.hidden
        };
        if (existing >= 0) {
          series[existing] = entry;
        } else {
          series.push(entry);
        }
        rebuildToggles();
        refresh();
      },
      removeUserRuns: function () {
        series = series.filter(function (s) {
          return !s.userRun;
        });
        rebuildToggles();
        refresh();
      },
      countUserRuns: function () {
        return series.filter(function (s) {
          return s.userRun;
        }).length;
      },
      /* Every plotted series, long-form, for CSV export. */
      exportRows: function () {
        var rows = [["panel", "node", "series", "mean", "std"]];
        panels.forEach(function (panel) {
          panel.group.nodes.forEach(function (node) {
            series.forEach(function (s) {
              var v = s.values[node];
              if (typeof v !== "number") {
                return;
              }
              var sd = s.stds ? s.stds[node] : "";
              rows.push([
                panel.group.label,
                node,
                s.label,
                String(v),
                typeof sd === "number" ? String(sd) : ""
              ]);
            });
          });
        });
        return rows;
      }
    };
  }

  // Bootstrap tab panes are display:none until shown, so a chart created in a
  // hidden pane measures its canvas as zero. Resize on reveal.
  document.addEventListener("shown.bs.tab", function () {
    if (window.Chart && Chart.instances) {
      Object.keys(Chart.instances).forEach(function (k) {
        Chart.instances[k].resize();
      });
    }
  });

  window.NPMT = {
    loadBundle: loadBundle,
    createPanelGroup: createPanelGroup,
    rescuePercent: rescuePercent
  };
})();
