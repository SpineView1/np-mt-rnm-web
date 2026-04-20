"""Views: one per tab + JSON APIs for live endpoints.

API stubs (simulate, rescue/custom) return 501 for now — real
implementations are added in Phases D and E.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from np_mt_rnm.network import load_network
from np_mt_rnm.simulation import run_single_replicate


def _render_tab(request, active: str, extra_context: dict | None = None):
    context = {"active": active}
    if extra_context:
        context.update(extra_context)
    return render(request, f"rnm/partials/{active}.html", context)


def _load_bundle(name: str) -> dict:
    path = Path(settings.PRECOMPUTED_DIR) / f"{name}.json"
    return json.loads(path.read_text())


# Network loader cache: loaded once per Django worker on first request.
_NET_CACHE = None


def _get_net():
    global _NET_CACHE
    if _NET_CACHE is None:
        xlsx_path = Path(settings.PRECOMPUTED_DIR) / "MT_PRIMARY4_1.xlsx"
        _NET_CACHE = load_network(xlsx_path)
    return _NET_CACHE


@require_GET
def overview(request):
    return _render_tab(request, "overview")


@require_GET
def network(request):
    return _render_tab(request, "network")


@require_GET
def simulate(request):
    bundle = _load_bundle("network")
    return _render_tab(request, "simulate", {
        "node_names": [n["id"] for n in bundle["nodes"]],
    })


@require_GET
def falsification(request):
    data = _load_bundle("falsification")
    return _render_tab(request, "falsification", {"falsification_json": json.dumps(data)})


@require_GET
def transitions(request):
    data = _load_bundle("transitions")
    return _render_tab(request, "transitions", {"transitions_json": json.dumps(data)})


@require_GET
def rescue(request):
    bundle = _load_bundle("rescue")
    net = _load_bundle("network")
    return _render_tab(request, "rescue", {
        "rescue_json": json.dumps(bundle),
        "node_names": [n["id"] for n in net["nodes"]],
    })


@require_GET
def downloads(request):
    return _render_tab(request, "downloads")


# ---- JSON APIs ----


@require_GET
def api_network(request):
    return JsonResponse(_load_bundle("network"))


@csrf_exempt
@require_POST
def api_simulate(request):
    """Live single-replicate ODE solve. ~0.5–2 seconds.

    Body: {"regime": {"Hypo": 0.01, "NL": 0.80, "HL": 0.01},
           "clamps": {"SOX9": 1.0}}   # clamps optional
    """
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return JsonResponse({"error": "invalid JSON"}, status=400)

    regime = payload.get("regime")
    clamps = payload.get("clamps") or {}
    if not isinstance(regime, dict):
        return JsonResponse({"error": "'regime' must be an object"}, status=400)

    net = _get_net()
    try:
        # Deterministic seed from the payload so repeated identical requests
        # return identical output (useful for debugging and caching).
        seed = hash(json.dumps(payload, sort_keys=True)) & 0x7FFFFFFF
        result = run_single_replicate(
            net, regime=regime, user_clamps=clamps, seed=seed,
        )
    except KeyError as e:
        return JsonResponse({"error": str(e)}, status=400)
    except Exception as e:
        return JsonResponse({"error": f"simulation failed: {e!s}"}, status=500)

    return JsonResponse({
        "node_activations": dict(zip(net.node_names, result.x_final.tolist())),
        "converged": bool(result.converged),
        "max_abs_derivative": float(result.max_abs_derivative),
        "t_final": float(result.t_final),
    })


@csrf_exempt
@require_POST
def api_rescue_custom(request):
    # Real implementation in Phase E (Task 12).
    return JsonResponse({"error": "not implemented yet"}, status=501)
