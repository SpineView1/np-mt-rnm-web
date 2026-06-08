# NP-MT-RNM — Web App

Interactive web interface for the **Mechanotransduction Regulatory Network Model of nucleus pulposus (NP) cells**. Loads the SBML model, displays its structure (overview, compartments, rate rules, units, metadata), and lets users **clamp species** (including the three mechanical loading inputs **Hypo / NL / HL**), **run simulations** with [libRoadRunner](https://libroadrunner.org/) / [tellurium](https://tellurium.analogmachine.org/), and **download** the SBML or simulation results.

Companion to the model repository: [SpineView1/np-mt-rnm](https://github.com/SpineView1/np-mt-rnm).

Paper: *A systems-level network model reveals how mechanical loading organizes regulatory states and transitions in nucleus pulposus cells* (Workineh, Chemorion, Noailly — 2026).

---

## Features

- Browse the SBML model: **147 species** spanning mechanical inputs, mechanosensors, signaling cascades, transcription factors, ECM, growth factors, cytokines, MMPs, and metabolic / hypoxia nodes.
- Simulate from a basal **Normal-loading** anabolic steady state with [tellurium](https://tellurium.analogmachine.org/).
- **Clamp any species** to a fixed value to impose mechanical regimes (e.g. `Hypo = 0.80` for hypo-loading, `HL = 0.80` for hyper-loading) or perturbations (`MMP13 = 1`, `SOX9 = 0`, …).
- Bar plot of initial vs final activation across 31 paper-figure markers (ECM, mechanosensors, growth factors, hypoxia axis, inflammatory mediators, catabolic enzymes).
- Download the live SBML.

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

The model exposes three boundary species — `Hypo`, `NL` (normal loading), and `HL` (hyper loading). Each regime clamps two of them low and one high:

| Regime | Hypo | NL | HL |
|---|---|---|---|
| Hypo-loading | **0.80** | 0.01 | 0.01 |
| Normal loading (basal) | 0.01 | **0.80** | 0.01 |
| Hyper-loading | 0.01 | 0.01 | **0.80** |

The committed baseline state is the Normal-loading steady state.

## Acknowledgement

UI scaffolding adapted from [SpineView1/RNM](https://github.com/SpineView1/RNM); same Django project + ModelSimFront app layout as the [OA macrophage variant](https://github.com/Kneeview/oa-macrophage-rnm-web). Only the SBML model, `FIXED_ORDER`, baseline values, and authorship metadata differ.

## License

MIT.
