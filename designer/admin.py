from django.contrib import admin

from .models import ChatMessage, FormProject, ProjectShare


@admin.register(FormProject)
class FormProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "is_public", "allow_copy", "updated_at")
    list_filter = ("is_public", "allow_copy")
    search_fields = ("name", "owner__username", "description")
    readonly_fields = ("share_token", "created_at", "updated_at")


@admin.register(ProjectShare)
class ProjectShareAdmin(admin.ModelAdmin):
    list_display = ("project", "user", "can_edit", "created_at")
    search_fields = ("project__name", "user__username")


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ("created_at", "room", "author_name", "short_body")
    list_filter = ("project",)
    search_fields = ("body", "author_name")

    @admin.display(description="room")
    def room(self, obj):
        return obj.project.name if obj.project_id else "lobby"

    @admin.display(description="message")
    def short_body(self, obj):
        return obj.body[:60]
