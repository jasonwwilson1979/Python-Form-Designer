"""Tests for the designer app: permissions, API, sharing, chat and pages."""
import json
import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from .models import ChatMessage, CodeSnippet, FormProject, ProjectShare

User = get_user_model()

SAMPLE_DATA = {
    "fileName": "Form1",
    "formStructure": {"name": "Form1", "text": "Python Form", "size": "800, 600"},
    "controls": [
        {"id": "control1", "type": "button", "style": "left:10px", "innerHTML": "OK"}
    ],
    "eventHandlers": {},
    "visualLogic": {},
}


class ProjectPermissionTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("owner", password="pass12345")
        self.other = User.objects.create_user("other", password="pass12345")
        self.project = FormProject.objects.create(
            owner=self.owner, name="Demo", data=SAMPLE_DATA
        )

    def test_owner_has_full_access(self):
        self.assertTrue(self.project.user_can_view(self.owner))
        self.assertTrue(self.project.user_can_edit(self.owner))
        self.assertTrue(self.project.is_owner(self.owner))

    def test_stranger_has_no_access(self):
        self.assertFalse(self.project.user_can_view(self.other))
        self.assertFalse(self.project.user_can_edit(self.other))
        self.assertFalse(self.project.user_can_view(None))

    def test_share_with_view_rights(self):
        ProjectShare.objects.create(project=self.project, user=self.other)
        self.assertTrue(self.project.user_can_view(self.other))
        self.assertFalse(self.project.user_can_edit(self.other))

    def test_share_with_edit_rights(self):
        ProjectShare.objects.create(project=self.project, user=self.other, can_edit=True)
        self.assertTrue(self.project.user_can_edit(self.other))

    def test_public_project_is_readable_by_anyone(self):
        self.project.is_public = True
        self.project.save()
        self.assertTrue(self.project.user_can_view(None))
        self.assertTrue(self.project.user_can_view(self.other))
        self.assertFalse(self.project.user_can_edit(self.other))

    def test_share_token_is_unique_uuid(self):
        other_project = FormProject.objects.create(owner=self.owner, name="Two")
        self.assertIsInstance(self.project.share_token, uuid.UUID)
        self.assertNotEqual(self.project.share_token, other_project.share_token)


class ProjectApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("owner", password="pass12345")
        self.other = User.objects.create_user("other", password="pass12345")
        self.client.force_login(self.owner)

    def test_login_required(self):
        self.client.logout()
        response = self.client.get(reverse("designer:api_projects"))
        self.assertEqual(response.status_code, 401)
        self.assertFalse(response.json()["ok"])

    def test_create_and_list_projects(self):
        response = self.client.post(
            reverse("designer:api_projects"),
            data=json.dumps({"name": "My form", "data": SAMPLE_DATA}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        project_id = response.json()["project"]["id"]

        listing = self.client.get(reverse("designer:api_projects")).json()
        self.assertEqual(len(listing["owned"]), 1)
        self.assertEqual(listing["owned"][0]["id"], project_id)
        self.assertEqual(listing["shared"], [])

    def test_update_project(self):
        project = FormProject.objects.create(owner=self.owner, name="Old", data={})
        response = self.client.patch(
            reverse("designer:api_project_detail", args=[project.id]),
            data=json.dumps({"name": "New", "data": SAMPLE_DATA, "python_code": "print(1)"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        project.refresh_from_db()
        self.assertEqual(project.name, "New")
        self.assertEqual(project.python_code, "print(1)")
        self.assertEqual(len(project.data["controls"]), 1)

    def test_cannot_update_someone_elses_project(self):
        project = FormProject.objects.create(owner=self.other, name="Theirs", data={})
        response = self.client.patch(
            reverse("designer:api_project_detail", args=[project.id]),
            data=json.dumps({"name": "Hacked"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_only_owner_can_delete(self):
        project = FormProject.objects.create(owner=self.other, name="Theirs", data={})
        response = self.client.delete(reverse("designer:api_project_detail", args=[project.id]))
        self.assertEqual(response.status_code, 403)

        mine = FormProject.objects.create(owner=self.owner, name="Mine", data={})
        response = self.client.delete(reverse("designer:api_project_detail", args=[mine.id]))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(FormProject.objects.filter(pk=mine.pk).exists())

    def test_invalid_json_payload(self):
        response = self.client.post(
            reverse("designer:api_projects"), data="{not json", content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid JSON", response.json()["error"])


class SharingApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("owner", password="pass12345")
        self.other = User.objects.create_user("other", password="pass12345")
        self.project = FormProject.objects.create(
            owner=self.owner, name="Shared", data=SAMPLE_DATA
        )
        self.client.force_login(self.owner)

    def post_share(self, payload):
        return self.client.post(
            reverse("designer:api_project_share", args=[self.project.id]),
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_share_with_user(self):
        response = self.post_share({"action": "share", "username": "other", "can_edit": True})
        self.assertEqual(response.status_code, 200)
        share = ProjectShare.objects.get(project=self.project, user=self.other)
        self.assertTrue(share.can_edit)
        self.assertIn("other", [s["username"] for s in response.json()["project"]["shares"]])

    def test_share_with_unknown_user(self):
        response = self.post_share({"action": "share", "username": "ghost"})
        self.assertEqual(response.status_code, 404)

    def test_unshare(self):
        ProjectShare.objects.create(project=self.project, user=self.other)
        response = self.post_share({"action": "unshare", "username": "other"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(ProjectShare.objects.filter(project=self.project).exists())

    def test_visibility_toggle(self):
        response = self.post_share(
            {"action": "visibility", "is_public": True, "allow_copy": False}
        )
        self.assertEqual(response.status_code, 200)
        self.project.refresh_from_db()
        self.assertTrue(self.project.is_public)
        self.assertFalse(self.project.allow_copy)

    def test_regenerate_token(self):
        old_token = self.project.share_token
        response = self.post_share({"action": "regenerate"})
        self.assertEqual(response.status_code, 200)
        self.project.refresh_from_db()
        self.assertNotEqual(old_token, self.project.share_token)

    def test_non_owner_cannot_share(self):
        self.client.force_login(self.other)
        response = self.post_share({"action": "share", "username": "owner"})
        self.assertEqual(response.status_code, 403)

    def test_duplicate_project(self):
        response = self.client.post(
            reverse("designer:api_project_duplicate", args=[self.project.id])
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(FormProject.objects.filter(owner=self.owner).count(), 2)

    def test_import_shared_project(self):
        ProjectShare.objects.create(project=self.project, user=self.other)
        self.client.force_login(self.other)
        response = self.client.post(
            reverse("designer:api_import_shared", args=[self.project.share_token])
        )
        self.assertEqual(response.status_code, 201)
        copy = FormProject.objects.get(owner=self.other)
        self.assertEqual(copy.data["controls"][0]["id"], "control1")

    def test_import_requires_access(self):
        self.client.force_login(self.other)
        response = self.client.post(
            reverse("designer:api_import_shared", args=[self.project.share_token])
        )
        self.assertEqual(response.status_code, 403)

    def test_import_blocked_when_copying_disabled(self):
        self.project.allow_copy = False
        self.project.is_public = True
        self.project.save()
        self.client.force_login(self.other)
        response = self.client.post(
            reverse("designer:api_import_shared", args=[self.project.share_token])
        )
        self.assertEqual(response.status_code, 403)


class ChatApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("owner", password="pass12345")
        self.other = User.objects.create_user("other", password="pass12345")
        self.project = FormProject.objects.create(owner=self.owner, name="Chatty", data={})

    def test_project_chat_post_and_read(self):
        self.client.force_login(self.owner)
        url = reverse("designer:api_project_chat", args=[self.project.id])
        response = self.client.post(
            url, data=json.dumps({"body": "Hello there"}), content_type="application/json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["message"]["is_mine"])

        payload = self.client.get(url).json()
        self.assertEqual(len(payload["messages"]), 1)
        self.assertEqual(payload["messages"][0]["body"], "Hello there")
        self.assertEqual(payload["messages"][0]["author"], "owner")

    def test_after_parameter_returns_only_new_messages(self):
        first = ChatMessage.objects.create(
            project=self.project, author=self.owner, author_name="owner", body="one"
        )
        ChatMessage.objects.create(
            project=self.project, author=self.owner, author_name="owner", body="two"
        )
        self.client.force_login(self.owner)
        url = reverse("designer:api_project_chat", args=[self.project.id])
        payload = self.client.get(url, {"after": first.id}).json()
        self.assertEqual([m["body"] for m in payload["messages"]], ["two"])

    def test_stranger_cannot_read_project_chat(self):
        self.client.force_login(self.other)
        response = self.client.get(reverse("designer:api_project_chat", args=[self.project.id]))
        self.assertEqual(response.status_code, 403)

    def test_anonymous_can_read_public_chat_but_not_post(self):
        self.project.is_public = True
        self.project.save()
        url = reverse("designer:api_project_chat", args=[self.project.id])
        self.assertEqual(self.client.get(url).status_code, 200)
        response = self.client.post(
            url, data=json.dumps({"body": "hi"}), content_type="application/json"
        )
        self.assertEqual(response.status_code, 401)

    def test_lobby_chat_requires_login(self):
        response = self.client.get(reverse("designer:api_lobby_chat"))
        self.assertEqual(response.status_code, 401)

        self.client.force_login(self.owner)
        response = self.client.post(
            reverse("designer:api_lobby_chat"),
            data=json.dumps({"body": "hi everyone"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["message"]["project"])
        self.assertEqual(ChatMessage.objects.filter(project__isnull=True).count(), 1)

    def test_empty_message_is_rejected(self):
        self.client.force_login(self.owner)
        response = self.client.post(
            reverse("designer:api_project_chat", args=[self.project.id]),
            data=json.dumps({"body": "   "}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)


class CodeSnippetApiTests(TestCase):
    """The public code library is curated: only admins may publish."""

    def setUp(self):
        self.admin = User.objects.create_user("boss", password="pass12345", is_staff=True)
        self.user = User.objects.create_user("coder", password="pass12345")
        self.snippet = CodeSnippet.objects.create(
            name="Center window",
            description="Centres the window on screen",
            code="x = (screen.winfo_screenwidth() - 800) // 2",
            created_by=self.admin,
        )

    def test_login_required(self):
        response = self.client.get(reverse("designer:api_snippets"))
        self.assertEqual(response.status_code, 401)

    def test_regular_user_reads_public_library(self):
        self.client.force_login(self.user)
        payload = self.client.get(reverse("designer:api_snippets")).json()
        self.assertEqual(len(payload["snippets"]), 1)
        self.assertEqual(payload["snippets"][0]["name"], "Center window")
        self.assertFalse(payload["can_publish"])
        self.assertFalse(payload["snippets"][0]["can_edit"])

    def test_regular_user_cannot_publish(self):
        self.client.force_login(self.user)
        response = self.client.post(
            reverse("designer:api_snippets"),
            data=json.dumps({"name": "Mine", "code": "print(1)"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(CodeSnippet.objects.count(), 1)

    def test_admin_publishes_snippet(self):
        self.client.force_login(self.admin)
        response = self.client.post(
            reverse("designer:api_snippets"),
            data=json.dumps({"name": "Message box", "code": "messagebox.showinfo('hi')"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["snippet"]["is_public"])
        self.assertTrue(response.json()["snippet"]["can_edit"])
        self.assertEqual(CodeSnippet.objects.count(), 2)

    def test_publish_requires_name_and_code(self):
        self.client.force_login(self.admin)
        for payload in ({"name": "", "code": "x"}, {"name": "x", "code": "  "}):
            response = self.client.post(
                reverse("designer:api_snippets"),
                data=json.dumps(payload),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 400)

    def test_duplicate_public_name_rejected(self):
        self.client.force_login(self.admin)
        response = self.client.post(
            reverse("designer:api_snippets"),
            data=json.dumps({"name": "center window", "code": "x = 1"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)

    def test_admin_can_edit_and_delete(self):
        self.client.force_login(self.admin)
        url = reverse("designer:api_snippet_detail", args=[self.snippet.id])
        response = self.client.patch(
            url,
            data=json.dumps({"description": "Updated", "is_public": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.snippet.refresh_from_db()
        self.assertEqual(self.snippet.description, "Updated")

        response = self.client.delete(url)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(CodeSnippet.objects.filter(pk=self.snippet.pk).exists())

    def test_regular_user_cannot_edit_or_delete(self):
        self.client.force_login(self.user)
        url = reverse("designer:api_snippet_detail", args=[self.snippet.id])
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(
            self.client.patch(
                url, data=json.dumps({"name": "hacked"}), content_type="application/json"
            ).status_code,
            403,
        )
        self.assertEqual(self.client.delete(url).status_code, 403)

    def test_private_draft_hidden_from_regular_users(self):
        draft = CodeSnippet.objects.create(
            name="Draft idea", code="pass", is_public=False, created_by=self.admin
        )
        self.client.force_login(self.user)
        payload = self.client.get(reverse("designer:api_snippets")).json()
        self.assertEqual([s["name"] for s in payload["snippets"]], ["Center window"])
        self.assertEqual(
            self.client.get(reverse("designer:api_snippet_detail", args=[draft.id])).status_code,
            403,
        )

        self.client.force_login(self.admin)
        payload = self.client.get(reverse("designer:api_snippets")).json()
        self.assertEqual(len(payload["snippets"]), 2)

    def test_copy_into_local_library_counts(self):
        self.client.force_login(self.user)
        response = self.client.post(
            reverse("designer:api_snippet_copy", args=[self.snippet.id])
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["snippet"]["code"], self.snippet.code)
        self.snippet.refresh_from_db()
        self.assertEqual(self.snippet.copy_count, 1)


class PageTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("owner", password="pass12345")
        self.other = User.objects.create_user("other", password="pass12345")
        self.project = FormProject.objects.create(
            owner=self.owner, name="Pagey", data=SAMPLE_DATA, python_code="print('hi')"
        )

    def test_dashboard_nav_has_the_code_library_button(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("designer:dashboard"))
        self.assertContains(response, 'id="codeLibraryNavBtn"')
        self.assertContains(response, "code-library.js")
        self.assertContains(response, 'id="library-api"')
        bootstrap = response.context["LIBRARY_API"]
        self.assertEqual(bootstrap["api"]["snippets"], reverse("designer:api_snippets"))
        self.assertIn("__ID__", bootstrap["api"]["snippetTemplate"])
        self.assertIn("__ID__", bootstrap["api"]["snippetCopyTemplate"])
        self.assertFalse(bootstrap["user"]["isStaff"])

    def test_code_library_button_order_is_between_my_forms_and_profile(self):
        self.client.force_login(self.owner)
        html = self.client.get(reverse("designer:dashboard")).content.decode()
        my_forms = html.index("My forms")
        library = html.index('id="codeLibraryNavBtn"')
        profile = html.index(reverse("accounts:profile"))
        self.assertLess(my_forms, library)
        self.assertLess(library, profile)

    def test_admin_flag_is_exposed_in_the_library_bootstrap(self):
        self.admin = User.objects.create_user("boss", password="pass12345", is_staff=True)
        self.client.force_login(self.admin)
        response = self.client.get(reverse("designer:dashboard"))
        self.assertTrue(response.context["LIBRARY_API"]["user"]["isStaff"])

    def test_anonymous_visitors_get_no_library_bootstrap(self):
        response = self.client.get(reverse("accounts:login"))
        self.assertIsNone(response.context["LIBRARY_API"])
        self.assertNotContains(response, "code-library.js")

    def test_profile_page_also_has_the_library_button(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("accounts:profile"))
        self.assertContains(response, 'id="codeLibraryNavBtn"')

    def test_static_assets_are_cache_busted(self):
        """Static URLs carry a fingerprint so a deploy can never be masked by
        a browser (or proxy) serving an old CSS/JS file."""
        self.client.force_login(self.owner)
        response = self.client.get(reverse("designer:new_project"))
        self.assertContains(response, "designer-bridge.js?v=")
        self.assertContains(response, "designer-extras.css?v=")
        self.assertContains(response, "chat.js?v=")
        self.assertTrue(response.context["STATIC_VERSION"])

    def test_dashboard_static_assets_are_cache_busted(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("designer:dashboard"))
        self.assertContains(response, "code-library.js?v=")
        self.assertContains(response, "app.css?v=")

    def test_snippet_picker_lists_both_libraries(self):
        """Insert Code Snippet (Add Script) shows the local and the published
        snippets in one dialog, so nothing has to be fetched or tab-switched."""
        self.client.force_login(self.owner)
        response = self.client.get(reverse("designer:new_project"))
        content = response.content.decode()
        self.assertIn("picker-mode", content)             # CSS rules + JS toggle
        self.assertIn("picker-only", content)             # caption for the local list
        self.assertIn("window.pfdLoadPublicSnippets", content)  # bridge fetch hook
        self.assertIn("codeLibraryPickerBanner", content)

    def test_visual_logic_generator_emits_python_not_javascript(self):
        """The Logic Builder writes real Python: no JavaScript braces left behind,
        widget state read the Tkinter way, and empty blocks filled with pass."""
        template = (
            settings.BASE_DIR / "designer" / "templates" / "designer" / "designer.html"
        ).read_text(encoding="utf-8")
        self.assertNotIn('"} else:', template)
        self.assertNotIn('"} elif ', template)
        self.assertNotIn('+ "}\\n"', template)
        self.assertIn("pendingBodyIndent", template)
        self.assertIn('"pass\\n"', template)
        self.assertIn("_var.get()", template)
        self.assertIn(".cget('state')", template)

    def test_designer_wires_containers_context_menu_and_item_editors(self):
        """The menu/dropdown editors, container drops, stacking order and
        copy/paste must stay wired in the designer script."""
        template = (
            settings.BASE_DIR / "designer" / "templates" / "designer" / "designer.html"
        ).read_text(encoding="utf-8")
        for expected in (
            "saveMenuItemsFromPanel",
            "saveDropdownOptionsFromPanel",
            "CONTAINER_TYPES",
            "findDropTarget",
            "reparentControl",
            "restackControls",
            "controlMenuActions",
            "canvasMenuActions",
            "snapshotControl",
            "instantiateSnapshot",
            "pasteControlProperties",
            "selectAllControls",
            "const master = (parentElement",
        ):
            self.assertIn(expected, template)

    def test_visual_logic_item_actions_and_menu_handlers(self):
        """ComboBox/ListBox item actions are offered and generated, and menu item
        logic produces the handler the menu command points at."""
        template = (
            settings.BASE_DIR / "designer" / "templates" / "designer" / "designer.html"
        ).read_text(encoding="utf-8")
        for expected in (
            '<option value="addItem">Add Item</option>',
            '<option value="removeItem">Remove Item</option>',
            '<option value="clearItems">Clear Items</option>',
            '<option value="setValue">Select Item</option>',
            "ADD ITEM (",
            "REMOVE ITEM (",
            "CLEAR ITEMS (",
            "SELECT ITEM (",
            "_items = list(",
            "_handler(self):",
            "lookupEventType",
        ):
            self.assertIn(expected, template)

    def test_dashboard_requires_login(self):
        response = self.client.get(reverse("designer:dashboard"))
        self.assertEqual(response.status_code, 302)
        self.assertIn("/accounts/login/", response["Location"])

    def test_dashboard_lists_own_and_shared_projects(self):
        ProjectShare.objects.create(project=self.project, user=self.other)
        self.client.force_login(self.other)
        response = self.client.get(reverse("designer:dashboard"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Shared with me")
        self.assertContains(response, "Pagey")

    def test_new_project_page_renders_designer(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("designer:new_project"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "app-bootstrap")
        self.assertContains(response, "Python Form Designer")
        self.assertFalse(response.context["bootstrap"]["readOnly"])

    def test_editor_renders_saved_data_and_bootstrap(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("designer:project", args=[self.project.id]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "control1")
        bootstrap = response.context["bootstrap"]
        self.assertEqual(bootstrap["mode"], "edit")
        self.assertFalse(bootstrap["readOnly"])
        self.assertEqual(bootstrap["project"]["id"], self.project.id)

    def test_read_only_editor_for_shared_viewer(self):
        ProjectShare.objects.create(project=self.project, user=self.other)
        self.client.force_login(self.other)
        response = self.client.get(reverse("designer:project", args=[self.project.id]))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["bootstrap"]["readOnly"])
        self.assertContains(response, "readonly-banner")

    def test_share_page_is_public_when_enabled(self):
        self.project.is_public = True
        self.project.save()
        response = self.client.get(reverse("designer:share", args=[self.project.share_token]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Read-only view")

    def test_share_page_hidden_when_private(self):
        response = self.client.get(reverse("designer:share", args=[self.project.share_token]))
        self.assertEqual(response.status_code, 404)

    def test_unknown_project_is_404(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("designer:project", args=[9999]))
        self.assertEqual(response.status_code, 404)

    def test_download_python_code(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("designer:project_python", args=[self.project.id]))
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertIn("print", response.content.decode())

    def test_shared_python_download_respects_privacy(self):
        response = self.client.get(
            reverse("designer:shared_python", args=[self.project.share_token])
        )
        self.assertEqual(response.status_code, 404)
        self.project.is_public = True
        self.project.save()
        response = self.client.get(
            reverse("designer:shared_python", args=[self.project.share_token])
        )
        self.assertEqual(response.status_code, 200)



