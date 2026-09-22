package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mentor-sator/Sifer/services/identity/internal/session"
)

type sessions struct {
	err       error
	loggedOut string
}

func (s *sessions) tokens() session.Tokens {
	now := time.Now()
	return session.Tokens{
		AccessToken:      "header.payload.signature",
		AccessExpiresAt:  now.Add(15 * time.Minute),
		RefreshToken:     strings.Repeat("r", 43),
		RefreshExpiresAt: now.Add(30 * 24 * time.Hour),
	}
}

func (s *sessions) Login(_ context.Context, _, _ string) (session.Tokens, error) {
	if s.err != nil {
		return session.Tokens{}, s.err
	}
	return s.tokens(), nil
}

func (s *sessions) Refresh(_ context.Context, _ string) (session.Tokens, error) {
	if s.err != nil {
		return session.Tokens{}, s.err
	}
	return s.tokens(), nil
}

func (s *sessions) Logout(_ context.Context, token string) error {
	s.loggedOut = token
	return s.err
}

func call(t *testing.T, s Sessions, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	NewRouter(Dependencies{Sessions: s, Logger: quietLogger()}).ServeHTTP(recorder, request)
	return recorder
}

func TestLoginReturnsTokensUncached(t *testing.T) {
	recorder := call(t, &sessions{}, "/v1/login", `{"email":"a@b.co","password":"correct horse battery staple"}`)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status %d, cache %q", recorder.Code, recorder.Header().Get("Cache-Control"))
	}
	var body tokenResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.TokenType != "Bearer" || body.ExpiresIn != 900 || body.RefreshExpiresIn != 2592000 || body.AccessToken == "" {
		t.Fatalf("body = %+v", body)
	}
}

func TestTokenEndpointsMapErrors(t *testing.T) {
	cases := []struct {
		path   string
		err    error
		status int
		code   string
	}{
		{"/v1/login", session.ErrInvalidCredentials, http.StatusUnauthorized, "invalid_credentials"},
		{"/v1/login", context.DeadlineExceeded, http.StatusServiceUnavailable, "busy"},
		{"/v1/login", errors.New("database exploded"), http.StatusInternalServerError, "internal"},
		{"/v1/refresh", session.ErrInvalidRefresh, http.StatusUnauthorized, "invalid_refresh_token"},
		{"/v1/refresh", session.ErrRefreshReused, http.StatusUnauthorized, "invalid_refresh_token"},
	}
	for _, tc := range cases {
		body := `{"email":"a@b.co","password":"p"}`
		if tc.path == "/v1/refresh" {
			body = `{"refresh_token":"x"}`
		}
		recorder := call(t, &sessions{err: tc.err}, tc.path, body)
		var response map[string]string
		_ = json.Unmarshal(recorder.Body.Bytes(), &response)
		if recorder.Code != tc.status || response["error"] != tc.code || strings.Contains(recorder.Body.String(), "exploded") {
			t.Errorf("%s %v: %d %s", tc.path, tc.err, recorder.Code, recorder.Body.String())
		}
	}
}

func TestTokenEndpointsRejectBadJSON(t *testing.T) {
	for _, path := range []string{"/v1/login", "/v1/refresh", "/v1/logout"} {
		if recorder := call(t, &sessions{}, path, `{"unexpected":1}`); recorder.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", path, recorder.Code)
		}
	}
}

func TestLogoutIs204(t *testing.T) {
	s := &sessions{}
	recorder := call(t, s, "/v1/logout", `{"refresh_token":"abc"}`)
	if recorder.Code != http.StatusNoContent || s.loggedOut != "abc" {
		t.Fatalf("status %d, logged out %q", recorder.Code, s.loggedOut)
	}
}
