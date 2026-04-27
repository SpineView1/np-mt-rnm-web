"""Tests for the POST /api/simulate/ endpoint."""
from __future__ import annotations

import json

import pytest
from django.test import RequestFactory

from rnm_app.api.simulate_sbml import api_simulate_sbml


@pytest.mark.django_db
def test_api_simulate_normal_default():
    rf = RequestFactory()
    req = rf.post(
        "/api/simulate/",
        data=json.dumps({"regime": {"Hypo": 0.01, "NL": 0.80, "HL": 0.01}}),
        content_type="application/json",
    )
    resp = api_simulate_sbml(req)
    assert resp.status_code == 200
    data = json.loads(resp.content)
    assert "time" in data
    assert "final" in data
    assert data["final"]["SOX9"] > 0.5


@pytest.mark.django_db
def test_api_simulate_validation_unknown_clamp():
    rf = RequestFactory()
    req = rf.post(
        "/api/simulate/",
        data=json.dumps({"clamps": {"NOT_A_SPECIES": 0.5}}),
        content_type="application/json",
    )
    resp = api_simulate_sbml(req)
    assert resp.status_code == 400


@pytest.mark.django_db
def test_api_simulate_validation_too_many_clamps():
    rf = RequestFactory()
    req = rf.post(
        "/api/simulate/",
        data=json.dumps({"clamps": {f"X{i}": 0.5 for i in range(11)}}),
        content_type="application/json",
    )
    resp = api_simulate_sbml(req)
    assert resp.status_code == 400


@pytest.mark.django_db
def test_api_simulate_validation_regime_out_of_range():
    rf = RequestFactory()
    req = rf.post(
        "/api/simulate/",
        data=json.dumps({"regime": {"Hypo": 1.5, "NL": 0.5, "HL": 0.0}}),
        content_type="application/json",
    )
    resp = api_simulate_sbml(req)
    assert resp.status_code == 400


@pytest.mark.django_db
def test_api_simulate_default_regime_is_normal():
    rf = RequestFactory()
    req = rf.post("/api/simulate/", data=json.dumps({}), content_type="application/json")
    resp = api_simulate_sbml(req)
    assert resp.status_code == 200
    data = json.loads(resp.content)
    # Default regime is Normal — SOX9 should converge high.
    assert data["final"]["SOX9"] > 0.5
    assert data["n_species_total"] >= 100


@pytest.mark.django_db
def test_api_simulate_invalid_json():
    rf = RequestFactory()
    req = rf.post("/api/simulate/", data="not json", content_type="application/json")
    resp = api_simulate_sbml(req)
    assert resp.status_code == 400


@pytest.mark.django_db
def test_api_simulate_t_end_too_large():
    rf = RequestFactory()
    req = rf.post(
        "/api/simulate/",
        data=json.dumps({"t_end": 9999}),
        content_type="application/json",
    )
    resp = api_simulate_sbml(req)
    assert resp.status_code == 400
