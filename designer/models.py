"""Data model for the Python Form Designer website."""
import uuid

from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone


class FormProject(models.Model):
    """A saved form design (the JSON produced by the visual designer)."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="form_projects",
    )
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    #: Designer state: {formStructure: {...}, controls: [...], eventHandlers: {...}, visualLogic: {...}}
    data = models.JSONField(default=dict, blank=True)
    #: Last generated Tkinter code (kept so list/share pages can show it without re-running JS)
    python_code = models.TextField(blank=True)
    is_public = models.BooleanField(
        default=False, help_text="Anyone with the share link can open this form."
    )
    allow_copy = models.BooleanField(
        default=True, help_text="Visitors of the share link may copy this form to their account."
    )
    share_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)
        indexes = [models.Index(fields=["owner", "-updated_at"])]

    def __str__(self) -> str:  # pragma: no cover - repr helper
        return f"{self.name} ({self.owner.username})"

    # -- permissions -------------------------------------------------------
    def share_for(self, user):
        """Return the ProjectShare row for ``user`` (or None)."""
        if not user or not user.is_authenticated:
            return None
        return self.shares.filter(user=user).select_related("user").first()

    def user_can_view(self, user) -> bool:
        if self.is_public:
            return True
        if not user or not user.is_authenticated:
            return False
        if self.owner_id == user.id or user.is_staff:
            return True
        return self.shares.filter(user=user).exists()

    def user_can_edit(self, user) -> bool:
        if not user or not user.is_authenticated:
            return False
        if self.owner_id == user.id or user.is_staff:
            return True
        share = self.share_for(user)
        return bool(share and share.can_edit)

    def is_owner(self, user) -> bool:
        return bool(user and user.is_authenticated and self.owner_id == user.id)

    def get_share_url(self) -> str:
        return reverse("designer:share", args=[self.share_token])

    def touch(self):
        """Bump updated_at without triggering a full save."""
        FormProject.objects.filter(pk=self.pk).update(updated_at=timezone.now())


class ProjectShare(models.Model):
    """Explicit share of a project with another registered user."""

    project = models.ForeignKey(
        FormProject, on_delete=models.CASCADE, related_name="shares"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shared_projects"
    )
    can_edit = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("project", "user")
        ordering = ("user__username",)

    def __str__(self) -> str:  # pragma: no cover - repr helper
        return f"{self.project.name} -> {self.user.username}"


class CodeSnippet(models.Model):
    """A reusable code snippet.

    Snippets with ``is_public=True`` form the shared "public code library" and
    can only be created/edited by staff (administrators).  Regular users keep
    their own snippets in their browser cache and can copy public ones locally.
    """

    name = models.CharField(max_length=150)
    description = models.CharField(max_length=300, blank=True)
    code = models.TextField()
    language = models.CharField(max_length=40, default="python")
    is_public = models.BooleanField(
        default=True,
        help_text="Published to the shared public code library (admins only).",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="code_snippets",
    )
    copy_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name", "id")
        constraints = [
            models.UniqueConstraint(
                fields=["name"],
                condition=models.Q(is_public=True),
                name="unique_public_snippet_name",
            )
        ]

    def __str__(self) -> str:  # pragma: no cover - repr helper
        visibility = "public" if self.is_public else "draft"
        return f"{self.name} ({visibility})"

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "code": self.code,
            "language": self.language,
            "is_public": self.is_public,
            "created_by": self.created_by.username if self.created_by_id else "system",
            "copy_count": self.copy_count,
            "updated_at": self.updated_at.isoformat(),
        }


class ChatMessage(models.Model):
    """Chat message either inside a project room or in the public lobby."""

    project = models.ForeignKey(
        FormProject,
        on_delete=models.CASCADE,
        related_name="chat_messages",
        null=True,
        blank=True,
        help_text="Empty for the global lobby chat.",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="chat_messages",
        null=True,
        blank=True,
    )
    #: Snapshot of the username so deleted accounts keep readable history.
    author_name = models.CharField(max_length=150, blank=True)
    body = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")
        indexes = [models.Index(fields=["project", "id"])]

    def __str__(self) -> str:  # pragma: no cover - repr helper
        room = self.project.name if self.project_id else "lobby"
        return f"[{room}] {self.author_name}: {self.body[:40]}"

    @property
    def display_name(self) -> str:
        return self.author_name or "anonymous"

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "project": self.project_id,
            "author": self.author_name,
            "body": self.body,
            "created_at": self.created_at.isoformat(),
            "is_mine": False,  # filled in by the serializer
        }
