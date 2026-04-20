from django.urls import path

from . import views

app_name = "rnm"

urlpatterns = [
    path("", views.overview, name="overview"),
    path("network/", views.network, name="network"),
    path("simulate/", views.simulate, name="simulate"),
    path("falsification/", views.falsification, name="falsification"),
    path("transitions/", views.transitions, name="transitions"),
    path("rescue/", views.rescue, name="rescue"),
    path("downloads/", views.downloads, name="downloads"),

    # JSON APIs
    path("api/network/", views.api_network, name="api_network"),
    path("api/simulate/", views.api_simulate, name="api_simulate"),
    path("api/rescue/custom/", views.api_rescue_custom, name="api_rescue_custom"),
]
