package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mentor-sator/Sifer/services/identity/internal/signing"
)

type pinger struct {
	err   error
	delay time.Duration
}

func (p pinger) Ping(ctx context.Context) error {
	select {
	case <-time.After(p.delay):
		return p.err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func serve(t *testing.T, db Pinger, path string) (int, map[string]string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	NewRouter(Dependencies{DB: db, Logger: quietLogger()}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	body := map[string]string{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("%s body %q: %v", path, recorder.Body.String(), err)
	}
	return recorder.Code, body
}

func TestHealthzIgnoresDatabase(t *testing.T) {
	code, body := serve(t, pinger{err: errors.New("down")}, "/healthz")
	if code != http.StatusOK || body["status"] != "ok" {
		t.Fatalf("healthz = %d %v", code, body)
	}
}

func TestReadyzWhenDatabaseAnswers(t *testing.T) {
	code, body := serve(t, pinger{}, "/readyz")
	if code != http.StatusOK || body["database"] != "ok" {
		t.Fatalf("readyz = %d %v", code, body)
	}
}

func TestReadyzWhenDatabaseFails(t *testing.T) {
	code, body := serve(t, pinger{err: errors.New("connection refused")}, "/readyz")
	if code != http.StatusServiceUnavailable || body["database"] != "unreachable" {
		t.Fatalf("readyz = %d %v", code, body)
	}
}

func TestReadyzGivesUpOnSlowDatabase(t *testing.T) {
	started := time.Now()
	code, _ := serve(t, pinger{delay: time.Minute}, "/readyz")
	if code != http.StatusServiceUnavailable {
		t.Fatalf("readyz = %d, want 503", code)
	}
	if elapsed := time.Since(started); elapsed > readyTimeout+time.Second {
		t.Fatalf("readyz took %s", elapsed)
	}
}

func TestUnknownRouteIs404(t *testing.T) {
	recorder := httptest.NewRecorder()
	NewRouter(Dependencies{DB: pinger{}, Logger: quietLogger()}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/nothing", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d", recorder.Code)
	}
}

type staticKeys struct{}

func (staticKeys) JWKS() signing.JWKSet {
	return signing.JWKSet{Keys: []signing.JWK{{Kty: "OKP", Crv: "Ed25519", X: "x", Kid: "kid", Use: "sig", Alg: "EdDSA"}}}
}

func TestJWKSPublishesKeysWithCaching(t *testing.T) {
	recorder := httptest.NewRecorder()
	NewRouter(Dependencies{Keys: staticKeys{}, Logger: quietLogger()}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=300" {
		t.Fatalf("Cache-Control = %q", got)
	}
	var set signing.JWKSet
	if err := json.Unmarshal(recorder.Body.Bytes(), &set); err != nil {
		t.Fatal(err)
	}
	if len(set.Keys) != 1 || set.Keys[0].Kid != "kid" || set.Keys[0].Alg != "EdDSA" {
		t.Fatalf("jwks = %+v", set)
	}
}
