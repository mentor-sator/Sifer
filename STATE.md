# Sifer — Build State

**Last updated:** 19 September 2026 (end of day 3)
**Phase:** P0 — Machine Roles, Toolchain, and Native Infrastructure
**Repo:** https://github.com/mentor-sator/Sifer
**Working directory:** `C:\Users\Novemba\Sifer`
**Last pushed commit:** "P0: backup age recipient, encrypted dev secrets file" (day 3; `git log -1` for the hash)

This file is the handover document. Anyone picking up Sifer — a new conversation,
a new session, a future you — should be able to read this and know exactly where
the build stands, what was decided and why, and what is blocking.

---

## 0. Day 4 — start here

**Where P0 stands:** the toolchain is installed, secrets and the age identity
work, all five native services are installed, verified, driven by `just`, and
blocked from the network by explicit firewall rules. Two age recipients exist
(workstation + offline backup) and `secrets/dev.age` holds every development
secret plus the signing certificate. What remains is the compose file, the
JS/TS tooling and CI — no more service installs, no more secrets work.

**First three commands of the day**, from `C:\Users\Novemba\Sifer`:

```
just up
just status
git log --oneline -3
```

Nothing starts on boot by design, so after a restart every service is stopped
until `just up` runs. `just status` should show five rows, all `running`, with
`Exposed` = `no` for all except `livekit`, which reads `yes` by design (4.5,
debt 11) and is covered by its firewall block rule (4.7).

**Then continue with section 9, "Next actions".** Section 7 lists everything
still open in P0; section 8 lists the debt that is deliberately carried.

---

## 1. The machine

One laptop. Every role lives on it.

| Property | Value |
| --- | --- |
| OS | Windows 11 Pro 25H2, build 26200.9457 |
| RAM | 7.8 GB |
| Disk | C: only — 237.6 GB total, ~38 GB free at P0 start |
| GPU | Intel UHD Graphics 620 (integrated, no CUDA) |
| Administrator | Yes |
| TLS-inspecting proxy | No |
| Hyper-V | Available (Pro edition) |
| Network | Wi-Fi `CANALBOX-4C2A-2G`, Windows profile **Public** |
| Smart App Control | **Off** (registry `VerifiedAndReputablePolicyState = 0`) |

### Rules for working on this machine

- **All work runs as `Novemba`, never as `Administrator`.** Per-user artefacts
  (signing certificate, credential store entries, PATH, data directories) are
  scoped to one account. Elevate via UAC only for a specific command.
- **Use the PowerShell console. Never PowerShell ISE.**
- **Never paste file contents into the prompt.** Files are written by PowerShell
  with `[IO.File]::WriteAllText(path, text, [Text.UTF8Encoding]::new($false))`
  — UTF-8, no BOM, LF. `Set-Content -Encoding UTF8` in PowerShell 5 writes a BOM
  and is not used.
- **Anything that creates or edits a project file runs inside
  `C:\Users\Novemba\Sifer`. Anything that installs a tool does not.**

### Pre-existing software that occupies default ports

Three programs from other projects were already listening on the default ports.
They are **not Sifer's and are not touched.** Sifer uses its own ports instead.

| Port | Owner | Notes |
| --- | --- | --- |
| 5432 | Older PostgreSQL, running as a Windows service (`postgres.exe`, PID varies) | Listens on `0.0.0.0` and `[::]` — reachable from the LAN |
| 6379 | Redis 3.0.504 (old Microsoft Windows port) | Listens on `0.0.0.0` and `[::]`, **no password** — reachable from the LAN |
| 6380 | Memurai app (`C:\Program Files\Memurai\memurai.exe`), bundles Redis 7.4.7 | `127.0.0.1` only, no password |

**Open recommendation:** restrict the 5432 PostgreSQL and the 6379 Redis to
`127.0.0.1`. Outside Sifer's scope, not yet done.

---

## 2. Deviations from the blueprint, and why

The three source documents assume two machines (16 GB + 8 GB), a corporate TLS
proxy, and no administrator rights. None of that holds. Each deviation below is a
decision, not an oversight.

### 2.1 One machine, three roles

- **Workstation** — unchanged.
- **Verification target** — folded in. `docker-compose.yml` is still authored and
  maintained from P0 as the deployment topology. See 2.4.
- **Agency target (P9)** — becomes a Hyper-V guest on this machine, sealed per
  Document 1 §3.5.3. **This violates §3.5.3's rule that workstation and agency
  target may never be the same machine.** Unresolved. Must be settled before P9.

### 2.2 No proxy trust configuration

Blueprint 0A step 1 is skipped. `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`,
`UV_NATIVE_TLS`, `CARGO_HTTP_CAINFO` are unnecessary.
`ELECTRON_SKIP_BINARY_DOWNLOAD` is deliberately **not** set.

### 2.3 No Ollama — both engine rows point remote

A 7B model holds ~5 GB resident, which does not fit 7.8 GB alongside an editor
and a build, and runs at a few tokens per second on UHD 620. **Both text and
vision engine rows point at a remote OpenAI-compatible endpoint during
development.** Local models become fallback rows. Carried as debt.

### 2.4 No Docker Desktop

Disk decides this. `docker-compose.yml` is still authored, pinned to the same
versions as the native stack, and never run here. Carried as debt.

### 2.5 Smart App Control off

Done. It blocked every unsigned or self-signed binary (`age-keygen` included),
and signing with the Sifer certificate did not help. **Reversible on this build**:
since the April 2026 cumulative update (KB5083769, build 26200.8116+) it can be
switched back on without a reset. It stays off for the whole time Sifer is
developed on this machine.

### 2.6 Non-default infrastructure ports

Because of section 1's pre-existing software, Sifer's native services use
non-default ports. Containers in `docker-compose.yml` keep the defaults
internally; only connection URLs differ between the two stacks.

| Service | Native port (this machine) | Container port |
| --- | --- | --- |
| PostgreSQL | **5433** | 5432 |
| Redis | **6390** | 6379 |

### 2.7 Redis from redis-windows 7.4.11 (msys2), not 7.4.x Alpine parity by build

No official Windows Redis exists. The community `redis-windows` msys2 build is
used: newest 7.4 patch, plain process, no service. Compose will pin
`redis:7.4.11-alpine` to match (confirm the tag exists when writing the file).

### 2.8 Qdrant collection deletes must be sent twice on Windows

Known, open upstream bug — qdrant/qdrant issue #5924 (reported on v1.13.2,
reproduced here on v1.12.4, no fix as of September 2026). On the Windows binary
the first `DELETE /collections/{name}` returns `Access is denied (os error 5)`:
the collection is unloaded and disappears from `GET /collections`, but its
folder stays in `storage/collections`. A second `DELETE` removes the folder.
Reproduced 5/5.

**Rule for all Sifer code:** every collection delete is sent twice; an
`Access is denied` on the first attempt is expected, an error on the second is
real. Verified 5/5 with create → upsert → delete-twice → folder gone.
Point writes, reads and searches are unaffected. Linux containers do not have
this bug.

### 2.9 Defender exclusion on the data root

`%LOCALAPPDATA%\sifer` is excluded from Microsoft Defender real-time scanning
(data only; binaries in `sifer-infra` are still scanned). Standard practice for
database data directories. **It did not fix 2.8** — recorded so nobody assumes
it did.

### 2.10 MinIO replaced by SILO (pgsty/silo)

**The blueprint's MinIO is no longer installable.** MinIO stopped publishing
community binaries and container images in late 2025, declared the community
edition in maintenance mode in December 2025, and the upstream repository was
archived read-only on **25 April 2026**. No releases, no security patches.

Sifer uses **SILO** (`pgsty/silo`), the maintained community fork of the
open-source MinIO server: active releases (2026-09-16 used here), a published
Windows amd64 binary with checksums, and deliberate compatibility with the S3
API, the `MINIO_*` environment variables, `x-minio-*` headers, `/minio/*`
routes and the `.minio.sys` on-disk format. Its client ships as `mcli`.
Matching Linux container images exist (`pgsty/silo`) for `docker-compose.yml`.

Alternatives considered and rejected: Garage (no Windows build), SeaweedFS
(needs an external metadata store), RustFS (immature), Ceph (far too heavy),
building MinIO from frozen source (we would own every future CVE).
Sifer's code speaks plain S3, so replacing the server later is cheap.

---

## 3. Toolchain — installed and verified

Installed from archives and direct installers, not package managers. `winget`
is broken (`0x8a15000f`) and not repaired.

| Tool | Version | Location |
| --- | --- | --- |
| Git | 2.55.0.windows.5 | `C:\Program Files\Git` |
| Node | 22.11.0 | `C:\Users\Novemba\AppData\Local\node` |
| npm | 11.19.0 | bundled with Node |
| pnpm | 9.15.0 | `C:\Users\Novemba\AppData\Local\pnpm\pnpm.exe` |
| Go | 1.25.5 | `C:\Program Files\Go` |
| Python | 3.12.10 | `C:\Program Files\Python312` |
| Rust / cargo | 1.82.0 | `%USERPROFILE%\.cargo\bin` |
| buf | 1.47.2 | `%LOCALAPPDATA%\sifer-bin` |
| atlas | v1.3.4 | `%LOCALAPPDATA%\sifer-bin` |
| just | 1.36.0 | `%LOCALAPPDATA%\sifer-bin` |
| age / age-keygen | 1.2.1 | `%LOCALAPPDATA%\sifer-bin` |

### Version notes

- Go 1.25.5 vs blueprint 1.23.4 — kept; the pin lives in `go.mod`.
- Python 3.12.10 vs 3.12.7 — kept; `uv` manages its own interpreter.
- Node 25.2.1 was removed for 22.11.0 (odd-numbered, breaks Electron ABI at P2).

### Abandoned

- **fnm** — shell profile hook broke silently. Removed.
- **corepack** — `ENOTDIR`, then ignored the pnpm pin. Disabled; leftover shims
  in `%APPDATA%\npm\pnpm*` deleted.
- **PowerShell ISE** — do not use.

### User-scope environment

PATH additions:
```
C:\Users\Novemba\AppData\Local\node
C:\Users\Novemba\AppData\Local\pnpm
C:\Users\Novemba\AppData\Local\sifer-bin
C:\Users\Novemba\.cargo\bin
```

`PNPM_HOME` = `C:\Users\Novemba\AppData\Local\pnpm`

---

## 4. Native infrastructure

Binaries live in `%LOCALAPPDATA%\sifer-infra`. Data lives in
`%LOCALAPPDATA%\sifer`. **Neither is inside the repository.**

| Service | Version | Binaries | Data | Bind | State |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL | 16.4 (EDB zip) | `sifer-infra\postgresql-16.4` | `sifer\pgdata` | `127.0.0.1:5433` | **Installed, verified** |
| Redis | 7.4.11 (redis-windows msys2) | `sifer-infra\redis-7.4.11` | `sifer\redis` | `127.0.0.1:6390` | **Installed, verified** |
| Qdrant | 1.12.4 (official Windows zip) | `sifer-infra\qdrant-1.12.4` | `sifer\qdrant` | `127.0.0.1:6333` HTTP, `:6334` gRPC | **Installed, verified** |
| SILO (MinIO fork) | RELEASE.2026-09-16 | `sifer-infra\silo-2026.09.16` | `sifer\silo\data` | `127.0.0.1:9000` S3, `:9001` console (also `::1`) | **Installed, verified** |
| LiveKit | 1.13.7 (official Windows zip) | `sifer-infra\livekit-1.13.7` | `sifer\livekit` | `127.0.0.1:7880` signal, `:7881` TCP media (also `::`, see debt 11) | **Installed, verified** |

"Installed, verified" means each one was proved working end to end. None of them
starts on boot: after a restart, `just up`.

Logs: `%LOCALAPPDATA%\sifer\logs\postgres.log`, `%LOCALAPPDATA%\sifer\redis\redis.log`,
`%LOCALAPPDATA%\sifer\qdrant\stdout.txt`,
`%LOCALAPPDATA%\sifer\silo\stdout.txt` and `stderr.txt`,
`%LOCALAPPDATA%\sifer\livekit\stdout.txt` and `stderr.txt`.

Client tool: `mcli` RELEASE.2026-09-16 in `sifer-infra\mcli-2026.09.16`.

**Nothing auto-starts.** After a reboot every service is stopped until `just up`.

### 4.1 PostgreSQL

- `initdb -U postgres -E UTF8 --locale=C -A scram-sha-256`, password from the
  credential store via a temporary `--pwfile` deleted immediately after.
- `listen_addresses = '127.0.0.1'` and `port = 5433` appended to
  `pgdata\postgresql.conf`.
- Start: `pg_ctl -D %LOCALAPPDATA%\sifer\pgdata -l %LOCALAPPDATA%\sifer\logs\postgres.log -w start`
- Verified: `select version()` → PostgreSQL 16.4; netstat shows only `127.0.0.1:5433`.

### 4.2 Redis

- Download verified against SHA-256
  `ec629971d76756dd040204297f1a92f43848e7a5f4862d39426beeafcca2a2a9`
  (`Redis-7.4.11-Windows-x64-msys2.zip`).
- Committed config: `infra/local/redis.conf` — `bind 127.0.0.1`,
  `protected-mode yes`, `port 6390`, `appendonly yes`, `appendfsync everysec`,
  `logfile redis.log`.
- Password: `requirepass` in `%LOCALAPPDATA%\sifer\redis\auth.conf`, generated
  from the credential store. Plaintext, outside the repo, user profile only.
- **msys2 path trap:** this build cannot open Windows absolute paths —
  `C:/Users/...` is resolved relative to the working directory and fails with
  `can't open config file`. Start procedure therefore copies
  `infra/local/redis.conf` into the data directory and launches with relative
  names only:
  `redis-server.exe redis.conf --include auth.conf`, working directory
  `%LOCALAPPDATA%\sifer\redis`.
- Verified: `PONG` with auth active, `redis_version:7.4.11`, and an
  `XGROUP CREATE` / `XADD` / `XREADGROUP` round-trip on a consumer group.
- **Check ownership, not just the port.** Two earlier "successful" checks were
  talking to other programs' Redis. The start script confirms the listening PID
  equals the started process.

### 4.3 Qdrant

- Download verified against SHA-256
  `01d1657465bb2f920ba7f89b50016548e409b59fe4aba6ffdc9a4bc529382801`
  (`qdrant-x86_64-pc-windows-msvc.zip`, single `qdrant.exe`).
- Committed config: `infra/local/qdrant.yaml` — `telemetry_disabled: true`,
  relative `./storage` and `./snapshots`, `host: 127.0.0.1`, ports 6333/6334,
  CORS off. No personal paths in the file.
- Start: copy `infra/local/qdrant.yaml` into `%LOCALAPPDATA%\sifer\qdrant`,
  set `QDRANT__SERVICE__API_KEY` from the credential store for the launch only,
  run `qdrant.exe --config-path qdrant.yaml` with that working directory,
  then remove the variable from the session.
- Harmless startup warnings: `Config file not found: config/config`,
  `config/development`, and missing `./static` (web UI not used).
- Verified: both ports on `127.0.0.1` owned by the started PID; request without
  key → `401`; `version 1.12.4`; create, upsert, delete-twice 5/5 (see 2.8).

---

### 4.4 SILO (object storage)

- Downloads verified against SHA-256:
  `f99f4c376754aeea50c982afdd7aa3fd62ee9393e0ad603be570055c2342ee41`
  (`silo_20260916000000.0.0_windows_amd64.tar.gz`) and
  `24f90568cbb010fd792a96cc286b3505bb6a620dd2932f35db556a4d0ac11e52`
  (`mcli_20260916000000.0.0_windows_amd64.tar.gz`).
- No config file: flags and environment only. Root user `sifer-admin`,
  password from the credential store, `MINIO_UPDATE=off`.
- Start: set `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` for the launch only, run
  `silo.exe server data --address 127.0.0.1:9000 --console-address 127.0.0.1:9001`
  with working directory `%LOCALAPPDATA%\sifer\silo`, then clear the variables.
- Client credentials are passed as `MC_HOST_sifer=http://sifer-admin:<password>@127.0.0.1:9000`
  for the command only. **Never `mcli alias set`** — that writes the secret to
  `%USERPROFILE%\mcli\config.json`. Verified that file holds no Sifer secret.
- Verified: both ports owned by the started PID; `/minio/health/live` → 200;
  bucket and object reads without credentials → **403**; create bucket, upload,
  read back identical, remove bucket → all pass. The bare `/` returns 200
  (console page), which is expected.

### 4.5 LiveKit

- Download verified against LiveKit's published checksum
  `e539e7d2f75807b9c9202cd2a0bf2cb3d52fc4c52978a6953e0f47bc339fe77f`
  (`livekit_1.13.7_windows_amd64.zip`).
- Committed config: `infra/local/livekit.yaml` — `port: 7880`,
  `bind_addresses: [127.0.0.1]`, `rtc.tcp_port: 7881`, UDP range 50000-50020,
  `use_external_ip: false`. No keys in the file.
- Keys: API key `sifer-dev`, secret from the credential store, passed as
  `LIVEKIT_KEYS="sifer-dev: <secret>"` for the launch only.
- Start: copy `infra/local/livekit.yaml` into `%LOCALAPPDATA%\sifer\livekit`
  and run `livekit-server.exe --config livekit.yaml` with that working
  directory.
- Verified: `GET /` → 200; `ListRooms` without a token → **401**; with an
  HS256 access token signed by the secret, create → list → delete round trip
  passes.
- **`bind_addresses` covers signalling only.** Port 7880 binds `127.0.0.1`, but
  the TCP media port 7881 binds `::` (every address). UDP 50000-50020 opens only
  while a room is active, so `just status` shows `-` for UDP when idle.
- **Found on day 3:** Windows held two **Allow inbound** rules for
  `livekit-server.exe` on the Public profile, created by the first-run firewall
  prompt. With 7881 on `::`, LiveKit was reachable from the Wi-Fi. Both rules
  were removed and replaced by a block rule (4.7).
- **Localhost binding blocks the phone.** Sifer Live (P13) needs the handset to
  reach this server. At P13 the LiveKit block rule is replaced by a narrow allow
  rule (specific ports, local subnet only), written into `Set-SiferFirewall.ps1`.

### 4.6 Running the stack

`tools/Infra.psm1` holds the service table (binary, data directory, ports,
config file, environment) and the start, stop and status logic. The `Justfile`
is a thin wrapper:

| Command | Does |
| --- | --- |
| `just up` | starts all five in order, skipping any already running |
| `just down` | stops all five in reverse order |
| `just status` | service, ports, state, every bound TCP address, UDP endpoints, `Exposed` (any non-loopback binding), PID, owner |
| `just logs <service>` | tail of that service's log and stderr |
| `just restart <service>` | stop then start one service |
| `just firewall` | rebuilds the Sifer firewall rules (4.7); self-elevates through UAC |

Rules the module enforces:

- **Ownership, not just the port.** A listening port whose process path is not
  our pinned binary is reported `foreign` and start refuses, naming the owner.
  This is what the 5432/6379/6380 collisions taught us.
- Configs are copied from `infra/local/` into each data directory at start, so
  the repo stays the source of truth and Redis gets the relative paths it needs.
- Secrets are read from the credential store, set as environment variables for
  the launch only, and removed immediately afterwards.
- Every non-Postgres service is launched with `Start-Process` and its output
  redirected to `stdout.txt` / `stderr.txt` in its data directory.

**Two Windows traps, both hit and fixed:**

1. `pg_ctl` started with the call operator runs attached to the console, so a
   Ctrl+C in that window (or closing it) takes PostgreSQL down with it. This
   killed the database twice before it was understood. Fixed by launching
   `pg_ctl` with `Start-Process`.
2. `Start-Process -Wait` waits for the process **and all its descendants**.
   `pg_ctl` exits but PostgreSQL does not, so `just up` hung forever after
   starting the database and never reached the other four. Fixed by
   `-PassThru` plus `$control.WaitForExit()`, which waits for `pg_ctl` alone.

Verified: `just down` → five stopped; `just up` → five started, all
`running` on `127.0.0.1`, completing in seconds.

**Day 3 fix:** status previously reported only the first address per port and
no UDP, so a port bound on both `127.0.0.1` and `::` could look safe.
`Get-PortListener` now returns every listener, status adds `Udp` and `Exposed`,
and `Wait-ForPorts` counts ports with a listener rather than listeners (a port
bound twice would otherwise time out). Verified with `just restart livekit`.

### 4.7 Firewall

`tools/Set-SiferFirewall.ps1`, run with `just firewall`. It self-elevates
through UAC from a normal shell, so the working rule (never run as
Administrator) holds. It:

1. removes every firewall rule whose program lives under `sifer-infra`
   (including any Allow rule a first-run prompt created);
2. creates one **Inbound / Block / all profiles** rule per server binary —
   `postgres.exe`, `redis-server.exe`, `qdrant.exe`, `silo.exe`,
   `livekit-server.exe` — in rule group `Sifer`.

Block rules override allow rules, and Windows Firewall does not filter
loopback, so every service stays reachable from this laptop and from nothing
else. Idempotent: safe to re-run. Errors from the elevated process are written
to `%TEMP%\sifer-firewall-error.txt`.

**Re-run `just firewall` after any upgrade that changes a binary path** (a new
version directory means the old rules no longer match). If Windows ever shows a
firewall prompt for a Sifer binary, choose Cancel, then re-run it.

Verified: five `Sifer block inbound …` rules, all enabled, no Allow rules left
for any `sifer-infra` program.

---

## 5. Secrets and identities

**No secret values appear in this file, by design.**

### 5.1 Credential store module — DONE

`tools/CredentialStore.cs` (P/Invoke to `CredWriteW` / `CredReadW` /
`CredFree`) and `tools/SiferSecrets.psm1` expose:

- `Set-SiferSecret -Name <n> -Value <v>`
- `Get-SiferSecret -Name <n>` (throws if missing)
- `Test-SiferSecret -Name <n>`

Entries are Generic credentials, target `sifer/<name>`, persisted per user.
Load with `Import-Module .\tools\SiferSecrets.psm1 -Force` from the repo root.
`cmdkey` is not used because it cannot read a value back.

| Name | Holds |
| --- | --- |
| `sifer/age/workstation` | age private identity |
| `sifer/postgres/superuser` | PostgreSQL `postgres` role password (64 hex) |
| `sifer/redis/default` | Redis `requirepass` (64 hex) |
| `sifer/qdrant/api-key` | Qdrant service API key (64 hex) |
| `sifer/silo/root-password` | SILO root password for user `sifer-admin` (64 hex) |
| `sifer/livekit/api-secret` | LiveKit secret for API key `sifer-dev` (64 hex) |
| `sifer/signing/pfx-password` | Password of `secrets\sifer-codesign.pfx` (64 hex, random) |

### 5.2 Code-signing certificate — DONE

| Field | Value |
| --- | --- |
| Subject | `CN=Sifer Development, O=Sifer, C=RW` |
| Thumbprint | `C8DBC5E9EB36C7A7CD46118940D3F270B0FCB051` |
| Serial | `1A534629A3D3788F432171217D6E0630` |
| Algorithm | RSA 4096, SHA256 |
| Valid | 16 Sep 2026 → 16 Sep 2036 |
| Private store | `Cert:\CurrentUser\My` |
| Trust store | `Cert:\CurrentUser\Root` |
| Exported PFX | `secrets\sifer-codesign.pfx` (gitignored) |
| PFX password | Random 64 hex, in `sifer/signing/pfx-password` and in `secrets/dev.age`. Nobody needs to remember it. |
| PFX encryption | `AES256_SHA256` (re-exported day 3) |

Signed and `Valid`: `age.exe`, `age-keygen.exe`, `atlas.exe`, `buf.exe`, `just.exe`.

### 5.3 age identity — DONE

- Private identity in the credential store (`sifer/age/workstation`), never on disk.
- Public recipient committed in `secrets/recipients.txt` under `# workstation`:
  `age1wzysn26rzzklj9rfkdtgnjdl8p0ewtwlzg47wjgdye203z5m6dpsmmnkq0`
- Verified by an encrypt → decrypt round trip reading the identity back from the
  credential store.
- Decrypt pattern: `Get-SiferSecret -Name 'age/workstation' | age -d -i - <file>`

- Backup recipient added day 3, under `# backup (Google Drive, passphrase-protected)`:
  `age13qwscys3t9va630g48umlldr7jvljrqmgdf4yjvsxdme9u0c5eqqmtfcz2`

**Backup identity.** Generated in memory and written only as a passphrase-
encrypted age file (`age -p`, scrypt). The file `sifer-backup-identity.age`
lives in Google Drive, folder `Sifer backup`; no copy stays on the laptop. The
autogenerated passphrase is on paper, offline, kept apart from the laptop.
**Never store the passphrase in the same Google account** (Docs, Keep, Gmail,
Photos). Recovery: download the file, then
`age -d -i sifer-backup-identity.age secrets\dev.age` and type the passphrase.

Verified: a test message encrypted to `recipients.txt` decrypts with both the
workstation identity and the backup identity. Two earlier backup keys were
discarded (a mistyped passphrase, then a passphrase visible in a screenshot);
neither ever encrypted anything real.

### 5.5 `secrets/dev.age` — DONE

`tools/DevSecrets.psm1`, driven by `just`:

| Command | Does |
| --- | --- |
| `just secrets` | builds the file from the credential store and the `.pfx`, encrypts to every recipient in `recipients.txt` |
| `just secrets-check` | decrypts, lists keys with value **lengths only**, rebuilds the certificate from the file and checks its thumbprint |

`Get-SiferDevSecrets` (same module) returns the values as an ordered dictionary
in memory, for later recipes such as `just dev`. The plaintext never touches
disk: it is built in memory and piped straight into `age`.

Entries (15): `POSTGRES_SUPERUSER_URL`, `REDIS_URL`, `QDRANT_URL`,
`QDRANT_GRPC_URL`, `QDRANT_API_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`, `SIGNING_CERT_THUMBPRINT`, `SIGNING_PFX_PASSWORD`,
`SIGNING_PFX_BASE64`.

Not yet included, added when they exist: OAuth client ids and secrets (Google,
Microsoft), app-level database roles. Model credentials never go here — they
are engine rows created at runtime (Document 1, §12).

**Re-run `just secrets` whenever a credential-store secret changes or a
recipient is added**, then commit the new `dev.age`.

Verified: 15 entries, 7166 bytes; `just secrets-check` → all lengths non-zero,
`PFX round trip: ok`.

### 5.4 GitHub — RESOLVED

GitHub account renamed from `ngabonzizacedrickkennedy` to `mentor-sator`
(September 2026). `origin` is `https://github.com/mentor-sator/Sifer.git`.
Six commits are on `origin/main`, `9f51556` through `de9353f`. Local repo config
pins `credential.https://github.com.username` to `mentor-sator`. Pushes
authenticate through the browser sign-in.

**Still to do:** revoke the expired `ghp_` token that was displayed on screen
during diagnosis.

---

## 6. Repository state

| Item | State |
| --- | --- |
| Branch | `main` |
| Pushed | day 3 dev secrets commit |
| Uncommitted | nothing |
| Encoding | All tracked text files UTF-8, no BOM, LF — enforced by `.gitattributes` |

### Tracked files

```
.gitattributes
.gitignore
.node-version
Justfile
README.md
STATE.md
infra/local/livekit.yaml
infra/local/qdrant.yaml
infra/local/redis.conf
pnpm-workspace.yaml
rust-toolchain.toml
secrets/dev.age
secrets/recipients.txt
tools/CredentialStore.cs
tools/DevSecrets.psm1
tools/Infra.psm1
tools/Set-SiferFirewall.ps1
tools/SiferSecrets.psm1
```

`pnpm-workspace.yaml` covers `apps/*`, `packages/*` **and `services/*`** — a
deliberate addition over the blueprint, because session-gateway, action-planner
and billing are Node packages.

### Directory skeleton

```
apps/  packages/  services/  contracts/  infra/local/  secrets/  tools/
```

---

## 7. Remaining P0 work

| Item | Blueprint ref | State |
| --- | --- | --- |
| Confirm LiveKit `::` media port is firewalled | — | **Done** (day 3, 4.7) |
| Backup age recipient | 0A.6 / 0C.21 | **Done** (day 3, 5.3) |
| `secrets/dev.age` | 0C.21 | **Done** (day 3, 5.5) |
| `Justfile` recipe `secrets` | 0B.16 | **Done** (plus `secrets-check`) |
| `Justfile` recipes `migrate`, `gen`, `dev`, `seed`, `verify` | 0B.16 | Deferred until they have code to run |
| `docker-compose.yml` (authored, not run) | 0B.15 | **Next** |
| `turbo.json` | 0A.3 | Not started |
| ESLint 9 flat config + 2 custom rules | 0A.10 | Not started |
| GitHub Actions | 0A.7 | Unblocked, not started |

### Non-negotiables in the remaining work

- Data directories stay outside the repo tree.
- Every service bound to `127.0.0.1`, verified with netstat **and** PID ownership.
- `just up` must check each port's owner before starting, and fail loudly on a clash.
- `just seed` rebuilds the database from migrations and fixtures in one command.
- `just verify` runs format, lint, typecheck, test across all four runtimes, in
  that order, green before every commit.
- Pin every version; native and compose versions never drift.

---

## 8. Named debt

1. **Local model path unproven.** Text and vision run remote in development.
2. **Phase-boundary gate cannot run.** No container engine here.
3. **Agency guest shares a host with the workstation.** Violates Document 1
   §3.5.3. Resolve before P9. Isolation conditions when built: no shared folders,
   no drive redirection, no clipboard redirection, no enhanced session mode, a
   virtual switch that reaches the internet but not the host, Smart App Control
   off from first boot with the base snapshot taken in that state.
4. **Commercial code signing needed at P19.** Azure Artifact Signing is not
   available to Rwanda-based entities; the route is a traditional OV/EV CA
   certificate with a hardware token. Budget before packaging.
5. **macOS is not provisioned and will not be.** Scope reduction.
6. **Smart App Control is off for the development period.** Reversible on this
   build.
7. **Redis is a community build.** Pinned and hash-verified, not vendor-supported.
8. ~~Single age identity.~~ **Resolved day 3** — backup recipient added (5.3).
9. **Qdrant Windows delete bug** (upstream #5924). Worked around by delete-twice
   (2.8). Remove the workaround when upstream fixes it.
10. **SILO is a single-maintainer fork** (Pigsty). Pinned and hash-verified,
    with signed checksums, but one maintainer is the risk. Watch for a wider
    community line; S3 keeps the exit cheap.
11. **LiveKit binds its media port to `::`** (all addresses); `bind_addresses`
    only covers signalling. Mitigated by the `Sifer block inbound
    livekit-server` rule (4.7), verified day 3. Must be settled deliberately at
    P13, when the phone needs to reach it.
12. **Network profile is Public.** Correct for safety; noted because P13's
    allow rule must target the profile in use at that time.

---

## 9. Next actions, in order

1. Write `docker-compose.yml` (authored, never run here), pinned to the same
   versions as the native stack: PostgreSQL 16.4, Redis 7.4.11, Qdrant 1.12.4,
   SILO RELEASE.2026-09-16, LiveKit 1.13.7.
2. Add `turbo.json` and the ESLint 9 flat config with the two custom rules.
3. Add GitHub Actions.
4. Close P0 against its definition of done, minus the container half (debt 2).
5. Revoke the exposed GitHub token; optionally restrict the pre-existing
   5432 PostgreSQL and 6379 Redis to `127.0.0.1`.

---

## 10. Working agreement

- One recommended approach per step. No option menus.
- Code without comments, clean and readable.
- Two or three steps at a time, then verify with a screenshot before moving on.
- Files are written by PowerShell as UTF-8 without BOM, LF line endings.
- Deliverables stay scoped to what was asked.
