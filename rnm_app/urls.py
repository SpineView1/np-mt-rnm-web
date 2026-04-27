from django.urls import path

from . import views
from .api.simulate_sbml import api_simulate_sbml


app_name = "rnm"

urlpatterns = [
    path("", views.home, name="home"),
    path("api/network/", views.api_network, name="api_network"),
    path("api/simulate/", api_simulate_sbml, name="api_simulate"),
]
