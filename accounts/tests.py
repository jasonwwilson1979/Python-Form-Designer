"""Tests for the accounts app."""
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

User = get_user_model()


class SignupTests(TestCase):
    def test_signup_creates_and_logs_in_user(self):
        response = self.client.post(
            reverse("accounts:signup"),
            data={
                "username": "newbie",
                "email": "newbie@example.com",
                "password1": "super-secret-123",
                "password2": "super-secret-123",
            },
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], reverse("designer:dashboard"))
        user = User.objects.get(username="newbie")
        self.assertEqual(user.email, "newbie@example.com")
        self.assertEqual(int(self.client.session["_auth_user_id"]), user.pk)

    def test_duplicate_username_is_rejected(self):
        User.objects.create_user("taken", password="pass12345")
        response = self.client.post(
            reverse("accounts:signup"),
            data={
                "username": "taken",
                "email": "other@example.com",
                "password1": "super-secret-123",
                "password2": "super-secret-123",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "already taken")
        self.assertEqual(User.objects.count(), 1)

    def test_duplicate_email_is_rejected(self):
        User.objects.create_user("first", email="dup@example.com", password="pass12345")
        response = self.client.post(
            reverse("accounts:signup"),
            data={
                "username": "second",
                "email": "dup@example.com",
                "password1": "super-secret-123",
                "password2": "super-secret-123",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "already exists")


class LoginTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("loginuser", password="pass12345")

    def test_login_page_renders(self):
        response = self.client.get(reverse("accounts:login"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Log in")

    def test_login_with_valid_credentials(self):
        response = self.client.post(
            reverse("accounts:login"), data={"username": "loginuser", "password": "pass12345"}
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], reverse("designer:dashboard"))

    def test_login_with_bad_password(self):
        response = self.client.post(
            reverse("accounts:login"), data={"username": "loginuser", "password": "nope"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Invalid username or password")

    def test_logout_requires_post(self):
        self.client.force_login(self.user)
        get_response = self.client.get(reverse("accounts:logout"))
        self.assertEqual(get_response.status_code, 405)
        post_response = self.client.post(reverse("accounts:logout"))
        self.assertEqual(post_response.status_code, 302)


class ProfileTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("profiler", password="pass12345")

    def test_profile_requires_login(self):
        response = self.client.get(reverse("accounts:profile"))
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse("accounts:login"), response["Location"])

    def test_profile_update(self):
        self.client.force_login(self.user)
        response = self.client.post(
            reverse("accounts:profile"),
            data={"first_name": "Ada", "last_name": "Lovelace", "email": "ada@example.com"},
        )
        self.assertEqual(response.status_code, 302)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Ada")
        self.assertEqual(self.user.email, "ada@example.com")
