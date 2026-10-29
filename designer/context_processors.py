"""Template context available on every page."""
import hashlib
from functools import lru_cache

from django.conf import settings
from django.urls import reverse


@lru_cache(maxsize=1)
def static_fingerprint() -> str:
    """Short fingerprint of the project's static files.

    Appended to every static URL (``app.css?v=...``) so that changing a CSS or
    JS file always changes its URL - browsers can never keep serving a stale
    asset after a deploy or a code update.
    """
    digest = hashlib.sha1()
    roots = [settings.BASE_DIR / "designer" / "static", settings.BASE_DIR / "static"]
    for root in roots:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file():
                stat = path.stat()
                digest.update(
                    f"{path.name}:{stat.st_size}:{int(stat.st_mtime)}".encode("utf-8")
                )
    return digest.hexdigest()[:10]


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
        "STATIC_VERSION": static_fingerprint(),
        "LIBRARY_API": library_api,
    }

