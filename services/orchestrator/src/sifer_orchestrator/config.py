import os
from dataclasses import dataclass
from pathlib import Path
from typing import Self

DEFAULT_ADDR = "127.0.0.1:8083"
DEFAULT_OTLP_ENDPOINT = "127.0.0.1:4317"
TLS_PREFIX = "SIFER_TLS"


@dataclass(frozen=True, slots=True)
class TLSFiles:
    ca: Path
    cert: Path
    key: Path


def _host_port(name: str, fallback: str) -> str:
    value = os.environ.get(name) or fallback
    host, separator, port = value.rpartition(":")
    if not separator or not host or not port.isdigit():
        raise ValueError(f"{name} {value!r} is not host:port")
    return value


def _tls_files(prefix: str) -> TLSFiles | None:
    ca, cert, key = (os.environ.get(f"{prefix}_{part}") or "" for part in ("CA", "CERT", "KEY"))
    if not (ca or cert or key):
        return None
    if not (ca and cert and key):
        raise ValueError(f"{prefix}_CA, {prefix}_CERT and {prefix}_KEY must be set together")
    return TLSFiles(ca=Path(ca), cert=Path(cert), key=Path(key))


@dataclass(frozen=True, slots=True)
class Config:
    addr: str
    otlp_endpoint: str = DEFAULT_OTLP_ENDPOINT
    tls: TLSFiles | None = None
    shutdown_grace_s: float = 5.0

    @property
    def port(self) -> int:
        return int(self.addr.rpartition(":")[2])

    @classmethod
    def from_env(cls) -> Self:
        return cls(
            addr=_host_port("SIFER_ORCHESTRATOR_ADDR", DEFAULT_ADDR),
            otlp_endpoint=_host_port("SIFER_OTLP_ENDPOINT", DEFAULT_OTLP_ENDPOINT),
            tls=_tls_files(TLS_PREFIX),
        )
