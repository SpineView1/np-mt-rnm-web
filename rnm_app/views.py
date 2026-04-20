"""Views: one per tab + JSON APIs for live endpoints.

API stubs (simulate, rescue/custom) return 501 for now — real
implementations are added in Phases D and E.
"""
from __future__ import annotations

import json
from pathlib import Path

from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST


def _render_tab(request, active: str, extra_context: dict | None = None):
    context = {"active": active}
    if extra_context:
        context.update(extra_context)
    return render(request, f"rnm/partials/{active}.html", context)


def _load_bundle(name: str) -> dict:
    path = Path(settings.PRECOMPUTED_DIR) / f"{name}.json"
    return json.loads(path.read_text())


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
    # Real implementation in Phase D (Task 10).
    return JsonResponse({"error": "not implemented yet"}, status=501)


@csrf_exempt
@require_POST
def api_rescue_custom(request):
    # Real implementation in Phase E (Task 12).
    return JsonResponse({"error": "not implemented yet"}, status=501)
