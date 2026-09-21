from sifer.v1 import envelope_pb2 as _envelope_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EchoRequest(_message.Message):
    __slots__ = ("envelope",)
    ENVELOPE_FIELD_NUMBER: _ClassVar[int]
    envelope: _envelope_pb2.Envelope
    def __init__(self, envelope: _Optional[_Union[_envelope_pb2.Envelope, _Mapping]] = ...) -> None: ...

class EchoResponse(_message.Message):
    __slots__ = ("envelope",)
    ENVELOPE_FIELD_NUMBER: _ClassVar[int]
    envelope: _envelope_pb2.Envelope
    def __init__(self, envelope: _Optional[_Union[_envelope_pb2.Envelope, _Mapping]] = ...) -> None: ...
