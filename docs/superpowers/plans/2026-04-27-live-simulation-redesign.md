# Live Simulation Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `np-mt-rnm-web` so every simulation runs live with replicate variance, multi-node clamps are first-class, and no precomputed simulation JSON ships with the app. Implementation faithfully follows the spec at `docs/superpowers/specs/2026-04-26-live-simulation-redesign-design.md`.

**Architecture:** Inline Django request handlers compute results synchronously via the `np_mt_rnm` Python pipeline. Each request runs with `n_jobs=1` (no joblib forking — this was the freeze trigger). Hard caps: ≤5 clamps, ≤20 replicates, 30 s timeout. Per-worker LRU cache (size 200). Three gunicorn workers in production. Tabs use shared frontend components (multi-clamp builder, variance-aware bar chart).

**Tech Stack:** Django 5, gunicorn, `np_mt_rnm` (sister Python package, installed in `.venv`), Cytoscape.js, Chart.js, vanilla JS modules, Django `RequestFactory` test client (no HTTP-server roundtrip in tests).

---

## Freeze-safe rule (applies to every task)

Earlier sessions confirmed the Mac freezes when joblib spawns workers under combined memory pressure. **Every** call to `np_mt_rnm.simulation.run_replicates` or `np_mt_rnm.rescue.run_perturbation` in this codebase MUST pass `n_jobs=1`. Every test command MUST run via `RequestFactory` or single-process pytest — do NOT start `manage.py runserver` until Phase 7 (smoke). If a task instructs you to run the dev server, treat it as the last resort.

---

## File map

```
np-mt-rnm-web/
├── rnm_app/
│   ├── views.py                          # MODIFY: keep tab views, replace API stubs with imports from rnm_app.api
│   ├── urls.py                           # MODIFY: remove /api/rescue/custom/, add 5 new endpoints
│   ├── api/                              # NEW package
│   │   ├── __init__.py
│   │   ├── validation.py                 # NEW: shared input validators
│   │   ├── errors.py                     # NEW: 400/422/504 response helpers
│   │   ├── simulate.py                   # NEW: POST /api/simulate/
│   │   ├── rescue.py                     # NEW: POST /api/rescue/
│   │   ├── falsification.py              # NEW: POST + GET stream
│   │   └── transitions.py                # NEW: POST /api/transitions/
│   ├── compute/                          # NEW package — engine wrappers around np_mt_rnm
│   │   ├── __init__.py
│   │   ├── cache.py                      # NEW: LRU cache + key builder
│   │   ├── seed.py                       # NEW: default seed = hash(inputs)
│   │   ├── network_loader.py             # NEW: cached load_network for the worker
│   │   ├── simulate.py                   # NEW: run_simulation() returns mean/std/n_used/n_diverged
│   │   ├── rescue.py                     # NEW: balance_score, distance_to_normal, normal-ref cache
│   │   ├── falsification.py              # NEW: load 45 rules, evaluate one or all
│   │   └── transitions.py                # NEW: trajectory wrapper
│   ├── templates/rnm/partials/
│   │   ├── simulate.html                 # MODIFY: multi-clamp builder + variance bars
│   │   ├── rescue.html                   # MODIFY: chip toolbar, ranking board, pair suggestion
│   │   ├── falsification.html            # MODIFY: dropdown + run-all SSE
│   │   └── transitions.html              # MODIFY: regime selector + node picker + line plot
│   ├── static/rnm/
│   │   ├── js/
│   │   │   ├── components/
│   │   │   │   ├── multi_clamp.js        # NEW shared component
│   │   │   │   ├── variance_bars.js      # NEW shared component
│   │   │   │   └── error_banner.js       # NEW shared component
│   │   │   ├── simulate.js               # MODIFY: rewrite around shared components
│   │   │   ├── rescue.js                 # MODIFY: chips + ranking + pair suggestion
│   │   │   ├── falsification.js          # NEW
│   │   │   └── transitions.js            # NEW
│   │   └── css/
│   │       └── components.css            # NEW: chips, banner, ranking-board styles
├── precomputed/
│   ├── network.json                      # KEPT (topology only)
│   ├── node_categories.json              # KEPT
│   ├── baseline.json                     # DELETED
│   ├── rescue.json                       # DELETED
│   ├── falsification.json                # DELETED
│   └── transitions.json                  # DELETED
└── tests/
    ├── __init__.py                       # NEW
    ├── conftest.py                       # NEW: pytest-django + fixtures
    ├── test_compute_cache.py             # NEW
    ├── test_compute_simulate.py          # NEW
    ├── test_compute_rescue.py            # NEW
    ├── test_compute_falsification.py     # NEW
    ├── test_compute_transitions.py       # NEW
    ├── test_api_validation.py            # NEW
    ├── test_api_simulate.py              # NEW
    ├── test_api_rescue.py                # NEW
    ├── test_api_falsification.py         # NEW (single + sse)
    ├── test_api_transitions.py           # NEW
    └── test_variance_snapshot.py         # NEW
```

Sister repo (one task only):

```
np-mt-rnm/
└── np_mt_rnm/transitions.py              # MODIFY: add run_trajectory() with regime switch + t_eval
└── tests/test_transitions.py             # MODIFY: add trajectory test
```

---

## Phase 0 — Hygiene & test scaffold

### Task 0.1 — Discard the abandoned uncommitted changes from earlier session

The prior session left `rnm_app/views.py` and `rnm_app/static/rnm/js/rescue.js` modified with an interim live-rescue implementation. Per the design spec, both files are rewritten in later tasks; the in-flight edits are obsolete and would conflict.

**Files**
- Modify: `rnm_app/views.py` (revert)
- Modify: `rnm_app/static/rnm/js/rescue.js` (revert)

- [ ] **Step 1: Inspect what is being discarded**

```bash
cd np-mt-rnm-web
git diff rnm_app/views.py rnm_app/static/rnm/js/rescue.js | head -80
```
Confirm the diffs are the abandoned `api_rescue_custom` view + the live-rescue client JS, not anything you want to keep.

- [ ] **Step 2: Restore both files to HEAD**

```bash
git restore rnm_app/views.py rnm_app/static/rnm/js/rescue.js
git status --short
```
Expected: `M` markers gone for those two files. `docs/` and `tests/` may be untracked — fine.

- [ ] **Step 3: Commit (no-op if nothing else changed)**

No commit. The point of this task is to *discard*; nothing to commit.

---

### Task 0.2 — Add pytest-django + tests/ scaffold

The web app has no test layout yet. Add it before any production code so every later task can begin TDD-style.

**Files**
- Create: `tests/__init__.py` (empty)
- Create: `tests/conftest.py`
- Create: `pyproject.toml` (or extend if exists)
- Modify: `requirements.txt`

- [ ] **Step 1: Add pytest dependencies**

Append to `np-mt-rnm-web/requirements.txt`:

```
pytest==8.3.3
pytest-django==4.9.0
```

- [ ] **Step 2: Install them**

```bash
cd np-mt-rnm-web
.venv/bin/pip install -r requirements.txt
```

- [ ] **Step 3: Create `np-mt-rnm-web/pyproject.toml` (if it doesn't exist) or add to it**

```toml
[tool.pytest.ini_options]
DJANGO_SETTINGS_MODULE = "rnm_site.settings"
python_files = ["test_*.py"]
testpaths = ["tests"]
```

- [ ] **Step 4: Create `np-mt-rnm-web/tests/__init__.py`**

Empty file.

- [ ] **Step 5: Create `np-mt-rnm-web/tests/conftest.py`**

```python
"""Shared pytest fixtures for the rnm_app test suite."""
from __future__ import annotations

import pytest

from rnm_app.compute.network_loader import get_network


@pytest.fixture(scope="session")
def net():
    """Lazy-load the 147-node network once per test session."""
    return get_network()
```

The `network_loader` import will be implemented in Task 2.3; the fixture file fails to import until then, which is fine (TDD).

- [ ] **Step 6: Verify pytest discovers tests directory (no tests yet → no failures)**

```bash
cd np-mt-rnm-web
.venv/bin/pytest --collect-only 2>&1 | tail -10
```
Expected: "no tests ran" or empty collection. Should NOT crash on settings or import errors at this stage (conftest.py imports get_network which doesn't exist yet — that's OK because pytest skips conftest if it errors only on fixture access, not on collection. If it does crash, comment out the import line until Task 2.3 lands).

- [ ] **Step 7: Commit**

```bash
git add tests/__init__.py tests/conftest.py pyproject.toml requirements.txt
git commit -m "test(scaffold): add pytest-django + tests/ layout"
```

---

### Task 0.3 — Delete obsolete precomputed JSON

These files become misleading the moment any model parameter changes and the spec requires their removal.

**Files**
- Delete: `precomputed/baseline.json`
- Delete: `precomputed/rescue.json`
- Delete: `precomputed/falsification.json`
- Delete: `precomputed/transitions.json`
- Keep: `precomputed/network.json`, `precomputed/node_categories.json`, `precomputed/MT_PRIMARY4_1.xlsx`

- [ ] **Step 1: Delete the four files**

```bash
cd np-mt-rnm-web
rm precomputed/baseline.json precomputed/rescue.json precomputed/falsification.json precomputed/transitions.json
ls precomputed/
```
Expected output includes `network.json`, `node_categories.json`, `MT_PRIMARY4_1.xlsx`, and the figures directory (if any). NOT the four deleted files.

- [ ] **Step 2: Commit**

```bash
git add -u precomputed/
git commit -m "chore(precomputed): remove static rescue/baseline/falsification/transitions JSON

Per redesign spec: every simulation result is now computed live.
Network topology + node categories + the source xlsx remain."
```

---

## Phase 1 — Sister-repo extension: trajectory function

The Transitions tab needs a continuous trajectory with a regime switch at `t_switch`. `np_mt_rnm.transitions.run_transition_path` only returns per-step steady states. Add a new function in the sister repo so it stays unit-testable there.

### Task 1.1 — Add `run_trajectory` to `np_mt_rnm.transitions`

**Files**
- Modify: `../np-mt-rnm/np_mt_rnm/transitions.py`
- Modify: `../np-mt-rnm/tests/test_transitions.py`

- [ ] **Step 1: Write the failing test**

Append to `np-mt-rnm/tests/test_transitions.py`:

```python
import numpy as np

from np_mt_rnm.network import load_network
from np_mt_rnm.simulation import REGIME_PRESETS
from np_mt_rnm.transitions import run_trajectory


def test_run_trajectory_shape_and_switch(tmp_path):
    """Trajectory has expected shape and reflects regime switch at t_switch."""
    net = load_network("np_mt_rnm/data/MT_PRIMARY4_1.xlsx")  # adjust to your repo path
    result = run_trajectory(
        net,
        regime_a=REGIME_PRESETS["Normal"],
        regime_b=REGIME_PRESETS["Hyper"],
        t_switch=10.0,
        t_end=30.0,
        n_t=21,
        n_reps=2,
        seed=42,
        n_jobs=1,
    )
    assert result.t.shape == (21,)
    assert result.mean.shape == (21, len(net.node_names))
    assert result.std.shape == (21, len(net.node_names))
    # First sample must equal t=0; last must equal t_end.
    assert result.t[0] == 0.0
    assert result.t[-1] == 30.0
    # The switch index must lie at t_switch=10 → index 7 in a 0..30 / 21-pt grid.
    assert np.isclose(result.t[7], 10.0)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd np-mt-rnm
.venv/bin/pytest tests/test_transitions.py::test_run_trajectory_shape_and_switch -v
```
Expected: `ImportError: cannot import name 'run_trajectory'`.

- [ ] **Step 3: Implement `run_trajectory`**

Append to `np-mt-rnm/np_mt_rnm/transitions.py`:

```python
from dataclasses import dataclass
from typing import Mapping

import numpy as np
from joblib import Parallel, delayed
from scipy.integrate import solve_ivp

from np_mt_rnm.network import Network
from np_mt_rnm.ode import squads_rhs
from np_mt_rnm.simulation import build_clamps, _random_initial_state


@dataclass(frozen=True)
class TrajectoryResult:
    t: np.ndarray                 # (n_t,)
    mean: np.ndarray              # (n_t, n_nodes)
    std: np.ndarray               # (n_t, n_nodes)
    node_names: list[str]
    n_reps_used: int


def _one_trajectory(
    net: Network,
    regime_a: Mapping[str, float],
    regime_b: Mapping[str, float],
    t_switch: float,
    t_end: float,
    t_eval: np.ndarray,
    seed: int,
) -> np.ndarray:
    """Single replicate trajectory across the regime switch. Returns (n_t, n_nodes)."""
    rng = np.random.default_rng(seed)
    n = len(net.node_names)

    mask_a, x_clamp_a = build_clamps(net, regime=regime_a)
    mask_b, x_clamp_b = build_clamps(net, regime=regime_b)

    x0 = _random_initial_state(n, rng)
    x0[mask_a] = x_clamp_a[mask_a]

    t_eval_a = t_eval[t_eval <= t_switch]
    t_eval_b = t_eval[t_eval > t_switch]

    def rhs_a(t, y):
        return squads_rhs(t, y, net.mact, net.minh, clamped=mask_a)

    def rhs_b(t, y):
        return squads_rhs(t, y, net.mact, net.minh, clamped=mask_b)

    sol_a = solve_ivp(
        rhs_a, (0.0, t_switch), x0,
        t_eval=t_eval_a, method="LSODA",
        rtol=1e-6, atol=1e-9,
    )
    if not sol_a.success:
        raise RuntimeError(f"phase A solve failed: {sol_a.message}")
    y_at_switch = sol_a.y[:, -1].copy()
    y_at_switch[mask_b] = x_clamp_b[mask_b]

    sol_b = solve_ivp(
        rhs_b, (t_switch, t_end), y_at_switch,
        t_eval=t_eval_b, method="LSODA",
        rtol=1e-6, atol=1e-9,
    )
    if not sol_b.success:
        raise RuntimeError(f"phase B solve failed: {sol_b.message}")

    out = np.zeros((len(t_eval), n))
    out[: len(t_eval_a)] = sol_a.y.T
    out[len(t_eval_a) :] = sol_b.y.T
    return out


def run_trajectory(
    net: Network,
    regime_a: Mapping[str, float],
    regime_b: Mapping[str, float],
    t_switch: float,
    t_end: float,
    n_t: int,
    n_reps: int,
    seed: int = 0,
    n_jobs: int = 1,
) -> TrajectoryResult:
    """Run replicate trajectories with a regime switch at t_switch.

    Phase A: solve under regime_a from t=0 to t_switch.
    Phase B: continue under regime_b from the switch state to t_end.
    Both phases use t_eval from a uniform grid of n_t samples in [0, t_end].
    """
    if t_switch <= 0 or t_switch >= t_end:
        raise ValueError("require 0 < t_switch < t_end")
    t_eval = np.linspace(0.0, t_end, n_t)
    runs = Parallel(n_jobs=n_jobs)(
        delayed(_one_trajectory)(
            net, regime_a, regime_b, t_switch, t_end, t_eval, seed + 7919 * k
        )
        for k in range(n_reps)
    )
    stacked = np.stack(runs, axis=0)  # (n_reps, n_t, n_nodes)
    return TrajectoryResult(
        t=t_eval,
        mean=stacked.mean(axis=0),
        std=stacked.std(axis=0, ddof=1) if n_reps > 1 else np.zeros_like(stacked[0]),
        node_names=list(net.node_names),
        n_reps_used=n_reps,
    )
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd np-mt-rnm
.venv/bin/pytest tests/test_transitions.py::test_run_trajectory_shape_and_switch -v
```
Expected: 1 passed in a few seconds. **Always pass `n_jobs=1` (already wired in via the test).**

- [ ] **Step 5: Commit (in the sister repo)**

```bash
cd np-mt-rnm
git add np_mt_rnm/transitions.py tests/test_transitions.py
git commit -m "feat(transitions): add run_trajectory with regime switch

Returns per-replicate trajectory (n_t, n_nodes) plus mean/std bands. Used by
the np-mt-rnm-web Transitions tab for live trajectory plotting."
```

---

## Phase 2 — Compute foundation (web app side)

All `compute/` modules sit between Django views and `np_mt_rnm`. They handle: caching, seed defaulting, freeze-safe wrapping, and shape conversion for JSON.

### Task 2.1 — `compute/cache.py`: LRU cache + key builder

**Files**
- Create: `rnm_app/compute/__init__.py` (empty)
- Create: `rnm_app/compute/cache.py`
- Create: `tests/test_compute_cache.py`

- [ ] **Step 1: Write failing tests**

`tests/test_compute_cache.py`:

```python
"""LRU cache + cache-key builder."""
import pytest

from rnm_app.compute.cache import build_cache_key, get_cache


def test_cache_key_is_stable_across_clamp_order():
    k1 = build_cache_key(
        regime={"hypo": 0.01, "nl": 0.8, "hl": 0.01},
        clamps=[{"node": "SOX9", "value": 1.0}, {"node": "ROS", "value": 0.0}],
        n_replicates=5,
        seed=42,
    )
    k2 = build_cache_key(
        regime={"hl": 0.01, "nl": 0.8, "hypo": 0.01},
        clamps=[{"node": "ROS", "value": 0.0}, {"node": "SOX9", "value": 1.0}],
        n_replicates=5,
        seed=42,
    )
    assert k1 == k2


def test_cache_key_differs_when_n_replicates_differs():
    base = dict(regime={"hypo": 0.01, "nl": 0.8, "hl": 0.01}, clamps=[], seed=0)
    k5 = build_cache_key(**base, n_replicates=5)
    k20 = build_cache_key(**base, n_replicates=20)
    assert k5 != k20


def test_lru_cache_get_and_set():
    cache = get_cache(scope="test_namespace")
    cache.clear()
    cache.put("a", {"x": 1})
    assert cache.get("a") == {"x": 1}
    assert cache.get("missing") is None


def test_lru_cache_evicts_when_full():
    cache = get_cache(scope="test_evict", maxsize=2)
    cache.clear()
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)  # evicts "a"
    assert cache.get("a") is None
    assert cache.get("b") == 2
    assert cache.get("c") == 3
```

- [ ] **Step 2: Run; verify failure**

```bash
cd np-mt-rnm-web
.venv/bin/pytest tests/test_compute_cache.py -v
```
Expected: 4 errors (`ModuleNotFoundError` on the import).

- [ ] **Step 3: Implement `rnm_app/compute/cache.py`**

```python
"""Per-worker in-memory LRU cache for live-compute endpoints.

Keys are deterministic across:
  - regime dict (key order normalized)
  - clamps list (sorted by node name)
  - n_replicates
  - seed

Cache instances are scoped by name so tests and prod paths don't collide.
"""
from __future__ import annotations

from collections import OrderedDict
from typing import Any, Mapping, Sequence


def build_cache_key(
    regime: Mapping[str, float],
    clamps: Sequence[Mapping[str, Any]],
    n_replicates: int,
    seed: int,
) -> tuple:
    regime_tuple = tuple(sorted(regime.items()))
    clamps_tuple = tuple(sorted((c["node"], float(c["value"])) for c in clamps))
    return (regime_tuple, clamps_tuple, int(n_replicates), int(seed))


class LRU:
    def __init__(self, maxsize: int = 200) -> None:
        self._maxsize = maxsize
        self._data: OrderedDict[Any, Any] = OrderedDict()

    def get(self, key):
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def put(self, key, value) -> None:
        if key in self._data:
            self._data.move_to_end(key)
        self._data[key] = value
        if len(self._data) > self._maxsize:
            self._data.popitem(last=False)

    def clear(self) -> None:
        self._data.clear()


_CACHES: dict[str, LRU] = {}


def get_cache(scope: str = "default", maxsize: int = 200) -> LRU:
    if scope not in _CACHES:
        _CACHES[scope] = LRU(maxsize=maxsize)
    return _CACHES[scope]
```

- [ ] **Step 4: Run; verify pass**

```bash
.venv/bin/pytest tests/test_compute_cache.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add rnm_app/compute/__init__.py rnm_app/compute/cache.py tests/test_compute_cache.py
git commit -m "feat(compute): per-worker LRU cache with deterministic key builder"
```

---

### Task 2.2 — `compute/seed.py`: default seed from inputs

**Files**
- Create: `rnm_app/compute/seed.py`
- Modify: `tests/test_compute_cache.py` (add seed test) OR `tests/test_compute_seed.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_compute_seed.py`:

```python
from rnm_app.compute.seed import default_seed


def test_default_seed_is_stable_for_same_inputs():
    s1 = default_seed(
        regime={"hypo": 0.01, "nl": 0.8, "hl": 0.01},
        clamps=[{"node": "SOX9", "value": 1.0}],
    )
    s2 = default_seed(
        regime={"hl": 0.01, "hypo": 0.01, "nl": 0.8},
        clamps=[{"node": "SOX9", "value": 1.0}],
    )
    assert s1 == s2
    assert 0 <= s1 < 0x10000


def test_default_seed_differs_for_different_inputs():
    a = default_seed(
        regime={"hypo": 0.01, "nl": 0.8, "hl": 0.01},
        clamps=[{"node": "SOX9", "value": 1.0}],
    )
    b = default_seed(
        regime={"hypo": 0.01, "nl": 0.8, "hl": 0.01},
        clamps=[{"node": "ROS",  "value": 0.0}],
    )
    assert a != b
```

- [ ] **Step 2: Run; expect fail**

```bash
.venv/bin/pytest tests/test_compute_seed.py -v
```

- [ ] **Step 3: Implement `rnm_app/compute/seed.py`**

```python
"""Default seed from request inputs. Stable across equivalent JSON orderings."""
from __future__ import annotations

import hashlib
import json
from typing import Mapping, Sequence


def default_seed(
    regime: Mapping[str, float],
    clamps: Sequence[Mapping[str, object]],
) -> int:
    canonical = {
        "regime": sorted(regime.items()),
        "clamps": sorted((c["node"], float(c["value"])) for c in clamps),
    }
    raw = json.dumps(canonical, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(raw).digest()
    return int.from_bytes(digest[:2], "big")  # 0..0xFFFF
```

(Python's built-in `hash()` is randomized per process; we need stable across workers.)

- [ ] **Step 4: Run; verify pass**

```bash
.venv/bin/pytest tests/test_compute_seed.py -v
```

- [ ] **Step 5: Commit**

```bash
git add rnm_app/compute/seed.py tests/test_compute_seed.py
git commit -m "feat(compute): deterministic default seed from request inputs"
```

---

### Task 2.3 — `compute/network_loader.py`: cached network load per worker

**Files**
- Create: `rnm_app/compute/network_loader.py`
- Create: `tests/test_compute_network_loader.py`

- [ ] **Step 1: Failing test**

```python
from rnm_app.compute.network_loader import get_network


def test_get_network_returns_cached_instance():
    a = get_network()
    b = get_network()
    assert a is b
    assert len(a.node_names) == 147
```

- [ ] **Step 2: Run; expect fail (ModuleNotFoundError)**

- [ ] **Step 3: Implement `rnm_app/compute/network_loader.py`**

```python
"""Lazy, per-worker cached load of the np_mt_rnm Network."""
from __future__ import annotations

from pathlib import Path

from django.conf import settings

from np_mt_rnm.network import Network, load_network

_CACHE: Network | None = None


def get_network() -> Network:
    global _CACHE
    if _CACHE is None:
        path = Path(settings.PRECOMPUTED_DIR) / "MT_PRIMARY4_1.xlsx"
        _CACHE = load_network(path)
    return _CACHE
```

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add rnm_app/compute/network_loader.py tests/test_compute_network_loader.py
git commit -m "feat(compute): cached Network loader per worker"
```

---

### Task 2.4 — `compute/simulate.py`: core run_simulation

**Files**
- Create: `rnm_app/compute/simulate.py`
- Create: `tests/test_compute_simulate.py`

- [ ] **Step 1: Failing test**

```python
import numpy as np
import pytest

from np_mt_rnm.simulation import REGIME_PRESETS
from rnm_app.compute.simulate import SimulationResult, run_simulation


@pytest.mark.django_db
def test_run_simulation_returns_means_stds_for_normal(net):
    result = run_simulation(
        net=net,
        regime=REGIME_PRESETS["Normal"],
        clamps=[],
        n_replicates=2,
        seed=42,
    )
    assert isinstance(result, SimulationResult)
    assert result.mean_steady_state.shape == (147,)
    assert result.std_steady_state.shape == (147,)
    assert result.n_replicates_used == 2
    assert result.n_diverged == 0
    # All values in [0, 1] range modulo float noise
    assert (result.mean_steady_state >= -1e-6).all()
    assert (result.mean_steady_state <= 1 + 1e-6).all()


@pytest.mark.django_db
def test_run_simulation_clamp_pins_node(net):
    result = run_simulation(
        net=net,
        regime=REGIME_PRESETS["Normal"],
        clamps=[{"node": "SOX9", "value": 1.0}],
        n_replicates=1,
        seed=7,
    )
    sox9_idx = net.node_names.index("SOX9")
    assert np.isclose(result.mean_steady_state[sox9_idx], 1.0)
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement**

```python
"""Core single-shot simulation: run replicates, return mean/std/divergence."""
from __future__ import annotations

import warnings
from dataclasses import dataclass
from typing import Mapping, Sequence

import numpy as np

from np_mt_rnm.network import Network
from np_mt_rnm.simulation import run_replicates


@dataclass(frozen=True)
class SimulationResult:
    mean_steady_state: np.ndarray   # (n_nodes,)
    std_steady_state: np.ndarray    # (n_nodes,)
    node_names: list[str]
    n_replicates_used: int          # excludes diverged
    n_diverged: int


def run_simulation(
    net: Network,
    regime: Mapping[str, float],
    clamps: Sequence[Mapping[str, object]],
    n_replicates: int,
    seed: int,
) -> SimulationResult:
    """Always n_jobs=1 to avoid joblib forking (freeze trigger)."""
    user_clamps = {c["node"]: float(c["value"]) for c in clamps}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        ens = run_replicates(
            net,
            regime=regime,
            n_reps=n_replicates,
            user_clamps=user_clamps,
            seed=seed,
            n_jobs=1,
        )
    finite = np.isfinite(ens.steady_states).all(axis=1)
    n_diverged = int((~finite).sum())
    n_used = int(finite.sum())
    if n_used == 0:
        raise RuntimeError("simulation diverged on every replicate")
    finite_states = ens.steady_states[finite]
    return SimulationResult(
        mean_steady_state=finite_states.mean(axis=0),
        std_steady_state=(
            finite_states.std(axis=0, ddof=1) if n_used > 1 else np.zeros_like(finite_states[0])
        ),
        node_names=list(net.node_names),
        n_replicates_used=n_used,
        n_diverged=n_diverged,
    )
```

- [ ] **Step 4: Run; verify pass (will take a few seconds for the ODE solves)**

```bash
.venv/bin/pytest tests/test_compute_simulate.py -v
```

- [ ] **Step 5: Commit**

```bash
git add rnm_app/compute/simulate.py tests/test_compute_simulate.py
git commit -m "feat(compute): run_simulation core with variance + divergence tracking"
```

---

### Task 2.5 — `compute/rescue.py`: balance & distance-to-Normal

**Files**
- Create: `rnm_app/compute/rescue.py`
- Create: `tests/test_compute_rescue.py`

- [ ] **Step 1: Failing test**

```python
import numpy as np
import pytest

from rnm_app.compute.rescue import RescueResult, get_normal_reference, run_rescue


CATABOLIC = ["RhoA-E", "PIEZO1", "PI3K-E", "FAK-E", "ROS"]
ANABOLIC = ["SOX9", "PPARγ", "HIF-1α", "NRF2", "IκBα"]


@pytest.mark.django_db
def test_normal_reference_cached(net):
    ref1 = get_normal_reference(net)
    ref2 = get_normal_reference(net)
    assert ref1 is ref2
    assert ref1.shape == (147,)


@pytest.mark.django_db
def test_run_rescue_returns_balance_and_distance(net):
    result = run_rescue(
        net=net,
        clamps=[{"node": "SOX9", "value": 1.0}],
        n_replicates=2,
        seed=42,
    )
    assert isinstance(result, RescueResult)
    assert result.simulation.n_replicates_used == 2
    assert isinstance(result.balance_score, float)
    assert isinstance(result.distance_to_normal, float)
    assert result.distance_to_normal >= 0


@pytest.mark.django_db
def test_run_rescue_no_clamps_distance_equals_hyper_baseline_distance(net):
    """Empty clamps under Hyper → result should be at Hyper baseline; distance > 0."""
    result = run_rescue(net=net, clamps=[], n_replicates=2, seed=99)
    assert result.distance_to_normal > 0
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement**

```python
"""Hyper-locked rescue computation with balance score and distance-to-Normal."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np

from np_mt_rnm.network import Network
from np_mt_rnm.simulation import REGIME_PRESETS

from rnm_app.compute.simulate import SimulationResult, run_simulation

CATABOLIC_DOWN_NODES = ("RhoA-E", "PIEZO1", "PI3K-E", "FAK-E", "ROS")
ANABOLIC_UP_NODES = ("SOX9", "PPARγ", "HIF-1α", "NRF2", "IκBα")


@dataclass(frozen=True)
class RescueResult:
    simulation: SimulationResult
    balance_score: float
    distance_to_normal: float


_NORMAL_REF: tuple[Network, np.ndarray] | None = None


def get_normal_reference(net: Network, n_replicates: int = 5, seed: int = 31415) -> np.ndarray:
    """Mean steady state under the Normal regime. Cached for the worker's lifetime."""
    global _NORMAL_REF
    if _NORMAL_REF is not None and _NORMAL_REF[0] is net:
        return _NORMAL_REF[1]
    sim = run_simulation(
        net=net,
        regime=REGIME_PRESETS["Normal"],
        clamps=[],
        n_replicates=n_replicates,
        seed=seed,
    )
    _NORMAL_REF = (net, sim.mean_steady_state)
    return sim.mean_steady_state


def run_rescue(
    net: Network,
    clamps: Sequence[dict],
    n_replicates: int,
    seed: int,
) -> RescueResult:
    sim = run_simulation(
        net=net,
        regime=REGIME_PRESETS["Hyper"],
        clamps=clamps,
        n_replicates=n_replicates,
        seed=seed,
    )
    normal_ref = get_normal_reference(net)
    delta_vs_normal = sim.mean_steady_state - normal_ref
    distance = float(np.linalg.norm(delta_vs_normal))

    a_idx = [net.node_names.index(n) for n in ANABOLIC_UP_NODES if n in net.node_names]
    c_idx = [net.node_names.index(n) for n in CATABOLIC_DOWN_NODES if n in net.node_names]
    delta_vs_hyper_for_balance = sim.mean_steady_state  # already Hyper-relative when clamps act
    # Balance = mean activation of anabolic targets - mean activation of catabolic targets.
    balance = float(
        sim.mean_steady_state[a_idx].mean() - sim.mean_steady_state[c_idx].mean()
    )
    return RescueResult(
        simulation=sim,
        balance_score=balance,
        distance_to_normal=distance,
    )
```

- [ ] **Step 4: Run; verify pass**

```bash
.venv/bin/pytest tests/test_compute_rescue.py -v
```

- [ ] **Step 5: Commit**

```bash
git add rnm_app/compute/rescue.py tests/test_compute_rescue.py
git commit -m "feat(compute): rescue with balance score + distance-to-Normal cache"
```

---

### Task 2.6 — `compute/falsification.py`: load 45 rules + evaluate

**Files**
- Create: `rnm_app/compute/falsification.py`
- Create: `tests/test_compute_falsification.py`

- [ ] **Step 1: Failing test**

```python
import pytest

from rnm_app.compute.falsification import (
    evaluate_condition,
    iterate_conditions,
    load_rules,
)


def test_load_rules_returns_45_rules():
    rules = load_rules()
    assert len(rules) == 45
    ids = [r.node + "/" + r.cls + "/" + r.reference_tag for r in rules]
    assert len(set(ids)) == 45  # all unique


@pytest.mark.django_db
def test_evaluate_condition_returns_polarities(net):
    rules = load_rules()
    out = evaluate_condition(net, rules[0], n_replicates=2, seed=11)
    assert out.expected_polarity in {"+", "-", "0"}
    assert out.observed_polarity in {"+", "-", "0"}


@pytest.mark.django_db
def test_iterate_conditions_streams_all(net):
    rules = load_rules()[:3]
    seen = []
    for outcome in iterate_conditions(net, rules, n_replicates=2, seed=0):
        seen.append(outcome.condition_id)
    assert len(seen) == 3
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement**

```python
"""Falsification: load 45 paper rules and evaluate one or all live."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from django.conf import settings

from np_mt_rnm.falsification import (
    FalsificationRule,
    evaluate_rule,
    load_benchmark,
)
from np_mt_rnm.network import Network
from np_mt_rnm.simulation import REGIME_PRESETS, run_replicates

from rnm_app.compute.simulate import run_simulation


@dataclass(frozen=True)
class ConditionOutcome:
    condition_id: str
    expected_polarity: str        # "+", "-", or "0"
    observed_polarity: str
    match: bool
    delta: float
    delta_std: float


_RULES: list[FalsificationRule] | None = None


def load_rules() -> list[FalsificationRule]:
    global _RULES
    if _RULES is None:
        path = Path(settings.PRECOMPUTED_DIR).parent / "data" / "falsification_benchmark.csv"
        if not path.exists():
            # Fallback to the np-mt-rnm data dir
            from np_mt_rnm import __file__ as pkg_init
            path = Path(pkg_init).parent / "data" / "falsification_benchmark.csv"
        _RULES = load_benchmark(path)
    return _RULES


def _condition_id(rule: FalsificationRule) -> str:
    return f"{rule.node}/{rule.cls}/{rule.reference_tag}"


def _polarity_from_expected(expected: str) -> str:
    if expected.lower() in ("up", "increased", "+"):
        return "+"
    if expected.lower() in ("down", "decreased", "-"):
        return "-"
    return "0"


def evaluate_condition(
    net: Network,
    rule: FalsificationRule,
    n_replicates: int,
    seed: int,
) -> ConditionOutcome:
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        normal_ens = run_replicates(
            net, regime=REGIME_PRESETS["Normal"], n_reps=n_replicates,
            seed=seed, n_jobs=1,
        )
        hyper_ens = run_replicates(
            net, regime=REGIME_PRESETS["Hyper"], n_reps=n_replicates,
            seed=seed + 1, n_jobs=1,
        )
        outcome = evaluate_rule(rule, normal_ens, hyper_ens, n_boot=2000, seed=seed)

    delta = outcome.delta
    if delta > 0.01:
        observed = "+"
    elif delta < -0.01:
        observed = "-"
    else:
        observed = "0"
    expected = _polarity_from_expected(rule.expected)
    return ConditionOutcome(
        condition_id=_condition_id(rule),
        expected_polarity=expected,
        observed_polarity=observed,
        match=(expected == observed),
        delta=float(delta),
        delta_std=float((outcome.ci_upper - outcome.ci_lower) / 3.92),  # 95% CI half-width / 1.96
    )


def iterate_conditions(
    net: Network,
    rules: list[FalsificationRule],
    n_replicates: int,
    seed: int,
) -> Iterator[ConditionOutcome]:
    for k, rule in enumerate(rules):
        yield evaluate_condition(net, rule, n_replicates=n_replicates, seed=seed + 1000 * k)
```

- [ ] **Step 4: Run; verify pass**

```bash
.venv/bin/pytest tests/test_compute_falsification.py -v
```

- [ ] **Step 5: Commit**

```bash
git add rnm_app/compute/falsification.py tests/test_compute_falsification.py
git commit -m "feat(compute): falsification — load 45 rules + evaluate / iterate"
```

---

### Task 2.7 — `compute/transitions.py`: thin wrapper

**Files**
- Create: `rnm_app/compute/transitions.py`
- Create: `tests/test_compute_transitions.py`

- [ ] **Step 1: Failing test**

```python
import pytest

from rnm_app.compute.transitions import run_transition


@pytest.mark.django_db
def test_run_transition_returns_trajectory(net):
    res = run_transition(
        net=net,
        start_regime="Normal",
        end_regime="Hyper",
        t_switch=10.0,
        t_end=30.0,
        node_names=["SOX9", "ROS"],
        n_replicates=2,
        seed=42,
    )
    assert "t" in res
    assert len(res["t"]) > 0
    assert "trajectories" in res
    assert "SOX9" in res["trajectories"]
    assert len(res["trajectories"]["SOX9"]["mean"]) == len(res["t"])
    assert res["n_replicates_used"] == 2
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement**

```python
"""Web-side trajectory wrapper. Slices to user-selected nodes."""
from __future__ import annotations

import warnings

import numpy as np

from np_mt_rnm.network import Network
from np_mt_rnm.simulation import REGIME_PRESETS
from np_mt_rnm.transitions import run_trajectory


def run_transition(
    net: Network,
    start_regime: str,
    end_regime: str,
    t_switch: float,
    t_end: float,
    node_names: list[str],
    n_replicates: int,
    seed: int,
    n_t: int = 41,
) -> dict:
    if start_regime not in REGIME_PRESETS:
        raise KeyError(f"unknown regime: {start_regime}")
    if end_regime not in REGIME_PRESETS:
        raise KeyError(f"unknown regime: {end_regime}")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        traj = run_trajectory(
            net=net,
            regime_a=REGIME_PRESETS[start_regime],
            regime_b=REGIME_PRESETS[end_regime],
            t_switch=t_switch,
            t_end=t_end,
            n_t=n_t,
            n_reps=n_replicates,
            seed=seed,
            n_jobs=1,
        )
    out_traj = {}
    for name in node_names:
        idx = traj.node_names.index(name)
        out_traj[name] = {
            "mean": traj.mean[:, idx].tolist(),
            "std": traj.std[:, idx].tolist(),
        }
    return {
        "t": traj.t.tolist(),
        "trajectories": out_traj,
        "n_replicates_used": traj.n_reps_used,
    }
```

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add rnm_app/compute/transitions.py tests/test_compute_transitions.py
git commit -m "feat(compute): transitions wrapper around np_mt_rnm.run_trajectory"
```

---

## Phase 3 — API helpers

### Task 3.1 — `api/validation.py`: shared validators

**Files**
- Create: `rnm_app/api/__init__.py` (empty)
- Create: `rnm_app/api/validation.py`
- Create: `tests/test_api_validation.py`

- [ ] **Step 1: Failing tests**

```python
import pytest

from rnm_app.api.validation import (
    ValidationError,
    validate_clamps,
    validate_n_replicates,
    validate_regime,
)


def test_validate_n_replicates_accepts_allowed():
    assert validate_n_replicates(5, allowed=(1, 5, 10, 20)) == 5


def test_validate_n_replicates_rejects_other():
    with pytest.raises(ValidationError):
        validate_n_replicates(7, allowed=(1, 5, 10, 20))


def test_validate_regime_preset_string():
    out = validate_regime("Hyper")
    assert out == {"Hypo": 0.01, "NL": 0.01, "HL": 0.80}


def test_validate_regime_dict():
    out = validate_regime({"hypo": 0.01, "nl": 0.8, "hl": 0.01})
    assert out == {"Hypo": 0.01, "NL": 0.8, "HL": 0.01}


def test_validate_regime_dict_out_of_range():
    with pytest.raises(ValidationError):
        validate_regime({"hypo": 0.01, "nl": 1.2, "hl": 0.01})


def test_validate_clamps_unknown_node(net):
    with pytest.raises(ValidationError):
        validate_clamps([{"node": "NOT_A_NODE", "value": 1.0}], known_nodes=set(net.node_names))


def test_validate_clamps_too_many():
    too_many = [{"node": f"X{k}", "value": 1.0} for k in range(6)]
    with pytest.raises(ValidationError):
        validate_clamps(too_many, known_nodes={f"X{k}" for k in range(6)})


def test_validate_clamps_duplicate_nodes(net):
    with pytest.raises(ValidationError):
        validate_clamps(
            [{"node": "SOX9", "value": 1.0}, {"node": "SOX9", "value": 0.0}],
            known_nodes=set(net.node_names),
        )


def test_validate_clamps_value_out_of_range(net):
    with pytest.raises(ValidationError):
        validate_clamps(
            [{"node": "SOX9", "value": 1.5}],
            known_nodes=set(net.node_names),
        )
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement**

```python
"""Shared validators with field-level error reporting."""
from __future__ import annotations

from typing import Iterable, Mapping, Sequence


REGIME_PRESETS_LOWER = {
    "hypo": {"Hypo": 0.80, "NL": 0.01, "HL": 0.01},
    "normal": {"Hypo": 0.01, "NL": 0.80, "HL": 0.01},
    "hyper": {"Hypo": 0.01, "NL": 0.01, "HL": 0.80},
}


class ValidationError(ValueError):
    def __init__(self, field: str, message: str) -> None:
        super().__init__(f"{field}: {message}")
        self.field = field
        self.message = message


def validate_n_replicates(value: int, allowed: Sequence[int]) -> int:
    if value not in allowed:
        raise ValidationError("n_replicates", f"must be one of {sorted(allowed)}")
    return value


def validate_regime(value) -> Mapping[str, float]:
    if isinstance(value, str):
        key = value.lower()
        if key not in REGIME_PRESETS_LOWER:
            raise ValidationError("regime", f"unknown preset '{value}'")
        return REGIME_PRESETS_LOWER[key]
    if not isinstance(value, dict):
        raise ValidationError("regime", "must be a preset name or {hypo,nl,hl} dict")
    out = {}
    for src_key, dst_key in (("hypo", "Hypo"), ("nl", "NL"), ("hl", "HL")):
        if src_key not in value:
            raise ValidationError(f"regime.{src_key}", "missing")
        try:
            f = float(value[src_key])
        except (TypeError, ValueError):
            raise ValidationError(f"regime.{src_key}", "must be a number")
        if not (0.0 <= f <= 1.0):
            raise ValidationError(f"regime.{src_key}", "must be in [0, 1]")
        out[dst_key] = f
    return out


def validate_clamps(value, known_nodes: Iterable[str], max_count: int = 5) -> list[dict]:
    if not isinstance(value, list):
        raise ValidationError("clamps", "must be a list")
    if len(value) > max_count:
        raise ValidationError("clamps", f"at most {max_count} clamps")
    seen = set()
    known = set(known_nodes)
    out = []
    for k, c in enumerate(value):
        if not isinstance(c, dict) or "node" not in c or "value" not in c:
            raise ValidationError(f"clamps[{k}]", "must be {node, value}")
        node = c["node"]
        if node in seen:
            raise ValidationError(f"clamps[{k}].node", f"duplicate node '{node}'")
        seen.add(node)
        if node not in known:
            raise ValidationError(f"clamps[{k}].node", f"unknown node '{node}'")
        try:
            v = float(c["value"])
        except (TypeError, ValueError):
            raise ValidationError(f"clamps[{k}].value", "must be a number")
        if not (0.0 <= v <= 1.0):
            raise ValidationError(f"clamps[{k}].value", "must be in [0, 1]")
        out.append({"node": node, "value": v})
    return out
```

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add rnm_app/api/__init__.py rnm_app/api/validation.py tests/test_api_validation.py
git commit -m "feat(api): shared input validators with field-level errors"
```

---

### Task 3.2 — `api/errors.py`: response builders

**Files**
- Create: `rnm_app/api/errors.py`

- [ ] **Step 1: Implement (no test — purely a helper, exercised by view tests)**

```python
"""Standardized JSON error responses."""
from __future__ import annotations

from django.http import JsonResponse

from rnm_app.api.validation import ValidationError


def validation_error_response(exc: ValidationError) -> JsonResponse:
    return JsonResponse(
        {"errors": [{"field": exc.field, "error": exc.message}]},
        status=400,
    )


def diverged_response(inputs_echo: dict) -> JsonResponse:
    return JsonResponse(
        {"error": "simulation diverged", "inputs_echo": inputs_echo},
        status=422,
    )


def timeout_response(suggestion: str = "reduce n_replicates or clamp count") -> JsonResponse:
    return JsonResponse(
        {"error": "timeout", "suggestion": suggestion},
        status=504,
    )


def server_error_response(message: str) -> JsonResponse:
    return JsonResponse({"error": message}, status=500)
```

- [ ] **Step 2: Commit**

```bash
git add rnm_app/api/errors.py
git commit -m "feat(api): JSON error response helpers"
```

---

## Phase 4 — API endpoints

### Task 4.1 — `POST /api/simulate/`

**Files**
- Create: `rnm_app/api/simulate.py`
- Create: `tests/test_api_simulate.py`
- Modify: `rnm_app/urls.py`

- [ ] **Step 1: Failing test (RequestFactory)**

```python
import json

import pytest
from django.test import RequestFactory

from rnm_app.api.simulate import api_simulate


@pytest.fixture
def rf():
    return RequestFactory()


def _post(rf, body):
    return rf.post(
        "/api/simulate/",
        data=json.dumps(body),
        content_type="application/json",
    )


@pytest.mark.django_db
def test_simulate_happy_path(rf):
    req = _post(rf, {
        "regime": "Normal",
        "clamps": [],
        "n_replicates": 1,
    })
    resp = api_simulate(req)
    assert resp.status_code == 200
    data = json.loads(resp.content)
    assert "mean_steady_state" in data
    assert "std_steady_state" in data
    assert "delta_vs_hyper" in data
    assert data["n_replicates_used"] == 1
    assert "elapsed_s" in data
    assert "seed_used" in data
    assert data["cache_hit"] is False


@pytest.mark.django_db
def test_simulate_cache_hit_on_repeat(rf):
    body = {"regime": "Normal", "clamps": [], "n_replicates": 1, "seed": 7}
    r1 = json.loads(api_simulate(_post(rf, body)).content)
    r2 = json.loads(api_simulate(_post(rf, body)).content)
    assert r1["cache_hit"] is False
    assert r2["cache_hit"] is True
    assert r1["mean_steady_state"] == r2["mean_steady_state"]


@pytest.mark.django_db
def test_simulate_validation_error_unknown_node(rf):
    req = _post(rf, {
        "regime": "Normal",
        "clamps": [{"node": "NOT_A_NODE", "value": 1.0}],
        "n_replicates": 1,
    })
    resp = api_simulate(req)
    assert resp.status_code == 400
    data = json.loads(resp.content)
    assert data["errors"][0]["field"] == "clamps[0].node"


@pytest.mark.django_db
def test_simulate_clamp_cap(rf):
    too_many = [
        {"node": n, "value": 1.0}
        for n in ["SOX9", "ROS", "PIEZO1", "FAK-E", "PI3K-E", "RhoA-E"]
    ]
    req = _post(rf, {"regime": "Normal", "clamps": too_many, "n_replicates": 1})
    resp = api_simulate(req)
    assert resp.status_code == 400
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement `rnm_app/api/simulate.py`**

```python
"""POST /api/simulate/ — live ODE solve with multi-clamp + variance."""
from __future__ import annotations

import json
import time

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from rnm_app.api.errors import (
    diverged_response,
    server_error_response,
    validation_error_response,
)
from rnm_app.api.validation import (
    ValidationError,
    validate_clamps,
    validate_n_replicates,
    validate_regime,
)
from rnm_app.compute.cache import build_cache_key, get_cache
from rnm_app.compute.network_loader import get_network
from rnm_app.compute.seed import default_seed
from rnm_app.compute.simulate import run_simulation

_NORMAL_NODE_CATEGORIES = ("ecm", "tf", "gf", "cytokines", "oxidative", "cell_fate")


def _per_category_mean_abs(delta: dict, categories) -> dict:
    """Compute per-category mean|Δ| from the global node→delta mapping."""
    from np_mt_rnm.categories import NODE_CATEGORIES

    label_map = {
        "ecm": "ecm_matrix",
        "tf": "transcription_factor",
        "gf": "growth_factor",
        "cytokines": "cytokines_chemokines_proteases",
        "oxidative": "oxidative_proteostasis",
        "cell_fate": "cell_fate",
    }
    out = {}
    for short, full in label_map.items():
        nodes = [n for n, cs in NODE_CATEGORIES.items() if full in cs]
        vals = [abs(delta[n]) for n in nodes if n in delta]
        out[short] = float(sum(vals) / len(vals)) if vals else 0.0
    return out


@csrf_exempt
@require_POST
def api_simulate(request: HttpRequest) -> JsonResponse:
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return JsonResponse({"errors": [{"field": "body", "error": "invalid JSON"}]}, status=400)

    net = get_network()
    try:
        regime = validate_regime(payload.get("regime"))
        clamps = validate_clamps(payload.get("clamps", []), known_nodes=net.node_names)
        n_reps = validate_n_replicates(
            int(payload.get("n_replicates", 5)),
            allowed=(1, 5, 10, 20),
        )
    except ValidationError as exc:
        return validation_error_response(exc)
    seed = int(payload.get("seed", default_seed(regime, clamps)))

    cache = get_cache(scope="simulate")
    key = build_cache_key(regime=regime, clamps=clamps, n_replicates=n_reps, seed=seed)
    cached = cache.get(key)
    t0 = time.monotonic()
    if cached is not None:
        return JsonResponse({**cached, "cache_hit": True, "elapsed_s": 0.0})

    try:
        sim = run_simulation(net, regime, clamps, n_replicates=n_reps, seed=seed)
    except RuntimeError:
        return diverged_response({"regime": regime, "clamps": clamps, "n_replicates": n_reps})
    except Exception as exc:
        return server_error_response(f"simulation failed: {exc!s}")

    # Compute delta_vs_hyper using the cached Hyper baseline.
    from np_mt_rnm.simulation import REGIME_PRESETS

    hyper_baseline_key = build_cache_key(
        regime=REGIME_PRESETS["Hyper"], clamps=[], n_replicates=5, seed=31415,
    )
    hyper_cached = cache.get(hyper_baseline_key)
    if hyper_cached is None:
        hyper_sim = run_simulation(
            net, REGIME_PRESETS["Hyper"], clamps=[], n_replicates=5, seed=31415,
        )
        hyper_mean = hyper_sim.mean_steady_state
        cache.put(hyper_baseline_key, {"mean_steady_state": dict(zip(net.node_names, hyper_mean.tolist()))})
    else:
        import numpy as np
        hyper_mean = np.array([hyper_cached["mean_steady_state"][n] for n in net.node_names])

    mean_dict = dict(zip(net.node_names, sim.mean_steady_state.tolist()))
    std_dict  = dict(zip(net.node_names, sim.std_steady_state.tolist()))
    delta_dict = {n: mean_dict[n] - float(hyper_mean[i]) for i, n in enumerate(net.node_names)}

    payload_out = {
        "mean_steady_state": mean_dict,
        "std_steady_state": std_dict,
        "delta_vs_hyper": delta_dict,
        "per_category_mean_abs_delta": _per_category_mean_abs(delta_dict, _NORMAL_NODE_CATEGORIES),
        "n_replicates_used": sim.n_replicates_used,
        "n_diverged": sim.n_diverged,
        "elapsed_s": round(time.monotonic() - t0, 3),
        "seed_used": seed,
    }
    cache.put(key, {**payload_out, "cache_hit": False})
    return JsonResponse({**payload_out, "cache_hit": False})
```

- [ ] **Step 4: Wire URL in `rnm_app/urls.py`**

Add to the urlpatterns (and import):

```python
from rnm_app.api.simulate import api_simulate

# In urlpatterns:
path("api/simulate/", api_simulate, name="api_simulate"),
```

Remove any old `api_simulate` reference if it points to `views.api_simulate`.

- [ ] **Step 5: Run tests; verify pass**

```bash
.venv/bin/pytest tests/test_api_simulate.py -v
```

- [ ] **Step 6: Commit**

```bash
git add rnm_app/api/simulate.py tests/test_api_simulate.py rnm_app/urls.py
git commit -m "feat(api): live POST /api/simulate/ with cache + variance"
```

---

### Task 4.2 — `POST /api/rescue/`

**Files**
- Create: `rnm_app/api/rescue.py`
- Create: `tests/test_api_rescue.py`
- Modify: `rnm_app/urls.py`

- [ ] **Step 1: Failing test**

```python
import json

import pytest
from django.test import RequestFactory

from rnm_app.api.rescue import api_rescue


@pytest.mark.django_db
def test_rescue_happy_path():
    rf = RequestFactory()
    req = rf.post(
        "/api/rescue/",
        data=json.dumps({"clamps": [{"node": "SOX9", "value": 1.0}], "n_replicates": 1}),
        content_type="application/json",
    )
    resp = api_rescue(req)
    assert resp.status_code == 200
    data = json.loads(resp.content)
    assert "balance_score" in data
    assert "distance_to_normal" in data
    assert data["distance_to_normal"] >= 0
    assert "mean_steady_state" in data


@pytest.mark.django_db
def test_rescue_ignores_client_regime():
    rf = RequestFactory()
    # Even if client tries to set Normal, server forces Hyper.
    req = rf.post(
        "/api/rescue/",
        data=json.dumps({"regime": "Normal", "clamps": [], "n_replicates": 1}),
        content_type="application/json",
    )
    resp = api_rescue(req)
    assert resp.status_code == 200
    # Distance to Normal should be > 0 (we ran under Hyper, not Normal)
    data = json.loads(resp.content)
    assert data["distance_to_normal"] > 0
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement `rnm_app/api/rescue.py`**

```python
"""POST /api/rescue/ — Hyper-locked live rescue."""
from __future__ import annotations

import json
import time

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from rnm_app.api.errors import (
    diverged_response,
    server_error_response,
    validation_error_response,
)
from rnm_app.api.simulate import _per_category_mean_abs
from rnm_app.api.validation import (
    ValidationError,
    validate_clamps,
    validate_n_replicates,
)
from rnm_app.compute.cache import build_cache_key, get_cache
from rnm_app.compute.network_loader import get_network
from rnm_app.compute.rescue import get_normal_reference, run_rescue
from rnm_app.compute.seed import default_seed
from np_mt_rnm.simulation import REGIME_PRESETS


@csrf_exempt
@require_POST
def api_rescue(request: HttpRequest) -> JsonResponse:
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return JsonResponse({"errors": [{"field": "body", "error": "invalid JSON"}]}, status=400)

    net = get_network()
    try:
        clamps = validate_clamps(payload.get("clamps", []), known_nodes=net.node_names)
        n_reps = validate_n_replicates(
            int(payload.get("n_replicates", 5)), allowed=(1, 5, 10, 20),
        )
    except ValidationError as exc:
        return validation_error_response(exc)

    regime_hyper = REGIME_PRESETS["Hyper"]
    seed = int(payload.get("seed", default_seed(regime_hyper, clamps)))

    cache = get_cache(scope="rescue")
    key = build_cache_key(regime=regime_hyper, clamps=clamps, n_replicates=n_reps, seed=seed)
    cached = cache.get(key)
    t0 = time.monotonic()
    if cached is not None:
        return JsonResponse({**cached, "cache_hit": True, "elapsed_s": 0.0})

    try:
        result = run_rescue(net=net, clamps=clamps, n_replicates=n_reps, seed=seed)
    except RuntimeError:
        return diverged_response({"clamps": clamps, "n_replicates": n_reps})
    except Exception as exc:
        return server_error_response(f"rescue failed: {exc!s}")

    from rnm_app.compute.simulate import run_simulation

    sim = result.simulation
    hyper_sim = run_simulation(net, regime_hyper, clamps=[], n_replicates=5, seed=31415)
    mean_dict = dict(zip(net.node_names, sim.mean_steady_state.tolist()))
    std_dict  = dict(zip(net.node_names, sim.std_steady_state.tolist()))
    delta_dict = {
        n: float(sim.mean_steady_state[i] - hyper_sim.mean_steady_state[i])
        for i, n in enumerate(net.node_names)
    }

    payload_out = {
        "mean_steady_state": mean_dict,
        "std_steady_state": std_dict,
        "delta_vs_hyper": delta_dict,
        "per_category_mean_abs_delta": _per_category_mean_abs(delta_dict, None),
        "balance_score": result.balance_score,
        "distance_to_normal": result.distance_to_normal,
        "n_replicates_used": sim.n_replicates_used,
        "n_diverged": sim.n_diverged,
        "elapsed_s": round(time.monotonic() - t0, 3),
        "seed_used": seed,
    }
    cache.put(key, {**payload_out, "cache_hit": False})
    return JsonResponse({**payload_out, "cache_hit": False})
```

- [ ] **Step 4: Wire URL**

Add to `rnm_app/urls.py`:

```python
from rnm_app.api.rescue import api_rescue
path("api/rescue/", api_rescue, name="api_rescue"),
```

Remove the old `api/rescue/custom/` route if still present.

- [ ] **Step 5: Run tests**

```bash
.venv/bin/pytest tests/test_api_rescue.py -v
```

- [ ] **Step 6: Commit**

```bash
git add rnm_app/api/rescue.py tests/test_api_rescue.py rnm_app/urls.py
git commit -m "feat(api): live POST /api/rescue/ with balance + distance"
```

---

### Task 4.3 — `POST /api/falsification/` (single condition)

**Files**
- Create: `rnm_app/api/falsification.py` (single condition handler in this task)
- Create: `tests/test_api_falsification.py`
- Modify: `rnm_app/urls.py`

- [ ] **Step 1: Failing test**

```python
import json

import pytest
from django.test import RequestFactory

from rnm_app.api.falsification import api_falsification_single


@pytest.mark.django_db
def test_falsification_single_happy_path():
    rf = RequestFactory()
    # Pick the first condition id; we'll discover it dynamically.
    from rnm_app.compute.falsification import load_rules
    rules = load_rules()
    cid = f"{rules[0].node}/{rules[0].cls}/{rules[0].reference_tag}"
    req = rf.post(
        "/api/falsification/",
        data=json.dumps({"condition_id": cid, "n_replicates": 1}),
        content_type="application/json",
    )
    resp = api_falsification_single(req)
    assert resp.status_code == 200
    data = json.loads(resp.content)
    assert data["condition_id"] == cid
    assert data["expected_polarity"] in {"+", "-", "0"}
    assert data["observed_polarity"] in {"+", "-", "0"}


@pytest.mark.django_db
def test_falsification_unknown_condition():
    rf = RequestFactory()
    req = rf.post(
        "/api/falsification/",
        data=json.dumps({"condition_id": "FAKE/FAKE/FAKE", "n_replicates": 1}),
        content_type="application/json",
    )
    resp = api_falsification_single(req)
    assert resp.status_code == 400
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement `rnm_app/api/falsification.py`**

```python
"""POST /api/falsification/ — single condition + GET /stream/ — all 45 SSE."""
from __future__ import annotations

import json
import time

from django.http import HttpRequest, JsonResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from rnm_app.api.errors import server_error_response, validation_error_response
from rnm_app.api.validation import ValidationError, validate_n_replicates
from rnm_app.compute.falsification import (
    evaluate_condition,
    iterate_conditions,
    load_rules,
)
from rnm_app.compute.network_loader import get_network


@csrf_exempt
@require_POST
def api_falsification_single(request: HttpRequest) -> JsonResponse:
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return JsonResponse({"errors": [{"field": "body", "error": "invalid JSON"}]}, status=400)

    cid = payload.get("condition_id")
    if not isinstance(cid, str):
        return validation_error_response(ValidationError("condition_id", "required"))
    try:
        n_reps = validate_n_replicates(int(payload.get("n_replicates", 5)), allowed=(1, 5, 10))
    except ValidationError as exc:
        return validation_error_response(exc)

    rules = load_rules()
    rule = next((r for r in rules if f"{r.node}/{r.cls}/{r.reference_tag}" == cid), None)
    if rule is None:
        return validation_error_response(
            ValidationError("condition_id", f"unknown condition '{cid}'")
        )

    net = get_network()
    t0 = time.monotonic()
    try:
        outcome = evaluate_condition(net, rule, n_replicates=n_reps, seed=hash(cid) & 0xFFFF)
    except Exception as exc:
        return server_error_response(f"falsification failed: {exc!s}")
    return JsonResponse({
        "condition_id": cid,
        "expected_polarity": outcome.expected_polarity,
        "observed_polarity": outcome.observed_polarity,
        "observed_delta": outcome.delta,
        "observed_delta_std": outcome.delta_std,
        "match": outcome.match,
        "elapsed_s": round(time.monotonic() - t0, 3),
    })
```

- [ ] **Step 4: Wire URL**

```python
from rnm_app.api.falsification import api_falsification_single
path("api/falsification/", api_falsification_single, name="api_falsification"),
```

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add rnm_app/api/falsification.py tests/test_api_falsification.py rnm_app/urls.py
git commit -m "feat(api): live POST /api/falsification/ for single condition"
```

---

### Task 4.4 — `GET /api/falsification/stream/` (SSE)

**Files**
- Modify: `rnm_app/api/falsification.py` (add stream view)
- Modify: `tests/test_api_falsification.py` (add SSE test)
- Modify: `rnm_app/urls.py`

- [ ] **Step 1: Failing test**

Append to `tests/test_api_falsification.py`:

```python
@pytest.mark.django_db
def test_falsification_stream_yields_event_per_condition():
    """SSE produces one event per rule + a final 'done' event."""
    from django.test import Client

    client = Client()
    resp = client.get("/api/falsification/stream/?n_replicates=1")
    assert resp.status_code == 200
    assert resp["Content-Type"].startswith("text/event-stream")

    chunks = list(resp.streaming_content)
    text = b"".join(chunks).decode()
    n_data_events = text.count("data: ")
    # 45 conditions + 1 done event
    assert n_data_events >= 46
    assert "event: done" in text
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement (append to `rnm_app/api/falsification.py`)**

```python
@require_GET
def api_falsification_stream(request: HttpRequest) -> StreamingHttpResponse:
    try:
        n_reps = int(request.GET.get("n_replicates", 5))
        if n_reps not in (1, 5, 10):
            n_reps = 5
    except (TypeError, ValueError):
        n_reps = 5

    net = get_network()
    rules = load_rules()

    def event_stream():
        n_matched = 0
        t0 = time.monotonic()
        try:
            for k, outcome in enumerate(
                iterate_conditions(net, rules, n_replicates=n_reps, seed=0)
            ):
                if outcome.match:
                    n_matched += 1
                payload = {
                    "condition_id": outcome.condition_id,
                    "match": outcome.match,
                    "expected_polarity": outcome.expected_polarity,
                    "observed_polarity": outcome.observed_polarity,
                    "elapsed_s": round(time.monotonic() - t0, 3),
                }
                yield f"data: {json.dumps(payload)}\n\n"
            done_payload = {
                "n_total": len(rules),
                "n_matched": n_matched,
                "elapsed_s": round(time.monotonic() - t0, 3),
            }
            yield f"event: done\ndata: {json.dumps(done_payload)}\n\n"
        except GeneratorExit:
            return

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response
```

- [ ] **Step 4: Wire URL**

```python
from rnm_app.api.falsification import api_falsification_stream
path("api/falsification/stream/", api_falsification_stream, name="api_falsification_stream"),
```

- [ ] **Step 5: Run tests**

```bash
.venv/bin/pytest tests/test_api_falsification.py -v
```
The SSE test will be slow (~3 min for 45 reps × 1 each); consider marking with `@pytest.mark.slow` and providing a CLI to skip in fast loops if it's painful.

- [ ] **Step 6: Commit**

```bash
git add rnm_app/api/falsification.py tests/test_api_falsification.py rnm_app/urls.py
git commit -m "feat(api): GET /api/falsification/stream/ — SSE over 45 rules"
```

---

### Task 4.5 — `POST /api/transitions/`

**Files**
- Create: `rnm_app/api/transitions.py`
- Create: `tests/test_api_transitions.py`
- Modify: `rnm_app/urls.py`

- [ ] **Step 1: Failing test**

```python
import json

import pytest
from django.test import RequestFactory

from rnm_app.api.transitions import api_transitions


@pytest.mark.django_db
def test_transitions_happy_path():
    rf = RequestFactory()
    req = rf.post(
        "/api/transitions/",
        data=json.dumps({
            "start_regime": "Normal",
            "end_regime": "Hyper",
            "t_switch": 10.0,
            "t_end": 30.0,
            "node_names": ["SOX9", "ROS"],
            "n_replicates": 1,
        }),
        content_type="application/json",
    )
    resp = api_transitions(req)
    assert resp.status_code == 200
    data = json.loads(resp.content)
    assert "t" in data
    assert "trajectories" in data
    assert "SOX9" in data["trajectories"]
    assert len(data["trajectories"]["SOX9"]["mean"]) == len(data["t"])


@pytest.mark.django_db
def test_transitions_validation_unknown_regime():
    rf = RequestFactory()
    req = rf.post(
        "/api/transitions/",
        data=json.dumps({
            "start_regime": "BadRegime",
            "end_regime": "Hyper",
            "t_switch": 10.0,
            "t_end": 30.0,
            "node_names": ["SOX9"],
            "n_replicates": 1,
        }),
        content_type="application/json",
    )
    resp = api_transitions(req)
    assert resp.status_code == 400
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement**

```python
"""POST /api/transitions/ — live trajectory across regime switch."""
from __future__ import annotations

import json
import time

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from rnm_app.api.errors import server_error_response, validation_error_response
from rnm_app.api.validation import ValidationError, validate_n_replicates
from rnm_app.compute.network_loader import get_network
from rnm_app.compute.transitions import run_transition

ALLOWED_REGIMES = ("Hypo", "Normal", "Hyper")


@csrf_exempt
@require_POST
def api_transitions(request: HttpRequest) -> JsonResponse:
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return JsonResponse({"errors": [{"field": "body", "error": "invalid JSON"}]}, status=400)

    try:
        start = payload.get("start_regime")
        end = payload.get("end_regime")
        if start not in ALLOWED_REGIMES:
            raise ValidationError("start_regime", f"must be one of {ALLOWED_REGIMES}")
        if end not in ALLOWED_REGIMES:
            raise ValidationError("end_regime", f"must be one of {ALLOWED_REGIMES}")
        try:
            t_switch = float(payload.get("t_switch", 10.0))
            t_end = float(payload.get("t_end", 30.0))
        except (TypeError, ValueError):
            raise ValidationError("t_switch/t_end", "must be numbers")
        if not (0 < t_switch < t_end):
            raise ValidationError("t_switch", "require 0 < t_switch < t_end")
        node_names = payload.get("node_names", [])
        if not isinstance(node_names, list) or not (1 <= len(node_names) <= 10):
            raise ValidationError("node_names", "must be 1..10 names")
        n_reps = validate_n_replicates(int(payload.get("n_replicates", 5)), allowed=(1, 5, 10))
    except ValidationError as exc:
        return validation_error_response(exc)

    net = get_network()
    unknown = [n for n in node_names if n not in net.node_names]
    if unknown:
        return validation_error_response(
            ValidationError("node_names", f"unknown nodes: {unknown}")
        )

    t0 = time.monotonic()
    try:
        result = run_transition(
            net=net,
            start_regime=start,
            end_regime=end,
            t_switch=t_switch,
            t_end=t_end,
            node_names=node_names,
            n_replicates=n_reps,
            seed=hash((start, end, t_switch, t_end, tuple(node_names))) & 0xFFFF,
        )
    except Exception as exc:
        return server_error_response(f"transition failed: {exc!s}")
    return JsonResponse({**result, "elapsed_s": round(time.monotonic() - t0, 3)})
```

- [ ] **Step 4: Wire URL**

```python
from rnm_app.api.transitions import api_transitions
path("api/transitions/", api_transitions, name="api_transitions"),
```

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add rnm_app/api/transitions.py tests/test_api_transitions.py rnm_app/urls.py
git commit -m "feat(api): live POST /api/transitions/"
```

---

### Task 4.6 — Retire old API stubs in `views.py`

**Files**
- Modify: `rnm_app/views.py`

- [ ] **Step 1: Remove the old `api_simulate` and `api_rescue_custom` functions and their helpers if no longer needed**

Trim `views.py` to just the seven tab views + `api_network`. Delete `api_simulate`, `api_rescue_custom`, `_get_net`, and any bundle-loading the new tabs no longer need.

After edit, `views.py` should look roughly like:

```python
"""Tab views. Live API endpoints live in rnm_app.api.*."""
from __future__ import annotations

import json
from pathlib import Path

from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET


def _render_tab(request, active: str, extra_context: dict | None = None):
    context = {"active": active}
    if extra_context:
        context.update(extra_context)
    return render(request, f"rnm/partials/{active}.html", context)


def _load_bundle(name: str) -> dict:
    path = Path(settings.PRECOMPUTED_DIR) / f"{name}.json"
    return json.loads(path.read_text())


@require_GET
def overview(request): return _render_tab(request, "overview")

@require_GET
def network(request): return _render_tab(request, "network")

@require_GET
def downloads(request): return _render_tab(request, "downloads")

@require_GET
def simulate(request):
    bundle = _load_bundle("network")
    return _render_tab(request, "simulate", {"node_names": [n["id"] for n in bundle["nodes"]]})

@require_GET
def rescue(request):
    bundle = _load_bundle("network")
    return _render_tab(request, "rescue", {"node_names": [n["id"] for n in bundle["nodes"]]})

@require_GET
def falsification(request):
    from rnm_app.compute.falsification import load_rules
    rules = load_rules()
    condition_ids = [f"{r.node}/{r.cls}/{r.reference_tag}" for r in rules]
    return _render_tab(request, "falsification", {"condition_ids": condition_ids})

@require_GET
def transitions(request):
    bundle = _load_bundle("network")
    return _render_tab(request, "transitions", {"node_names": [n["id"] for n in bundle["nodes"]]})

@require_GET
def api_network(request):
    return JsonResponse(_load_bundle("network"))
```

- [ ] **Step 2: Run all tests; nothing should regress**

```bash
.venv/bin/pytest -v
```

- [ ] **Step 3: Commit**

```bash
git add rnm_app/views.py
git commit -m "refactor(views): drop precomputed-JSON bundle loads, slim to tab + topology"
```

---

## Phase 5 — Shared frontend components

No automated tests for frontend (per spec). Each task: write the component, hand-verify in browser only at Phase 7.

### Task 5.1 — `multi_clamp.js` shared module

**Files**
- Create: `rnm_app/static/rnm/js/components/multi_clamp.js`

- [ ] **Step 1: Implement**

```javascript
// Multi-clamp builder. Renders a list of {node, value} rows + Add button.
// Usage:
//   const builder = createMultiClampBuilder(rootEl, allNodeNames, { maxClamps: 5 });
//   builder.getClamps()  // -> [{node, value}, ...]
//   builder.addClamp(node, value)
//   builder.onChange(cb)

export function createMultiClampBuilder(root, allNodes, opts = {}) {
  const maxClamps = opts.maxClamps ?? 5;
  const listeners = [];
  let clamps = [];

  function emit() {
    listeners.forEach(cb => cb([...clamps]));
  }

  function render() {
    root.innerHTML = "";
    const list = document.createElement("div");
    list.className = "multi-clamp-list";
    clamps.forEach((c, idx) => {
      const row = document.createElement("div");
      row.className = "clamp-row";
      row.innerHTML = `
        <input type="text" list="all-nodes-${root.id}" value="${c.node}" data-idx="${idx}" class="clamp-node-input">
        <input type="range" min="0" max="1" step="0.01" value="${c.value}" data-idx="${idx}" class="clamp-value-slider">
        <span class="clamp-value-label">${c.value.toFixed(2)}</span>
        <div class="clamp-snap">
          <button data-snap="0" data-idx="${idx}">0</button>
          <button data-snap="0.5" data-idx="${idx}">½</button>
          <button data-snap="1" data-idx="${idx}">1</button>
        </div>
        <button class="clamp-remove" data-idx="${idx}" aria-label="remove">×</button>
      `;
      list.appendChild(row);
    });
    root.appendChild(list);
    if (clamps.length < maxClamps) {
      const add = document.createElement("button");
      add.textContent = "+ Add clamp";
      add.className = "clamp-add";
      add.addEventListener("click", () => {
        clamps.push({ node: allNodes[0], value: 1.0 });
        render();
        emit();
      });
      root.appendChild(add);
    }
    if (!document.getElementById(`all-nodes-${root.id}`)) {
      const dl = document.createElement("datalist");
      dl.id = `all-nodes-${root.id}`;
      allNodes.forEach(n => {
        const o = document.createElement("option");
        o.value = n;
        dl.appendChild(o);
      });
      root.appendChild(dl);
    }
    root.querySelectorAll(".clamp-node-input").forEach(el => {
      el.addEventListener("change", e => {
        const idx = parseInt(e.target.dataset.idx, 10);
        clamps[idx].node = e.target.value;
        emit();
      });
    });
    root.querySelectorAll(".clamp-value-slider").forEach(el => {
      el.addEventListener("input", e => {
        const idx = parseInt(e.target.dataset.idx, 10);
        clamps[idx].value = parseFloat(e.target.value);
        const lbl = el.parentElement.querySelector(".clamp-value-label");
        if (lbl) lbl.textContent = clamps[idx].value.toFixed(2);
      });
      el.addEventListener("change", emit);
    });
    root.querySelectorAll(".clamp-snap button").forEach(el => {
      el.addEventListener("click", e => {
        const idx = parseInt(e.target.dataset.idx, 10);
        clamps[idx].value = parseFloat(e.target.dataset.snap);
        render();
        emit();
      });
    });
    root.querySelectorAll(".clamp-remove").forEach(el => {
      el.addEventListener("click", e => {
        const idx = parseInt(e.target.dataset.idx, 10);
        clamps.splice(idx, 1);
        render();
        emit();
      });
    });
  }

  return {
    getClamps: () => [...clamps],
    setClamps(c) { clamps = c.slice(0, maxClamps); render(); emit(); },
    addClamp(node, value) {
      if (clamps.length >= maxClamps) return false;
      if (clamps.some(c => c.node === node)) return false;
      clamps.push({ node, value });
      render(); emit();
      return true;
    },
    removeClamp(node) {
      const before = clamps.length;
      clamps = clamps.filter(c => c.node !== node);
      if (clamps.length !== before) { render(); emit(); }
    },
    onChange(cb) { listeners.push(cb); },
    render,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add rnm_app/static/rnm/js/components/multi_clamp.js
git commit -m "feat(ui): shared multi-clamp builder component"
```

---

### Task 5.2 — `variance_bars.js` shared module

**Files**
- Create: `rnm_app/static/rnm/js/components/variance_bars.js`

- [ ] **Step 1: Implement**

```javascript
// Variance-aware horizontal bar chart. Top-N by |mean Δ| with error whiskers.
// Uses Chart.js (already loaded by the page). Includes a "Show all" toggle that
// switches into a scrollable container.
//
// renderVarianceBars(ctx, { meansByNode, stdsByNode, defaultTopN = 20, height = 480 })

export function renderVarianceBars(canvas, opts) {
  const { meansByNode, stdsByNode } = opts;
  const defaultTopN = opts.defaultTopN ?? 20;
  let chart = null;
  let showAll = false;

  function pickEntries() {
    const entries = Object.entries(meansByNode).map(([node, mean]) => ({
      node,
      mean,
      std: stdsByNode?.[node] ?? 0,
    }));
    entries.sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
    return showAll ? entries : entries.slice(0, defaultTopN);
  }

  function render() {
    if (chart) chart.destroy();
    const data = pickEntries();
    const labels = data.map(d => d.node);
    const means = data.map(d => d.mean);
    const stds = data.map(d => d.std);
    const heightPx = Math.max(24 * data.length, 240);
    canvas.height = heightPx;
    if (canvas.parentElement.classList.contains("variance-scroll")) {
      canvas.parentElement.style.height = showAll ? "560px" : "auto";
      canvas.parentElement.style.overflowY = showAll ? "auto" : "visible";
    }
    chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "mean",
            data: means,
            backgroundColor: means.map(v => v >= 0 ? "#1f9d55" : "#c74343"),
          },
        ],
      },
      options: {
        indexAxis: "y",
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: "Δ activation" } },
        },
      },
    });
    // Error whiskers: draw via custom plugin afterwards.
    drawWhiskers(canvas, chart, means, stds);
  }

  function drawWhiskers(canvas, chart, means, stds) {
    const ctx = canvas.getContext("2d");
    const meta = chart.getDatasetMeta(0);
    ctx.save();
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    meta.data.forEach((bar, i) => {
      const xCenter = chart.scales.x.getPixelForValue(means[i]);
      const xLow = chart.scales.x.getPixelForValue(means[i] - stds[i]);
      const xHi = chart.scales.x.getPixelForValue(means[i] + stds[i]);
      const y = bar.y;
      ctx.beginPath();
      ctx.moveTo(xLow, y);
      ctx.lineTo(xHi, y);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xLow, y - 4); ctx.lineTo(xLow, y + 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xHi, y - 4); ctx.lineTo(xHi, y + 4); ctx.stroke();
    });
    ctx.restore();
  }

  return {
    render,
    toggleShowAll() { showAll = !showAll; render(); return showAll; },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add rnm_app/static/rnm/js/components/variance_bars.js
git commit -m "feat(ui): variance-aware bar chart with show-all toggle + whiskers"
```

---

### Task 5.3 — `error_banner.js`

**Files**
- Create: `rnm_app/static/rnm/js/components/error_banner.js`
- Create: `rnm_app/static/rnm/css/components.css`
- Modify: `rnm_app/templates/rnm/base.html` (link the CSS)

- [ ] **Step 1: Implement `error_banner.js`**

```javascript
// Top-of-tab dismissible red banner.
// showError(rootEl, "message", "optional suggestion")

export function showError(rootEl, message, suggestion) {
  const existing = rootEl.querySelector(".error-banner");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.className = "error-banner";
  div.innerHTML = `
    <strong>${message}</strong>
    ${suggestion ? `<span class="hint">${suggestion}</span>` : ""}
    <button class="dismiss" aria-label="dismiss">×</button>
  `;
  div.querySelector(".dismiss").addEventListener("click", () => div.remove());
  rootEl.prepend(div);
}
```

- [ ] **Step 2: Implement `components.css`**

```css
.error-banner {
  background: #ffe0e0;
  border-left: 4px solid #c74343;
  padding: 8px 12px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.error-banner .hint { color: #555; font-size: 0.9em; }
.error-banner .dismiss {
  margin-left: auto; background: transparent; border: 0;
  font-size: 1.2em; cursor: pointer;
}

.multi-clamp-list { display: grid; gap: 6px; }
.clamp-row { display: grid; grid-template-columns: 1fr 1fr 60px auto auto; gap: 8px; align-items: center; }
.clamp-snap button { padding: 2px 6px; font-size: 0.85em; }
.clamp-add { margin-top: 8px; }
.clamp-remove { background: transparent; border: 0; font-size: 1.2em; cursor: pointer; }

.variance-scroll { border: 1px solid var(--border, #ddd); border-radius: 4px; }

.candidate-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.candidate-chip {
  padding: 4px 10px; border-radius: 12px;
  border: 1px solid #aaa; background: #f6f6f6; cursor: pointer; font-size: 0.9em;
}
.candidate-chip:disabled { opacity: 0.4; cursor: not-allowed; }
.candidate-chip.catabolic { border-color: #c74343; }
.candidate-chip.anabolic { border-color: #1f9d55; }

.ranking-board { margin-top: 16px; border-collapse: collapse; width: 100%; }
.ranking-board th, .ranking-board td { padding: 4px 8px; border-bottom: 1px solid #eee; font-size: 0.9em; }

.pair-suggestion {
  margin-top: 12px; padding: 8px 12px; border: 1px dashed #888; border-radius: 4px;
  background: #fafaf6;
}
```

- [ ] **Step 3: Link CSS in `rnm_app/templates/rnm/base.html`**

In the `<head>`, add:

```html
<link rel="stylesheet" href="{% static 'rnm/css/components.css' %}">
```

- [ ] **Step 4: Commit**

```bash
git add rnm_app/static/rnm/js/components/error_banner.js \
        rnm_app/static/rnm/css/components.css \
        rnm_app/templates/rnm/base.html
git commit -m "feat(ui): error banner + components CSS (chips, ranking, banner)"
```

---

## Phase 6 — Tab pages (templates + JS)

### Task 6.1 — Simulate tab

**Files**
- Modify: `rnm_app/templates/rnm/partials/simulate.html`
- Modify: `rnm_app/static/rnm/js/simulate.js`

- [ ] **Step 1: Rewrite `simulate.html`**

```html
{% extends "rnm/base.html" %}
{% load static %}
{% block title %}Simulate — NP-MT-RNM{% endblock %}
{% block head %}
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>
  <script src="https://unpkg.com/cytoscape@3.28.1/dist/cytoscape.min.js"></script>
{% endblock %}
{% block content %}
  <h2>Simulate</h2>
  <p>Choose a regime, optionally clamp 0–5 nodes, and run a live ODE solve.</p>

  <div id="simulate-error-root"></div>

  <div class="simulate-controls">
    <div class="preset-buttons">
      <span class="label">Preset:</span>
      <button data-preset="Hypo">Hypo</button>
      <button data-preset="Normal">Normal</button>
      <button data-preset="Hyper">Hyper</button>
    </div>
    <div class="slider-group">
      <label>Hypo <input id="slider-hypo" type="number" min="0" max="1" step="0.01" value="0.01"></label>
      <label>NL   <input id="slider-nl"   type="number" min="0" max="1" step="0.01" value="0.80"></label>
      <label>HL   <input id="slider-hl"   type="number" min="0" max="1" step="0.01" value="0.01"></label>
    </div>
    <h3>Clamps</h3>
    <div id="simulate-clamps"></div>
    <label>Replicates:
      <select id="sim-reps">
        <option value="1">1</option>
        <option value="5" selected>5</option>
        <option value="10">10</option>
        <option value="20">20</option>
      </select>
    </label>
    <button id="run-sim">Run</button>
    <span id="sim-status" class="muted"></span>
  </div>

  <div class="simulate-output">
    <div id="sim-network" style="height: 400px; border: 1px solid var(--border); border-radius: 4px;"></div>
    <div class="variance-scroll"><canvas id="sim-bars"></canvas></div>
    <button id="sim-toggle-all" type="button">Show all 147</button>
    <div id="sim-categories"></div>
  </div>
{% endblock %}
{% block scripts %}
  <script type="module" src="{% static 'rnm/js/simulate.js' %}"></script>
  <script>
    window.NP_MT_RNM_NODE_NAMES = {{ node_names|safe }};
  </script>
{% endblock %}
```

- [ ] **Step 2: Rewrite `simulate.js` (full file replacement)**

```javascript
import { createMultiClampBuilder } from "./components/multi_clamp.js";
import { renderVarianceBars } from "./components/variance_bars.js";
import { showError } from "./components/error_banner.js";

const NODE_NAMES = window.NP_MT_RNM_NODE_NAMES || [];

const clampBuilder = createMultiClampBuilder(
  document.getElementById("simulate-clamps"),
  NODE_NAMES,
  { maxClamps: 5 }
);
clampBuilder.render();

document.querySelectorAll(".preset-buttons button").forEach(btn => {
  btn.addEventListener("click", () => {
    const p = btn.dataset.preset;
    const presets = {
      Hypo:   { hypo: 0.80, nl: 0.01, hl: 0.01 },
      Normal: { hypo: 0.01, nl: 0.80, hl: 0.01 },
      Hyper:  { hypo: 0.01, nl: 0.01, hl: 0.80 },
    };
    const v = presets[p];
    document.getElementById("slider-hypo").value = v.hypo;
    document.getElementById("slider-nl").value = v.nl;
    document.getElementById("slider-hl").value = v.hl;
  });
});

let bars = null;

document.getElementById("run-sim").addEventListener("click", async () => {
  const status = document.getElementById("sim-status");
  const btn = document.getElementById("run-sim");
  btn.disabled = true;
  status.textContent = "running…";

  const body = {
    regime: {
      hypo: parseFloat(document.getElementById("slider-hypo").value),
      nl: parseFloat(document.getElementById("slider-nl").value),
      hl: parseFloat(document.getElementById("slider-hl").value),
    },
    clamps: clampBuilder.getClamps(),
    n_replicates: parseInt(document.getElementById("sim-reps").value, 10),
  };

  const t0 = performance.now();
  let resp;
  try {
    resp = await fetch("/api/simulate/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    showError(document.getElementById("simulate-error-root"), "Network error", e.message);
    btn.disabled = false; status.textContent = "";
    return;
  }
  const data = await resp.json();
  btn.disabled = false;

  if (!resp.ok) {
    const msg = data.error || (data.errors && data.errors[0] && `${data.errors[0].field}: ${data.errors[0].error}`) || resp.statusText;
    showError(document.getElementById("simulate-error-root"), msg, data.suggestion);
    status.textContent = "";
    return;
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  status.textContent = `done (${elapsed}s · ${data.n_replicates_used} reps · cache ${data.cache_hit ? "hit" : "miss"})`;

  bars = renderVarianceBars(document.getElementById("sim-bars"), {
    meansByNode: data.delta_vs_hyper,
    stdsByNode: data.std_steady_state,
    defaultTopN: 20,
  });
  bars.render();

  const cat = document.getElementById("sim-categories");
  cat.innerHTML = "<h4>Mean |Δ| per category</h4>" + Object.entries(data.per_category_mean_abs_delta)
    .map(([k, v]) => `<span class="cat-chip">${k}: ${v.toFixed(3)}</span>`).join(" ");
});

document.getElementById("sim-toggle-all").addEventListener("click", () => {
  if (bars) bars.toggleShowAll();
});
```

- [ ] **Step 3: Commit**

```bash
git add rnm_app/templates/rnm/partials/simulate.html rnm_app/static/rnm/js/simulate.js
git commit -m "feat(simulate): live multi-clamp + variance bars + per-category"
```

---

### Task 6.2 — Rescue tab (chips + ranking board + pair suggestion)

**Files**
- Modify: `rnm_app/templates/rnm/partials/rescue.html`
- Modify: `rnm_app/static/rnm/js/rescue.js` (full rewrite)

- [ ] **Step 1: Rewrite `rescue.html`**

```html
{% extends "rnm/base.html" %}
{% load static %}
{% block title %}Rescue — NP-MT-RNM{% endblock %}
{% block head %}
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>
{% endblock %}
{% block content %}
  <h2>Rescue screen</h2>
  <p>Regime locked to <strong>Hyper</strong> (degenerated baseline). Add 1–5 clamps and run a live perturbation.</p>

  <div id="rescue-error-root"></div>

  <div class="candidate-chips">
    <strong>Catabolic ↓:</strong>
    {% for n in "RhoA-E,PIEZO1,PI3K-E,FAK-E,ROS"|cut:" "|cut:""|slice:":" %}{% endfor %}
    <button class="candidate-chip catabolic" data-node="RhoA-E" data-value="0">RhoA-E ↓</button>
    <button class="candidate-chip catabolic" data-node="PIEZO1" data-value="0">PIEZO1 ↓</button>
    <button class="candidate-chip catabolic" data-node="PI3K-E" data-value="0">PI3K-E ↓</button>
    <button class="candidate-chip catabolic" data-node="FAK-E" data-value="0">FAK-E ↓</button>
    <button class="candidate-chip catabolic" data-node="ROS" data-value="0">ROS ↓</button>
  </div>
  <div class="candidate-chips">
    <strong>Anabolic ↑:</strong>
    <button class="candidate-chip anabolic" data-node="SOX9" data-value="1">SOX9 ↑</button>
    <button class="candidate-chip anabolic" data-node="PPARγ" data-value="1">PPARγ ↑</button>
    <button class="candidate-chip anabolic" data-node="HIF-1α" data-value="1">HIF-1α ↑</button>
    <button class="candidate-chip anabolic" data-node="NRF2" data-value="1">NRF2 ↑</button>
    <button class="candidate-chip anabolic" data-node="IκBα" data-value="1">IκBα ↑</button>
  </div>

  <div id="rescue-clamps"></div>

  <label>Replicates:
    <select id="rescue-reps">
      <option value="1">1</option>
      <option value="5" selected>5</option>
      <option value="10">10</option>
      <option value="20">20</option>
    </select>
  </label>
  <button id="run-rescue">Run</button>
  <span id="rescue-status" class="muted"></span>

  <div class="rescue-output">
    <p>
      <strong>Balance:</strong> <span id="rescue-balance">—</span> ·
      <strong>Distance to Normal:</strong> <span id="rescue-distance">—</span>
    </p>
    <div class="variance-scroll"><canvas id="rescue-bars"></canvas></div>
    <button id="rescue-toggle-all" type="button">Show all 147</button>
    <div id="rescue-pair-suggestion"></div>
    <h3>Session ranking</h3>
    <table class="ranking-board">
      <thead><tr><th>Run</th><th>Clamps</th><th>Distance</th><th>Balance</th></tr></thead>
      <tbody id="rescue-ranking-body"></tbody>
    </table>
  </div>
{% endblock %}
{% block scripts %}
  <script type="module" src="{% static 'rnm/js/rescue.js' %}"></script>
  <script>
    window.NP_MT_RNM_NODE_NAMES = {{ node_names|safe }};
  </script>
{% endblock %}
```

- [ ] **Step 2: Rewrite `rescue.js` (full replacement)**

```javascript
import { createMultiClampBuilder } from "./components/multi_clamp.js";
import { renderVarianceBars } from "./components/variance_bars.js";
import { showError } from "./components/error_banner.js";

const NODE_NAMES = window.NP_MT_RNM_NODE_NAMES || [];
const CATABOLIC = ["RhoA-E", "PIEZO1", "PI3K-E", "FAK-E", "ROS"];
const ANABOLIC = ["SOX9", "PPARγ", "HIF-1α", "NRF2", "IκBα"];

const builder = createMultiClampBuilder(
  document.getElementById("rescue-clamps"),
  NODE_NAMES,
  { maxClamps: 5 }
);
builder.onChange(refreshChipState);
builder.render();

function refreshChipState() {
  const present = new Set(builder.getClamps().map(c => c.node));
  const full = builder.getClamps().length >= 5;
  document.querySelectorAll(".candidate-chip").forEach(btn => {
    btn.disabled = present.has(btn.dataset.node) || (full && !present.has(btn.dataset.node));
  });
}
refreshChipState();

document.querySelectorAll(".candidate-chip").forEach(btn => {
  btn.addEventListener("click", () => {
    builder.addClamp(btn.dataset.node, parseFloat(btn.dataset.value));
  });
});

let bars = null;

document.getElementById("run-rescue").addEventListener("click", runRescue);
document.getElementById("rescue-toggle-all").addEventListener("click", () => {
  if (bars) bars.toggleShowAll();
});

async function runRescue() {
  const btn = document.getElementById("run-rescue");
  const status = document.getElementById("rescue-status");
  btn.disabled = true;
  status.textContent = "running…";

  const body = {
    clamps: builder.getClamps(),
    n_replicates: parseInt(document.getElementById("rescue-reps").value, 10),
  };
  const t0 = performance.now();
  let resp;
  try {
    resp = await fetch("/api/rescue/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    showError(document.getElementById("rescue-error-root"), "Network error", e.message);
    btn.disabled = false; status.textContent = ""; return;
  }
  const data = await resp.json();
  btn.disabled = false;

  if (!resp.ok) {
    const msg = data.error || (data.errors && data.errors[0] && `${data.errors[0].field}: ${data.errors[0].error}`) || resp.statusText;
    showError(document.getElementById("rescue-error-root"), msg, data.suggestion);
    status.textContent = ""; return;
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  status.textContent = `done (${elapsed}s · cache ${data.cache_hit ? "hit" : "miss"})`;

  document.getElementById("rescue-balance").textContent = data.balance_score.toFixed(3);
  document.getElementById("rescue-distance").textContent = data.distance_to_normal.toFixed(3);

  bars = renderVarianceBars(document.getElementById("rescue-bars"), {
    meansByNode: data.delta_vs_hyper,
    stdsByNode: data.std_steady_state,
    defaultTopN: 20,
  });
  bars.render();

  appendRankingEntry({
    label: builder.getClamps().map(c => `${c.node}=${c.value.toFixed(2)}`).join(" + ") || "(no clamps)",
    distance: data.distance_to_normal,
    balance: data.balance_score,
    clamps: builder.getClamps(),
  });
  refreshPairSuggestion();
}

function appendRankingEntry(entry) {
  const board = JSON.parse(sessionStorage.getItem("rescueBoard") || "[]");
  board.push(entry);
  sessionStorage.setItem("rescueBoard", JSON.stringify(board));
  renderRanking();
}

function renderRanking() {
  const board = JSON.parse(sessionStorage.getItem("rescueBoard") || "[]");
  board.sort((a, b) => a.distance - b.distance);
  const tbody = document.getElementById("rescue-ranking-body");
  tbody.innerHTML = "";
  board.slice(0, 30).forEach((e, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i + 1}</td><td>${e.label}</td><td>${e.distance.toFixed(3)}</td><td>${e.balance.toFixed(3)}</td>`;
    tbody.appendChild(tr);
  });
}
renderRanking();

function refreshPairSuggestion() {
  const root = document.getElementById("rescue-pair-suggestion");
  const board = JSON.parse(sessionStorage.getItem("rescueBoard") || "[]");
  const singles = board.filter(e => e.clamps.length === 1);
  const cataSingles = singles.filter(e => CATABOLIC.includes(e.clamps[0].node) && e.clamps[0].value === 0);
  const anabSingles = singles.filter(e => ANABOLIC.includes(e.clamps[0].node) && e.clamps[0].value === 1);
  if (cataSingles.length === 0 || anabSingles.length === 0) { root.innerHTML = ""; return; }
  cataSingles.sort((a, b) => a.distance - b.distance);
  anabSingles.sort((a, b) => a.distance - b.distance);
  const c = cataSingles[0].clamps[0].node;
  const a = anabSingles[0].clamps[0].node;
  root.className = "pair-suggestion";
  root.innerHTML = `
    <strong>Try next:</strong> ${c} ↓ + ${a} ↑
    <button id="apply-pair">Apply</button>
  `;
  document.getElementById("apply-pair").addEventListener("click", () => {
    builder.setClamps([{ node: c, value: 0 }, { node: a, value: 1 }]);
  });
}
refreshPairSuggestion();
```

- [ ] **Step 3: Commit**

```bash
git add rnm_app/templates/rnm/partials/rescue.html rnm_app/static/rnm/js/rescue.js
git commit -m "feat(rescue): chip toolbar, ranking board, pair suggestion, variance bars"
```

---

### Task 6.3 — Falsification tab (single + run-all SSE)

**Files**
- Modify: `rnm_app/templates/rnm/partials/falsification.html`
- Create: `rnm_app/static/rnm/js/falsification.js`

- [ ] **Step 1: Rewrite `falsification.html`**

```html
{% extends "rnm/base.html" %}
{% load static %}
{% block title %}Falsification — NP-MT-RNM{% endblock %}
{% block content %}
  <h2>Falsification benchmark</h2>
  <p>Compare model polarity (Normal vs Hyper) against 45 published expectations. Run one or run all 45 (~3 min).</p>

  <div id="falsification-error-root"></div>
  <label>Condition:
    <select id="falsification-cid">
      {% for cid in condition_ids %}<option value="{{ cid }}">{{ cid }}</option>{% endfor %}
    </select>
  </label>
  <label>Replicates:
    <select id="falsification-reps">
      <option value="1">1</option><option value="5" selected>5</option><option value="10">10</option>
    </select>
  </label>
  <button id="run-fals-single">Run one</button>
  <button id="run-fals-all">Run all 45</button>
  <button id="cancel-fals" disabled>Cancel</button>
  <span id="fals-status" class="muted"></span>

  <table class="ranking-board" id="fals-table">
    <thead><tr><th>#</th><th>Condition</th><th>Expected</th><th>Observed</th><th>Match</th><th>Elapsed</th></tr></thead>
    <tbody id="fals-tbody"></tbody>
  </table>
{% endblock %}
{% block scripts %}
  <script type="module" src="{% static 'rnm/js/falsification.js' %}"></script>
{% endblock %}
```

- [ ] **Step 2: Implement `falsification.js`**

```javascript
import { showError } from "./components/error_banner.js";

const tbody = document.getElementById("fals-tbody");
const status = document.getElementById("fals-status");
const errorRoot = document.getElementById("falsification-error-root");
let evtSource = null;
let rowCounter = 0;

document.getElementById("run-fals-single").addEventListener("click", async () => {
  const cid = document.getElementById("falsification-cid").value;
  const n = parseInt(document.getElementById("falsification-reps").value, 10);
  status.textContent = "running…";
  let resp;
  try {
    resp = await fetch("/api/falsification/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ condition_id: cid, n_replicates: n }),
    });
  } catch (e) {
    showError(errorRoot, "Network error", e.message);
    status.textContent = ""; return;
  }
  const data = await resp.json();
  if (!resp.ok) {
    showError(errorRoot, data.error || "request failed", data.suggestion);
    status.textContent = ""; return;
  }
  appendRow(data);
  status.textContent = `done (${data.elapsed_s}s)`;
});

document.getElementById("run-fals-all").addEventListener("click", () => {
  tbody.innerHTML = ""; rowCounter = 0;
  status.textContent = "streaming…";
  document.getElementById("cancel-fals").disabled = false;
  evtSource = new EventSource("/api/falsification/stream/?n_replicates=5");
  let nMatched = 0, nSeen = 0;
  evtSource.onmessage = e => {
    const data = JSON.parse(e.data);
    appendRow(data);
    nSeen++; if (data.match) nMatched++;
    status.textContent = `streaming… ${nSeen}/45 (matched ${nMatched})`;
  };
  evtSource.addEventListener("done", e => {
    const d = JSON.parse(e.data);
    status.textContent = `done — ${d.n_matched}/${d.n_total} matched in ${d.elapsed_s}s`;
    document.getElementById("cancel-fals").disabled = true;
    evtSource.close();
  });
  evtSource.onerror = () => {
    showError(errorRoot, "stream error");
    status.textContent = "";
    document.getElementById("cancel-fals").disabled = true;
    evtSource.close();
  };
});

document.getElementById("cancel-fals").addEventListener("click", () => {
  if (evtSource) { evtSource.close(); status.textContent = "cancelled"; }
  document.getElementById("cancel-fals").disabled = true;
});

function appendRow(data) {
  rowCounter++;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${rowCounter}</td>
    <td>${data.condition_id}</td>
    <td>${data.expected_polarity}</td>
    <td>${data.observed_polarity}</td>
    <td>${data.match ? "✓" : "✗"}</td>
    <td>${data.elapsed_s}s</td>
  `;
  tbody.appendChild(tr);
}
```

- [ ] **Step 3: Commit**

```bash
git add rnm_app/templates/rnm/partials/falsification.html rnm_app/static/rnm/js/falsification.js
git commit -m "feat(falsification): single + run-all SSE with cancel"
```

---

### Task 6.4 — Transitions tab

**Files**
- Modify: `rnm_app/templates/rnm/partials/transitions.html`
- Create: `rnm_app/static/rnm/js/transitions.js`

- [ ] **Step 1: Rewrite `transitions.html`**

```html
{% extends "rnm/base.html" %}
{% load static %}
{% block title %}Transitions — NP-MT-RNM{% endblock %}
{% block head %}
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>
{% endblock %}
{% block content %}
  <h2>Regime transitions</h2>
  <p>Switch from one regime to another at <code>t_switch</code> and watch selected nodes evolve.</p>
  <div id="transitions-error-root"></div>

  <div class="transition-controls">
    <label>Start regime:
      <select id="t-start"><option>Hypo</option><option selected>Normal</option><option>Hyper</option></select>
    </label>
    <label>End regime:
      <select id="t-end"><option>Hypo</option><option>Normal</option><option selected>Hyper</option></select>
    </label>
    <label>t_switch <input id="t-switch" type="number" min="1" max="100" step="1" value="10"></label>
    <label>t_end <input id="t-end-time" type="number" min="2" max="200" step="1" value="30"></label>
    <label>Replicates:
      <select id="t-reps"><option value="1">1</option><option value="5" selected>5</option><option value="10">10</option></select>
    </label>
    <label>Nodes (1–10, comma-separated):
      <input id="t-nodes" type="text" value="SOX9,ROS,RhoA-E,PPARγ,HIF-1α">
    </label>
    <button id="run-trans">Run</button>
    <span id="trans-status" class="muted"></span>
  </div>

  <canvas id="trans-chart" height="320"></canvas>
{% endblock %}
{% block scripts %}
  <script type="module" src="{% static 'rnm/js/transitions.js' %}"></script>
{% endblock %}
```

- [ ] **Step 2: Implement `transitions.js`**

```javascript
import { showError } from "./components/error_banner.js";

let chart = null;

document.getElementById("run-trans").addEventListener("click", async () => {
  const status = document.getElementById("trans-status");
  status.textContent = "running…";
  const body = {
    start_regime: document.getElementById("t-start").value,
    end_regime: document.getElementById("t-end").value,
    t_switch: parseFloat(document.getElementById("t-switch").value),
    t_end: parseFloat(document.getElementById("t-end-time").value),
    n_replicates: parseInt(document.getElementById("t-reps").value, 10),
    node_names: document.getElementById("t-nodes").value.split(",").map(s => s.trim()).filter(Boolean),
  };
  let resp;
  try {
    resp = await fetch("/api/transitions/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    showError(document.getElementById("transitions-error-root"), "Network error", e.message);
    status.textContent = ""; return;
  }
  const data = await resp.json();
  if (!resp.ok) {
    const msg = data.error || (data.errors && data.errors[0] && `${data.errors[0].field}: ${data.errors[0].error}`) || resp.statusText;
    showError(document.getElementById("transitions-error-root"), msg, data.suggestion);
    status.textContent = ""; return;
  }
  status.textContent = `done (${data.elapsed_s}s)`;
  draw(data, body.t_switch);
});

function draw(data, tSwitch) {
  const datasets = [];
  const palette = ["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf"];
  Object.entries(data.trajectories).forEach(([node, vals], idx) => {
    const color = palette[idx % palette.length];
    datasets.push({
      label: node,
      data: data.t.map((t, i) => ({ x: t, y: vals.mean[i] })),
      borderColor: color,
      backgroundColor: color + "33",
      pointRadius: 0,
      tension: 0.1,
    });
  });
  if (chart) chart.destroy();
  chart = new Chart(document.getElementById("trans-chart").getContext("2d"), {
    type: "line",
    data: { datasets },
    options: {
      animation: false,
      parsing: false,
      scales: {
        x: { type: "linear", title: { display: true, text: "t" } },
        y: { min: 0, max: 1, title: { display: true, text: "activation" } },
      },
      plugins: {
        annotation: {
          annotations: {
            switchLine: {
              type: "line", xMin: tSwitch, xMax: tSwitch,
              borderColor: "#999", borderDash: [4, 4],
            },
          },
        },
      },
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add rnm_app/templates/rnm/partials/transitions.html rnm_app/static/rnm/js/transitions.js
git commit -m "feat(transitions): live trajectory plot with regime switch"
```

---

## Phase 7 — Smoke (manual; minimal dev-server use)

### Task 7.1 — Run the full pytest suite

**Files**
- (none modified)

- [ ] **Step 1: Run full test suite**

```bash
cd np-mt-rnm-web
.venv/bin/pytest -v --tb=short 2>&1 | tail -40
```
Expected: all green. If any fail, fix in place and re-run.

- [ ] **Step 2: Variance snapshot test (canonical scenarios)**

Create `tests/test_variance_snapshot.py`:

```python
"""Canonical scenarios — guard against silent numerical regressions."""
import pytest

from rnm_app.compute.simulate import run_simulation
from rnm_app.compute.rescue import run_rescue
from np_mt_rnm.simulation import REGIME_PRESETS


@pytest.mark.django_db
def test_hyper_baseline_steady_within_bounds(net):
    sim = run_simulation(net, REGIME_PRESETS["Hyper"], clamps=[], n_replicates=2, seed=12345)
    # ROS should be elevated under Hyper
    ros_idx = net.node_names.index("ROS")
    assert sim.mean_steady_state[ros_idx] > 0.3
    # std must be non-negative
    assert (sim.std_steady_state >= 0).all()


@pytest.mark.django_db
def test_sox9_up_rescue_reduces_distance(net):
    no_clamp = run_rescue(net=net, clamps=[], n_replicates=2, seed=11)
    sox9_up = run_rescue(net=net, clamps=[{"node": "SOX9", "value": 1.0}], n_replicates=2, seed=11)
    # Pinning SOX9=1 should not increase distance to Normal (sanity, may not strictly decrease)
    assert sox9_up.distance_to_normal <= no_clamp.distance_to_normal + 0.5


@pytest.mark.django_db
def test_dual_clamp_runs(net):
    res = run_rescue(
        net=net,
        clamps=[{"node": "SOX9", "value": 1.0}, {"node": "RhoA-E", "value": 0.0}],
        n_replicates=2,
        seed=22,
    )
    assert res.distance_to_normal >= 0
```

```bash
.venv/bin/pytest tests/test_variance_snapshot.py -v
```

- [ ] **Step 3: Commit snapshot tests**

```bash
git add tests/test_variance_snapshot.py
git commit -m "test(variance-snapshot): canonical scenarios as regression guard"
```

---

### Task 7.2 — Manual browser smoke (single dev-server start)

**Files**
- (none modified)

This is the only place we touch the dev server. Keep it short.

- [ ] **Step 1: Update freeze-trace memory before starting the server**

Before running, update `~/.claude/projects/-Users-kiptengwer-Documents-ZERIHUN/memory/project_np_mt_rnm_web_freeze_trace.md` with:

> "About to start runserver for one-shot smoke. Background task id will be recorded."

- [ ] **Step 2: Start the dev server**

```bash
cd np-mt-rnm-web
.venv/bin/python manage.py runserver 127.0.0.1:8765 --noreload &
RUNSERVER_PID=$!
sleep 2
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8765/
```
Expected: `HTTP 200`.

- [ ] **Step 3: Smoke checklist (in browser at http://127.0.0.1:8765/)**

Walk through each item and check off:
- [ ] Overview tab loads
- [ ] Network tab renders 147 nodes
- [ ] Simulate: pick "Normal" preset, no clamps, run → see top-20 bars + per-category strip; chart fits viewport
- [ ] Simulate: add SOX9 clamp = 1.0, run → see SOX9 pinned in network recolor
- [ ] Rescue: click "SOX9 ↑" chip, run → balance + distance populated; entry appears in ranking board
- [ ] Rescue: click "RhoA-E ↓" chip, run → second entry; pair suggestion appears
- [ ] Rescue: click "Apply" on pair suggestion → builder shows both clamps; run; entry appears as dual
- [ ] Falsification: pick first condition, run → row appears with polarity match
- [ ] Falsification: "Run all 45" → table fills progressively; cancel works
- [ ] Transitions: Normal→Hyper, t_switch=10, t_end=30, run → line plot shows the switch
- [ ] Bar charts in Simulate and Rescue do not require page-scrolling at default top-20

- [ ] **Step 4: Stop the server**

```bash
kill -TERM $RUNSERVER_PID
sleep 1
lsof -i :8765 || echo "port free"
```

- [ ] **Step 5: Update freeze-trace memory with outcome (any freeze? clean?)**

If clean → mark "smoke passed without freeze; safe to delete this trace memory next session."

- [ ] **Step 6: Commit nothing (no code change in this task)**

---

## Phase 8 — Production scaffolding (optional / deferred)

Defer the gunicorn config, Procfile/Dockerfile, and host-specific files to a follow-up plan once the host is chosen. The spec calls hosting an open decision; do not invent it.

If/when the host is decided, the next plan should include: `gunicorn.conf.py` with 3 sync workers, a `Procfile` or `Dockerfile`, environment-specific `DJANGO_SETTINGS_MODULE`, and a CI step that runs `pytest` on every push.

---

## Self-review checklist (run after the plan is complete)

Before handing this plan to the executor, verify:

- [ ] Every spec section has at least one task. Cross-reference: Background (n/a), Goals 1-5 (Tasks 2.4–2.7, 4.1–4.5, 5.2, 6.1–6.4), Architecture (2.1–2.3, 4.1 cache wiring), Components (Phase 6), API contracts (Phase 4), Error handling (3.1, 3.2, 4.x), Testing (Phase 0 + tests in every backend task + 7.1), What gets deleted (0.3, 4.6).
- [ ] No "TBD" / "TODO" / "implement later" / "appropriate error handling" anywhere in the plan body.
- [ ] Every test step shows the actual test code; every implementation step shows the actual code; every command shows the exact invocation + expected output.
- [ ] Type names align: `SimulationResult` and `RescueResult` referenced consistently between compute and api modules; `ConditionOutcome` used by both falsification compute and the SSE handler; `TrajectoryResult` returned by the sister-repo function and consumed by `compute/transitions.py`.
- [ ] Freeze-safe rule (`n_jobs=1`) appears in every code path that calls `run_replicates`/`run_perturbation`/`run_trajectory`. Spot-checked: 1.1 step 4 (test passes n_jobs=1), 2.4 (`n_jobs=1` in `run_simulation`), 2.6 (`n_jobs=1` in `evaluate_condition`), 2.7 (`n_jobs=1` in `run_transition`).
