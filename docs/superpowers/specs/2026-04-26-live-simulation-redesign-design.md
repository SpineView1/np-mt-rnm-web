# NP-MT-RNM Web App — Live Simulation Redesign

**Date:** 2026-04-26
**Status:** Design approved (implementation plan pending)
**Repository:** `np-mt-rnm-web/`
**Author:** Francis Chemorion (UPF)

## Background

`np-mt-rnm-web` currently ships precomputed JSON snapshots — `rescue.json`, `baseline.json`, `falsification.json`, `transitions.json` — generated from the `np_mt_rnm` Python pipeline at one fixed seed. Each tab renders one of these snapshots.

Treating those snapshots as authoritative is misleading for a paper companion site:

1. **Coverage.** The state space (147 nodes × arbitrary clamp values × regime parameters) is effectively infinite; precomputed JSON covers only what the authors happened to run.
2. **Variance.** A single stochastic draw is presented as a point estimate, hiding the replicate-to-replicate variability that determines whether a finding is robust.
3. **Interactivity.** Users cannot ask "what if I knock down node X" — the simulator is read-only.

The biologist's meeting notes (2026-04-22) explicitly call for: single-node knockout testing on candidate catabolic / anabolic nodes, double-node combinations, and recommendations for which pairs to try next. None of this fits a static snapshot.

## Goals

1. Every simulation result is computed live on user demand.
2. Replicate variance (mean ± std) is shown, never hidden.
3. Multi-node clamping (1–5 simultaneous clamps) is first-class on both the Simulate and Rescue tabs.
4. The Rescue tab supports the biologist's workflow: explore single-node KDs, surface a session-local ranking, propose follow-up pairs.
5. The Simulate tab's bar chart fits the viewport without page-scrolling at its default view.

## Scope and constraints

- **Audience:** paper readers; ≤1000 users/year; concurrent peak ≲5.
- **Compute budget:** few seconds per request; 30 s hard cap.
- **No precomputed simulation data ships with the app.** Only network topology and paper text/figures are static.
- **Non-goals:** job queues, Celery/Redis, frontend automated tests, mobile-first design, an explicit "Reproduce paper" button (can be added later).

## Architecture

### Compute model

Every simulation runs inline in the Django request handler. POST → compute → JSON response. Synchronous. No background workers, no polling.

### Freeze-safe rules (enforced server-side)

- `n_jobs=1` always in calls to `np_mt_rnm.simulation.run_replicates` and `np_mt_rnm.rescue.run_perturbation`. No joblib forking. (Forking under memory pressure was the freeze trigger in earlier sessions.)
- `n_replicates` clamped to ≤ 20 server-side, regardless of client payload.
- `clamps` clamped to ≤ 5 entries.
- 30 s timeout at the Django layer for non-streaming endpoints.

### Worker pool

- **Production:** gunicorn with 3 sync workers behind a reverse proxy.
- **Development:** `manage.py runserver --noreload` (single-process, sufficient for local edits).

### Caching

Per-worker in-memory LRU cache, size 200, keyed by:

```
(regime_tuple, sorted_clamps_tuple, n_replicates, seed)
```

Cache miss on `n_replicates` upgrade is correct: variance for n=20 cannot be derived from cached n=5.

### Variance is first-class

Every simulation response includes `mean` and `std` across replicates. UI shows error whiskers / ±std text, not a single bare number.

### Seeding

Default `seed = hash((regime_tuple, sorted_clamps_tuple)) & 0xFFFF`. Same inputs → same result (stable, shareable URLs); different inputs → different seed. Optional `seed` field in any request lets users force replicate variability.

### Static vs live

| Asset | Treatment |
|---|---|
| Network topology (`network.json`, `node_categories.json`) | **Static** |
| Paper narrative text (Overview tab) | **Static** |
| Paper figure PNGs (Overview tab only, labelled "from the published paper") | **Static** |
| Steady states, deltas, rankings, balance score, distance-to-Normal | **Live** |
| Falsification polarity matches | **Live** |
| Transition trajectories | **Live** |
| `precomputed/baseline.json`, `rescue.json`, `falsification.json`, `transitions.json` | **Deleted** |

### Hosting

Choice deferred to implementation plan. Render free, Fly.io small VM, and a UPF departmental server all fit the load budget.

## Components

### Overview tab

Plain narrative + citation + paper figures. No simulation. Unchanged.

### Network tab

Cytoscape.js render of the 147-node, 357-edge topology from `network.json`. Category filters. Pure topology view; no steady-state coloring (that lives in Simulate / Rescue).

### Simulate tab — general-purpose live simulator

**Inputs**
- Regime: sliders (`hypo`, `nl`, `hl`) or preset buttons (Hypo / Normal / Hyper).
- Multi-clamp builder (shared component). 0–5 clamps.
- Replicate count: 1 / 5 / 10 / 20 (default 5).

**Action**
`POST /api/simulate/`.

**Outputs**
- Network recolored by mean steady state.
- Variance-aware bar chart (shared component) of top-20 nodes by `|mean_delta_vs_hyper|`, with error whiskers.
- Per-category strip: ECM / TF / GF / cytokines / oxidative / cell-fate mean|Δ|.

### Rescue tab — Hyper-focused rescue exploration

**Inputs**
- Regime locked to Hyper (banner explains).
- Multi-clamp builder (1–5 clamps, any of the 147 nodes).
- Replicate selector.
- **Candidate chip toolbar.** Two rows of one-click chips above the multi-clamp builder:
  - **Catabolic ↓ chips:** RhoA-E, PIEZO1, PI3K-E, FAK-E, ROS. Click → appends one clamp at value 0.
  - **Anabolic ↑ chips:** SOX9, PPARγ, HIF-1α, NRF2, IκBα. Click → appends one clamp at value 1.
  Chips are disabled when the corresponding node is already in the builder, or when the 5-clamp cap is reached. This pattern supports the biologist's workflow: click a single chip → run → log to ranking → repeat for each candidate → then click two chips to construct a dual.

**Action**
`POST /api/rescue/`. Same compute as Simulate plus rescue-specific metrics.

**Outputs**
- Variance-aware delta bar chart.
- Per-category scorecard.
- **Balance score** — anabolic_mean − catabolic_mean over the published 5+5 sets.
- **Distance-to-Normal** — Euclidean distance over all 147 nodes between the mean perturbed steady state and the Normal mean steady state. The Normal reference is computed once per worker on cold start.
- **Session ranking board.** Every run during this browser session is appended to `sessionStorage` and ranked by user-selected metric (default: distance-to-Normal, ascending). Persists across tab navigation; resets on browser close.
- **Pair suggestion.** Once the user has ≥2 single-clamp runs that include at least one node from `CATABOLIC_DOWN_NODES` (clamped to 0) and at least one from `ANABOLIC_UP_NODES` (clamped to 1), show: "Try next: `<best_catabolic_KD>` + `<best_anabolic_UP>`" with a one-click button that populates the clamp builder. "Best" = lowest distance-to-Normal among the user's matching single-clamp runs.

### Falsification tab

**Single condition**
Dropdown of 45 paper conditions → "Run" → `POST /api/falsification/` → forest-style row showing expected polarity, observed polarity, match indicator, observed Δ on the named target node ± std.

**Run all 45**
"Run all" button opens an SSE connection to `GET /api/falsification/stream/`. UI fills a progressive forest plot, one row per condition as it returns. Running tally of matched/total. User can cancel mid-stream by closing the EventSource. Server caps each condition to 5 replicates; total expected wall time ≤3 min.

### Transitions tab

**Inputs**
- Start regime, end regime.
- `t_switch`, `t_end`.
- Selected nodes for plotting (≤10, default a 5-node preset of marker genes).
- Replicate selector.

**Action**
`POST /api/transitions/`.

**Outputs**
Line plot per selected node (mean line + std band) over time, with a vertical marker at `t_switch`.

### Downloads tab

Links only. No simulation. Unchanged.

### Shared component: multi-clamp builder

- "Add clamp" button appends a row: node autocomplete (fuzzy over all 147 names from `network.json`) + value slider [0, 1] with snap buttons (0 / 0.5 / 1) + remove ×.
- Hard limit: 5 clamps. Re-validated server-side.
- Live validation: reject duplicate node names; show inline error.

### Shared component: variance-aware bar chart

- **Default view:** top-20 by `|mean Δ|`. Each bar 24 px tall → ~480 px column, fits viewport without page-scrolling.
- **Toggle:** "Show all 147" switches to an internally-scrollable container (the chart scrolls, the page does not).
- Horizontal bars; whiskers = ± std across replicates.
- This is the **fix** for the existing "bar graph too tall" complaint, which originated in the 147-node Simulate canvas at fixed 400 px height.

## API contracts

### `POST /api/simulate/`

```
request:
  {
    "regime": {"hypo": float, "nl": float, "hl": float}
              | "Hypo" | "Normal" | "Hyper",
    "clamps": [{"node": str, "value": float in [0,1]}, ...],   // 0..5
    "n_replicates": 1|5|10|20,
    "seed": int (optional)
  }

response 200:
  {
    "mean_steady_state":  {node_name: float, ...},   // length 147
    "std_steady_state":   {node_name: float, ...},   // length 147
    "delta_vs_hyper":     {node_name: float, ...},   // mean - Hyper baseline mean
    "per_category_mean_abs_delta": {
        "ecm": float, "tf": float, "gf": float,
        "cytokines": float, "oxidative": float, "cell_fate": float
    },
    "n_replicates_used": int,
    "n_diverged": int,
    "elapsed_s": float,
    "seed_used": int,
    "cache_hit": bool
  }
```

`delta_vs_hyper` is included unconditionally, even when the request regime *is* Hyper (in which case mean values are ≈ 0). The cross-check is harmless and useful as a self-test.

### `POST /api/rescue/`

Same request shape as `/api/simulate/`; regime forced server-side to Hyper (any client-supplied regime is ignored). Response adds:

```
    "balance_score":      float,
    "distance_to_normal": float,
```

The Normal reference steady-state mean is computed once per worker on cold start and cached for the worker's lifetime.

### `POST /api/falsification/`

```
request:
  {
    "condition_id": str,         // matches one of the 45 paper conditions
    "n_replicates": 1|5|10        // default 5
  }

response 200:
  {
    "condition_id": str,
    "expected_polarity": "+" | "-" | "0",
    "observed_polarity": "+" | "-" | "0",
    "observed_delta":     {node: float},
    "observed_delta_std": {node: float},
    "match": bool,
    "elapsed_s": float
  }
```

### `GET /api/falsification/stream/`

Server-Sent Events. One event per condition as it completes:

```
data: {"condition_id": str, "match": bool,
       "expected_polarity": str, "observed_polarity": str,
       "elapsed_s": float}\n\n
```

Final event:

```
event: done
data: {"n_total": 45, "n_matched": int, "elapsed_s": float}
```

Server caps each condition to 5 replicates. Disconnect detection: if the client closes the EventSource, the server stops on the next condition boundary.

### `POST /api/transitions/`

```
request:
  {
    "start_regime": "Hypo"|"Normal"|"Hyper",
    "end_regime":   "Hypo"|"Normal"|"Hyper",
    "t_switch": float,
    "t_end":    float,
    "node_names": [str, ...],     // <= 10
    "n_replicates": 1|5|10
  }

response 200:
  {
    "t": [float, ...],
    "trajectories": {
      node_name: {"mean": [float, ...], "std": [float, ...]}
    },
    "n_replicates_used": int,
    "elapsed_s": float
  }
```

### Shared response behavior

- Validation errors → 400 with field-level errors (see Error handling).
- Compute divergence → 422.
- Timeout → 504.
- Every response includes `elapsed_s`; non-streaming responses include `cache_hit` and `seed_used`.

## Error handling

### Validation (HTTP 400)

- Unknown node name in `clamps[].node` → `{"errors": [{"field": "clamps[2].node", "error": "unknown node 'XYZ'"}]}`.
- Clamp count > 5, replicate count outside the allowed set, regime values outside [0, 1], unknown regime preset, unknown `condition_id` → same shape.

### Compute (HTTP 422)

- ODE solver returns non-finite values for **all** replicates → `{"error": "simulation diverged", "inputs_echo": {...}}`.
- Single-replicate divergences are tolerated and excluded from the mean. Response includes `n_replicates_used` (< requested) and `n_diverged`.
- The benign `RuntimeWarning: divide by zero / overflow / invalid value` from `np_mt_rnm/ode.py:67,69` is suppressed at the worker boundary.

### Timeout (HTTP 504)

- 30 s hard cap per non-streaming request → `{"error": "timeout", "suggestion": "reduce n_replicates or clamp count"}`.
- Falsification SSE has no overall cap, but each individual condition gets 30 s.

### Worker contention

With 3 gunicorn workers, a 4th simultaneous request queues at the gunicorn layer. No special handling.

### SSE disconnect

Server-side handler stops on the next iteration when the client closes the EventSource. No cleanup needed.

### Frontend behavior

- Generic banner pattern: red strip at top of the active tab, dismissible, shows server's `error` message verbatim plus the `suggestion`.
- Run buttons disable while a request is in flight; spinner + elapsed-time counter shown on every Run.
- No silent failures.

## Testing

### Reused as-is

`np_mt_rnm/tests/` already covers the simulation engine, rescue logic, and falsification (45 conditions). Not touched.

### New, in `np-mt-rnm-web/tests/`

- **`test_views.py`** — Django `RequestFactory` tests for every endpoint:
  - Happy path for each endpoint.
  - Every 400 / 422 / 504 path from "Error handling".
  - Cache hit/miss correctness.
  - Seed reproducibility (same inputs → identical numerics).
- **`test_clamp_validation.py`** — exhaustive: unknown nodes, duplicates, count caps, value bounds.
- **`test_sse_falsification.py`** — uses Django test client to consume SSE; asserts one event per condition + final `done`.
- **`test_variance_snapshot.py`** — three canonical scenarios (Hyper baseline, single SOX9↑ rescue, dual SOX9↑ + RhoA-E↓ rescue). For each: mean steady state within published bounds, std non-zero. Pinned seed list.

### Frontend

No automated tests in v1.

### Manual smoke checklist (run before each release)

- All 7 tabs load.
- Each Run button completes without freeze.
- Bar chart fits viewport without page-scrolling at default top-20.
- "Run all 45" Falsification streams to completion.
- Refresh mid-run cleanly cancels (no orphaned compute).

## What gets deleted

- `precomputed/baseline.json`, `rescue.json`, `falsification.json`, `transitions.json` (deleted from the repo, not just gitignored).
- View functions / URL routes that read those files.
- The "Published 35 perturbations" section of the current Rescue tab template.
- The hardcoded ECM-only top-10 ranking in `rescue.js` (replaced by the session-local ranking board).
- The "Run (~15–25 s)" custom-rescue button in the current Rescue template (replaced by the new multi-clamp builder + Run flow).
- The fixed-400 px-tall, 147-node bar chart in `simulate.js` (replaced by the variance-aware bar chart component).

## Open decisions deferred to implementation plan

- Hosting target (Render vs Fly.io vs UPF departmental server).
- Default `t_switch` / `t_end` for the Transitions tab.
- Whether the Overview tab keeps every paper figure or just a hero figure.
- Selection of the 5-node default preset for Transitions plotting.
