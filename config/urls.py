"""URL configuration for the Python Form Designer website."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.templatetags.static import static as static_url
from django.urls import include, path
from django.views.generic import RedirectView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("accounts.urls")),
    # Browsers ask for /favicon.ico directly, not only for the <link> tags, so send
    # that request to the same icon instead of answering 404.
    path(
        "favicon.ico",
        RedirectView.as_view(url=static_url("designer/img/favicon.ico"), permanent=False),
    ),
    path("", include("designer.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
