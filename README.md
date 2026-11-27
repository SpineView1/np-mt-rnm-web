# NP-MT-RNM — Web App

Interactive web interface for the **Mechanotransduction Regulatory Network Model of nucleus pulposus (NP) cells**. Loads the SBML model, displays its structure (overview, compartments, rate rules, units, metadata), and lets users **clamp species** (including the three mechanical loading inputs **Hypo / NL / HL**), **run simulations** with [libRoadRunner](https://libroadrunner.org/) / [tellurium](https://tellurium.analogmachine.org/), and **download** the SBML or simulation results.

Companion to the model repository: [SpineView1/np-mt-rnm](https://github.com/SpineView1/np-mt-rnm).

Paper: *A systems-level view of nucleus pulposus mechanotransduction and its regulatory control* (Workineh, Chemorion, Noailly — 2026). The bundled SBML is the manuscript's 146-node, 353-interaction network, exported from [np-mt-rnm](https://github.com/SpineView1/np-mt-rnm).

---

## Abstract

Intervertebral disc degeneration (IDD), a major contributor to chronic low back pain, is strongly influenced by mechanical loading-dependent regulation of nucleus pulposus (NP) cell phenotype. Previous studies have characterized individual mechanosensors and specific signalling pathways involved in NP mechanotransduction. However, the regulatory interactions through which these components integrate mechanical cues into coordinated cellular responses remain incompletely understood. Here, we present an NP-specific, signed, directed regulatory network model (RNM) comprising 146 molecular nodes and 353 literature-supported interactions. The network connects mechanosensors with signalling cascades, metabolic and redox regulators, transcription factors, extracellular matrix (ECM) effectors, inflammatory mediators, and cell-fate pathways. Using the SQUADS semi-quantitative formalism, which accommodates limited kinetic parameter availability, we simulated steady-state responses to hypo-loading (Hypo), normal loading (NL), and hyper-loading (HL). We also analyzed network topology and screened 48 single- and dual-node perturbations under sustained HL. NL maintained high activity of the ECM-associated regulators ACAN, COL2A1, SOX9, and TIMP3, supported by AKT1, FAK, and antioxidant regulation. HL promoted inflammatory and catabolic regulation through mediators such as NF-κB, AP-1, MMP13, and ADAMTS4/5, accompanied by increased ROS, BAX, and CASP3 activity. Hypo reduced anabolic activity while retaining calcium, ROS, AMPK, and apoptotic signalling, suggesting a possible adhesion-dependent stress mechanism. Model falsification against 39 literature-derived molecular directionality benchmarks yielded 37 concordant predictions (94.9%), providing indirect, direction-level support for the RNM. HSF1 and CCN2 showed contradictory responses. Simulated regulatory recovery was module-specific. SOX9 activation achieved 82.8% ECM-profile recovery, increasing to 85.9% with ROS suppression. SOX9 activation combined with NF-κB suppression achieved 57.0% inflammatory/proteolytic-module recovery. FOXO activation with ROS suppression achieved 68.9% oxidative-stress/proteostasis-module recovery. NRF2 activation with PIEZO1 suppression achieved 37.5% cell-survival-module recovery. These predictions identify candidate molecular targets and intervention combinations for anabolic reinforcement, inflammatory suppression, redox protection, and mechanosensory modulation. The RNM provides a mechanistic framework for computational prioritization of candidate therapeutic targets and intervention combinations. Its predictions can guide subsequent preclinical validation in NP-cell and disc-explant models under controlled mechanical loading. Experimental validation, incorporation of time-dependent loading, and calibration of regulatory parameters are necessary to establish the therapeutic relevance of these predictions and improve the model's translational applicability.

**Keywords:** Nucleus pulposus, Mechanotransduction, Regulatory network modeling, Mechanical loading, Intervertebral disc degeneration, Systems biology, Network control

---

## Features

- Browse the SBML model: **146 species** spanning mechanical inputs, mechanosensors, signaling cascades, transcription factors, ECM, growth factors, cytokines, MMPs, and metabolic / hypoxia nodes.
- Simulate from a basal **Normal-loading** anabolic steady state with [tellurium](https://tellurium.analogmachine.org/).
- **Clamp any species** to a fixed value to impose mechanical regimes (e.g. `Hypo = 0.20` for hypo-loading, `HL = 0.80` for hyper-loading) or perturbations (`MMP13 = 1`, `SOX9 = 0`, …).
- **Abstract** tab: the manuscript's title, authors, abstract and keywords, verbatim.
- **Paper results** tab: every computational figure of the manuscript, interactive, with the manuscript's figure numbers and captions and the manuscript-style image for each: topology (Fig. 2); baselines with 95% bootstrap CIs and Kruskal–Wallis / rank-sum q-values (Figs. 3–4); falsification against 39 literature-derived benchmarks with zero-based bootstrap-CI criteria: NL/HL profiles, sign grid, forest plot and the full benchmark registry with references (Fig. 5); the 48-intervention rescue screen (6 suppression × 6 activation targets), Top-20 rankings for the eight modules (Figs. 6–7), node-resolved responses of the two top interventions per module (Supplementary Figs. S2–S3), the Δ heatmap and the phenotype-panel table. Data come from [np-mt-rnm](https://github.com/SpineView1/np-mt-rnm)'s `results/web_bundle/paper_results.json`; images from its `results/figures/paper/`.
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
| `np_mt_rnm_model.xml` | SBML L3V2 model (146 species, 143 rate rules, 3 boundary inputs: Hypo / NL / HL) auto-discovered at startup |
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
