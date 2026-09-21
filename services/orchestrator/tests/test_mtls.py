from __future__ import annotations

import datetime
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import grpc
import pytest
import pytest_asyncio
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from grpc import aio
from sifer.v1 import envelope_pb2, orchestrator_pb2, orchestrator_pb2_grpc

from sifer_orchestrator.config import Config, TLSFiles
from sifer_orchestrator.schema import SCHEMA_MAJOR
from sifer_orchestrator.server import start

SERVER_NAME = "orchestrator"


@dataclass(frozen=True)
class Authority:
    cert: x509.Certificate
    key: ec.EllipticCurvePrivateKey

    @property
    def pem(self) -> bytes:
        return self.cert.public_bytes(serialization.Encoding.PEM)

    @classmethod
    def create(cls, name: str) -> Authority:
        key = ec.generate_private_key(ec.SECP256R1())
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
        now = datetime.datetime.now(datetime.UTC)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(subject)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=1))
            .not_valid_after(now + datetime.timedelta(hours=1))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(key, hashes.SHA256())
        )
        return cls(cert=cert, key=key)

    def issue(self, name: str, usage: x509.ObjectIdentifier) -> tuple[bytes, bytes]:
        key = ec.generate_private_key(ec.SECP256R1())
        now = datetime.datetime.now(datetime.UTC)
        cert = (
            x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)]))
            .issuer_name(self.cert.subject)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=1))
            .not_valid_after(now + datetime.timedelta(hours=1))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(name)]), critical=False)
            .add_extension(x509.ExtendedKeyUsage([usage]), critical=False)
            .sign(self.key, hashes.SHA256())
        )
        key_pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        return cert.public_bytes(serialization.Encoding.PEM), key_pem


@pytest.fixture
def authority() -> Authority:
    return Authority.create("sifer-test-ca")


@pytest_asyncio.fixture
async def port(authority: Authority, tmp_path: Path) -> AsyncIterator[int]:
    cert, key = authority.issue(SERVER_NAME, ExtendedKeyUsageOID.SERVER_AUTH)
    files = TLSFiles(
        ca=tmp_path / "ca.crt", cert=tmp_path / "server.crt", key=tmp_path / "server.key"
    )
    files.ca.write_bytes(authority.pem)
    files.cert.write_bytes(cert)
    files.key.write_bytes(key)
    server, bound = await start(Config(addr="127.0.0.1:0", tls=files))
    try:
        yield bound
    finally:
        await server.stop(None)


async def echo(port: int, credentials: grpc.ChannelCredentials | None) -> None:
    options = (("grpc.ssl_target_name_override", SERVER_NAME),)
    target = f"127.0.0.1:{port}"
    channel = (
        aio.secure_channel(target, credentials, options)
        if credentials
        else aio.insecure_channel(target)
    )
    async with channel:
        stub = orchestrator_pb2_grpc.OrchestratorServiceStub(channel)
        request = orchestrator_pb2.EchoRequest(
            envelope=envelope_pb2.Envelope(schema_major=SCHEMA_MAJOR)
        )
        await stub.Echo(request, timeout=5)


@pytest.mark.asyncio
async def test_client_with_a_certificate_from_the_authority_is_served(
    port: int, authority: Authority
) -> None:
    cert, key = authority.issue("edge-gateway", ExtendedKeyUsageOID.CLIENT_AUTH)
    credentials = grpc.ssl_channel_credentials(authority.pem, key, cert)
    await echo(port, credentials)


@pytest.mark.asyncio
async def test_client_without_a_certificate_is_refused(port: int, authority: Authority) -> None:
    with pytest.raises(aio.AioRpcError) as failure:
        await echo(port, grpc.ssl_channel_credentials(authority.pem))
    assert failure.value.code() is grpc.StatusCode.UNAVAILABLE


@pytest.mark.asyncio
async def test_client_from_another_authority_is_refused(port: int, authority: Authority) -> None:
    stranger = Authority.create("stranger-ca")
    cert, key = stranger.issue("edge-gateway", ExtendedKeyUsageOID.CLIENT_AUTH)
    with pytest.raises(aio.AioRpcError) as failure:
        await echo(port, grpc.ssl_channel_credentials(authority.pem, key, cert))
    assert failure.value.code() is grpc.StatusCode.UNAVAILABLE


@pytest.mark.asyncio
async def test_plaintext_client_is_refused(port: int) -> None:
    with pytest.raises(aio.AioRpcError) as failure:
        await echo(port, None)
    assert failure.value.code() is grpc.StatusCode.UNAVAILABLE
