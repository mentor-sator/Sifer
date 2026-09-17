# Sifer — Build State

**Last updated:** 17 September 2026
**Phase:** P0 — Machine Roles, Toolchain, and Native Infrastructure (in progress)
**Repo:** https://github.com/ngabonzizacedrickkennedy/Sifer
**Working directory:** `C:\Users\Novemba\Sifer`
**Last pushed commit:** `78fc84e` — "P0: age workstation identity, credential store module, LF normalisation"

This file is the handover document. Anyone picking up Sifer — a new conversation,
a new session, a future you — should be able to read this and know exactly where
the build stands, what was decided and why, and what is blocking.

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
| PostgreSQL | 16.4 (EDB zip) | `sifer-infra\postgresql-16.4` | `sifer\pgdata` | `127.0.0.1:5433` | **Running, verified** |
| Redis | 7.4.11 (redis-windows msys2) | `sifer-infra\redis-7.4.11` | `sifer\redis` | `127.0.0.1:6390` | **Running, verified** |
| Qdrant | v1.12.4 | — | — | — | Not started |
| MinIO | pinned release | — | — | — | Not started |
| LiveKit | pinned release | — | — | — | Not started |

Logs: `%LOCALAPPDATA%\sifer\logs\postgres.log`, `%LOCALAPPDATA%\sifer\redis\redis.log`.

**Nothing auto-starts.** After a reboot both must be started again; the
`Justfile` (`just up`) will own this.

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
| PFX password | Chosen interactively. **Not recorded anywhere. Do not lose it.** |

Signed and `Valid`: `age.exe`, `age-keygen.exe`, `atlas.exe`, `buf.exe`, `just.exe`.

### 5.3 age identity — DONE

- Private identity in the credential store (`sifer/age/workstation`), never on disk.
- Public recipient committed in `secrets/recipients.txt` under `# workstation`:
  `age1wzysn26rzzklj9rfkdtgnjdl8p0ewtwlzg47wjgdye203z5m6dpsmmnkq0`
- Verified by an encrypt → decrypt round trip reading the identity back from the
  credential store.
- Decrypt pattern: `Get-SiferSecret -Name 'age/workstation' | age -d -i - <file>`

**Single point of failure.** It is the only identity. If this Windows profile is
lost, anything encrypted only to it is unrecoverable. **A backup recipient must
be added to `recipients.txt` before `secrets/dev.age` holds any real value.**
The blueprint's second recipient (verification target) no longer exists.

### 5.4 GitHub — RESOLVED

Pushing as `ngabonzizacedrickkennedy` works; commits `9f51556` and `78fc84e`
are on `origin/main`. Local repo config pins
`credential.https://github.com.username` to that account.

**Still to do:** revoke the expired `ghp_` token that was displayed on screen
during diagnosis.

---

## 6. Repository state

| Item | State |
| --- | --- |
| Branch | `main` |
| Pushed | `78fc84e` |
| Uncommitted | `infra/local/redis.conf`, this `STATE.md` |
| Encoding | All tracked text files UTF-8, no BOM, LF — enforced by `.gitattributes` |

### Tracked files

```
.gitattributes
.gitignore
.node-version
README.md
pnpm-workspace.yaml
rust-toolchain.toml
secrets/recipients.txt
tools/CredentialStore.cs
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
| Commit `infra/local/redis.conf` + `STATE.md` | — | Next |
| Qdrant v1.12.4, `127.0.0.1` | 0B.12–13 | Not started |
| MinIO, `127.0.0.1` (default is `0.0.0.0`) | 0B.12–13 | Not started |
| LiveKit, `127.0.0.1` (default is `0.0.0.0`) | 0B.12–13 | Not started |
| Backup age recipient | 0A.6 / 0C.21 | Not started |
| `secrets/dev.age` | 0C.21 | Not started |
| `Justfile` (`up`, `down`, `logs`, `secrets`, `migrate`, `gen`, `dev`, `seed`, `verify`) | 0B.16 | Not started |
| `docker-compose.yml` (authored, not run) | 0B.15 | Not started |
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
8. **Single age identity** until the backup recipient is added (5.3).

---

## 9. Next actions, in order

1. Commit `infra/local/redis.conf` and `STATE.md`; push.
2. Install Qdrant v1.12.4, bound to `127.0.0.1`, verified by PID ownership.
3. Install MinIO and LiveKit, bound to `127.0.0.1`, same verification.
4. Add the backup age recipient, then create `secrets/dev.age`.
5. Write the `Justfile` and `docker-compose.yml`.
6. Add `turbo.json`, the ESLint flat config, and GitHub Actions.
7. Close P0 against its definition of done, minus the container half (debt 2).
8. Revoke the exposed GitHub token; optionally restrict the pre-existing
   5432 PostgreSQL and 6379 Redis to `127.0.0.1`.

---

## 10. Working agreement

- One recommended approach per step. No option menus.
- Code without comments, clean and readable.
- Two or three steps at a time, then verify with a screenshot before moving on.
- Files are written by PowerShell as UTF-8 without BOM, LF line endings.
- Deliverables stay scoped to what was asked.
