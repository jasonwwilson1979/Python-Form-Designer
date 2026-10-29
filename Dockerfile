# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Python Form Designer - production image (Django + Gunicorn + WhiteNoise)
# ---------------------------------------------------------------------------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_SETTINGS_MODULE=config.settings

WORKDIR /app

# curl is used by the container healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt

COPY . /app

# Collect static files at build time so the image is ready to serve.  This is
# best effort on purpose: some build environments (network shares, odd file
# permissions, read-only contexts) cannot write here, and entrypoint.sh
# collects the files again when the container starts, so a failure must not
# block the whole deployment.  Any error is printed in full and the build
# continues.
RUN DJANGO_SECRET_KEY=build-only-secret DATA_DIR=/tmp/builddata \
        python manage.py collectstatic --noinput \
    || echo "WARNING: build-time collectstatic failed - static files will be collected at container start (see entrypoint.sh)"

ENV DATA_DIR=/data \
    DJANGO_DEBUG=False \
    DJANGO_ALLOWED_HOSTS=* \
    PORT=8000 \
    GUNICORN_WORKERS=3 \
    GUNICORN_THREADS=2

VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/healthz/" || exit 1

# /bin/sh is used explicitly so the container never depends on the executable
# bit of entrypoint.sh (which a Windows/network-share build context can lose).
ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
CMD ["gunicorn"]
