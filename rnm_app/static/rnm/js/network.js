// Cytoscape.js rendering of the 147-node NP-MT regulatory network.
(async function () {
  const resp = await fetch("/api/network/");
  if (!resp.ok) {
    document.getElementById("cy").innerHTML = `<p style="padding:20px;color:#c74343">Failed to load network: ${resp.status}</p>`;
    return;
  }
  const data = await resp.json();

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

  const elements = [
    ...data.nodes.map(n => ({
      data: {
        id: n.id,
        label: n.id,
        category: n.category,
        color: categoryColors[n.category] || "#999",
      },
    })),
    ...data.edges.map((e, i) => ({
      data: { id: `e${i}`, source: e.source, target: e.target, sign: e.sign },
    })),
  ];

  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements,
    layout: { name: "cose", idealEdgeLength: 80, nodeOverlap: 10, padding: 10 },
    style: [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          label: "data(label)",
          "font-size": 8,
          "text-valign": "center",
          "text-halign": "center",
          color: "#fff",
          "text-outline-color": "#000",
          "text-outline-width": 1,
          width: 20, height: 20,
        },
      },
      {
        selector: "edge[sign > 0]",
        style: {
          "line-color": "#27ae60",
          "target-arrow-color": "#27ae60",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          width: 1,
        },
      },
      {
        selector: "edge[sign < 0]",
        style: {
          "line-color": "#c0392b",
          "target-arrow-color": "#c0392b",
          "target-arrow-shape": "tee",
          "curve-style": "bezier",
          width: 1,
        },
      },
      {
        selector: "node:selected",
        style: {
          "border-width": 2,
          "border-color": "#2b5876",
        },
      },
    ],
  });

  // Category filter UI.
  const filterHost = document.getElementById("category-filters");
  const usedCategories = [...new Set(data.nodes.map(n => n.category))].sort();
  filterHost.innerHTML = usedCategories
    .map(c => `<label style="margin-right:10px;color:${categoryColors[c] || '#999'}">
      <input type="checkbox" class="cat-filter" data-cat="${c}" checked> ${c}
    </label>`)
    .join("");

  document.querySelectorAll(".cat-filter").forEach(cb => {
    cb.addEventListener("change", () => {
      const enabled = new Set();
      document.querySelectorAll(".cat-filter").forEach(x => {
        if (x.checked) enabled.add(x.dataset.cat);
      });
      cy.nodes().forEach(n => {
        n.style("display", enabled.has(n.data("category")) ? "element" : "none");
      });
    });
  });

  // Click a node to log its metadata (for now — more elaborate panel can come later).
  cy.on("tap", "node", (evt) => {
    const n = evt.target;
    console.log("[network] clicked", n.id(), n.data("category"));
  });
})();
