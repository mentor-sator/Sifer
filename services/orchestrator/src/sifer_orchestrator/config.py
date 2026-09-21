import os
from dataclasses import dataclass
from typing import Self

DEFAULT_ADDR = "127.0.0.1:8083"


@dataclass(frozen=True, slots=True)
class Config:
    addr: str
    shutdown_grace_s: float = 5.0

    @classmethod
    def from_env(cls) -> Self:
        addr = os.environ.get("SIFER_ORCHESTRATOR_ADDR") or DEFAULT_ADDR
        host, separator, port = addr.rpartition(":")
        if not separator or not host or not port.isdigit():
            raise ValueError(f"SIFER_ORCHESTRATOR_ADDR {addr!r} is not host:port")
        return cls(addr=addr)
