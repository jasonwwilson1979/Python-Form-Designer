"""Account URLs."""
from django.urls import path

from . import views

app_name = "accounts"

urlpatterns = [
    path("login/", views.FormDesignerLoginView.as_view(), name="login"),
    path("logout/", views.FormDesignerLogoutView.as_view(), name="logout"),
    path("signup/", views.SignupView.as_view(), name="signup"),
    path("profile/", views.profile, name="profile"),
]
