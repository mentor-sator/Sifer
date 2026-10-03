from typing import override

import grpc
from grpc import aio
from sifer.v1 import orchestrator_pb2, orchestrator_pb2_grpc

from sifer_orchestrator.schema import SCHEMA_MAJOR

EchoContext = aio.ServicerContext[orchestrator_pb2.EchoRequest, orchestrator_pb2.EchoResponse]


class OrchestratorService(orchestrator_pb2_grpc.OrchestratorServiceServicer):
    @override
    async def Echo(
        self,
        request: orchestrator_pb2.EchoRequest,
        context: EchoContext,
    ) -> orchestrator_pb2.EchoResponse:
        if not request.HasField("envelope"):
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "envelope is required")
        major = request.envelope.schema_major
        if major != SCHEMA_MAJOR:
            await context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                f"schema_major {major} is not supported; expected {SCHEMA_MAJOR}",
            )
        return orchestrator_pb2.EchoResponse(envelope=request.envelope)
