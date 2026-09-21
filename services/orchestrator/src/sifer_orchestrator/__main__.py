import asyncio
import contextlib

from sifer_orchestrator import logs
from sifer_orchestrator.config import Config
from sifer_orchestrator.server import serve


def main() -> None:
    logs.configure()
    config = Config.from_env()
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(serve(config))


if __name__ == "__main__":
    main()
