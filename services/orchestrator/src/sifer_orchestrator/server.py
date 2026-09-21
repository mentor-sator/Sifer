import logging

import grpc
from grpc import aio
from opentelemetry.instrumentation.grpc import aio_server_interceptor
from opentelemetry.trace import TracerProvider
from sifer.v1 import orchestrator_pb2_grpc

from sifer_orchestrator.config import Config, TLSFiles
from sifer_orchestrator.service import OrchestratorService

log = logging.getLogger(__name__)


def server_credentials(files: TLSFiles) -> grpc.ServerCredentials:
    return grpc.ssl_server_credentials(
        [(files.key.read_bytes(), files.cert.read_bytes())],
        root_certificates=files.ca.read_bytes(),
        require_client_auth=True,
    )


async def start(
    config: Config, tracer_provider: TracerProvider | None = None
) -> tuple[aio.Server, int]:
    server = aio.server(interceptors=[aio_server_interceptor(tracer_provider=tracer_provider)])
    orchestrator_pb2_grpc.add_OrchestratorServiceServicer_to_server(OrchestratorService(), server)
    if config.tls is None:
        port = server.add_insecure_port(config.addr)
    else:
        port = server.add_secure_port(config.addr, server_credentials(config.tls))
    if port == 0:
        raise RuntimeError(f"cannot bind {config.addr}")
    await server.start()
    return server, port


async def serve(config: Config) -> None:
    server, _ = await start(config)
    log.info(
        "orchestrator listening",
        extra={"addr": config.addr, "otlp": config.otlp_endpoint, "mtls": config.tls is not None},
    )
    try:
        await server.wait_for_termination()
    finally:
        log.info("orchestrator shutting down")
        await server.stop(config.shutdown_grace_s)
