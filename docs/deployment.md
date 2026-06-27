# Deployment

BarclaudeGateway ships as a single, versioned Docker image built only by CI on GitHub's Linux
runners and published to GHCR. You deploy it in the homelab with Portainer (or plain
`docker compose`). One container runs one process: Fastify serves the web UI **and** the `/api` +
`/v1` routes — there is no separate UI container and no reverse proxy.

## The only state to back up

- **The SQLite database** — on the `appdata` named volume (`/data/barclaudegateway.sqlite`). It holds
  your configuration and the encrypted Chronodrive credentials.
- **`BCG_MASTER_KEY`** — the 32-byte key that decrypts those credentials. It is **not** stored in the
  image or the database; you inject it at run time.

Lose the key and the DB's encrypted credentials become unreadable. Everything else (the image, the
built UI, dependencies) is rebuildable from a tag.

## The image

- **Reference:** `ghcr.io/machintrucbidule/barclaudegateway`
- **Visibility:** public — Portainer/Watchtower pull it with **no registry credentials**.
- **Tags** (published from a `vX.Y.Z` git tag): the exact `X.Y.Z` (immutable, reproducible), the
  moving `X.Y` (follows patch releases), and `latest` (newest stable release).
  - Pin `BCG_TAG=0.2.0` for a fixed, reproducible deployment (current latest stable).
  - Use `latest` (the default) to let Watchtower auto-update on each new release.
- **Base:** `node:24-slim`, runs as the non-root `node` user (uid/gid 1000).
- **Listens on** container port **8090**.

## Runtime configuration (`BCG_*`)

| Variable         | Required | Default (in image)                           | Purpose                                                                                |
| ---------------- | -------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `BCG_MASTER_KEY` | **Yes**  | — (prints a generated key & exits if absent) | 32-byte key (hex or base64) for AES-256 credential encryption. Inject as a secret/env. |
| `BCG_DB_PATH`    | No       | `/data/barclaudegateway.sqlite`              | SQLite file path. Must sit on the mounted volume.                                      |
| `BCG_PORT`       | No       | `8090`                                       | Port the container listens on.                                                         |
| `BCG_HOST`       | No       | `0.0.0.0`                                    | Bind address (all interfaces, so the ESP32 on the LAN can reach it).                   |
| `BCG_UI_DIR`     | No       | `/app/packages/frontend/dist`                | Where the bundled SPA lives. Leave as-is.                                              |

Generate the master key once and keep it safe:

```sh
openssl rand -hex 32
```

**First-run assist:** you don't have to generate it by hand. If you start the container with **no**
`BCG_MASTER_KEY`, it prints a ready-to-use generated key with copy-and-restart instructions to the
container logs, then exits — for example:

```
BCG_MASTER_KEY is not set — the app cannot start without it.

Here is a freshly generated 32-byte key you can use:

    BCG_MASTER_KEY=2f1c…<64 hex chars>…9ab0

Next steps:
  1. Copy the value above into the BCG_MASTER_KEY environment variable …
  2. Restart the container / app.
```

Copy that value into `BCG_MASTER_KEY` (stack env / compose `.env` / container env) and redeploy. The
key is **only printed, never written to disk or the database** — keep it safe yourself (lose it and the
encrypted credentials become unreadable). The app does not start until the key is set in the
environment.

## Deploy with Portainer

1. In Portainer: **Stacks → Add stack**, paste [`deploy/stack.yml`](../deploy/stack.yml).
2. In the stack's **Environment variables**, set:
   - `BCG_MASTER_KEY` — the value from `openssl rand -hex 32` (required).
   - `BCG_TAG` — `latest` (auto-update) or a pinned version like `0.2.0` (optional).
   - `BCG_PORT` — the host port to publish, if not `8090` (optional).
3. Deploy. The container starts, creates the SQLite DB on first boot, and serves the UI on the
   published port. Finish setup (Chronodrive login, destinations) in the web UI.

Because the image is public, no GHCR credentials are configured in Portainer. The
`com.centurylinklabs.watchtower.enable=true` label lets Watchtower auto-pull when the running tag
moves (relevant when `BCG_TAG=latest`).

**First run:** until you save your Chronodrive credentials, the dashboard shows an informational
"not configured yet" message (not an error) and the app makes no upstream calls — this is expected
(DECISION-016, v0.0.2+). Enter your credentials on the Config page to bring it online.

## Deploy with plain Docker Compose

```sh
export BCG_MASTER_KEY="$(openssl rand -hex 32)"   # store this safely, reuse it every time
docker compose -f deploy/stack.yml up -d
```

## Persistence and permissions

- The DB lives on the **named volume `appdata`**, mounted at `/data`. A fresh named volume inherits
  the `node` (uid 1000) ownership baked into the image, so the non-root process can write.
- If you instead **bind-mount a host directory** to `/data`, Docker does not change its ownership —
  `chown 1000:1000 <hostdir>` first, or the container can't write the DB.

## Backup and restore

The database runs in **SQLite WAL mode**: `/data` holds three files —
`barclaudegateway.sqlite`, `barclaudegateway.sqlite-wal`, and `barclaudegateway.sqlite-shm`. Recent
writes live in the `-wal` file until they are checkpointed, so **copying only the `.sqlite` file can
lose your latest changes**. Back up the whole DB consistently, one of two ways:

```sh
# Option A (recommended): a consistent single-file snapshot via SQLite's online backup.
docker exec <container> sh -c \
  'node -e "const {DatabaseSync}=require(\"node:sqlite\"); new DatabaseSync(\"/data/barclaudegateway.sqlite\").exec(\"VACUUM INTO \\\"/data/backup.sqlite\\\"\")"'
docker cp <container>:/data/backup.sqlite ./barclaudegateway-backup.sqlite

# Option B: stop the container first (so the WAL is checkpointed and quiescent), then copy all three.
docker stop <container>
docker cp <container>:/data/barclaudegateway.sqlite     ./
docker cp <container>:/data/barclaudegateway.sqlite-wal ./   # may be absent after a clean stop
docker cp <container>:/data/barclaudegateway.sqlite-shm ./   # may be absent after a clean stop
docker start <container>
```

Keep `BCG_MASTER_KEY` somewhere safe **alongside** the backup — without it the encrypted credentials
in the DB are unreadable (that separation is the whole point; see "The only state to back up").

**Restore:** stop the container, copy the backed-up file(s) back into the volume as
`barclaudegateway.sqlite` (a single-file snapshot from Option A needs no `-wal`/`-shm`), ensure they
are owned by `node` (`chown 1000:1000`), set the **same** `BCG_MASTER_KEY` as when the backup was
made, and start the container.

## Health and restart

- **Healthcheck:** baked into the image, hitting `GET /livez` (returns 200 whenever the HTTP server
  is up). It deliberately does **not** use `GET /health`, which runs a live Chronodrive self-test and
  returns 503 when the upstream is merely down — that would wrongly mark a healthy container as
  unhealthy. Use `GET /health` yourself only as a Chronodrive readiness check.
- **Restart policy:** `unless-stopped` — the container comes back after a host reboot or a crash,
  unless you stopped it on purpose.

## Cutting a release

Releases are built only by CI. To publish a new version:

```sh
# bump the version in the root package.json, commit, then (example for 0.2.0):
git tag v0.2.0
git push origin v0.2.0
```

The tag triggers `.github/workflows/release.yml`, which builds the image on a Linux runner and pushes
the exact `X.Y.Z`, the moving `X.Y`, and `latest` to GHCR. Routine pushes/PRs only run the checks
pipeline (and, when the Dockerfile changes, a no-push build check) — they never publish. Current
latest stable: **0.2.0**.
