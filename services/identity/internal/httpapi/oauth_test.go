package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mentor-sator/Sifer/services/identity/internal/federation"
	"github.com/mentor-sator/Sifer/services/identity/internal/oauth"
	"github.com/mentor-sator/Sifer/services/identity/internal/session"
)

type fakeFederation struct {
	startErr  error
	finishErr error
	started   []string
	finished  []string
}

func (f *fakeFederation) Start(_ context.Context, provider, redirectURI string, forceConsent bool) (string, error) {
	f.started = append(f.started, fmt.Sprintf("%s|%s|%t", provider, redirectURI, forceConsent))
	return "https://accounts.google.com/o/oauth2/v2/auth?state=s1", f.startErr
}

func (f *fakeFederation) Finish(_ context.Context, provider, state, code string) (session.Tokens, error) {
	f.finished = append(f.finished, provider+"|"+state+"|"+code)
	return session.Tokens{
		AccessToken:      "access-1",
		AccessExpiresAt:  time.Now().Add(15 * time.Minute),
		RefreshToken:     "refresh-1",
		RefreshExpiresAt: time.Now().Add(session.RefreshTTL),
	}, f.finishErr
}

func oauthCall(t *testing.T, f Federation, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	NewRouter(Dependencies{Federation: f, Logger: quietLogger()}).ServeHTTP(recorder, request)
	var decoded map[string]any
	_ = json.Unmarshal(recorder.Body.Bytes(), &decoded)
	return recorder, decoded
}

func TestOAuthStartReturnsAuthorizationURL(t *testing.T) {
	f := &fakeFederation{}
	recorder, body := oauthCall(t, f, "/v1/oauth/google/start", `{"redirect_uri":"http://127.0.0.1:53682/oauth/callback","force_consent":true}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
	if body["authorization_url"] != "https://accounts.google.com/o/oauth2/v2/auth?state=s1" || body["expires_in"] != float64(600) {
		t.Fatalf("body = %v", body)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("start response is cacheable")
	}
	if f.started[0] != "google|http://127.0.0.1:53682/oauth/callback|true" {
		t.Fatalf("started = %v", f.started)
	}
}

func TestOAuthStartMapsErrors(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{federation.ErrUnknownProvider, http.StatusNotFound, "unknown_provider"},
		{oauth.ErrInvalidRedirect, http.StatusBadRequest, "invalid_redirect_uri"},
		{oauth.ErrTooManyFlows, http.StatusServiceUnavailable, "busy"},
		{fmt.Errorf("boom"), http.StatusInternalServerError, "internal"},
	}
	for _, tc := range cases {
		recorder, body := oauthCall(t, &fakeFederation{startErr: tc.err}, "/v1/oauth/google/start", `{"redirect_uri":"x"}`)
		if recorder.Code != tc.status || body["error"] != tc.code {
			t.Fatalf("%v: status = %d, body = %v", tc.err, recorder.Code, body)
		}
	}
}

func TestOAuthFinishReturnsSiferTokens(t *testing.T) {
	f := &fakeFederation{}
	recorder, body := oauthCall(t, f, "/v1/oauth/google/finish", `{"state":"s1","code":"c1"}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
	if body["access_token"] != "access-1" || body["refresh_token"] != "refresh-1" || body["token_type"] != "Bearer" {
		t.Fatalf("body = %v", body)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("token response is cacheable")
	}
	if f.finished[0] != "google|s1|c1" {
		t.Fatalf("finished = %v", f.finished)
	}
}

func TestOAuthFinishMapsErrors(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{federation.ErrUnknownProvider, http.StatusNotFound, "unknown_provider"},
		{federation.ErrInvalidRequest, http.StatusBadRequest, "invalid_request"},
		{oauth.ErrUnknownState, http.StatusBadRequest, "invalid_state"},
		{fmt.Errorf("%w: invalid_grant", oauth.ErrExchangeRejected), http.StatusBadRequest, "invalid_grant"},
		{federation.ErrEmailUnverified, http.StatusForbidden, "email_unverified"},
		{federation.ErrAccountDisabled, http.StatusForbidden, "account_disabled"},
		{federation.ErrAccountExists, http.StatusConflict, "account_exists"},
		{federation.ErrConsentRequired, http.StatusConflict, "consent_required"},
		{fmt.Errorf("%w: status 500", oauth.ErrExchangeFailed), http.StatusBadGateway, "provider_unavailable"},
		{oauth.ErrInvalidIDToken, http.StatusBadGateway, "provider_unavailable"},
		{context.DeadlineExceeded, http.StatusServiceUnavailable, "busy"},
		{fmt.Errorf("boom"), http.StatusInternalServerError, "internal"},
	}
	for _, tc := range cases {
		recorder, body := oauthCall(t, &fakeFederation{finishErr: tc.err}, "/v1/oauth/google/finish", `{"state":"s","code":"c"}`)
		if recorder.Code != tc.status || body["error"] != tc.code {
			t.Fatalf("%v: status = %d, body = %v", tc.err, recorder.Code, body)
		}
		if _, leaked := body["access_token"]; leaked {
			t.Fatalf("%v: tokens returned with an error", tc.err)
		}
	}
}

func TestOAuthEndpointsRejectBadBodies(t *testing.T) {
	for _, path := range []string{"/v1/oauth/google/start", "/v1/oauth/google/finish"} {
		for _, body := range []string{"", "[]", `{"unknown":1}`, `{} {}`} {
			recorder, decoded := oauthCall(t, &fakeFederation{}, path, body)
			if recorder.Code != http.StatusBadRequest || decoded["error"] != "invalid_json" {
				t.Fatalf("%s %q: status = %d, body = %v", path, body, recorder.Code, decoded)
			}
		}
		recorder, decoded := oauthCall(t, &fakeFederation{}, path, `{"state":"`+strings.Repeat("a", maxOAuthBody)+`"}`)
		if recorder.Code != http.StatusRequestEntityTooLarge || decoded["error"] != "body_too_large" {
			t.Fatalf("%s oversized: status = %d", path, recorder.Code)
		}
	}
}

func TestOAuthEndpointsWithoutProvidersAre404(t *testing.T) {
	for _, path := range []string{"/v1/oauth/google/start", "/v1/oauth/google/finish"} {
		recorder, body := oauthCall(t, nil, path, `{}`)
		if recorder.Code != http.StatusNotFound || body["error"] != "unknown_provider" {
			t.Fatalf("%s: status = %d, body = %v", path, recorder.Code, body)
		}
	}
}
