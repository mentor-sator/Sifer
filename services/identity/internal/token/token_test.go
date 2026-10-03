package token

import (
	"crypto/ed25519"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/mentor-sator/Sifer/internal/accesstoken"
	"github.com/mentor-sator/Sifer/services/identity/internal/signing"
)

func newKey(t *testing.T) *signing.Key {
	t.Helper()
	encoded, err := signing.Generate()
	if err != nil {
		t.Fatal(err)
	}
	key, err := signing.Parse(encoded)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func parse(t *testing.T, raw string, public ed25519.PublicKey) (*jwt.Token, *accesstoken.Claims, error) {
	t.Helper()
	claims := &accesstoken.Claims{}
	parsed, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) { return public, nil },
		jwt.WithValidMethods([]string{"EdDSA"}),
		jwt.WithIssuer(accesstoken.Issuer),
		jwt.WithAudience(accesstoken.Audience),
		jwt.WithExpirationRequired(),
	)
	return parsed, claims, err
}

func TestAccessTokenVerifiesWithPublicKey(t *testing.T) {
	key := newKey(t)
	issuer := NewIssuer(key)
	fixed := time.Now().UTC().Add(-time.Hour)
	issuer.now = func() time.Time { return fixed }
	raw, expires, err := issuer.Access("7c9e6679-7425-40de-944b-e07fc1f90ae7", "ninette@example.com")
	if err != nil {
		t.Fatalf("Access: %v", err)
	}
	if !expires.Equal(fixed.Truncate(time.Second).Add(accesstoken.TTL)) {
		t.Fatalf("expires = %s", expires)
	}
	issuer.now = time.Now
	fresh, _, _ := issuer.Access("7c9e6679-7425-40de-944b-e07fc1f90ae7", "ninette@example.com")
	parsed, claims, err := parse(t, fresh, key.Public())
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.Header["kid"] != key.ID() || parsed.Header["typ"] != accesstoken.Type || parsed.Header["alg"] != "EdDSA" {
		t.Fatalf("header = %v", parsed.Header)
	}
	if claims.Subject != "7c9e6679-7425-40de-944b-e07fc1f90ae7" || claims.Email != "ninette@example.com" || len(claims.ID) != 22 {
		t.Fatalf("claims = %+v", claims)
	}
	if _, _, err := parse(t, raw, key.Public()); !errors.Is(err, jwt.ErrTokenExpired) {
		t.Fatalf("token issued an hour ago: err = %v, want expired", err)
	}
}

func TestAccessTokenFailsWithAnotherKey(t *testing.T) {
	raw, _, err := NewIssuer(newKey(t)).Access("user", "a@b.co")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := parse(t, raw, newKey(t).Public()); !errors.Is(err, jwt.ErrTokenSignatureInvalid) {
		t.Fatalf("err = %v, want signature invalid", err)
	}
}

func TestTokenIDsAreUnique(t *testing.T) {
	issuer := NewIssuer(newKey(t))
	first, _, _ := issuer.Access("user", "a@b.co")
	second, _, _ := issuer.Access("user", "a@b.co")
	if first == second {
		t.Fatal("two tokens are identical")
	}
}
