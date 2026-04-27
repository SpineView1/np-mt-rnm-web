// Simulation tab — live tellurium-backed runs, two Chart.js panels.
// Loaded as an ES module from home.html.

const PRESETS = {
  hypo:   { Hypo: 0.80, NL: 0.01, HL: 0.01 },
  normal: { Hypo: 0.01, NL: 0.80, HL: 0.01 },
  hyper:  { Hypo: 0.01, NL: 0.01, HL: 0.80 },
};

const SPECIES = (window.NP_MT_RNM_SPECIES || []).filter(s => !s.is_boundary);
const MAX_CLAMPS = 10;

let barChart = null;
let lineChart = null;

const $ = (id) => document.getElementById(id);

function setStatus(msg, kind) {
  const el = $("sim-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "small mt-2 mb-0";
  if (kind === "error") el.classList.add("error");
  else if (kind === "ok") el.classList.add("ok");
  else el.classList.add("text-muted");
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  $("reg-hypo").value = p.Hypo;
  $("reg-nl").value = p.NL;
  $("reg-hl").value = p.HL;
  document.querySelectorAll("[data-preset]").forEach(b => {
    b.classList.toggle("active", b.dataset.preset === name);
  });
}

function buildClampRow() {
  const host = $("clamp-rows");
  if (!host) return;
  if (host.children.length >= MAX_CLAMPS) {
    setStatus(`At most ${MAX_CLAMPS} clamps.`, "error");
    return;
  }
  const row = document.createElement("div");
  row.className = "clamp-row";

  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  for (const sp of SPECIES) {
    const opt = document.createElement("option");
    opt.value = sp.id;
    opt.textContent = sp.id;
    select.appendChild(opt);
  }

  const value = document.createElement("input");
  value.type = "number";
  value.min = "0";
  value.max = "1";
  value.step = "0.01";
  value.value = "0.5";
  value.className = "form-control form-control-sm";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn-sm btn-outline-danger";
  remove.textContent = "x";
  remove.addEventListener("click", () => row.remove());

  row.appendChild(select);
  row.appendChild(value);
  row.appendChild(remove);
  host.appendChild(row);
}

function collectClamps() {
  const out = {};
  document.querySelectorAll("#clamp-rows .clamp-row").forEach(row => {
    const id = row.querySelector("select").value;
    const v = parseFloat(row.querySelector("input").value);
    if (id && Number.isFinite(v)) out[id] = v;
  });
  return out;
}

function topByDelta(initial, final, k = 20) {
  const ids = Object.keys(final);
  const ranked = ids
    .map(id => [id, Math.abs((final[id] || 0) - (initial[id] || 0))])
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(x => x[0]);
  return ranked;
}

function colorFor(i, n, alpha = 1) {
  const hue = Math.round((360 * i) / Math.max(1, n));
  return `hsla(${hue}, 65%, 50%, ${alpha})`;
}

function renderBar(initial, final) {
  const ids = topByDelta(initial, final, 20);
  const labels = ids;
  const init = ids.map(id => initial[id] ?? 0);
  const fin  = ids.map(id => final[id] ?? 0);

  const ctx = $("bar-chart").getContext("2d");
  if (barChart) barChart.destroy();
  barChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "initial", data: init, backgroundColor: "rgba(13,110,253,0.45)" },
        { label: "final",   data: fin,  backgroundColor: "rgba(253,126,20,0.85)" },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      scales: { x: { min: 0, max: 1 } },
      plugins: { legend: { position: "top" } },
    },
  });
}

function renderLine(time, trajectories) {
  const ids = Object.keys(trajectories);
  const datasets = ids.map((id, i) => ({
    label: id,
    data: trajectories[id],
    borderColor: colorFor(i, ids.length, 1),
    backgroundColor: colorFor(i, ids.length, 0.1),
    pointRadius: 0,
    borderWidth: 1.5,
    tension: 0.2,
  }));
  const ctx = $("line-chart").getContext("2d");
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(ctx, {
    type: "line",
    data: { labels: time.map(t => t.toFixed(1)), datasets },
    options: {
      responsive: true,
      animation: false,
      scales: { y: { min: 0, max: 1 } },
      plugins: { legend: { position: "right", labels: { boxWidth: 10, font: { size: 10 } } } },
    },
  });
}

async function runSimulation() {
  const regime = {
    Hypo: parseFloat($("reg-hypo").value),
    NL:   parseFloat($("reg-nl").value),
    HL:   parseFloat($("reg-hl").value),
  };
  const clamps = collectClamps();
  const t_end = parseFloat($("t-end").value) || 100;
  const n_points = parseInt($("n-points").value, 10) || 51;

  setStatus("Running...");
  $("run-sim").disabled = true;
  try {
    const resp = await fetch("/api/simulate/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regime, clamps, t_end, n_points }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setStatus(`Error: ${data.error || resp.status}`, "error");
      return;
    }
    renderBar(data.initial, data.final);
    renderLine(data.time, data.trajectories);
    setStatus(`Done in ${data.elapsed_s.toFixed(2)}s (${data.n_species_total} species).`, "ok");
  } catch (err) {
    setStatus(`Network error: ${err.message}`, "error");
  } finally {
    $("run-sim").disabled = false;
  }
}

function init() {
  document.querySelectorAll("[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });
  $("add-clamp")?.addEventListener("click", buildClampRow);
  $("run-sim")?.addEventListener("click", runSimulation);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
