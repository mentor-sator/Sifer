package session

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type accounts struct {
	byEmail map[string]Credentials
	updated map[string]string
}

func (a *accounts) FindCredentials(_ context.Context, email string) (Credentials, error) {
	credentials, ok := a.byEmail[email]
	if !ok {
		return Credentials{}, ErrUnknownAccount
	}
	return credentials, nil
}

func (a *accounts) UpdatePasswordHash(_ context.Context, userID, hash string) error {
	a.updated[userID] = hash
	return nil
}

type refreshes struct {
	created   [][]byte
	rotated   [][]byte
	revoked   [][]byte
	rotateErr error
}

func (r *refreshes) CreateRefresh(_ context.Context, _ string, hash []byte, _ time.Time) error {
	r.created = append(r.created, hash)
	return nil
}

func (r *refreshes) RotateRefresh(_ context.Context, presented, next []byte, _ time.Time) (Holder, error) {
	r.rotated = append(r.rotated, presented, next)
	if r.rotateErr != nil {
		return Holder{}, r.rotateErr
	}
	return Holder{UserID: "u1", Email: "ninette@example.com"}, nil
}

func (r *refreshes) RevokeRefreshFamily(_ context.Context, presented []byte) error {
	r.revoked = append(r.revoked, presented)
	return nil
}

type hasher struct {
	verified []string
	rehash   bool
}

func (h *hasher) Hash(_ context.Context, password string) (string, error) {
	return "hash:" + password, nil
}

func (h *hasher) Verify(_ context.Context, password, encoded string) (bool, error) {
	h.verified = append(h.verified, encoded)
	if encoded != "hash:"+password {
		return false, errors.New("mismatch")
	}
	return h.rehash, nil
}

type issuer struct{}

func (issuer) Access(userID, email string) (string, time.Time, error) {
	return "access:" + userID + ":" + email, time.Now().Add(15 * time.Minute), nil
}

func newService(t *testing.T, h *hasher) (*Service, *accounts, *refreshes) {
	t.Helper()
	a := &accounts{
		byEmail: map[string]Credentials{
			"ninette@example.com": {UserID: "u1", Email: "ninette@example.com", PasswordHash: "hash:correct horse battery staple"},
			"oauth@example.com":   {UserID: "u2", Email: "oauth@example.com"},
		},
		updated: map[string]string{},
	}
	r := &refreshes{}
	s, err := NewService(context.Background(), a, r, h, issuer{})
	if err != nil {
		t.Fatal(err)
	}
	return s, a, r
}

func TestLoginIssuesTokens(t *testing.T) {
	s, _, r := newService(t, &hasher{})
	tokens, err := s.Login(context.Background(), " Ninette@Example.com ", "correct horse battery staple")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if tokens.AccessToken != "access:u1:ninette@example.com" || len(tokens.RefreshToken) != refreshLength {
		t.Fatalf("tokens = %+v", tokens)
	}
	stored, _ := hashRefresh(tokens.RefreshToken)
	if len(r.created) != 1 || !bytes.Equal(r.created[0], stored) {
		t.Fatal("stored refresh hash does not match the issued token")
	}
	if time.Until(tokens.RefreshExpiresAt) < RefreshTTL-time.Minute {
		t.Fatalf("refresh expires %s", tokens.RefreshExpiresAt)
	}
}

func TestLoginFailuresAreIndistinguishableAndAlwaysHash(t *testing.T) {
	h := &hasher{}
	s, _, r := newService(t, h)
	cases := map[string][2]string{
		"wrong password":  {"ninette@example.com", "correct horse battery stapler"},
		"unknown email":   {"nobody@example.com", "correct horse battery staple"},
		"malformed email": {"not-an-email", "correct horse battery staple"},
		"oauth only":      {"oauth@example.com", "correct horse battery staple"},
		"huge password":   {"ninette@example.com", strings.Repeat("x", 2000)},
	}
	for name, input := range cases {
		before := len(h.verified)
		if _, err := s.Login(context.Background(), input[0], input[1]); !errors.Is(err, ErrInvalidCredentials) {
			t.Errorf("%s: err = %v", name, err)
		}
		if name != "huge password" && len(h.verified) != before+1 {
			t.Errorf("%s: no password verification ran", name)
		}
	}
	if len(r.created) != 0 {
		t.Fatal("refresh token created on a failed login")
	}
}

func TestLoginRehashesOldParameters(t *testing.T) {
	s, a, _ := newService(t, &hasher{rehash: true})
	if _, err := s.Login(context.Background(), "ninette@example.com", "correct horse battery staple"); err != nil {
		t.Fatal(err)
	}
	if a.updated["u1"] != "hash:correct horse battery staple" {
		t.Fatalf("updated = %v", a.updated)
	}
}

func TestRefreshRotates(t *testing.T) {
	s, _, r := newService(t, &hasher{})
	old, oldHash, _ := newRefresh()
	tokens, err := s.Refresh(context.Background(), old)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	nextHash, _ := hashRefresh(tokens.RefreshToken)
	if tokens.RefreshToken == old || !bytes.Equal(r.rotated[0], oldHash) || !bytes.Equal(r.rotated[1], nextHash) {
		t.Fatal("rotation did not present the old hash and store the new one")
	}
}

func TestRefreshRejectsMalformedWithoutStore(t *testing.T) {
	s, _, r := newService(t, &hasher{})
	for _, input := range []string{"", "short", strings.Repeat("a", 43) + "=", strings.Repeat("!", 43)} {
		if _, err := s.Refresh(context.Background(), input); !errors.Is(err, ErrInvalidRefresh) {
			t.Errorf("%q: err = %v", input, err)
		}
	}
	if len(r.rotated) != 0 {
		t.Fatal("malformed token reached the store")
	}
}

func TestRefreshPassesReuseThrough(t *testing.T) {
	s, _, r := newService(t, &hasher{})
	r.rotateErr = ErrRefreshReused
	token, _, _ := newRefresh()
	if _, err := s.Refresh(context.Background(), token); !errors.Is(err, ErrRefreshReused) {
		t.Fatalf("err = %v", err)
	}
}

func TestLogoutRevokesFamily(t *testing.T) {
	s, _, r := newService(t, &hasher{})
	token, hash, _ := newRefresh()
	if err := s.Logout(context.Background(), token); err != nil || len(r.revoked) != 1 || !bytes.Equal(r.revoked[0], hash) {
		t.Fatalf("Logout: %v, revoked %d", err, len(r.revoked))
	}
	if err := s.Logout(context.Background(), "garbage"); err != nil || len(r.revoked) != 1 {
		t.Fatal("garbage token reached the store")
	}
}
