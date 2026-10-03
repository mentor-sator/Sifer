package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"

	siferv1 "github.com/mentor-sator/Sifer/gen/go/sifer/v1"
	"github.com/mentor-sator/Sifer/internal/telemetry"
)

var spans = tracetest.NewSpanRecorder()

func TestMain(m *testing.M) {
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spans)))
	otel.SetTextMapPropagator(telemetry.Propagator())
	os.Exit(m.Run())
}

type tracingOrchestrator struct {
	seen trace.SpanContext
}

func (o *tracingOrchestrator) Echo(ctx context.Context, in *siferv1.EchoRequest, _ ...grpc.CallOption) (*siferv1.EchoResponse, error) {
	o.seen = trace.SpanContextFromContext(ctx)
	return &siferv1.EchoResponse{Envelope: in.GetEnvelope()}, nil
}

func echoWithTrace(t *testing.T, orchestrator siferv1.OrchestratorServiceClient, traceparent string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/echo", strings.NewReader(`{"schemaMajor":1}`))
	if traceparent != "" {
		request.Header.Set("traceparent", traceparent)
	}
	NewRouter(orchestrator, nil).ServeHTTP(recorder, request)
	return recorder
}

func TestEchoContinuesTheCallersTrace(t *testing.T) {
	const traceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	orchestrator := &tracingOrchestrator{}

	recorder := echoWithTrace(t, orchestrator, "00-"+traceID+"-00f067aa0ba902b7-01")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if got := orchestrator.seen.TraceID().String(); got != traceID {
		t.Fatalf("orchestrator saw trace %s, want %s", got, traceID)
	}
	if got := recorder.Header().Get("traceparent"); !strings.HasPrefix(got, "00-"+traceID+"-") {
		t.Fatalf("response traceparent = %q", got)
	}
}

func TestEchoMintsATraceWhenNoneArrives(t *testing.T) {
	orchestrator := &tracingOrchestrator{}

	recorder := echoWithTrace(t, orchestrator, "")

	if !orchestrator.seen.IsValid() {
		t.Fatal("orchestrator call carried no trace")
	}
	want := "00-" + orchestrator.seen.TraceID().String() + "-"
	if got := recorder.Header().Get("traceparent"); !strings.HasPrefix(got, want) {
		t.Fatalf("response traceparent = %q, want prefix %q", got, want)
	}
}

func TestEchoRecordsAServerSpan(t *testing.T) {
	orchestrator := &tracingOrchestrator{}

	echoWithTrace(t, orchestrator, "")

	for _, span := range spans.Ended() {
		if span.SpanContext().TraceID() == orchestrator.seen.TraceID() {
			if span.SpanKind() != trace.SpanKindServer || span.Name() != "POST /v1/echo" {
				t.Fatalf("span %q kind %v", span.Name(), span.SpanKind())
			}
			return
		}
	}
	t.Fatal("no server span recorded for the request")
}

func TestHealthChecksAreNotTraced(t *testing.T) {
	before := len(spans.Ended())
	recorder := httptest.NewRecorder()
	NewRouter(&fakeOrchestrator{}, nil).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if after := len(spans.Ended()); after != before {
		t.Fatalf("health check produced %d spans", after-before)
	}
}
