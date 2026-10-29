# Python Form Designer (Django website)

A multi-user web version of the original single-file visual Tkinter form designer.
Design forms by dragging controls, get live Python/Tkinter code, then save the
result to your account, share it with a link or another user, and chat about it.

## Features

| Area | What you get |
| --- | --- |
| **Visual designer** | The original drag-and-drop designer (labels, entries, buttons, check/radio buttons, combo boxes, list boxes, frames, label frames, toplevels, menus), live Python code preview, visual logic builder, resize/collapse the code preview |
| **Editing controls** | Click a control to select it, drag to move, drag the handles to resize, **Delete key / top-bar Delete button / right-click → Delete** to remove it, right-click → Clear Canvas to empty the form, click the canvas (or its header) to edit the form's own properties |
| **Accounts** | Sign up / log in / log out, profile page, Django admin for user management |
| **Per-user forms** | Every form belongs to a user; the dashboard lists *my forms* and *shared with me* |
| **Save to database** | Explicit **project name field in the header** (never follows the last clicked control), `Save` button, `Ctrl+S`, and auto-save every 20 s while there are unsaved changes |
| **Save to the browser** | The `Browser` button (and the original toolbar `Save` icon) stores a draft in `localStorage`; auto-draft for brand-new forms with restore prompt |
| **Sharing** | Public read-only link, per-user sharing with *view only* / *can edit* rights, revoke access, regenerate the link, optional "visitors may copy this form" |
| **Chat** | Per-form chat room (drawer, unread badge, 4 s polling) plus a community lobby chat on the dashboard |
| **Code library** | Browser-cached snippets for everyone (save/edit/insert), **plus a public code library stored in the database that only administrators can publish to**; any user can browse it and copy snippets into their own library |
| **Copy to my account** | Anyone with a share link can clone the form into their own account (when the owner allows it) |
| **Export** | Download the generated `.py`, or use the designer's JSON export/import |
| **Deployment** | Docker image (Gunicorn + WhiteNoise), `docker-compose.yml`, Portainer stack, GHCR publishing workflow, SQLite or PostgreSQL |

---

## 1. Run it locally (development)

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # macOS / Linux

pip install -r requirements.txt

python manage.py migrate
python manage.py createsuperuser   # optional, for /admin/
python manage.py runserver
```

Open <http://127.0.0.1:8000/> - you are redirected to the login page.
Use **Sign up free** to create an account, then **New form** to open the designer.

Useful commands:

```bash
python manage.py test              # 64 tests
python manage.py check
python manage.py collectstatic --noinput
```

Local data lives in `./data/db.sqlite3` (git-ignored).

---

## 2. Deploy with Docker Compose

```bash
cp .env.example .env          # then edit DJANGO_SECRET_KEY etc.
docker compose up -d --build
```

* App: <http://localhost:8000/> (change the port with `APP_PORT`).
* SQLite data is kept in the named volume `formdesigner-data` (mounted at `/data`).
* Want PostgreSQL instead?

```bash
# in .env
DB_ENGINE=postgres
DB_PASSWORD=something-strong

docker compose --profile postgres up -d --build
```

Useful commands:

```bash
docker compose logs -f web
docker compose exec web python manage.py createsuperuser
docker compose down                # volumes are kept
```

The container entrypoint automatically waits for the database, runs
`migrate`, collects static files, optionally creates a superuser (see
`DJANGO_SUPERUSER_*`) and then starts Gunicorn on port 8000.
A `/healthz/` endpoint is exposed for health checks.

---

## 3. Deploy from GitHub through Portainer

### 3a. Put the code on GitHub

```bash
git init
git add .
git commit -m "Django version of the Python Form Designer"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Pushing to `main` triggers `.github/workflows/docker-publish.yml`, which runs the
test suite and publishes the image to the GitHub Container Registry:

```
ghcr.io/<you>/<repo>:latest
```

### 3b. Portainer - option A: let Portainer build from the Git repo

1. Portainer -> **Stacks** -> **Add stack** -> **Repository**.
2. *Repository URL*: `https://github.com/<you>/<repo>`
   (*Repository reference*: `refs/heads/main`)
3. *Compose path*: `docker-compose.yml`
4. Under **Environment variables** add at least:
   * `DJANGO_SECRET_KEY` = a long random string
   * `DJANGO_ALLOWED_HOSTS` = `forms.example.com,localhost`
   * `DJANGO_CSRF_TRUSTED_ORIGINS` = `https://forms.example.com` (when behind HTTPS)
   * optional: `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_PASSWORD`
5. **Deploy the stack**. Portainer clones the repo, builds the image and starts it.
6. Enable *GitOps updates* (polling or webhook) if you want Portainer to
   redeploy automatically on every push.

### 3c. Portainer - option B: pull the prebuilt GHCR image

1. Edit `portainer-stack.yml` and replace `ghcr.io/change_me_owner/...` with your
   real image, e.g. `ghcr.io/jason/pythonformdesigner:latest`.
2. Portainer -> **Stacks** -> **Add stack** -> **Repository**,
   *Compose path*: `portainer-stack.yml`, set the environment variables as above.
3. (Private package only) Add a **Registry** in Portainer:
   *Registry type* `Custom`, URL `ghcr.io`, username = your GitHub user,
   password = a Personal Access Token with `read:packages`.
4. Deploy.

> Behind a reverse proxy (Nginx/Traefik/Synology) terminate TLS there and forward
> to port 8000. Keep `DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_TRUSTED_ORIGINS`
> aligned with the public URL, and set `DJANGO_SECURE_COOKIES=True` when using HTTPS.

### 3d. If a stack build fails

Portainer only shows the last line of the build log (`... did not complete
successfully: exit code: 1`); the real error is a few lines above it. Two
properties of this image make a build failure far less likely:

* **Static files are collected twice.** The build runs `collectstatic` as a
  *best effort* step, and `entrypoint.sh` collects them again when the container
  starts. A build-environment problem (network share, unusual file permissions,
  read-only context, full disk) therefore appears as
  `WARNING: build-time collectstatic failed ...` in the build log instead of
  stopping the deployment, and the container log shows the full traceback at
  start-up.
* **The entrypoint is executed with `/bin/sh`**, so the container never depends
  on the executable bit of `entrypoint.sh` being preserved by the build context.

Reproduce a failing build locally with the complete output:

```bash
docker build --progress=plain --no-cache -t pfd-debug .
docker run --rm pfd-debug python manage.py collectstatic --noinput --verbosity 2
```

Common causes:

| Symptom in the build log | Fix |
| --- | --- |
| `No space left on device` | Free space on the Portainer host (`docker system prune -a`) |
| `Permission denied` / `Operation not permitted` | Build context on a Windows path or network share without POSIX permissions - clone the repo on the Docker host instead |
| pip download errors / timeouts | The build host cannot reach PyPI - use the prebuilt GHCR image (option B above) |
| `SyntaxError` / `ImproperlyConfigured` | A repository file is broken or has the wrong line endings (`.gitattributes` keeps the repo at LF) |

---

## 4. Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | insecure dev key | **Change in production** |
| `DJANGO_DEBUG` | `True` locally, `False` in the image | Debug mode |
| `DJANGO_ALLOWED_HOSTS` | `*` (dev) | Comma separated hostnames |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | empty | Full origins, e.g. `https://forms.example.com` |
| `DJANGO_SECURE_COOKIES` | `False` | Secure session/CSRF cookies (HTTPS) |
| `SITE_NAME` | `Python Form Designer` | Branding in the UI |
| `APP_VERSION` | `2.0.0` | Shown in the navbar/status bar |
| `DATA_DIR` | `/data` in Docker | Where SQLite + writable data lives |
| `DB_ENGINE` | `sqlite` | `sqlite` or `postgres` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_HOST` / `DB_PORT` | - | PostgreSQL connection |
| `DB_PATH` | `<DATA_DIR>/db.sqlite3` | SQLite file location |
| `DJANGO_SUPERUSER_USERNAME` / `_PASSWORD` / `_EMAIL` | empty | Superuser created on start (email optional) |
| `GUNICORN_WORKERS` / `GUNICORN_THREADS` | `3` / `2` | Gunicorn tuning |
| `APP_PORT` | `8000` | Host port published by compose |

---

## 5. Project layout

```
config/                     Django project (env-driven settings, urls, wsgi/asgi)
accounts/                   Sign up / log in / log out / profile
designer/
  models.py                 FormProject, ProjectShare, ChatMessage, CodeSnippet
  api.py                    JSON API (projects, sharing, chat, import)
  views.py                  Dashboard, designer, share page, .py download, healthz
  urls.py                   All routes
  templates/designer/
    designer.html           The visual designer (converted from the original HTML)
    dashboard.html          My forms + shared with me + lobby chat
  static/designer/
    css/app.css             Website chrome (nav, cards, chat, modals, toasts)
    css/designer-extras.css Designer-specific additions (toolbar actions, read-only)
    js/chat.js              Reusable polling chat widget
    js/designer-bridge.js   Save/load to Django, sharing, chat, read-only mode
    js/dashboard.js         Dashboard actions + lobby chat
templates/base.html         Shared layout for the account pages
legacy/Pythonformbuilder.html  The original standalone single-file designer
Dockerfile / entrypoint.sh  Production image (Gunicorn + WhiteNoise)
docker-compose.yml          Self-hosted stack (SQLite or PostgreSQL profile)
portainer-stack.yml         Stack that pulls the prebuilt GHCR image
.github/workflows/          CI: tests + publish image to GHCR
```

## 6. How the designer talks to Django

The designer page renders a `bootstrap` JSON blob (`<script id="app-bootstrap">`)
with the project id, its data, permissions and all API URLs. `designer-bridge.js`
then:

* calls `window.applyFormData(data)` (exposed by the designer script) to restore a saved form;
* calls `window.pfdGetProjectData()` to serialise the canvas before saving;
* saves with `POST /api/projects/` (first save) or `PATCH /api/projects/<id>/` (updates);
* polls the form chat and manages the share modal.

If JavaScript is unavailable the designer still works as a local-only tool.

## 7. HTTP API

All endpoints return JSON. Authentication is the normal Django session cookie;
POST/PATCH/DELETE requests need the `X-CSRFToken` header (the pages include a
`<meta name="csrf-token">`).

| Method | URL | Description |
| --- | --- | --- |
| `GET` | `/api/projects/` | `{owned: [...], shared: [...]}` |
| `POST` | `/api/projects/` | Create a form (`name`, `data`, `python_code`) |
| `GET` | `/api/projects/<id>/` | Full form (data + shares + share url) |
| `PATCH` | `/api/projects/<id>/` | Update name/data/python_code/visibility |
| `DELETE` | `/api/projects/<id>/` | Delete (owner only) |
| `POST` | `/api/projects/<id>/duplicate/` | Copy to my account |
| `POST` | `/api/projects/<id>/share/` | `action`: `share`, `unshare`, `visibility`, `regenerate` |
| `GET`/`POST` | `/api/projects/<id>/chat/` | Read / post messages in the form room |
| `GET`/`POST` | `/api/chat/` | Lobby chat (signed-in users) |
| `POST` | `/api/shared/<token>/import/` | Copy a shared form into my account |
| `GET` | `/api/snippets/` | Public code library (staff also see unpublished drafts) |
| `POST` | `/api/snippets/` | Publish a snippet (**staff only**) |
| `GET`/`PATCH`/`DELETE` | `/api/snippets/<id>/` | Read (public) / edit / delete (**staff only** to change) |
| `POST` | `/api/snippets/<id>/copy/` | Copy a public snippet into the browser library (counts copies) |
| `GET` | `/healthz/` | Health check for Docker/Portainer |

## 7b. The code library

The **Code Library** button lives in the top bar of the designer (right of
*My forms*) and in the site nav on *My forms* / profile pages (between
*My forms* and your profile), so you can grab a snippet without opening the
designer. Both open the same dialog.

The **Code Library tab inside the Logic Builder** (double-click a control) lists
the same two libraries side by side - your browser snippets and the published
ones - so you can insert code straight into a control's script with one click
(*Insert* drops the snippet into the script editor and switches to the Script
tab; *Copy to my library* saves a public snippet locally). That tab is only for
finding and inserting code, so the "add snippet" form is not repeated there.

The **Add Script dialog** (Logic Builder -> Visual Logic -> *Add Script*) has an
**Insert Code Snippet** button on the left of its footer: it opens the Code
Library as a picker (banner *"Choose a snippet to insert into your script"*, with
a Cancel), and pressing **Insert** on any local or public snippet puts its code
into the script box and returns you to the Add Script dialog, ready to press OK.

There are two layers, shown as two tabs (the dialog always fits the screen: its
header, tabs and search stay visible while the lists scroll, and the one search
box filters **both** libraries by name, description and code):

1. **Your own snippets ("My snippets" tab - browser cache).** Everything you save
   lives in your browser (`localStorage`) exactly as before - add, edit, search,
   insert and delete them; they are included in the Backup Cache export.
2. **The public code library ("Public library" tab - database).** Snippets stored
   in the `CodeSnippet` table and shared with every signed-in user. Because it is
   curated:
   * **Administrators** (staff users) can publish, edit, unpublish and delete
     them - either from the dialog (the publish panel, which can prefill from one
     of your own snippets) or from `/admin/` (bulk "Publish selected snippets" /
     "Unpublish" actions).
   * **Everyone else** can browse the public library and press
     **Copy to my library** to add a snippet to their own browser cache (or
     *Copy code* to copy the code to the clipboard). They cannot change the
     shared copy.
   * Each card shows its author, how many times it has been copied, and hides the
     code behind a **Show code** toggle to keep the list compact.

To make a user an administrator: `/admin/` → Users → select the user →
tick *Staff status* (and *Superuser status* if they should manage everything).

## 8. Data, backups and admin

* **SQLite** (default): `/data/db.sqlite3` inside the `formdesigner-data` volume.
  Back up with `docker run --rm -v formdesigner-data:/data -v "$PWD":/backup alpine tar czf /backup/pfd-data.tgz -C /data .`
* **PostgreSQL**: set `DB_ENGINE=postgres` and use `pg_dump` / `pg_restore`.
* **Admin**: `/admin/` - manage users, forms, shares, chat messages and the
  public code library (`CodeSnippet`, with bulk publish/unpublish actions).
* The designer also keeps browser drafts in `localStorage`
  (`form_<name>` for the classic Save dialog, `pfd_draft_*` for auto-drafts) and
  can export/import forms as JSON.

## 9. Production checklist

- [ ] Set a strong `DJANGO_SECRET_KEY`
- [ ] `DJANGO_DEBUG=False` (already the default in the image)
- [ ] `DJANGO_ALLOWED_HOSTS` = your hostname(s)
- [ ] `DJANGO_CSRF_TRUSTED_ORIGINS` = `https://your-host` when behind HTTPS
- [ ] `DJANGO_SECURE_COOKIES=True` when serving HTTPS
- [ ] Use PostgreSQL for multi-user/high-traffic deployments
- [ ] Back up the volume (or the database) on a schedule
- [ ] Put a TLS reverse proxy in front of the container


