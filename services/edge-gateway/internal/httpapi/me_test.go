package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mentor-sator/Sifer/services/edge-gateway/internal/auth"
)

type verifier struct {
	err  error
	seen string
}

func (v *verifier) Verify(_ context.Context, raw string) (auth.Principal, error) {
	v.seen = raw
	if v.err != nil {
		return auth.Principal{}, v.err
	}
	return auth.Principal{UserID: "7c9e6679-7425-40de-944b-e07fc1f90ae7", Email: "ninette@example.com"}, nil
}

func getMe(t *testing.T, v Verifier, authorization string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	NewRouter(&fakeOrchestrator{}, v).ServeHTTP(recorder, request)
	return recorder
}

func TestMeReturnsTheVerifiedPrincipal(t *testing.T) {
	v := &verifier{}
	recorder := getMe(t, v, "Bearer header.payload.signature")
	if recorder.Code != http.StatusOK || v.seen != "header.payload.signature" || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status %d, seen %q", recorder.Code, v.seen)
	}
	var body map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["email"] != "ninette@example.com" || body["id"] != "7c9e6679-7425-40de-944b-e07fc1f90ae7" {
		t.Fatalf("body = %v", body)
	}
}

func TestMeAcceptsLowercaseScheme(t *testing.T) {
	if recorder := getMe(t, &verifier{}, "bearer abc.def.ghi"); recorder.Code != http.StatusOK {
		t.Fatalf("status %d", recorder.Code)
	}
}

func TestMeRequiresAToken(t *testing.T) {
	v := &verifier{}
	for _, header := range []string{"", "Bearer", "Bearer   ", "Basic dXNlcjpwYXNz", "Token abc"} {
		recorder := getMe(t, v, header)
		if recorder.Code != http.StatusUnauthorized || errorCode(t, recorder) != "unauthenticated" || recorder.Header().Get("WWW-Authenticate") == "" {
			t.Errorf("%q: %d %s", header, recorder.Code, recorder.Body.String())
		}
	}
	if v.seen != "" {
		t.Fatal("verifier called without a bearer token")
	}
}

func TestMeRejectsInvalidTokens(t *testing.T) {
	recorder := getMe(t, &verifier{err: auth.ErrInvalidToken}, "Bearer forged")
	if recorder.Code != http.StatusUnauthorized || errorCode(t, recorder) != "invalid_token" {
		t.Fatalf("%d %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("WWW-Authenticate"); got != `Bearer realm="sifer", error="invalid_token"` {
		t.Fatalf("WWW-Authenticate = %q", got)
	}
}

func TestMeIs503WithoutKeys(t *testing.T) {
	recorder := getMe(t, &verifier{err: auth.ErrNoKeys}, "Bearer any")
	if recorder.Code != http.StatusServiceUnavailable || errorCode(t, recorder) != "auth_unavailable" {
		t.Fatalf("%d %s", recorder.Code, recorder.Body.String())
	}
}

func TestMeDoesNotLeakVerifierErrors(t *testing.T) {
	recorder := getMe(t, &verifier{err: errors.New("kid k9 not found in cache")}, "Bearer any")
	if recorder.Code != http.StatusUnauthorized || strings.Contains(recorder.Body.String(), "k9") {
		t.Fatalf("%d %s", recorder.Code, recorder.Body.String())
	}
}
