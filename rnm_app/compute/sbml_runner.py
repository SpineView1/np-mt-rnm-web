"""Thin tellurium wrapper for the NP-MT-RNM SBML model.

Loads `precomputed/model.xml` once per worker and exposes a `simulate()`
helper. Single-threaded only — never spawn worker processes here (the user's
Mac freezes when joblib forks).
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import tellurium as te
from django.conf import settings


_RUNNER_CACHE = None  # roadrunner.RoadRunner | None


def _model_path() -> Path:
    return Path(settings.PRECOMPUTED_DIR) / "model.xml"


def get_runner():
    """Lazy-load model.xml on first call; cache for the worker's lifetime.

    Returns a `roadrunner.RoadRunner` instance. Callers should treat it as
    a shared resource and `reset()` it at the start of every simulation.
    """
    global _RUNNER_CACHE
    if _RUNNER_CACHE is None:
        _RUNNER_CACHE = te.loadSBMLModel(str(_model_path()))
    return _RUNNER_CACHE


def _strip_brackets(col: str) -> str:
    """Tellurium returns column names like '[SOX9]'. Strip the brackets."""
    if col.startswith("[") and col.endswith("]"):
        return col[1:-1]
    return col


def simulate(
    runner,
    regime: Optional[dict] = None,
    clamps: Optional[dict] = None,
    t_end: float = 100.0,
    n_points: int = 51,
) -> dict:
    """Run a single simulation.

    Parameters
    ----------
    runner : roadrunner.RoadRunner
        Cached runner from `get_runner()`.
    regime : dict, optional
        Boundary species values in [0, 1], e.g. ``{"Hypo": 0.01, "NL": 0.80,
        "HL": 0.01}``. Missing keys are left at the model default.
    clamps : dict, optional
        Map of non-boundary species id → initial value in [0, 1]. NOTE: this
        is an initial-concentration override applied AFTER ``runner.reset()``,
        not a hard clamp. The species is free to drift over time. A true hard
        clamp would require modifying the SBML or stepping the integrator
        manually — that is a v2 problem.
    t_end : float
        End of integration window (model time units).
    n_points : int
        Number of evenly-spaced time points returned (including t=0 and t_end).

    Returns
    -------
    dict
        ``{
            "time": [float, ...],
            "species_ids": [str, ...],
            "initial": {species_id: float, ...},
            "final": {species_id: float, ...},
            "trajectories": {species_id: [float, ...], ...},
        }``
    """
    regime = regime or {}
    clamps = clamps or {}

    # Always start from a clean state — required for repeatable runs.
    runner.reset()

    # Boundary species: setting the attribute fixes the concentration for
    # the whole run because boundaryCondition=true in the SBML.
    for k, v in regime.items():
        runner[k] = float(v)

    # Floating-species initial-condition overrides.
    for k, v in clamps.items():
        runner[k] = float(v)

    result = runner.simulate(0.0, float(t_end), int(n_points))

    colnames = [_strip_brackets(c) for c in result.colnames]
    time_idx = colnames.index("time")
    time = [float(row[time_idx]) for row in result]

    species_ids: list[str] = []
    trajectories: dict[str, list[float]] = {}
    initial: dict[str, float] = {}
    final: dict[str, float] = {}

    for j, name in enumerate(colnames):
        if j == time_idx:
            continue
        traj = [float(row[j]) for row in result]
        species_ids.append(name)
        trajectories[name] = traj
        initial[name] = traj[0]
        final[name] = traj[-1]

    return {
        "time": time,
        "species_ids": species_ids,
        "initial": initial,
        "final": final,
        "trajectories": trajectories,
    }
