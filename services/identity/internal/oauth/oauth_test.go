package oauth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const redirect = "http://127.0.0.1:53682/oauth/callback"

type clock struct{ at time.Time }

func (c *clock) now() time.Time { return c.at }

func newClock() *clock {
	return &clock{at: time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)}
}

func testProvider(tokenURL string) Provider {
	provider := Google("client-123.apps.googleusercontent.com", "GOCSPX-test")
	if tokenURL != "" {
		provider.TokenURL = tokenURL
	}
	return provider
}

func TestChallengeMatchesRFC7636(t *testing.T) {
	got := Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
	if got != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" {
		t.Fatalf("challenge = %q", got)
	}
}

func TestValidateRedirect(t *testing.T) {
	valid := []string{redirect, "http://127.0.0.1:1024/oauth/callback", "http://127.0.0.1:65535/oauth/callback"}
	for _, raw := range valid {
		if err := ValidateRedirect(raw); err != nil {
			t.Fatalf("ValidateRedirect(%q) = %v", raw, err)
		}
	}
	invalid := []string{
		"",
		"https://127.0.0.1:53682/oauth/callback",
		"http://localhost:53682/oauth/callback",
		"http://[::1]:53682/oauth/callback",
		"http://192.168.1.5:53682/oauth/callback",
		"http://127.0.0.1/oauth/callback",
		"http://127.0.0.1:80/oauth/callback",
		"http://127.0.0.1:065535/oauth/callback",
		"http://127.0.0.1:70000/oauth/callback",
		"http://127.0.0.1:53682/other",
		"http://127.0.0.1:53682/oauth/callback?x=1",
		"http://127.0.0.1:53682/oauth/callback#x",
		"http://user@127.0.0.1:53682/oauth/callback",
	}
	for _, raw := range invalid {
		if err := ValidateRedirect(raw); !errors.Is(err, ErrInvalidRedirect) {
			t.Fatalf("ValidateRedirect(%q) = %v, want ErrInvalidRedirect", raw, err)
		}
	}
}

func TestBeginBuildsAuthorizationURL(t *testing.T) {
	c := newClock()
	flows := NewFlows(c.now)
	authURL, pending, err := flows.Begin(testProvider(""), redirect, false)
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Scheme+"://"+parsed.Host+parsed.Path != googleAuthURL {
		t.Fatalf("endpoint = %s", authURL)
	}
	query := parsed.Query()
	want := map[string]string{
		"response_type":          "code",
		"client_id":              "client-123.apps.googleusercontent.com",
		"redirect_uri":           redirect,
		"scope":                  "openid email profile",
		"code_challenge":         Challenge(pending.Verifier),
		"code_challenge_method":  "S256",
		"nonce":                  pending.Nonce,
		"access_type":            "offline",
		"include_granted_scopes": "true",
	}
	for key, value := range want {
		if query.Get(key) != value {
			t.Fatalf("%s = %q, want %q", key, query.Get(key), value)
		}
	}
	if query.Has("prompt") || query.Has("client_secret") || query.Has("code_verifier") {
		t.Fatalf("unexpected parameters: %v", query)
	}
	if len(query.Get("state")) != 43 || len(pending.Verifier) != 43 || len(pending.Nonce) != 43 {
		t.Fatal("state, verifier and nonce must be 32 random bytes")
	}
	if !pending.ExpiresAt.Equal(c.at.Add(FlowTTL)) || pending.Provider != "google" {
		t.Fatalf("pending = %+v", pending)
	}

	forced, _, err := flows.Begin(testProvider(""), redirect, true)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(forced, "prompt=consent") {
		t.Fatalf("forced consent missing: %s", forced)
	}
}

func TestBeginRefusesBadRedirect(t *testing.T) {
	flows := NewFlows(newClock().now)
	if _, _, err := flows.Begin(testProvider(""), "http://evil.example/oauth/callback", false); !errors.Is(err, ErrInvalidRedirect) {
		t.Fatalf("error = %v", err)
	}
}

func stateOf(t *testing.T, authURL string) string {
	t.Helper()
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	return parsed.Query().Get("state")
}

func TestTakeIsOneTimeAndExpires(t *testing.T) {
	c := newClock()
	flows := NewFlows(c.now)
	authURL, pending, _ := flows.Begin(testProvider(""), redirect, false)
	state := stateOf(t, authURL)

	got, err := flows.Take(state)
	if err != nil || got != pending {
		t.Fatalf("Take = %+v, %v", got, err)
	}
	if _, err := flows.Take(state); !errors.Is(err, ErrUnknownState) {
		t.Fatalf("second Take error = %v", err)
	}
	if _, err := flows.Take("never-issued"); !errors.Is(err, ErrUnknownState) {
		t.Fatalf("unknown Take error = %v", err)
	}

	authURL, _, _ = flows.Begin(testProvider(""), redirect, false)
	c.at = c.at.Add(FlowTTL)
	if _, err := flows.Take(stateOf(t, authURL)); !errors.Is(err, ErrUnknownState) {
		t.Fatalf("expired Take error = %v", err)
	}
}

func TestFlowsAreBoundedAndExpiredOnesAreSwept(t *testing.T) {
	c := newClock()
	flows := NewFlows(c.now)
	for range maxPendingFlows {
		if _, _, err := flows.Begin(testProvider(""), redirect, false); err != nil {
			t.Fatalf("Begin: %v", err)
		}
	}
	if _, _, err := flows.Begin(testProvider(""), redirect, false); !errors.Is(err, ErrTooManyFlows) {
		t.Fatalf("error = %v, want ErrTooManyFlows", err)
	}
	c.at = c.at.Add(FlowTTL + time.Second)
	if _, _, err := flows.Begin(testProvider(""), redirect, false); err != nil {
		t.Fatalf("Begin after expiry: %v", err)
	}
}

func idToken(t *testing.T, claims map[string]any) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","kid":"k1"}`))
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	return header + "." + base64.RawURLEncoding.EncodeToString(payload) + ".c2ln"
}

func goodClaims(c *clock, nonce string) map[string]any {
	return map[string]any{
		"iss":            "https://accounts.google.com",
		"aud":            "client-123.apps.googleusercontent.com",
		"sub":            "110169484474386276334",
		"exp":            c.at.Add(time.Hour).Unix(),
		"iat":            c.at.Unix(),
		"nonce":          nonce,
		"email":          "Ninette@Example.com",
		"email_verified": true,
		"name":           "Ninette",
	}
}

func TestIdentifyAcceptsValidClaims(t *testing.T) {
	c := newClock()
	exchanger := NewExchanger(http.DefaultClient, c.now)
	pending := Pending{Nonce: "n-1"}
	identity, err := exchanger.Identify(testProvider(""), pending, idToken(t, goodClaims(c, "n-1")))
	if err != nil {
		t.Fatalf("Identify: %v", err)
	}
	want := Identity{Subject: "110169484474386276334", Email: "Ninette@Example.com", EmailVerified: true, Name: "Ninette"}
	if identity != want {
		t.Fatalf("identity = %+v", identity)
	}

	claims := goodClaims(c, "n-1")
	claims["iss"] = "accounts.google.com"
	claims["aud"] = []string{"other", "client-123.apps.googleusercontent.com"}
	claims["email_verified"] = "true"
	identity, err = exchanger.Identify(testProvider(""), pending, idToken(t, claims))
	if err != nil || !identity.EmailVerified {
		t.Fatalf("variant claims: %+v, %v", identity, err)
	}
}

func TestIdentifyRefusesBadClaims(t *testing.T) {
	c := newClock()
	exchanger := NewExchanger(http.DefaultClient, c.now)
	pending := Pending{Nonce: "n-1"}
	cases := map[string]func(map[string]any){
		"issuer":   func(m map[string]any) { m["iss"] = "https://evil.example" },
		"audience": func(m map[string]any) { m["aud"] = "someone-else" },
		"aud list": func(m map[string]any) { m["aud"] = []string{"a", "b"} },
		"subject":  func(m map[string]any) { m["sub"] = "" },
		"nonce":    func(m map[string]any) { m["nonce"] = "n-2" },
		"expired":  func(m map[string]any) { m["exp"] = c.at.Add(-2 * time.Minute).Unix() },
		"future":   func(m map[string]any) { m["iat"] = c.at.Add(5 * time.Minute).Unix() },
	}
	for name, mutate := range cases {
		claims := goodClaims(c, "n-1")
		mutate(claims)
		if _, err := exchanger.Identify(testProvider(""), pending, idToken(t, claims)); !errors.Is(err, ErrInvalidIDToken) {
			t.Fatalf("%s: error = %v, want ErrInvalidIDToken", name, err)
		}
	}
	for _, raw := range []string{"", "a.b", "a.!!!.c", "a." + base64.RawURLEncoding.EncodeToString([]byte("[")) + ".c"} {
		if _, err := exchanger.Identify(testProvider(""), pending, raw); !errors.Is(err, ErrInvalidIDToken) {
			t.Fatalf("malformed %q: error = %v", raw, err)
		}
	}

	claims := goodClaims(c, "n-1")
	claims["email_verified"] = false
	identity, err := exchanger.Identify(testProvider(""), pending, idToken(t, claims))
	if err != nil || identity.EmailVerified {
		t.Fatalf("unverified email: %+v, %v", identity, err)
	}
}

func TestExchangeSendsPKCEAndParsesTokens(t *testing.T) {
	c := newClock()
	var form url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		form, _ = url.ParseQuery(string(body))
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
			http.Error(w, "bad request shape", http.StatusTeapot)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"ya29.a","refresh_token":"1//r","expires_in":3599,"scope":"openid https://www.googleapis.com/auth/userinfo.email","id_token":"h.p.s","token_type":"Bearer"}`))
	}))
	defer server.Close()

	pending := Pending{Verifier: "verifier-1", RedirectURI: redirect}
	tokens, err := NewExchanger(server.Client(), c.now).Exchange(context.Background(), testProvider(server.URL), pending, "code-1")
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	want := map[string]string{
		"grant_type":    "authorization_code",
		"code":          "code-1",
		"redirect_uri":  redirect,
		"client_id":     "client-123.apps.googleusercontent.com",
		"client_secret": "GOCSPX-test",
		"code_verifier": "verifier-1",
	}
	for key, value := range want {
		if form.Get(key) != value {
			t.Fatalf("form %s = %q, want %q", key, form.Get(key), value)
		}
	}
	if tokens.AccessToken != "ya29.a" || tokens.RefreshToken != "1//r" || tokens.IDToken != "h.p.s" {
		t.Fatalf("tokens = %+v", tokens)
	}
	if !tokens.ExpiresAt.Equal(c.at.Add(3599*time.Second)) || len(tokens.Scopes) != 2 {
		t.Fatalf("expiry or scopes wrong: %+v", tokens)
	}
}

func TestExchangeErrors(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"invalid grant", http.StatusBadRequest, `{"error":"invalid_grant"}`, ErrExchangeRejected},
		{"bad client", http.StatusUnauthorized, `{"error":"invalid_client"}`, ErrExchangeRejected},
		{"server error", http.StatusInternalServerError, `oops`, ErrExchangeFailed},
		{"not json", http.StatusOK, `<html>`, ErrExchangeFailed},
		{"no id token", http.StatusOK, `{"access_token":"a","expires_in":60,"token_type":"Bearer"}`, ErrExchangeFailed},
		{"wrong type", http.StatusOK, `{"access_token":"a","expires_in":60,"token_type":"mac","id_token":"x"}`, ErrExchangeFailed},
	}
	for _, tc := range cases {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(tc.body))
		}))
		_, err := NewExchanger(server.Client(), newClock().now).Exchange(context.Background(), testProvider(server.URL), Pending{RedirectURI: redirect}, "code")
		server.Close()
		if !errors.Is(err, tc.want) {
			t.Fatalf("%s: error = %v, want %v", tc.name, err, tc.want)
		}
		if strings.Contains(err.Error(), "GOCSPX") {
			t.Fatalf("%s: error leaks the client secret", tc.name)
		}
	}

	unreachable := testProvider("http://127.0.0.1:1/token")
	if _, err := NewExchanger(http.DefaultClient, newClock().now).Exchange(context.Background(), unreachable, Pending{}, "code"); !errors.Is(err, ErrExchangeFailed) {
		t.Fatalf("unreachable error = %v", err)
	}
}
