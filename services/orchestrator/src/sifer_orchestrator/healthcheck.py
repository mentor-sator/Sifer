import socket
import sys

from sifer_orchestrator.config import Config

TIMEOUT_S = 2.0


def check(config: Config) -> None:
    with socket.create_connection(("127.0.0.1", config.port), timeout=TIMEOUT_S):
        pass


def main() -> None:
    try:
        check(Config.from_env())
    except (OSError, ValueError) as error:
        sys.stderr.write(f"unhealthy: {error}\n")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
