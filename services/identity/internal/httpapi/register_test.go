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

	"github.com/mentor-sator/Sifer/services/identity/internal/account"
)

type registrar struct {
	got account.Registration
	err error
}

func (r *registrar) Register(_ context.Context, registration account.Registration) (account.Account, error) {
	r.got = registration
	if r.err != nil {
		return account.Account{}, r.err
	}
	return account.Account{
		ID:          "7c9e6679-7425-40de-944b-e07fc1f90ae7",
		Email:       "ninette@example.com",
		DisplayName: "Ninette",
		Locale:      "en",
		CreatedAt:   time.Date(2026, 9, 22, 8, 0, 0, 0, time.FixedZone("CAT", 2*3600)),
	}, nil
}

func post(t *testing.T, accounts Registrar, body string) (int, map[string]string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/register", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	NewRouter(Dependencies{DB: pinger{}, Accounts: accounts, Logger: quietLogger()}).ServeHTTP(recorder, request)
	response := map[string]string{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("body %q: %v", recorder.Body.String(), err)
	}
	return recorder.Code, response
}

func TestRegisterCreatesAccount(t *testing.T) {
	accounts := &registrar{}
	code, body := post(t, accounts, `{"email":"Ninette@Example.com","password":"correct horse battery staple","display_name":"Ninette"}`)
	if code != http.StatusCreated {
		t.Fatalf("status = %d %v", code, body)
	}
	if body["id"] != "7c9e6679-7425-40de-944b-e07fc1f90ae7" || body["email"] != "ninette@example.com" || body["created_at"] != "2026-09-22T06:00:00Z" {
		t.Fatalf("body = %v", body)
	}
	if _, leaked := body["password"]; leaked {
		t.Fatal("response echoes the password")
	}
	if accounts.got.Email != "Ninette@Example.com" || accounts.got.Password != "correct horse battery staple" {
		t.Fatalf("registrar got %+v", accounts.got)
	}
}

func TestRegisterMapsErrors(t *testing.T) {
	valid := `{"email":"a@b.co","password":"correct horse battery staple"}`
	cases := []struct {
		name   string
		err    error
		body   string
		status int
		code   string
	}{
		{"validation", &account.ValidationError{Field: "password", Reason: "must be at least 15 characters"}, valid, http.StatusBadRequest, "invalid_password"},
		{"taken", account.ErrEmailTaken, valid, http.StatusConflict, "email_taken"},
		{"busy", context.DeadlineExceeded, valid, http.StatusServiceUnavailable, "busy"},
		{"internal", errors.New("disk on fire"), valid, http.StatusInternalServerError, "internal"},
		{"not json", nil, `email=a`, http.StatusBadRequest, "invalid_json"},
		{"unknown field", nil, `{"email":"a@b.co","password":"x","admin":true}`, http.StatusBadRequest, "invalid_json"},
		{"two objects", nil, valid + valid, http.StatusBadRequest, "invalid_json"},
		{"too large", nil, `{"email":"` + strings.Repeat("a", 5000) + `"}`, http.StatusRequestEntityTooLarge, "body_too_large"},
	}
	for _, tc := range cases {
		code, body := post(t, &registrar{err: tc.err}, tc.body)
		if code != tc.status || body["error"] != tc.code {
			t.Errorf("%s: %d %v, want %d %s", tc.name, code, body, tc.status, tc.code)
		}
		if strings.Contains(body["message"], "disk on fire") {
			t.Errorf("%s: internal error leaked to caller", tc.name)
		}
	}
}
