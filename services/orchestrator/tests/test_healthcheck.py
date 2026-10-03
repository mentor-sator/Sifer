import socket

import pytest

from sifer_orchestrator.config import Config
from sifer_orchestrator.healthcheck import check, main


def test_check_passes_when_the_port_listens() -> None:
    with socket.create_server(("127.0.0.1", 0)) as listener:
        port = listener.getsockname()[1]
        check(Config(addr=f"0.0.0.0:{port}"))


def test_main_exits_non_zero_when_nothing_listens(monkeypatch: pytest.MonkeyPatch) -> None:
    with socket.create_server(("127.0.0.1", 0)) as listener:
        port = listener.getsockname()[1]
    monkeypatch.setenv("SIFER_ORCHESTRATOR_ADDR", f"127.0.0.1:{port}")
    with pytest.raises(SystemExit) as exit_info:
        main()
    assert exit_info.value.code == 1
