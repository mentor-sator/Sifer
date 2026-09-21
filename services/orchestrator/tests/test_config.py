from pathlib import Path

import pytest

from sifer_orchestrator.config import DEFAULT_ADDR, DEFAULT_OTLP_ENDPOINT, Config, TLSFiles

ADDRESSES = ("SIFER_ORCHESTRATOR_ADDR", "SIFER_OTLP_ENDPOINT")
TLS = ("SIFER_TLS_CA", "SIFER_TLS_CERT", "SIFER_TLS_KEY")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ADDRESSES + TLS:
        monkeypatch.delenv(name, raising=False)


def test_defaults_to_loopback_without_tls() -> None:
    config = Config.from_env()
    assert config.addr == DEFAULT_ADDR
    assert config.otlp_endpoint == DEFAULT_OTLP_ENDPOINT
    assert config.tls is None
    assert config.port == 8083


def test_honours_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIFER_ORCHESTRATOR_ADDR", "0.0.0.0:18083")
    monkeypatch.setenv("SIFER_OTLP_ENDPOINT", "127.0.0.1:14317")
    for name, value in zip(TLS, ("ca.crt", "server.crt", "server.key"), strict=True):
        monkeypatch.setenv(name, value)
    config = Config.from_env()
    assert config.addr == "0.0.0.0:18083"
    assert config.port == 18083
    assert config.otlp_endpoint == "127.0.0.1:14317"
    assert config.tls == TLSFiles(Path("ca.crt"), Path("server.crt"), Path("server.key"))


@pytest.mark.parametrize("name", ADDRESSES)
@pytest.mark.parametrize("value", ["8083", "127.0.0.1:", ":8083", "localhost:http"])
def test_rejects_malformed_address(monkeypatch: pytest.MonkeyPatch, name: str, value: str) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match="host:port"):
        Config.from_env()


@pytest.mark.parametrize("name", TLS)
def test_rejects_partial_tls(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.setenv(name, "only-this-one")
    with pytest.raises(ValueError, match="must be set together"):
        Config.from_env()
