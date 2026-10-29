"""
ASGI config for the Python Form Designer project.

Chat uses HTTP polling (see designer/api.py) so plain WSGI/Gunicorn sync
workers are enough - this ASGI entry point is provided for completeness.
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_asgi_application()
