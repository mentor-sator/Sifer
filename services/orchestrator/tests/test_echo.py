from __future__ import annotations

from collections.abc import AsyncIterator

import grpc
import pytest
import pytest_asyncio
from grpc import aio
from sifer.v1 import envelope_pb2, orchestrator_pb2, orchestrator_pb2_grpc

from sifer_orchestrator.config import Config
from sifer_orchestrator.schema import SCHEMA_MAJOR, major_from_package
from sifer_orchestrator.server import start


@pytest_asyncio.fixture
async def stub() -> AsyncIterator[orchestrator_pb2_grpc.OrchestratorServiceAsyncStub]:
    server, port = await start(Config(addr="127.0.0.1:0"))
    try:
        async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            yield orchestrator_pb2_grpc.OrchestratorServiceStub(channel)
    finally:
        await server.stop(None)


def test_schema_major_comes_from_contract_package() -> None:
    assert SCHEMA_MAJOR == 1
    assert major_from_package("sifer.v7") == 7
    with pytest.raises(RuntimeError):
        major_from_package("sifer")


@pytest.mark.asyncio
async def test_echo_returns_the_envelope(
    stub: orchestrator_pb2_grpc.OrchestratorServiceAsyncStub,
) -> None:
    sent = envelope_pb2.Envelope(
        schema_major=SCHEMA_MAJOR,
        trace_id="0192f0c4-7b1e-7cc0-9d6a-3f2b8e1a4c55",
        session_id="p1",
        seq=42,
    )
    response = await stub.Echo(orchestrator_pb2.EchoRequest(envelope=sent))
    assert response.envelope == sent


@pytest.mark.asyncio
async def test_echo_rejects_another_major(
    stub: orchestrator_pb2_grpc.OrchestratorServiceAsyncStub,
) -> None:
    sent = envelope_pb2.Envelope(schema_major=SCHEMA_MAJOR + 1)
    with pytest.raises(aio.AioRpcError) as failure:
        await stub.Echo(orchestrator_pb2.EchoRequest(envelope=sent))
    assert failure.value.code() == grpc.StatusCode.FAILED_PRECONDITION


@pytest.mark.asyncio
async def test_echo_requires_an_envelope(
    stub: orchestrator_pb2_grpc.OrchestratorServiceAsyncStub,
) -> None:
    with pytest.raises(aio.AioRpcError) as failure:
        await stub.Echo(orchestrator_pb2.EchoRequest())
    assert failure.value.code() == grpc.StatusCode.INVALID_ARGUMENT
