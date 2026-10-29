#!/bin/sh
# ---------------------------------------------------------------------------
# Container entrypoint: wait for the DB, migrate, collect static, then serve.
# ---------------------------------------------------------------------------
set -e

echo "[entrypoint] Python Form Designer starting..."

: "${DATA_DIR:=/data}"
export DATA_DIR
mkdir -p "$DATA_DIR"

case "${DB_ENGINE:-sqlite}" in
    postgres|postgresql)
        echo "[entrypoint] waiting for PostgreSQL at ${DB_HOST:-db}:${DB_PORT:-5432} ..."
        python - <<'PY'
import os
import socket
import sys
import time

host = os.environ.get("DB_HOST", "db")
port = int(os.environ.get("DB_PORT", "5432"))
for attempt in range(1, 61):
    try:
        with socket.create_connection((host, port), timeout=3):
            print("[entrypoint] database is reachable")
            sys.exit(0)
    except OSError:
        print(f"[entrypoint] waiting for {host}:{port} ({attempt}/60)")
        time.sleep(2)
print("[entrypoint] database did not become available in time", file=sys.stderr)
sys.exit(1)
PY
        ;;
    *)
        echo "[entrypoint] using SQLite at ${DB_PATH:-$DATA_DIR/db.sqlite3}"
        ;;
esac

echo "[entrypoint] applying database migrations..."
python manage.py migrate --noinput

echo "[entrypoint] collecting static files..."
python manage.py collectstatic --noinput

if [ -n "${DJANGO_SUPERUSER_USERNAME:-}" ] && [ -n "${DJANGO_SUPERUSER_PASSWORD:-}" ]; then
    echo "[entrypoint] ensuring superuser '${DJANGO_SUPERUSER_USERNAME}' exists..."
    python - <<'PY'
import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model

username = os.environ["DJANGO_SUPERUSER_USERNAME"]
password = os.environ["DJANGO_SUPERUSER_PASSWORD"]
email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "")

User = get_user_model()
if User.objects.filter(username=username).exists():
    print(f"[entrypoint] user '{username}' already exists - leaving it untouched")
else:
    User.objects.create_superuser(username=username, email=email, password=password)
    print(f"[entrypoint] created superuser '{username}'")
PY
fi

if [ "$1" = "gunicorn" ]; then
    shift
    echo "[entrypoint] starting gunicorn on port ${PORT:-8000}..."
    exec gunicorn config.wsgi:application \
        --bind "0.0.0.0:${PORT:-8000}" \
        --workers "${GUNICORN_WORKERS:-3}" \
        --threads "${GUNICORN_THREADS:-2}" \
        --timeout "${GUNICORN_TIMEOUT:-60}" \
        --access-logfile - \
        --error-logfile - \
        "$@"
fi

exec "$@"
