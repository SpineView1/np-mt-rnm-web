# NP-MT-RNM — Web App

Interactive web interface for the **Mechanotransduction Regulatory Network Model of nucleus pulposus (NP) cells**. Loads the SBML model, displays its structure (overview, compartments, rate rules, units, metadata), and lets users **clamp species** (including the three mechanical loading inputs **Hypo / NL / HL**), **run simulations** with [libRoadRunner](https://libroadrunner.org/) / [tellurium](https://tellurium.analogmachine.org/), and **download** the SBML or simulation results.

Companion to the model repository: [SpineView1/np-mt-rnm](https://github.com/SpineView1/np-mt-rnm).

Paper: *A systems-level network model reveals mechanical regulation of nucleus pulposus cell states* (Workineh, Chemorion, Noailly — 2026). The bundled SBML is the manuscript's 147-node, 357-edge network, exported from [np-mt-rnm](https://github.com/SpineView1/np-mt-rnm).

---

## Abstract

Intervertebral disc degeneration (IDD) is a leading cause of chronic low back pain and is strongly influenced by mechanical loading–dependent regulation of nucleus pulposus (NP) cell phenotype. Although individual mechanosensors and signaling pathways have been characterized, the systems-level principles governing how NP cells integrate mechanical cues into coordinated regulatory states remain unclear. Here, we present a systems-level regulatory network model of NP mechanotransduction comprising 147 molecular nodes and 356 experimentally supported interactions spanning mechanosensory inputs, signaling cascades, metabolic and redox regulators, transcription factors, extracellular matrix (ECM) effectors, inflammatory mediators, and cell-fate modules. Mechanical environments are represented as hypo-, normal-, and hyper-loading inputs that initiate distinct signaling programs. Semi-quantitative regulatory network simulations reveal three stable regimes: a hypo-loading state characterized by reduced ECM-anabolic activity, impaired adhesion-mediated survival signaling, and metabolic stress with features consistent with an anoikis-like phenotype; a normal-loading state associated with coordinated ECM maintenance, metabolic balance, and redox stability; and a hyper-loading state dominated by inflammatory amplification, oxidative stress, matrix degradation, and apoptosis. Falsification tests against independent experimental data demonstrate high directional concordance (~95%), supporting the biological plausibility of the network. Systematic perturbation analysis further identifies a distributed control structure in which mechanotransductive, redox, and transcriptional regulators jointly determine state stability, with combined attenuation of mechanically driven and stress-amplifying pathways together with activation of anabolic or cytoprotective programs most effectively restoring normal-like states. These findings provide a systems-level framework for understanding load-dependent NP cell regulation and for guiding multi-target therapeutic strategies in intervertebral disc mechanobiology.

**Keywords:** Nucleus pulposus, Mechanotransduction, Regulatory network modeling, Mechanical loading, Intervertebral disc degeneration, Systems biology, Network control

---

## Features

- Browse the SBML model: **147 species** spanning mechanical inputs, mechanosensors, signaling cascades, transcription factors, ECM, growth factors, cytokines, MMPs, and metabolic / hypoxia nodes.
- Simulate from a basal **Normal-loading** anabolic steady state with [tellurium](https://tellurium.analogmachine.org/).
- **Clamp any species** to a fixed value to impose mechanical regimes (e.g. `Hypo = 0.20` for hypo-loading, `HL = 0.80` for hyper-loading) or perturbations (`MMP13 = 1`, `SOX9 = 0`, …).
- **Abstract** tab: the manuscript's title, authors, abstract and keywords, verbatim.
- **Paper results** tab: every computational figure of the manuscript (topology, baselines, transition heatmaps, falsification, rescue rankings and node-resolved responses), interactive, with the manuscript's figure numbers and captions and the manuscript-style image for each. Data come from [np-mt-rnm](https://github.com/SpineView1/np-mt-rnm)'s `results/web_bundle/paper_results.json`; images from its `results/figures/paper/`.
- **Simulation** tab: run 100 replicates under the published loading regimes or your own clamps; results are added as series to the grouped panels, alongside the published Hypo / Normal / Hyper baselines.
- Download the live SBML and simulation results (CSV).

## Requirements

Python 3.10+, Django 5, libRoadRunner / tellurium, libsbml, matplotlib, pandas, numpy, networkx — see `requirements.txt`.

## Quick start

```bash
git clone git@github.com:SpineView1/np-mt-rnm-web.git
cd np-mt-rnm-web
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Then visit **http://localhost:8000/network-model/**.

## Docker

```bash
docker build -t np-mt-rnm-web .
docker run -p 8000:8000 np-mt-rnm-web
```

The container runs `manage.py migrate` + `collectstatic` at startup, then serves Django on `0.0.0.0:8000`.

## What's inside

| Path | Role |
|---|---|
| `biomodelize/` | Django project (settings, urls, wsgi) |
| `ModelSimFront/` | Django app — views, urls, templates |
| `ModelSimFront/views.py` | SBML parsing, stepped simulation, clamp + download endpoints |
| `ModelSimFront/templates/` | `view_sbml.html` + tab partials (overview, reactions, simulation, …) |
| `static/css/`, `static/js/` | Custom styles + front-end logic (Bootstrap 5) |
| `np_mt_rnm_model.xml` | SBML L3V2 model (147 species, 144 rate rules, 3 boundary inputs: Hypo / NL / HL) auto-discovered at startup |
| `Dockerfile` | Container image |

## Mechanical loading regimes

The model exposes three boundary species — `Hypo`, `NL` (normal loading), and `HL` (hyper loading). Each regime clamps two of them low and one high (manuscript Section 2.2):

| Regime | Hypo | NL | HL |
|---|---|---|---|
| Hypo-loading | **0.20** | 0.01 | 0.01 |
| Normal loading (basal) | 0.01 | **0.80** | 0.01 |
| Hyper-loading | 0.01 | 0.01 | **0.80** |

The committed baseline state is the Normal-loading steady state.

## Acknowledgement

UI scaffolding adapted from [SpineView1/RNM](https://github.com/SpineView1/RNM); same Django project + ModelSimFront app layout as the [OA macrophage variant](https://github.com/Kneeview/oa-macrophage-rnm-web). Only the SBML model, `FIXED_ORDER`, baseline values, and authorship metadata differ.

## License

MIT.
