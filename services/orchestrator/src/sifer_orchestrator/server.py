import logging

from grpc import aio
from sifer.v1 import orchestrator_pb2_grpc

from sifer_orchestrator.config import Config
from sifer_orchestrator.service import OrchestratorService

log = logging.getLogger(__name__)


async def start(config: Config) -> tuple[aio.Server, int]:
    server = aio.server()
    orchestrator_pb2_grpc.add_OrchestratorServiceServicer_to_server(OrchestratorService(), server)
    port = server.add_insecure_port(config.addr)
    if port == 0:
        raise RuntimeError(f"cannot bind {config.addr}")
    await server.start()
    return server, port


async def serve(config: Config) -> None:
    server, _ = await start(config)
    log.info("orchestrator listening", extra={"addr": config.addr})
    try:
        await server.wait_for_termination()
    finally:
        log.info("orchestrator shutting down")
        await server.stop(config.shutdown_grace_s)
