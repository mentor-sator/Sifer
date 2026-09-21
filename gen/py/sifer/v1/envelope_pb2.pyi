import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from sifer.v1 import interaction_pb2 as _interaction_pb2
from sifer.v1 import session_pb2 as _session_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Envelope(_message.Message):
    __slots__ = ("schema_major", "trace_id", "session_id", "seq", "emitted_at", "drop_context", "instruction", "fix_plan", "action_plan", "action_result", "screen_snapshot", "step_change", "overlay_command", "speech_chunk", "session_control", "confirm_request", "authority_request", "consult_request", "diagnostic_delta")
    SCHEMA_MAJOR_FIELD_NUMBER: _ClassVar[int]
    TRACE_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    SEQ_FIELD_NUMBER: _ClassVar[int]
    EMITTED_AT_FIELD_NUMBER: _ClassVar[int]
    DROP_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTION_FIELD_NUMBER: _ClassVar[int]
    FIX_PLAN_FIELD_NUMBER: _ClassVar[int]
    ACTION_PLAN_FIELD_NUMBER: _ClassVar[int]
    ACTION_RESULT_FIELD_NUMBER: _ClassVar[int]
    SCREEN_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    STEP_CHANGE_FIELD_NUMBER: _ClassVar[int]
    OVERLAY_COMMAND_FIELD_NUMBER: _ClassVar[int]
    SPEECH_CHUNK_FIELD_NUMBER: _ClassVar[int]
    SESSION_CONTROL_FIELD_NUMBER: _ClassVar[int]
    CONFIRM_REQUEST_FIELD_NUMBER: _ClassVar[int]
    AUTHORITY_REQUEST_FIELD_NUMBER: _ClassVar[int]
    CONSULT_REQUEST_FIELD_NUMBER: _ClassVar[int]
    DIAGNOSTIC_DELTA_FIELD_NUMBER: _ClassVar[int]
    schema_major: int
    trace_id: str
    session_id: str
    seq: int
    emitted_at: _timestamp_pb2.Timestamp
    drop_context: _interaction_pb2.DropContext
    instruction: _interaction_pb2.Instruction
    fix_plan: _interaction_pb2.FixPlan
    action_plan: _interaction_pb2.ActionPlan
    action_result: _interaction_pb2.ActionResult
    screen_snapshot: _session_pb2.ScreenSnapshot
    step_change: _session_pb2.StepChange
    overlay_command: _session_pb2.OverlayCommand
    speech_chunk: _session_pb2.SpeechChunk
    session_control: _session_pb2.SessionControl
    confirm_request: _interaction_pb2.ConfirmRequest
    authority_request: _interaction_pb2.AuthorityRequest
    consult_request: _interaction_pb2.ConsultRequest
    diagnostic_delta: _interaction_pb2.DiagnosticDelta
    def __init__(self, schema_major: _Optional[int] = ..., trace_id: _Optional[str] = ..., session_id: _Optional[str] = ..., seq: _Optional[int] = ..., emitted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., drop_context: _Optional[_Union[_interaction_pb2.DropContext, _Mapping]] = ..., instruction: _Optional[_Union[_interaction_pb2.Instruction, _Mapping]] = ..., fix_plan: _Optional[_Union[_interaction_pb2.FixPlan, _Mapping]] = ..., action_plan: _Optional[_Union[_interaction_pb2.ActionPlan, _Mapping]] = ..., action_result: _Optional[_Union[_interaction_pb2.ActionResult, _Mapping]] = ..., screen_snapshot: _Optional[_Union[_session_pb2.ScreenSnapshot, _Mapping]] = ..., step_change: _Optional[_Union[_session_pb2.StepChange, _Mapping]] = ..., overlay_command: _Optional[_Union[_session_pb2.OverlayCommand, _Mapping]] = ..., speech_chunk: _Optional[_Union[_session_pb2.SpeechChunk, _Mapping]] = ..., session_control: _Optional[_Union[_session_pb2.SessionControl, _Mapping]] = ..., confirm_request: _Optional[_Union[_interaction_pb2.ConfirmRequest, _Mapping]] = ..., authority_request: _Optional[_Union[_interaction_pb2.AuthorityRequest, _Mapping]] = ..., consult_request: _Optional[_Union[_interaction_pb2.ConsultRequest, _Mapping]] = ..., diagnostic_delta: _Optional[_Union[_interaction_pb2.DiagnosticDelta, _Mapping]] = ...) -> None: ...
