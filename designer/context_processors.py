"""Template context available on every page."""
from django.conf import settings


def site_context(request):
    return {
        "SITE_NAME": settings.SITE_NAME,
        "APP_VERSION": settings.APP_VERSION,
    }
