import asyncio
import contextlib

from sifer_orchestrator import logs, telemetry
from sifer_orchestrator.config import Config
from sifer_orchestrator.server import serve


def main() -> None:
    logs.configure()
    config = Config.from_env()
    provider = telemetry.setup(config.otlp_endpoint)
    try:
        with contextlib.suppress(KeyboardInterrupt):
            asyncio.run(serve(config))
    finally:
        provider.shutdown()


if __name__ == "__main__":
    main()
