import os
from dataclasses import dataclass
from typing import Self

DEFAULT_ADDR = "127.0.0.1:8083"
DEFAULT_OTLP_ENDPOINT = "127.0.0.1:4317"


def _host_port(name: str, fallback: str) -> str:
    value = os.environ.get(name) or fallback
    host, separator, port = value.rpartition(":")
    if not separator or not host or not port.isdigit():
        raise ValueError(f"{name} {value!r} is not host:port")
    return value


@dataclass(frozen=True, slots=True)
class Config:
    addr: str
    otlp_endpoint: str = DEFAULT_OTLP_ENDPOINT
    shutdown_grace_s: float = 5.0

    @classmethod
    def from_env(cls) -> Self:
        return cls(
            addr=_host_port("SIFER_ORCHESTRATOR_ADDR", DEFAULT_ADDR),
            otlp_endpoint=_host_port("SIFER_OTLP_ENDPOINT", DEFAULT_OTLP_ENDPOINT),
        )
