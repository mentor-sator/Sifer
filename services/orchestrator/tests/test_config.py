import pytest

from sifer_orchestrator.config import DEFAULT_ADDR, DEFAULT_OTLP_ENDPOINT, Config

VARIABLES = ("SIFER_ORCHESTRATOR_ADDR", "SIFER_OTLP_ENDPOINT")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in VARIABLES:
        monkeypatch.delenv(name, raising=False)


def test_defaults_to_loopback() -> None:
    config = Config.from_env()
    assert config.addr == DEFAULT_ADDR
    assert config.otlp_endpoint == DEFAULT_OTLP_ENDPOINT


def test_honours_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIFER_ORCHESTRATOR_ADDR", "127.0.0.1:18083")
    monkeypatch.setenv("SIFER_OTLP_ENDPOINT", "127.0.0.1:14317")
    config = Config.from_env()
    assert config.addr == "127.0.0.1:18083"
    assert config.otlp_endpoint == "127.0.0.1:14317"


@pytest.mark.parametrize("name", VARIABLES)
@pytest.mark.parametrize("value", ["8083", "127.0.0.1:", ":8083", "localhost:http"])
def test_rejects_malformed_address(monkeypatch: pytest.MonkeyPatch, name: str, value: str) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match="host:port"):
        Config.from_env()
