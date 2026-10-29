"""HTML views: dashboard, designer editor, public share page, code download."""
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.urls import reverse

from .models import FormProject


def healthz(request):
    """Lightweight health endpoint used by the container healthcheck."""
    return JsonResponse({"ok": True, "version": settings.APP_VERSION})


def _url_with_id(url_name, placeholder="__ID__"):
    """Build a URL template the JS can substitute the project id into."""
    return reverse(url_name, args=[0]).replace("/0/", f"/{placeholder}/")


def build_bootstrap(request, project=None, mode="new"):
    """Everything the designer page needs to talk to the backend."""
    if project is None:
        # A brand new (unsaved) form is editable by the signed-in user.
        can_edit = request.user.is_authenticated
    else:
        can_edit = project.user_can_edit(request.user)
    project_payload = None
    if project is not None:
        project_payload = {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "data": project.data,
            "pythonCode": project.python_code,
            "isPublic": project.is_public,
            "allowCopy": project.allow_copy,
            "shareToken": str(project.share_token),
            "shareUrl": request.build_absolute_uri(project.get_share_url()),
            "owner": project.owner.username,
            "canEdit": can_edit,
            "isOwner": project.is_owner(request.user),
            "updatedAt": project.updated_at.isoformat(),
            "url": reverse("designer:project", args=[project.id]),
        }

    return {
        "mode": mode,
        "appVersion": settings.APP_VERSION,
        "siteName": settings.SITE_NAME,
        "readOnly": not can_edit,
        "project": project_payload,
        "user": {
            "isAuthenticated": request.user.is_authenticated,
            "username": request.user.get_username() if request.user.is_authenticated else "",
            "isStaff": bool(request.user.is_authenticated and request.user.is_staff),
        },
        "api": {
            "projects": reverse("designer:api_projects"),
            "projectTemplate": _url_with_id("designer:api_project_detail"),
            "shareTemplate": _url_with_id("designer:api_project_share"),
            "duplicateTemplate": _url_with_id("designer:api_project_duplicate"),
            "chatTemplate": _url_with_id("designer:api_project_chat"),
            "lobbyChat": reverse("designer:api_lobby_chat"),
            "importSharedTemplate": reverse(
                "designer:api_import_shared",
                args=["00000000-0000-0000-0000-000000000000"],
            ).replace("00000000-0000-0000-0000-000000000000", "__TOKEN__"),
        },
        "urls": {
            "dashboard": reverse("designer:dashboard"),
            "newProject": reverse("designer:new_project"),
            "projectTemplate": _url_with_id("designer:project"),
            "login": reverse("accounts:login"),
            "logout": reverse("accounts:logout"),
            "signup": reverse("accounts:signup"),
            "downloadPythonTemplate": _url_with_id("designer:project_python"),
            "downloadPythonShared": reverse(
                "designer:shared_python",
                args=["00000000-0000-0000-0000-000000000000"],
            ).replace("00000000-0000-0000-0000-000000000000", "__TOKEN__"),
        },
    }



@login_required
def dashboard(request):
    """List the signed-in user's forms plus the ones shared with them."""
    owned = FormProject.objects.filter(owner=request.user).select_related("owner")
    shared = (
        FormProject.objects.filter(shares__user=request.user)
        .exclude(owner=request.user)
        .select_related("owner")
        .distinct()
    )
    context = {
        "owned_projects": owned,
        "shared_projects": shared,
        "owned_count": owned.count(),
        "lobby_chat_url": reverse("designer:api_lobby_chat"),
        "dashboard_bootstrap": {
            "api": {
                "projects": reverse("designer:api_projects"),
                "project": _url_with_id("designer:api_project_detail"),
                "duplicate": _url_with_id("designer:api_project_duplicate"),
                "lobbyChat": reverse("designer:api_lobby_chat"),
            },
            "urls": {
                "project": _url_with_id("designer:project"),
                "download": _url_with_id("designer:project_python"),
                "newProject": reverse("designer:new_project"),
                "login": reverse("accounts:login"),
            },
            "user": {
                "isAuthenticated": request.user.is_authenticated,
                "username": request.user.get_username(),
            },
        },
    }
    return render(request, "designer/dashboard.html", context)


@login_required
def new_project(request):
    """Blank designer for a brand new form."""
    return render(
        request,
        "designer/designer.html",
        {"project": None, "bootstrap": build_bootstrap(request, None, "new")},
    )


@login_required
def project_editor(request, pk):
    """Open a saved form (read-only when the user only has view rights)."""
    project = get_object_or_404(FormProject, pk=pk)
    if not project.user_can_view(request.user):
        raise Http404("Form not found")
    mode = "edit" if project.user_can_edit(request.user) else "view"
    return render(
        request,
        "designer/designer.html",
        {"project": project, "bootstrap": build_bootstrap(request, project, mode)},
    )


def shared_view(request, token):
    """Public (share link) view of a form - read-only unless the visitor can edit."""
    project = get_object_or_404(FormProject, share_token=token)
    if not project.user_can_view(request.user):
        raise Http404("Form not found")
    mode = "edit" if project.user_can_edit(request.user) else "view"
    return render(
        request,
        "designer/designer.html",
        {"project": project, "bootstrap": build_bootstrap(request, project, mode)},
    )


def _python_response(project):
    code = project.python_code or "# This form has not generated any code yet.\n"
    safe_name = "".join(
        ch for ch in project.name if ch.isalnum() or ch in " _-"
    ).strip().replace(" ", "_") or "form"
    response = HttpResponse(code, content_type="text/x-python; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{safe_name}.py"'
    return response


@login_required
def project_python(request, pk):
    """Download the generated Tkinter code of a form I can see."""
    project = get_object_or_404(FormProject, pk=pk)
    if not project.user_can_view(request.user):
        raise Http404("Form not found")
    return _python_response(project)


def shared_python(request, token):
    """Download the generated code of a shared form."""
    project = get_object_or_404(FormProject, share_token=token)
    if not project.user_can_view(request.user):
        raise Http404("Form not found")
    return _python_response(project)

