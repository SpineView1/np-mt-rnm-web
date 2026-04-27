"""POST /api/simulate/ — single-shot tellurium simulation."""
from __future__ import annotations

import json
import time as _time
from typing import Any

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from rnm_app.compute.sbml_runner import get_runner, simulate


DEFAULT_REGIME = {"Hypo": 0.01, "NL": 0.80, "HL": 0.01}
TOP_K = 20

MAX_CLAMPS = 10
MAX_T_END = 200.0
MAX_N_POINTS = 201
MIN_N_POINTS = 2


def _err(msg: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"error": msg}, status=status)


def _validate_unit_value(label: str, val: Any) -> tuple[bool, str]:
    try:
        f = float(val)
    except (TypeError, ValueError):
        return False, f"{label} must be a number"
    if not (0.0 <= f <= 1.0):
        return False, f"{label} must be in [0, 1]"
    return True, ""


@csrf_exempt
@require_POST
def api_simulate_sbml(request) -> JsonResponse:
    """POST /api/simulate/

    Body::

        {
            "regime": {"Hypo": float, "NL": float, "HL": float},   # optional
            "clamps": {"<species_id>": float, ...},                 # ≤10 entries
            "t_end": float,    # default 100, max 200
            "n_points": int    # default 51, min 2, max 201
        }

    Returns the time grid, species ids, initial/final concentrations, and
    per-species trajectories restricted to the top-K species ranked by
    ``|final - initial|``.
    """
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return _err("invalid JSON")

    if not isinstance(payload, dict):
        return _err("body must be a JSON object")

    runner = get_runner()
    allowed_ids = set(runner.getFloatingSpeciesIds()) | set(runner.getBoundarySpeciesIds())
    boundary_ids = set(runner.getBoundarySpeciesIds())

    # ---- regime ----
    regime = payload.get("regime")
    if regime is None:
        regime = dict(DEFAULT_REGIME)
    else:
        if not isinstance(regime, dict):
            return _err("'regime' must be an object")
        for k, v in regime.items():
            if k not in boundary_ids:
                return _err(f"unknown boundary species '{k}'")
            ok, msg = _validate_unit_value(f"regime['{k}']", v)
            if not ok:
                return _err(msg)
        regime = {k: float(v) for k, v in regime.items()}

    # ---- clamps ----
    clamps_in = payload.get("clamps") or {}
    if not isinstance(clamps_in, dict):
        return _err("'clamps' must be an object")
    if len(clamps_in) > MAX_CLAMPS:
        return _err(f"at most {MAX_CLAMPS} clamps allowed")
    clamps: dict[str, float] = {}
    for k, v in clamps_in.items():
        if k not in allowed_ids:
            return _err(f"unknown species '{k}' in clamps")
        ok, msg = _validate_unit_value(f"clamps['{k}']", v)
        if not ok:
            return _err(msg)
        clamps[k] = float(v)

    # ---- t_end ----
    t_end = payload.get("t_end", 100.0)
    try:
        t_end = float(t_end)
    except (TypeError, ValueError):
        return _err("'t_end' must be a number")
    if not (0.0 < t_end <= MAX_T_END):
        return _err(f"'t_end' must be in (0, {MAX_T_END}]")

    # ---- n_points ----
    n_points = payload.get("n_points", 51)
    try:
        n_points = int(n_points)
    except (TypeError, ValueError):
        return _err("'n_points' must be an integer")
    if not (MIN_N_POINTS <= n_points <= MAX_N_POINTS):
        return _err(f"'n_points' must be in [{MIN_N_POINTS}, {MAX_N_POINTS}]")

    # ---- run ----
    t0 = _time.perf_counter()
    try:
        out = simulate(
            runner,
            regime=regime,
            clamps=clamps,
            t_end=t_end,
            n_points=n_points,
        )
    except Exception as exc:  # noqa: BLE001 — surface integrator failures
        return _err(f"simulation failed: {exc!s}", status=500)
    elapsed = _time.perf_counter() - t0

    # Top-K species by absolute delta from initial to final.
    species_ids = out["species_ids"]
    initial = out["initial"]
    final = out["final"]
    deltas = sorted(
        species_ids,
        key=lambda s: abs(final[s] - initial[s]),
        reverse=True,
    )
    top_ids = deltas[:TOP_K]
    trajectories_top = {sid: out["trajectories"][sid] for sid in top_ids}

    return JsonResponse({
        "time": out["time"],
        "species_ids": species_ids,
        "initial": initial,
        "final": final,
        "trajectories": trajectories_top,
        "n_species_total": len(species_ids),
        "elapsed_s": round(elapsed, 4),
    })
