"""Template context available on every page."""
from django.conf import settings
from django.urls import reverse


def _url_with_id(url_name, placeholder="__ID__"):
    """Build a URL template the JS can substitute the snippet id into."""
    return reverse(url_name, args=[0]).replace("/0/", f"/{placeholder}/")


def site_context(request):
    library_api = None
    if request.user.is_authenticated:
        # Bootstrap for the shared code library dialog (dashboard, profile, ...)
        library_api = {
            "api": {
                "snippets": reverse("designer:api_snippets"),
                "snippetTemplate": _url_with_id("designer:api_snippet_detail"),
                "snippetCopyTemplate": _url_with_id("designer:api_snippet_copy"),
            },
            "user": {
                "username": request.user.get_username(),
                "isStaff": bool(request.user.is_staff),
            },
            "loginUrl": reverse("accounts:login"),
        }

    return {
        "SITE_NAME": settings.SITE_NAME,
        "APP_VERSION": settings.APP_VERSION,
        "LIBRARY_API": library_api,
    }

