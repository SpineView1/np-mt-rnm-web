"""Pytest config for SBML-based test suite."""
from __future__ import annotations

import pytest

from rnm_app.compute.sbml_runner import get_runner


@pytest.fixture
def runner():
    """Provide a freshly-reset RoadRunner instance for each test."""
    r = get_runner()
    r.reset()
    return r
