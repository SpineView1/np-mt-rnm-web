"""Tests for the tellurium-backed SBML runner."""
from __future__ import annotations

import pytest

from rnm_app.compute.sbml_runner import get_runner, simulate


@pytest.mark.django_db
def test_simulate_normal_regime():
    runner = get_runner()
    out = simulate(
        runner,
        regime={"Hypo": 0.01, "NL": 0.80, "HL": 0.01},
        clamps={},
        t_end=100,
        n_points=11,
    )
    assert "time" in out
    assert len(out["time"]) == 11
    # SOX9 high under Normal
    assert out["final"]["SOX9"] > 0.5
    # ROS low under Normal
    assert out["final"]["ROS"] < 0.1


@pytest.mark.django_db
def test_simulate_hyper_regime():
    runner = get_runner()
    out = simulate(
        runner,
        regime={"Hypo": 0.01, "NL": 0.01, "HL": 0.80},
        clamps={},
        t_end=100,
        n_points=11,
    )
    # Under Hyper, ROS should be high
    assert out["final"]["ROS"] > 0.5
    # SOX9 collapses
    assert out["final"]["SOX9"] < 0.1


@pytest.mark.django_db
def test_simulate_clamp_pins_initial():
    runner = get_runner()
    out = simulate(
        runner,
        regime={"Hypo": 0.01, "NL": 0.80, "HL": 0.01},
        clamps={"SOX9": 0.0},
        t_end=100,
        n_points=11,
    )
    assert out["initial"]["SOX9"] == 0.0
