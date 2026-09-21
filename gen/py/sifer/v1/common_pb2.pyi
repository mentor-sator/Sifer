from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ConfirmClass(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CONFIRM_CLASS_UNSPECIFIED: _ClassVar[ConfirmClass]
    CONFIRM_CLASS_NONE: _ClassVar[ConfirmClass]
    CONFIRM_CLASS_IRREVERSIBLE_FILESYSTEM: _ClassVar[ConfirmClass]
    CONFIRM_CLASS_IRREVERSIBLE_VCS: _ClassVar[ConfirmClass]
    CONFIRM_CLASS_IRREVERSIBLE_DATA: _ClassVar[ConfirmClass]
    CONFIRM_CLASS_IRREVERSIBLE_DEVICE: _ClassVar[ConfirmClass]
    CONFIRM_CLASS_PAYMENT_COMPLETION: _ClassVar[ConfirmClass]
CONFIRM_CLASS_UNSPECIFIED: ConfirmClass
CONFIRM_CLASS_NONE: ConfirmClass
CONFIRM_CLASS_IRREVERSIBLE_FILESYSTEM: ConfirmClass
CONFIRM_CLASS_IRREVERSIBLE_VCS: ConfirmClass
CONFIRM_CLASS_IRREVERSIBLE_DATA: ConfirmClass
CONFIRM_CLASS_IRREVERSIBLE_DEVICE: ConfirmClass
CONFIRM_CLASS_PAYMENT_COMPLETION: ConfirmClass
