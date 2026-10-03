from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from grpc import aio
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind
from sifer.v1 import envelope_pb2, orchestrator_pb2, orchestrator_pb2_grpc

from sifer_orchestrator import telemetry
from sifer_orchestrator.config import Config
from sifer_orchestrator.schema import SCHEMA_MAJOR
from sifer_orchestrator.server import start

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
PARENT_SPAN_ID = "00f067aa0ba902b7"


@pytest_asyncio.fixture
async def traced() -> AsyncIterator[
    tuple[orchestrator_pb2_grpc.OrchestratorServiceAsyncStub, InMemorySpanExporter]
]:
    exporter = InMemorySpanExporter()
    provider = TracerProvider(resource=telemetry.resource())
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    server, port = await start(Config(addr="127.0.0.1:0"), tracer_provider=provider)
    try:
        async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            yield orchestrator_pb2_grpc.OrchestratorServiceStub(channel), exporter
    finally:
        await server.stop(None)
        provider.shutdown()


@pytest.mark.asyncio
async def test_echo_joins_the_callers_trace(
    traced: tuple[orchestrator_pb2_grpc.OrchestratorServiceAsyncStub, InMemorySpanExporter],
) -> None:
    stub, exporter = traced
    request = orchestrator_pb2.EchoRequest(
        envelope=envelope_pb2.Envelope(schema_major=SCHEMA_MAJOR)
    )

    await stub.Echo(request, metadata=(("traceparent", f"00-{TRACE_ID}-{PARENT_SPAN_ID}-01"),))

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.kind is SpanKind.SERVER
    assert span.name == "/sifer.v1.OrchestratorService/Echo"
    assert format(span.context.trace_id, "032x") == TRACE_ID
    assert span.parent is not None
    assert format(span.parent.span_id, "016x") == PARENT_SPAN_ID
    assert span.resource.attributes["service.name"] == "orchestrator"
