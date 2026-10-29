"""Authentication views: sign up, log in, log out, profile."""
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView, LogoutView
from django.shortcuts import redirect, render
from django.urls import reverse_lazy
from django.views.generic import CreateView

from .forms import ProfileForm, SignupForm


class SignupView(CreateView):
    """Create an account and log the user straight in."""

    form_class = SignupForm
    template_name = "accounts/signup.html"
    success_url = reverse_lazy("designer:dashboard")

    def form_valid(self, form):
        response = super().form_valid(form)
        login(self.request, self.object)
        messages.success(
            self.request, f"Welcome {self.object.username}! Your account is ready."
        )
        return response

    def form_invalid(self, form):
        messages.error(self.request, "Please fix the highlighted fields.")
        return super().form_invalid(form)


class FormDesignerLoginView(LoginView):
    template_name = "accounts/login.html"
    redirect_authenticated_user = True

    def form_invalid(self, form):
        messages.error(self.request, "Invalid username or password.")
        return super().form_invalid(form)


class FormDesignerLogoutView(LogoutView):
    next_page = reverse_lazy("accounts:login")


@login_required
def profile(request):
    """Show / update the signed-in user's basic details."""
    if request.method == "POST":
        form = ProfileForm(request.POST, instance=request.user)
        if form.is_valid():
            form.save()
            messages.success(request, "Profile updated.")
            return redirect("accounts:profile")
        messages.error(request, "Please fix the highlighted fields.")
    else:
        form = ProfileForm(instance=request.user)

    return render(
        request,
        "accounts/profile.html",
        {"form": form, "project_count": request.user.form_projects.count()},
    )
