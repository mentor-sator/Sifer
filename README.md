# Sifer

An AI assistant with two bodies and one memory: a desktop orb you drag onto a
problem, and a mobile camera guide that watches you work.

## Layout

| Path | Holds |
| --- | --- |
| `apps/` | Motion (Electron), Live (React Native), dashboard (Next.js) |
| `services/` | The twelve backend services across four runtimes |
| `packages/` | Shared TypeScript packages, including generated contracts |
| `contracts/` | Protobuf definitions, the single source of truth for every boundary |
| `infra/local/` | Pinned configuration for the native infrastructure stack |
| `secrets/` | age-encrypted secrets; no plaintext ever lands here |

## Toolchain

Node 22.11.0, pnpm 9.15.0, Go 1.25, Python 3.12, Rust 1.82.0, buf 1.47.2,
atlas, just 1.36.0, age 1.2.1.
