// Live Simulate tab: sliders + optional clamp → POST /api/simulate/ → bars + network recolor.
(function () {
  const presetValues = {
    Hypo:   { Hypo: 0.20, NL: 0.01, HL: 0.01 },
    Normal: { Hypo: 0.01, NL: 0.80, HL: 0.01 },
    Hyper:  { Hypo: 0.01, NL: 0.01, HL: 0.80 },
  };

  const categoryColors = {
    mechanosensor:                  "#8e44ad",
    ion_channel:                    "#2980b9",
    rho_cytoskeletal:               "#16a085",
    mapk:                           "#1abc9c",
    metabolic:                      "#27ae60",
    oxidative_proteostasis:         "#2ecc71",
    transcription_factor:           "#f39c12",
    growth_factor:                  "#e67e22",
    ecm_matrix:                     "#c0392b",
    cytokines_chemokines_proteases: "#d35400",
    cell_fate:                      "#7f3ea1",
    other:                          "#95a5a6",
  };

  // ---- Preset button handlers ----
  document.querySelectorAll(".preset-buttons button").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = presetValues[btn.dataset.preset];
      document.getElementById("slider-hypo").value = p.Hypo;
      document.getElementById("slider-nl").value = p.NL;
      document.getElementById("slider-hl").value = p.HL;
    });
  });

  // ---- Cytoscape.js recolor panel ----
  let cy = null;
  let networkData = null;

  async function ensureNetwork() {
    if (cy) return cy;
    const resp = await fetch("/api/network/");
    if (!resp.ok) return null;
    networkData = await resp.json();
    cy = cytoscape({
      container: document.getElementById("sim-network"),
      elements: [
        ...networkData.nodes.map(n => ({
          data: {
            id: n.id,
            label: n.id,
            category: n.category,
            activation: 0,
          },
        })),
        ...networkData.edges.map((e, i) => ({
          data: { id: `e${i}`, source: e.source, target: e.target, sign: e.sign },
        })),
      ],
      layout: { name: "cose", idealEdgeLength: 70, nodeOverlap: 8, padding: 4 },
      style: [
        {
          selector: "node",
          style: {
            "background-color": `mapData(activation, 0, 1, #eee, #2a7f62)`,
            label: "data(label)",
            "font-size": 7,
            "text-valign": "center",
            "text-halign": "center",
            color: "#222",
            width: 16,
            height: 16,
          },
        },
        {
          selector: "edge[sign > 0]",
          style: {
            "line-color": "#27ae60",
            "target-arrow-color": "#27ae60",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            width: 0.8,
          },
        },
        {
          selector: "edge[sign < 0]",
          style: {
            "line-color": "#c0392b",
            "target-arrow-color": "#c0392b",
            "target-arrow-shape": "tee",
            "curve-style": "bezier",
            width: 0.8,
          },
        },
      ],
    });
    return cy;
  }

  // ---- Bar chart ----
  let barChart = null;

  function renderBars(activations) {
    const labels = Object.keys(activations);
    const values = labels.map(k => activations[k]);
    const ctx = document.getElementById("sim-bars").getContext("2d");
    if (barChart) barChart.destroy();
    barChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Activation",
          data: values,
          backgroundColor: values.map(v => `rgba(47, 157, 85, ${Math.max(0.12, Math.min(1.0, v))})`),
        }],
      },
      options: {
        scales: { y: { min: 0, max: 1 } },
        plugins: { legend: { display: false } },
        animation: false,
      },
    });
  }

  // ---- Run ----
  async function run() {
    const status = document.getElementById("sim-status");
    status.textContent = "running…";
    const body = {
      regime: {
        Hypo: parseFloat(document.getElementById("slider-hypo").value),
        NL:   parseFloat(document.getElementById("slider-nl").value),
        HL:   parseFloat(document.getElementById("slider-hl").value),
      },
      clamps: {},
    };
    const clampNode = document.getElementById("clamp-node").value;
    if (clampNode) {
      body.clamps[clampNode] = parseFloat(document.getElementById("clamp-value").value);
    }

    const t0 = performance.now();
    let resp;
    try {
      resp = await fetch("/api/simulate/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      status.textContent = "network error";
      return;
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      status.textContent = `error: ${err.error || resp.statusText}`;
      return;
    }
    const data = await resp.json();
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    status.textContent = `done (${elapsed}s, max|dx/dt|=${data.max_abs_derivative.toExponential(2)}, converged=${data.converged})`;

    renderBars(data.node_activations);

    // Recolor the network panel by activation.
    const cyInst = await ensureNetwork();
    if (cyInst) {
      cyInst.nodes().forEach(n => {
        const v = data.node_activations[n.id()] ?? 0;
        n.data("activation", v);
      });
    }
  }

  document.getElementById("run-sim").addEventListener("click", run);
  // Run once on page load to show default Normal state.
  run();
})();
