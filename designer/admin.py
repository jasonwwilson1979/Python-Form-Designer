from django.contrib import admin

from .models import ChatMessage, CodeSnippet, FormProject, ProjectShare


@admin.register(FormProject)
class FormProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "is_public", "allow_copy", "updated_at")
    list_filter = ("is_public", "allow_copy")
    search_fields = ("name", "owner__username", "description")
    readonly_fields = ("share_token", "created_at", "updated_at")


@admin.register(CodeSnippet)
class CodeSnippetAdmin(admin.ModelAdmin):
    list_display = ("name", "is_public", "language", "created_by", "copy_count", "updated_at")
    list_filter = ("is_public", "language")
    search_fields = ("name", "description", "code")
    readonly_fields = ("copy_count", "created_at", "updated_at")
    actions = ("publish_snippets", "unpublish_snippets")

    @admin.action(description="Publish selected snippets to the public library")
    def publish_snippets(self, request, queryset):
        updated = queryset.update(is_public=True)
        self.message_user(request, f"{updated} snippet(s) published to the public code library.")

    @admin.action(description="Unpublish selected snippets")
    def unpublish_snippets(self, request, queryset):
        updated = queryset.update(is_public=False)
        self.message_user(request, f"{updated} snippet(s) hidden from the public code library.")


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
