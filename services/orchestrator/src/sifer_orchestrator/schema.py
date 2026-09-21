from sifer.v1 import envelope_pb2


def major_from_package(package: str) -> int:
    _, separator, version = package.rpartition(".v")
    if not separator or not version.isdigit():
        raise RuntimeError(f"contract package {package!r} carries no major version")
    return int(version)


SCHEMA_MAJOR = major_from_package(envelope_pb2.DESCRIPTOR.package)
