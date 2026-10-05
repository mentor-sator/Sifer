package httpapi_test

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mentor-sator/Sifer/services/identity/internal/federation"
	"github.com/mentor-sator/Sifer/services/identity/internal/grant"
	"github.com/mentor-sator/Sifer/services/identity/internal/httpapi"
	"github.com/mentor-sator/Sifer/services/identity/internal/oauth"
	"github.com/mentor-sator/Sifer/services/identity/internal/password"
	"github.com/mentor-sator/Sifer/services/identity/internal/session"
	"github.com/mentor-sator/Sifer/services/identity/internal/signing"
	"github.com/mentor-sator/Sifer/services/identity/internal/store"
	"github.com/mentor-sator/Sifer/services/identity/internal/token"
)

const (
	liveClientID = "live-client.apps.googleusercontent.com"
	liveRedirect = "http://127.0.0.1:53682/oauth/callback"
)

type fakeGoogle struct {
	server  *httptest.Server
	subject string
	email   string
	nonce   string
	refresh string
	access  string
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	t.Helper()
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		t.Fatal(err)
	}
	id := hex.EncodeToString(buf)
	g := &fakeGoogle{subject: "google-" + id, email: "Live-" + id + "@Sifer.test"}
	g.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(body))
		if form.Get("client_id") != liveClientID || form.Get("client_secret") != "GOCSPX-live" || form.Get("code") != "good-code" || form.Get("code_verifier") == "" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		claims, _ := json.Marshal(map[string]any{
			"iss": "https://accounts.google.com", "aud": liveClientID, "sub": g.subject,
			"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(), "nonce": g.nonce,
			"email": g.email, "email_verified": true, "name": "Live Test",
		})
		idToken := "eyJhbGciOiJSUzI1NiJ9." + base64.RawURLEncoding.EncodeToString(claims) + ".c2ln"
		response := map[string]any{
			"access_token": g.access, "expires_in": 3599, "token_type": "Bearer", "id_token": idToken,
			"scope": "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
		}
		if g.refresh != "" {
			response["refresh_token"] = g.refresh
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	t.Cleanup(g.server.Close)
	return g
}

type liveRig struct {
	handler http.Handler
	google  *fakeGoogle
	sealer  *grant.Sealer
	pool    *pgxpool.Pool
}

func newLiveRig(t *testing.T) *liveRig {
	t.Helper()
	databaseURL := os.Getenv("SIFER_TEST_IDENTITY_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("SIFER_TEST_IDENTITY_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, _, err := store.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	encodedSigning, _ := signing.Generate()
	key, err := signing.Parse(encodedSigning)
	if err != nil {
		t.Fatal(err)
	}
	accounts := store.NewAccounts(pool)
	hasher := password.NewHasher(password.Params{Memory: 8 * 1024, Iterations: 1, Parallelism: 1, SaltLength: 16, KeyLength: 32}, 2)
	sessions, err := session.NewService(ctx, accounts, store.NewRefreshTokens(pool), hasher, token.NewIssuer(key))
	if err != nil {
		t.Fatal(err)
	}
	encodedGrant, _ := grant.Generate()
	grantKey, _ := grant.ParseKey(encodedGrant)
	sealer, _ := grant.NewSealer(grantKey)

	google := newFakeGoogle(t)
	provider := oauth.Google(liveClientID, "GOCSPX-live")
	provider.TokenURL = google.server.URL
	exchanger := oauth.NewExchanger(google.server.Client(), time.Now)
	service := federation.NewService([]oauth.Provider{provider}, oauth.NewFlows(time.Now), exchanger, store.NewFederated(pool), sealer, sessions)

	handler := httpapi.NewRouter(httpapi.Dependencies{
		DB:         pool,
		Sessions:   sessions,
		Federation: service,
		Keys:       key,
		Logger:     slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return &liveRig{handler: handler, google: google, sealer: sealer, pool: pool}
}

func (r *liveRig) post(t *testing.T, path, body string) (int, map[string]any) {
	t.Helper()
	recorder := httptest.NewRecorder()
	r.handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
	var decoded map[string]any
	_ = json.Unmarshal(recorder.Body.Bytes(), &decoded)
	return recorder.Code, decoded
}

func (r *liveRig) start(t *testing.T, force bool) string {
	t.Helper()
	body := `{"redirect_uri":"` + liveRedirect + `"}`
	if force {
		body = `{"redirect_uri":"` + liveRedirect + `","force_consent":true}`
	}
	status, decoded := r.post(t, "/v1/oauth/google/start", body)
	if status != http.StatusOK {
		t.Fatalf("start status = %d, body = %v", status, decoded)
	}
	authURL, _ := url.Parse(decoded["authorization_url"].(string))
	r.google.nonce = authURL.Query().Get("nonce")
	return authURL.Query().Get("state")
}

func (r *liveRig) finish(t *testing.T, state, code string) (int, map[string]any) {
	t.Helper()
	return r.post(t, "/v1/oauth/google/finish", `{"state":"`+state+`","code":"`+code+`"}`)
}

func (r *liveRig) refreshWorks(t *testing.T, tokens map[string]any) {
	t.Helper()
	status, refreshed := r.post(t, "/v1/refresh", `{"refresh_token":"`+tokens["refresh_token"].(string)+`"}`)
	if status != http.StatusOK || refreshed["access_token"] == "" {
		t.Fatalf("refresh after OAuth sign-in: status = %d, body = %v", status, refreshed)
	}
}

func TestLiveGoogleSignInEndToEnd(t *testing.T) {
	rig := newLiveRig(t)
	rig.google.access, rig.google.refresh = "ya29.first", "1//first"

	state := rig.start(t, false)
	status, tokens := rig.finish(t, state, "good-code")
	if status != http.StatusOK || tokens["token_type"] != "Bearer" {
		t.Fatalf("finish status = %d, body = %v", status, tokens)
	}
	rig.refreshWorks(t, tokens)

	if status, body := rig.finish(t, state, "good-code"); status != http.StatusBadRequest || body["error"] != "invalid_state" {
		t.Fatalf("replayed state: status = %d, body = %v", status, body)
	}

	rig.google.access, rig.google.refresh = "ya29.second", ""
	if status, body := rig.finish(t, rig.start(t, false), "good-code"); status != http.StatusOK {
		t.Fatalf("second sign-in without refresh token: status = %d, body = %v", status, body)
	}

	var userID, email string
	var sealed grant.Sealed
	var live, revoked int
	err := rig.pool.QueryRow(context.Background(),
		`SELECT g.user_id::text, a.email, g.dek_wrapped, g.access_ct, g.refresh_ct,
		        (SELECT count(*) FROM identity.third_party_grant WHERE user_id = g.user_id AND revoked_at IS NULL),
		        (SELECT count(*) FROM identity.third_party_grant WHERE user_id = g.user_id AND revoked_at IS NOT NULL)
		 FROM identity.external_identity e
		 JOIN identity.user_account a ON a.id = e.user_id
		 JOIN identity.third_party_grant g ON g.user_id = e.user_id AND g.revoked_at IS NULL
		 WHERE e.provider = 'google' AND e.subject = $1`,
		rig.google.subject,
	).Scan(&userID, &email, &sealed.DEKWrapped, &sealed.AccessCT, &sealed.RefreshCT, &live, &revoked)
	if err != nil {
		t.Fatalf("reading the stored grant: %v", err)
	}
	if email != strings.ToLower(rig.google.email) || live != 1 || revoked != 1 {
		t.Fatalf("email = %q, live = %d, revoked = %d", email, live, revoked)
	}
	secrets, err := rig.sealer.Open(grant.Binding{UserID: userID, Provider: "google"}, sealed)
	if err != nil {
		t.Fatalf("stored grant does not open: %v", err)
	}
	if secrets.Access != "ya29.second" || secrets.Refresh != "1//first" {
		t.Fatalf("stored grant = %+v", secrets)
	}
}

func TestLiveGoogleSignInRefusals(t *testing.T) {
	rig := newLiveRig(t)
	rig.google.access, rig.google.refresh = "ya29.x", ""

	if status, body := rig.finish(t, rig.start(t, false), "good-code"); status != http.StatusConflict || body["error"] != "consent_required" {
		t.Fatalf("first sign-in without refresh token: status = %d, body = %v", status, body)
	}
	if status, body := rig.finish(t, rig.start(t, true), "bad-code"); status != http.StatusBadRequest || body["error"] != "invalid_grant" {
		t.Fatalf("bad code: status = %d, body = %v", status, body)
	}
	if status, body := rig.finish(t, "never-issued", "good-code"); status != http.StatusBadRequest || body["error"] != "invalid_state" {
		t.Fatalf("unknown state: status = %d, body = %v", status, body)
	}
	if status, body := rig.post(t, "/v1/oauth/microsoft/start", `{"redirect_uri":"`+liveRedirect+`"}`); status != http.StatusNotFound || body["error"] != "unknown_provider" {
		t.Fatalf("unknown provider: status = %d, body = %v", status, body)
	}
}
