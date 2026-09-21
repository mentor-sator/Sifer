from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class SessionKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SESSION_KIND_UNSPECIFIED: _ClassVar[SessionKind]
    SESSION_KIND_ADIUTOR: _ClassVar[SessionKind]
    SESSION_KIND_MOBILE_LIVE: _ClassVar[SessionKind]
    SESSION_KIND_VIDE_APPICA: _ClassVar[SessionKind]
    SESSION_KIND_COMITIS: _ClassVar[SessionKind]

class SessionMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SESSION_MODE_UNSPECIFIED: _ClassVar[SessionMode]
    SESSION_MODE_GUIDED: _ClassVar[SessionMode]
    SESSION_MODE_OBSERVED: _ClassVar[SessionMode]
    SESSION_MODE_DELEGATED: _ClassVar[SessionMode]

class SessionState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SESSION_STATE_UNSPECIFIED: _ClassVar[SessionState]
    SESSION_STATE_STARTING: _ClassVar[SessionState]
    SESSION_STATE_PLANNING: _ClassVar[SessionState]
    SESSION_STATE_RUNNING: _ClassVar[SessionState]
    SESSION_STATE_PAUSED: _ClassVar[SessionState]
    SESSION_STATE_AWAITING_USER: _ClassVar[SessionState]
    SESSION_STATE_COMPLETED: _ClassVar[SessionState]
    SESSION_STATE_ABANDONED: _ClassVar[SessionState]
    SESSION_STATE_FAILED: _ClassVar[SessionState]

class StepState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    STEP_STATE_UNSPECIFIED: _ClassVar[StepState]
    STEP_STATE_PENDING: _ClassVar[StepState]
    STEP_STATE_INSTRUCTED: _ClassVar[StepState]
    STEP_STATE_IN_PROGRESS: _ClassVar[StepState]
    STEP_STATE_VERIFIED: _ClassVar[StepState]
    STEP_STATE_FAILED: _ClassVar[StepState]
    STEP_STATE_DELEGATED: _ClassVar[StepState]
    STEP_STATE_SKIPPED: _ClassVar[StepState]
SESSION_KIND_UNSPECIFIED: SessionKind
SESSION_KIND_ADIUTOR: SessionKind
SESSION_KIND_MOBILE_LIVE: SessionKind
SESSION_KIND_VIDE_APPICA: SessionKind
SESSION_KIND_COMITIS: SessionKind
SESSION_MODE_UNSPECIFIED: SessionMode
SESSION_MODE_GUIDED: SessionMode
SESSION_MODE_OBSERVED: SessionMode
SESSION_MODE_DELEGATED: SessionMode
SESSION_STATE_UNSPECIFIED: SessionState
SESSION_STATE_STARTING: SessionState
SESSION_STATE_PLANNING: SessionState
SESSION_STATE_RUNNING: SessionState
SESSION_STATE_PAUSED: SessionState
SESSION_STATE_AWAITING_USER: SessionState
SESSION_STATE_COMPLETED: SessionState
SESSION_STATE_ABANDONED: SessionState
SESSION_STATE_FAILED: SessionState
STEP_STATE_UNSPECIFIED: StepState
STEP_STATE_PENDING: StepState
STEP_STATE_INSTRUCTED: StepState
STEP_STATE_IN_PROGRESS: StepState
STEP_STATE_VERIFIED: StepState
STEP_STATE_FAILED: StepState
STEP_STATE_DELEGATED: StepState
STEP_STATE_SKIPPED: StepState

class SessionControl(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ScreenSnapshot(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class StepChange(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class OverlayCommand(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class SpeechChunk(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
