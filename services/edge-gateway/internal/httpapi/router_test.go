package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	siferv1 "github.com/mentor-sator/Sifer/gen/go/sifer/v1"
)

type fakeOrchestrator struct {
	err   error
	calls int
}

func (f *fakeOrchestrator) Echo(_ context.Context, in *siferv1.EchoRequest, _ ...grpc.CallOption) (*siferv1.EchoResponse, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return &siferv1.EchoResponse{Envelope: in.GetEnvelope()}, nil
}

func send(t *testing.T, orchestrator *fakeOrchestrator, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	NewRouter(orchestrator, nil).ServeHTTP(recorder, request)
	return recorder
}

func errorCode(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("error body %q: %v", recorder.Body.String(), err)
	}
	return payload.Error
}

func TestHealthz(t *testing.T) {
	recorder := send(t, &fakeOrchestrator{}, http.MethodGet, "/healthz", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if body := strings.TrimSpace(recorder.Body.String()); body != `{"status":"ok"}` {
		t.Fatalf("body = %s", body)
	}
}

func TestUnknownRouteIsNotFound(t *testing.T) {
	recorder := send(t, &fakeOrchestrator{}, http.MethodGet, "/nope", "")
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
	}
}

func TestEchoRoundTripsTheEnvelope(t *testing.T) {
	orchestrator := &fakeOrchestrator{}
	sent := `{"schemaMajor":1,"traceId":"0192f0c4-7b1e-7cc0-9d6a-3f2b8e1a4c55","sessionId":"p1","seq":"42"}`

	recorder := send(t, orchestrator, http.MethodPost, "/v1/echo", sent)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if orchestrator.calls != 1 {
		t.Fatalf("orchestrator calls = %d, want 1", orchestrator.calls)
	}
	want, got := &siferv1.Envelope{}, &siferv1.Envelope{}
	if err := protojson.Unmarshal([]byte(sent), want); err != nil {
		t.Fatal(err)
	}
	if err := protojson.Unmarshal(recorder.Body.Bytes(), got); err != nil {
		t.Fatalf("response is not an Envelope: %v", err)
	}
	if !proto.Equal(want, got) {
		t.Fatalf("echo = %v, want %v", got, want)
	}
}

func TestEchoRejectsAnotherSchemaMajor(t *testing.T) {
	orchestrator := &fakeOrchestrator{}

	recorder := send(t, orchestrator, http.MethodPost, "/v1/echo", `{"schemaMajor":2}`)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
	}
	if orchestrator.calls != 0 {
		t.Fatal("a mismatched envelope reached the orchestrator")
	}
	var payload struct {
		Error    string `json:"error"`
		Expected uint32 `json:"expected"`
		Received uint32 `json:"received"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error != "schema_major_mismatch" || payload.Expected != 1 || payload.Received != 2 {
		t.Fatalf("409 body = %s", recorder.Body.String())
	}
}

func TestEchoRejectsBadBodies(t *testing.T) {
	cases := map[string]string{
		"empty":         "",
		"not json":      "schemaMajor=1",
		"unknown field": `{"schemaMajor":1,"surprise":true}`,
		"wrong type":    `{"schemaMajor":"one"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			orchestrator := &fakeOrchestrator{}
			recorder := send(t, orchestrator, http.MethodPost, "/v1/echo", body)
			if recorder.Code != http.StatusBadRequest || errorCode(t, recorder) != "invalid_envelope" {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if orchestrator.calls != 0 {
				t.Fatal("an invalid body reached the orchestrator")
			}
		})
	}
}

func TestEchoRejectsOversizedBodies(t *testing.T) {
	body := `{"schemaMajor":1,"traceId":"` + strings.Repeat("a", maxBodyBytes) + `"}`
	recorder := send(t, &fakeOrchestrator{}, http.MethodPost, "/v1/echo", body)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusRequestEntityTooLarge)
	}
}

func TestEchoMapsUpstreamFailures(t *testing.T) {
	cases := []struct {
		code       codes.Code
		wantStatus int
		wantError  string
	}{
		{codes.InvalidArgument, http.StatusBadRequest, "invalid_argument"},
		{codes.FailedPrecondition, http.StatusConflict, "failed_precondition"},
		{codes.DeadlineExceeded, http.StatusGatewayTimeout, "upstream_timeout"},
		{codes.Unavailable, http.StatusServiceUnavailable, "upstream_unavailable"},
		{codes.Internal, http.StatusBadGateway, "upstream_error"},
	}
	for _, tc := range cases {
		t.Run(tc.code.String(), func(t *testing.T) {
			orchestrator := &fakeOrchestrator{err: status.Error(tc.code, "upstream said no")}
			recorder := send(t, orchestrator, http.MethodPost, "/v1/echo", `{"schemaMajor":1}`)
			if recorder.Code != tc.wantStatus || errorCode(t, recorder) != tc.wantError {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
