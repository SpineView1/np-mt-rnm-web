"""Slim Django views: home page + network JSON."""
from __future__ import annotations

import json
from pathlib import Path

import libsbml
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET


def _load_bundle(name: str) -> dict:
    path = Path(settings.PRECOMPUTED_DIR) / f"{name}.json"
    return json.loads(path.read_text())


_METADATA_CACHE: dict | None = None


def _model_metadata() -> tuple[dict, list[dict]]:
    """Read precomputed/model.xml once and return (summary, species_list).

    Cheap: a few hundred-element loop. Cached to skip repeat libsbml parses.
    """
    global _METADATA_CACHE
    if _METADATA_CACHE is not None:
        return _METADATA_CACHE["summary"], _METADATA_CACHE["species"]

    path = Path(settings.PRECOMPUTED_DIR) / "model.xml"
    reader = libsbml.SBMLReader()
    doc = reader.readSBMLFromFile(str(path))
    model = doc.getModel()

    species_list: list[dict] = []
    n_boundary = 0
    for i in range(model.getNumSpecies()):
        sp = model.getSpecies(i)
        is_boundary = bool(sp.getBoundaryCondition())
        if is_boundary:
            n_boundary += 1
        species_list.append({
            "id": sp.getId(),
            "name": sp.getName() or sp.getId(),
            "is_boundary": is_boundary,
        })
    species_list.sort(key=lambda s: (not s["is_boundary"], s["id"]))

    n_rate_rules = sum(
        1 for i in range(model.getNumRules()) if model.getRule(i).isRate()
    )

    params: dict[str, float] = {}
    for i in range(model.getNumParameters()):
        p = model.getParameter(i)
        params[p.getId()] = float(p.getValue())

    summary = {
        "n_species": model.getNumSpecies(),
        "n_boundary": n_boundary,
        "n_rate_rules": n_rate_rules,
        "h": params.get("h"),
        "gamma": params.get("gamma"),
    }
    _METADATA_CACHE = {"summary": summary, "species": species_list}
    return summary, species_list


@require_GET
def home(request):
    summary, species_list = _model_metadata()
    return render(
        request,
        "rnm/home.html",
        {"summary": summary, "species_list": species_list},
    )


@require_GET
def api_network(request):
    return JsonResponse(_load_bundle("network"))
