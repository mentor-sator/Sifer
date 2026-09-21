import pytest

from sifer_orchestrator.config import DEFAULT_ADDR, Config


def test_defaults_to_loopback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SIFER_ORCHESTRATOR_ADDR", raising=False)
    assert Config.from_env().addr == DEFAULT_ADDR


def test_honours_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIFER_ORCHESTRATOR_ADDR", "127.0.0.1:18083")
    assert Config.from_env().addr == "127.0.0.1:18083"


@pytest.mark.parametrize("addr", ["8083", "127.0.0.1:", ":8083", "localhost:http"])
def test_rejects_malformed_address(monkeypatch: pytest.MonkeyPatch, addr: str) -> None:
    monkeypatch.setenv("SIFER_ORCHESTRATOR_ADDR", addr)
    with pytest.raises(ValueError, match="host:port"):
        Config.from_env()
