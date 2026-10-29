"""URL routes for the designer app (pages + JSON API)."""
from django.urls import path

from . import api, views

app_name = "designer"

urlpatterns = [
    # Pages
    path("", views.dashboard, name="dashboard"),
    path("healthz/", views.healthz, name="healthz"),
    path("designer/", views.new_project, name="new_project"),
    path("designer/<int:pk>/", views.project_editor, name="project"),
    path("share/<uuid:token>/", views.shared_view, name="share"),
    path("designer/<int:pk>/download/", views.project_python, name="project_python"),
    path("share/<uuid:token>/download/", views.shared_python, name="shared_python"),
    # JSON API
    path("api/projects/", api.api_projects, name="api_projects"),
    path("api/projects/<int:pk>/", api.api_project_detail, name="api_project_detail"),
    path("api/projects/<int:pk>/duplicate/", api.api_project_duplicate, name="api_project_duplicate"),
    path("api/projects/<int:pk>/share/", api.api_project_share, name="api_project_share"),
    path("api/projects/<int:pk>/chat/", api.api_project_chat, name="api_project_chat"),
    path("api/shared/<uuid:token>/import/", api.api_import_shared, name="api_import_shared"),
    path("api/chat/", api.api_lobby_chat, name="api_lobby_chat"),
    # Public code library
    path("api/snippets/", api.api_snippets, name="api_snippets"),
    path("api/snippets/<int:pk>/", api.api_snippet_detail, name="api_snippet_detail"),
    path("api/snippets/<int:pk>/copy/", api.api_snippet_copy, name="api_snippet_copy"),
]
