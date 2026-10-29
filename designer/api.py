"""JSON API used by the designer UI and dashboard (plain fetch/XHR calls)."""
import json
import uuid
from functools import wraps

from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.views.decorators.http import require_http_methods

from .models import ChatMessage, FormProject, ProjectShare

User = get_user_model()


class ApiError(Exception):
    """Raised inside API views to return a clean JSON error."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def api_error(message, status=400):
    return JsonResponse({"ok": False, "error": message}, status=status)


def api(fn):
    """Translate ApiError into a JSON response."""

    @wraps(fn)
    def wrapper(request, *args, **kwargs):
        try:
            return fn(request, *args, **kwargs)
        except ApiError as exc:
            return api_error(exc.message, exc.status)

    return wrapper


def login_required_api(fn):
    """Like login_required but returns 401 JSON instead of an HTML redirect."""

    @wraps(fn)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return api_error("You need to log in first.", 401)
        return fn(request, *args, **kwargs)

    return wrapper


def read_json(request):
    """Parse the request body as a JSON object."""
    if not request.body:
        return {}
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError("Invalid JSON payload.") from exc
    if not isinstance(payload, dict):
        raise ApiError("JSON payload must be an object.")
    return payload


def validate_payload_size(data):
    """Guard against huge designer payloads."""
    try:
        size = len(json.dumps(data))
    except (TypeError, ValueError) as exc:
        raise ApiError("Form data must be JSON serialisable.") from exc
    if size > settings.MAX_PROJECT_PAYLOAD_BYTES:
        raise ApiError("This form is too large to save.", 413)


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------
def project_summary(project, request):
    data = project.data if isinstance(project.data, dict) else {}
    controls = data.get("controls") or []
    return {
        "id": project.id,
        "name": project.name,
        "owner": project.owner.username,
        "is_public": project.is_public,
        "allow_copy": project.allow_copy,
        "can_edit": project.user_can_edit(request.user),
        "is_owner": project.is_owner(request.user),
        "control_count": len(controls) if isinstance(controls, list) else 0,
        "share_token": str(project.share_token),
        "share_url": request.build_absolute_uri(project.get_share_url()),
        "url": reverse("designer:project", args=[project.id]),
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
    }


def project_detail(project, request):
    payload = project_summary(project, request)
    payload.update(
        {
            "description": project.description,
            "data": project.data,
            "python_code": project.python_code,
            "shares": [
                {"id": share.id, "username": share.user.username, "can_edit": share.can_edit}
                for share in project.shares.select_related("user")
            ],
        }
    )
    return payload


def message_dict(message, user):
    payload = message.as_dict()
    payload["is_mine"] = bool(
        user and user.is_authenticated and message.author_id == user.id
    )
    return payload


def serialize_messages(queryset, user):
    return [message_dict(message, user) for message in queryset]


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
@require_http_methods(["GET", "POST"])
@api
@login_required_api
def api_projects(request):
    """GET: list my forms + forms shared with me. POST: create a form."""
    if request.method == "GET":
        owned = FormProject.objects.filter(owner=request.user).select_related("owner")
        shared = (
            FormProject.objects.filter(shares__user=request.user)
            .exclude(owner=request.user)
            .select_related("owner")
            .distinct()
        )
        return JsonResponse(
            {
                "ok": True,
                "owned": [project_summary(p, request) for p in owned],
                "shared": [project_summary(p, request) for p in shared],
            }
        )

    payload = read_json(request)
    name = str(payload.get("name") or "").strip()[:150] or "Untitled form"
    data = payload.get("data") or {}
    validate_payload_size(data)
    project = FormProject.objects.create(
        owner=request.user,
        name=name,
        description=str(payload.get("description") or "")[:5000],
        data=data,
        python_code=str(payload.get("python_code") or ""),
    )
    return JsonResponse({"ok": True, "project": project_detail(project, request)}, status=201)


@require_http_methods(["GET", "PATCH", "POST", "DELETE"])
@api
@login_required_api
def api_project_detail(request, pk):
    """Read / update / delete one form."""
    project = get_object_or_404(FormProject, pk=pk)

    if request.method == "GET":
        if not project.user_can_view(request.user):
            raise ApiError("You do not have access to this form.", 403)
        return JsonResponse({"ok": True, "project": project_detail(project, request)})

    if request.method == "DELETE":
        if not (project.is_owner(request.user) or request.user.is_staff):
            raise ApiError("Only the owner can delete this form.", 403)
        project.delete()
        return JsonResponse({"ok": True, "deleted": pk})

    if not project.user_can_edit(request.user):
        raise ApiError("You do not have edit access to this form.", 403)

    payload = read_json(request)
    if "name" in payload:
        name = str(payload.get("name") or "").strip()[:150]
        if name:
            project.name = name
    if "description" in payload:
        project.description = str(payload.get("description") or "")[:5000]
    if "data" in payload:
        data = payload.get("data") or {}
        validate_payload_size(data)
        project.data = data
    if "python_code" in payload:
        project.python_code = str(payload.get("python_code") or "")[:500000]
    if "is_public" in payload and project.is_owner(request.user):
        project.is_public = bool(payload.get("is_public"))
    if "allow_copy" in payload and project.is_owner(request.user):
        project.allow_copy = bool(payload.get("allow_copy"))
    project.save()
    return JsonResponse({"ok": True, "project": project_detail(project, request)})


@require_http_methods(["POST"])
@api
@login_required_api
def api_project_duplicate(request, pk):
    """Copy any form I can see into my own account."""
    project = get_object_or_404(FormProject, pk=pk)
    if not project.user_can_view(request.user):
        raise ApiError("You do not have access to this form.", 403)
    copy = FormProject.objects.create(
        owner=request.user,
        name=f"{project.name} (copy)"[:150],
        description=project.description,
        data=project.data,
        python_code=project.python_code,
    )
    return JsonResponse({"ok": True, "project": project_detail(copy, request)}, status=201)


@require_http_methods(["POST"])
@api
@login_required_api
def api_import_shared(request, token):
    """Import a shared/public form (identified by its share token) into my account."""
    try:
        token = uuid.UUID(str(token))
    except (ValueError, TypeError) as exc:
        raise ApiError("Invalid share link.", 404) from exc
    project = get_object_or_404(FormProject, share_token=token)
    if not project.user_can_view(request.user):
        raise ApiError("You do not have access to this form.", 403)
    if not project.allow_copy and not project.is_owner(request.user):
        raise ApiError("The owner disabled copying for this form.", 403)
    copy = FormProject.objects.create(
        owner=request.user,
        name=f"{project.name} (copy)"[:150],
        description=project.description,
        data=project.data,
        python_code=project.python_code,
    )
    return JsonResponse({"ok": True, "project": project_detail(copy, request)}, status=201)


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------
@require_http_methods(["POST"])
@api
@login_required_api
def api_project_share(request, pk):
    """Owner-only share management: share, unshare, visibility, new link."""
    project = get_object_or_404(FormProject, pk=pk)
    if not (project.is_owner(request.user) or request.user.is_staff):
        raise ApiError("Only the owner can manage sharing for this form.", 403)

    payload = read_json(request)
    action = str(payload.get("action") or "share").lower()

    if action == "share":
        username = str(payload.get("username") or "").strip()
        if not username:
            raise ApiError("Enter the username you want to share with.")
        user = User.objects.filter(username__iexact=username).first()
        if user is None:
            raise ApiError("No user found with that username.", 404)
        if user == project.owner:
            raise ApiError("You already own this form.")
        share, created = ProjectShare.objects.update_or_create(
            project=project,
            user=user,
            defaults={"can_edit": bool(payload.get("can_edit"))},
        )
        return JsonResponse(
            {"ok": True, "created": created, "project": project_detail(project, request)}
        )

    if action == "unshare":
        username = str(payload.get("username") or "").strip()
        deleted, _ = ProjectShare.objects.filter(
            project=project, user__username__iexact=username
        ).delete()
        if not deleted:
            raise ApiError("That user does not have access.", 404)
        return JsonResponse({"ok": True, "project": project_detail(project, request)})

    if action == "visibility":
        project.is_public = bool(payload.get("is_public"))
        if "allow_copy" in payload:
            project.allow_copy = bool(payload.get("allow_copy"))
        project.save(update_fields=["is_public", "allow_copy", "updated_at"])
        return JsonResponse({"ok": True, "project": project_detail(project, request)})

    if action == "regenerate":
        project.share_token = uuid.uuid4()
        project.save(update_fields=["share_token", "updated_at"])
        return JsonResponse({"ok": True, "project": project_detail(project, request)})

    raise ApiError("Unknown share action.")


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------
def _chat_messages(request, project):
    """GET handler shared by the project room and the lobby."""
    after = request.GET.get("after", "")
    queryset = ChatMessage.objects.filter(project=project).select_related("author")
    if after.isdigit():
        messages = list(queryset.filter(id__gt=int(after))[: settings.CHAT_PAGE_SIZE])
    else:
        messages = list(
            reversed(list(queryset.order_by("-id")[: settings.CHAT_PAGE_SIZE]))
        )
    return JsonResponse(
        {
            "ok": True,
            "messages": serialize_messages(messages, request.user),
            "can_post": request.user.is_authenticated,
        }
    )


def _chat_post(request, project):
    """POST handler shared by the project room and the lobby."""
    if not request.user.is_authenticated:
        raise ApiError("Log in to send messages.", 401)
    payload = read_json(request)
    body = str(payload.get("body") or "").strip()
    if not body:
        raise ApiError("Message cannot be empty.")
    if len(body) > 2000:
        raise ApiError("Message is too long (2000 characters max).")
    message = ChatMessage.objects.create(
        project=project,
        author=request.user,
        author_name=request.user.username,
        body=body,
    )
    return JsonResponse(
        {"ok": True, "message": message_dict(message, request.user)}, status=201
    )


@require_http_methods(["GET", "POST"])
@api
def api_project_chat(request, pk):
    """Chat room for a single form (readable on public/share pages)."""
    project = get_object_or_404(FormProject, pk=pk)
    if not project.user_can_view(request.user):
        raise ApiError("You do not have access to this form.", 403)
    if request.method == "GET":
        return _chat_messages(request, project)
    return _chat_post(request, project)


@require_http_methods(["GET", "POST"])
@api
@login_required_api
def api_lobby_chat(request):
    """Global chat room for all signed-in users."""
    if request.method == "GET":
        return _chat_messages(request, None)
    return _chat_post(request, None)

