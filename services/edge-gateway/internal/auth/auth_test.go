package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/mentor-sator/Sifer/internal/accesstoken"
)

type signer struct {
	kid     string
	public  ed25519.PublicKey
	private ed25519.PrivateKey
}

func newSigner(t *testing.T, kid string) signer {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return signer{kid: kid, public: public, private: private}
}

func (s signer) jwk() map[string]string {
	return map[string]string{"kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(s.public), "kid": s.kid, "use": "sig", "alg": "EdDSA"}
}

type jwksServer struct {
	mu       sync.Mutex
	signers  []signer
	requests atomic.Int32
	fail     atomic.Bool
	server   *httptest.Server
}

func newJWKSServer(t *testing.T, signers ...signer) *jwksServer {
	t.Helper()
	j := &jwksServer{signers: signers}
	j.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		j.requests.Add(1)
		if j.fail.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		j.mu.Lock()
		keys := []map[string]string{}
		for _, s := range j.signers {
			keys = append(keys, s.jwk())
		}
		j.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": keys})
	}))
	t.Cleanup(j.server.Close)
	return j
}

func (j *jwksServer) set(signers ...signer) {
	j.mu.Lock()
	j.signers = signers
	j.mu.Unlock()
}

func quiet() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newKeys(url string) *Keys {
	return NewKeys(url, &http.Client{Timeout: 2 * time.Second}, quiet())
}

type tokenOptions struct {
	issuer, audience, typ, email, subject string
	issuedAt, expires                     time.Time
	omitKid                               bool
}

func defaults() tokenOptions {
	now := time.Now()
	return tokenOptions{
		issuer: accesstoken.Issuer, audience: accesstoken.Audience, typ: accesstoken.Type,
		email: "ninette@example.com", subject: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
		issuedAt: now, expires: now.Add(accesstoken.TTL),
	}
}

func mint(t *testing.T, s signer, o tokenOptions) string {
	t.Helper()
	claims := accesstoken.Claims{
		Email: o.email,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    o.issuer,
			Subject:   o.subject,
			Audience:  jwt.ClaimStrings{o.audience},
			IssuedAt:  jwt.NewNumericDate(o.issuedAt),
			ExpiresAt: jwt.NewNumericDate(o.expires),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	if !o.omitKid {
		token.Header["kid"] = s.kid
	}
	token.Header["typ"] = o.typ
	signed, err := token.SignedString(s.private)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func TestVerifyAcceptsAValidToken(t *testing.T) {
	s := newSigner(t, "k1")
	keys := newKeys(newJWKSServer(t, s).server.URL)
	if err := keys.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	principal, err := NewVerifier(keys).Verify(context.Background(), mint(t, s, defaults()))
	if err != nil || principal.Email != "ninette@example.com" || principal.UserID != "7c9e6679-7425-40de-944b-e07fc1f90ae7" {
		t.Fatalf("Verify = %+v, %v", principal, err)
	}
}

func TestVerifyRejectsBadTokens(t *testing.T) {
	s := newSigner(t, "k1")
	impostor := newSigner(t, "k1")
	keys := newKeys(newJWKSServer(t, s).server.URL)
	if err := keys.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	verifier := NewVerifier(keys)
	with := func(change func(*tokenOptions)) string {
		o := defaults()
		change(&o)
		return mint(t, s, o)
	}
	valid := mint(t, s, defaults())
	parts := strings.Split(valid, ".")
	tampered := parts[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(`{"iss":"sifer-identity","aud":["sifer"],"sub":"someone-else","email":"x@y.co","exp":9999999999,"iat":1}`)) + "." + parts[2]
	unsignedHeader := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"at+jwt","kid":"k1"}`))
	hmac := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"iss": accesstoken.Issuer, "aud": accesstoken.Audience, "sub": "x", "email": "x@y.co", "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix()})
	hmac.Header["kid"] = "k1"
	hmac.Header["typ"] = accesstoken.Type
	confused, _ := hmac.SignedString([]byte(s.public))
	cases := map[string]string{
		"expired": with(func(o *tokenOptions) {
			o.issuedAt = time.Now().Add(-time.Hour)
			o.expires = time.Now().Add(-time.Minute)
		}),
		"issued in future": with(func(o *tokenOptions) {
			o.issuedAt = time.Now().Add(time.Hour)
			o.expires = time.Now().Add(2 * time.Hour)
		}),
		"wrong issuer":         with(func(o *tokenOptions) { o.issuer = "someone-else" }),
		"wrong audience":       with(func(o *tokenOptions) { o.audience = "other" }),
		"id token typ":         with(func(o *tokenOptions) { o.typ = "JWT" }),
		"no email":             with(func(o *tokenOptions) { o.email = "" }),
		"no subject":           with(func(o *tokenOptions) { o.subject = "" }),
		"no kid":               with(func(o *tokenOptions) { o.omitKid = true }),
		"forged with same kid": mint(t, impostor, defaults()),
		"tampered claims":      tampered,
		"alg none":             unsignedHeader + "." + parts[1] + ".",
		"hs256 confusion":      confused,
		"garbage":              "not.a.token",
		"empty":                "",
	}
	for name, raw := range cases {
		if _, err := verifier.Verify(context.Background(), raw); !errors.Is(err, ErrInvalidToken) {
			t.Errorf("%s: err = %v, want ErrInvalidToken", name, err)
		}
	}
}

func TestLeewayToleratesSmallClockSkew(t *testing.T) {
	s := newSigner(t, "k1")
	keys := newKeys(newJWKSServer(t, s).server.URL)
	_ = keys.Refresh(context.Background())
	o := defaults()
	o.issuedAt = time.Now().Add(10 * time.Second)
	if _, err := NewVerifier(keys).Verify(context.Background(), mint(t, s, o)); err != nil {
		t.Fatalf("10 s skew rejected: %v", err)
	}
}

func TestKnownKidNeedsNoNetwork(t *testing.T) {
	s := newSigner(t, "k1")
	server := newJWKSServer(t, s)
	keys := newKeys(server.server.URL)
	_ = keys.Refresh(context.Background())
	verifier := NewVerifier(keys)
	for range 50 {
		if _, err := verifier.Verify(context.Background(), mint(t, s, defaults())); err != nil {
			t.Fatal(err)
		}
	}
	if got := server.requests.Load(); got != 1 {
		t.Fatalf("%d JWKS requests for 50 verifications, want 1", got)
	}
}

func TestRotationIsPickedUpOnUnknownKid(t *testing.T) {
	oldKey, newKey := newSigner(t, "old"), newSigner(t, "new")
	server := newJWKSServer(t, oldKey)
	keys := newKeys(server.server.URL)
	_ = keys.Refresh(context.Background())
	server.set(oldKey, newKey)
	if _, err := NewVerifier(keys).Verify(context.Background(), mint(t, newKey, defaults())); err != nil {
		t.Fatalf("token from the rotated key: %v", err)
	}
}

func TestUnknownKidsCannotHammerIdentity(t *testing.T) {
	s := newSigner(t, "k1")
	server := newJWKSServer(t, s)
	keys := newKeys(server.server.URL)
	_ = keys.Refresh(context.Background())
	verifier := NewVerifier(keys)
	for i := range 20 {
		stranger := newSigner(t, "stranger-"+string(rune('a'+i)))
		if _, err := verifier.Verify(context.Background(), mint(t, stranger, defaults())); !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("stranger %d: %v", i, err)
		}
	}
	if got := server.requests.Load(); got != 2 {
		t.Fatalf("%d JWKS requests, want 2 (startup + one forced refresh per minute)", got)
	}
}

func TestFailedRefreshKeepsKeys(t *testing.T) {
	s := newSigner(t, "k1")
	server := newJWKSServer(t, s)
	keys := newKeys(server.server.URL)
	_ = keys.Refresh(context.Background())
	server.fail.Store(true)
	if err := keys.Refresh(context.Background()); err == nil {
		t.Fatal("refresh against a 503 succeeded")
	}
	if _, err := NewVerifier(keys).Verify(context.Background(), mint(t, s, defaults())); err != nil {
		t.Fatalf("keys lost after a failed refresh: %v", err)
	}
}

func TestNoKeysIsDistinguishable(t *testing.T) {
	s := newSigner(t, "k1")
	server := newJWKSServer(t, s)
	server.fail.Store(true)
	keys := newKeys(server.server.URL)
	if _, err := NewVerifier(keys).Verify(context.Background(), mint(t, s, defaults())); !errors.Is(err, ErrNoKeys) {
		t.Fatalf("err = %v, want ErrNoKeys", err)
	}
}

func TestRunLoadsKeysAndStops(t *testing.T) {
	s := newSigner(t, "k1")
	keys := newKeys(newJWKSServer(t, s).server.URL)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { keys.Run(ctx); close(done) }()
	deadline := time.Now().Add(2 * time.Second)
	for !keys.Loaded() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !keys.Loaded() {
		t.Fatal("Run did not load keys")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not stop on cancel")
	}
}

func TestParseJWKSKeepsOnlyUsableKeys(t *testing.T) {
	good := newSigner(t, "good")
	document, _ := json.Marshal(map[string]any{"keys": []map[string]string{
		good.jwk(),
		{"kty": "EC", "crv": "P-256", "x": "abc", "kid": "ec"},
		{"kty": "OKP", "crv": "Ed25519", "x": "c2hvcnQ", "kid": "short"},
		{"kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(good.public), "kid": ""},
		{"kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(good.public), "kid": "enc", "use": "enc"},
	}})
	keys, err := parseJWKS(document)
	if err != nil || len(keys) != 1 || keys["good"] == nil {
		t.Fatalf("keys = %v, %v", keys, err)
	}
	if _, err := parseJWKS([]byte(`{"keys":[]}`)); err == nil {
		t.Fatal("empty JWKS accepted")
	}
}

func TestOversizedJWKSIsRefused(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"keys":[],"pad":"` + strings.Repeat("x", 70<<10) + `"}`))
	}))
	defer server.Close()
	if err := newKeys(server.URL).Refresh(context.Background()); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("err = %v", err)
	}
}
