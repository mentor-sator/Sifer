package federation

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/mentor-sator/Sifer/services/identity/internal/grant"
	"github.com/mentor-sator/Sifer/services/identity/internal/oauth"
	"github.com/mentor-sator/Sifer/services/identity/internal/session"
)

const redirect = "http://127.0.0.1:53682/oauth/callback"

type exchanger struct {
	tokens      oauth.TokenSet
	identity    oauth.Identity
	exchangeErr error
	identifyErr error
	codes       []string
}

func (e *exchanger) Exchange(_ context.Context, _ oauth.Provider, _ oauth.Pending, code string) (oauth.TokenSet, error) {
	e.codes = append(e.codes, code)
	return e.tokens, e.exchangeErr
}

func (e *exchanger) Identify(_ oauth.Provider, _ oauth.Pending, _ string) (oauth.Identity, error) {
	return e.identity, e.identifyErr
}

type store struct {
	userID  string
	current *grant.Sealed
	linked  []Link
	sealed  []grant.Sealed
	linkErr error
}

func (s *store) Link(_ context.Context, link Link, seal SealFunc) (session.Holder, error) {
	if s.linkErr != nil {
		return session.Holder{}, s.linkErr
	}
	sealed, err := seal(s.userID, s.current)
	if err != nil {
		return session.Holder{}, err
	}
	s.linked = append(s.linked, link)
	s.sealed = append(s.sealed, sealed)
	return session.Holder{UserID: s.userID, Email: link.Email}, nil
}

type issuer struct{ holders []session.Holder }

func (i *issuer) Issue(_ context.Context, holder session.Holder) (session.Tokens, error) {
	i.holders = append(i.holders, holder)
	return session.Tokens{AccessToken: "access:" + holder.UserID, RefreshToken: "refresh"}, nil
}

type fixture struct {
	service   *Service
	exchanger *exchanger
	store     *store
	issuer    *issuer
	sealer    *grant.Sealer
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	encoded, _ := grant.Generate()
	key, _ := grant.ParseKey(encoded)
	sealer, err := grant.NewSealer(key)
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{
		exchanger: &exchanger{
			tokens: oauth.TokenSet{
				AccessToken:  "ya29.new",
				RefreshToken: "1//new",
				ExpiresAt:    time.Now().Add(time.Hour),
				Scopes:       []string{"openid", "email"},
				IDToken:      "h.p.s",
			},
			identity: oauth.Identity{Subject: "sub-1", Email: " Ninette@Example.com ", EmailVerified: true, Name: "  Ninette  "},
		},
		store:  &store{userID: "11111111-1111-1111-1111-111111111111"},
		issuer: &issuer{},
		sealer: sealer,
	}
	provider := oauth.Google("client-1", "secret-1")
	f.service = NewService([]oauth.Provider{provider}, oauth.NewFlows(time.Now), f.exchanger, f.store, sealer, f.issuer)
	return f
}

func (f *fixture) start(t *testing.T) string {
	t.Helper()
	authURL, err := f.service.Start(context.Background(), "google", redirect, false)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	return parsed.Query().Get("state")
}

func (f *fixture) open(t *testing.T, sealed grant.Sealed) grant.Secrets {
	t.Helper()
	secrets, err := f.sealer.Open(grant.Binding{UserID: f.store.userID, Provider: "google"}, sealed)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return secrets
}

func TestFinishLinksSealsAndIssues(t *testing.T) {
	f := newFixture(t)
	state := f.start(t)
	tokens, err := f.service.Finish(context.Background(), "google", state, "code-1")
	if err != nil {
		t.Fatalf("Finish: %v", err)
	}
	if tokens.AccessToken != "access:"+f.store.userID {
		t.Fatalf("tokens = %+v", tokens)
	}
	link := f.store.linked[0]
	if link.Provider != "google" || link.Subject != "sub-1" || link.Email != "ninette@example.com" || link.DisplayName != "Ninette" {
		t.Fatalf("link = %+v", link)
	}
	if strings.Join(link.Scopes, " ") != "openid email" {
		t.Fatalf("scopes = %v", link.Scopes)
	}
	secrets := f.open(t, f.store.sealed[0])
	if secrets.Access != "ya29.new" || secrets.Refresh != "1//new" {
		t.Fatalf("sealed secrets = %+v", secrets)
	}
	if len(f.issuer.holders) != 1 || f.issuer.holders[0].Email != "ninette@example.com" {
		t.Fatalf("issued for %+v", f.issuer.holders)
	}
}

func TestFinishKeepsThePreviousRefreshTokenWhenNoneIsReturned(t *testing.T) {
	f := newFixture(t)
	previous, err := f.sealer.Seal(grant.Binding{UserID: f.store.userID, Provider: "google"}, grant.Secrets{Access: "old", Refresh: "1//kept"})
	if err != nil {
		t.Fatal(err)
	}
	f.store.current = &previous
	f.exchanger.tokens.RefreshToken = ""
	if _, err := f.service.Finish(context.Background(), "google", f.start(t), "code"); err != nil {
		t.Fatalf("Finish: %v", err)
	}
	secrets := f.open(t, f.store.sealed[0])
	if secrets.Access != "ya29.new" || secrets.Refresh != "1//kept" {
		t.Fatalf("sealed secrets = %+v", secrets)
	}
}

func TestFinishRequiresConsentWithoutAnyRefreshToken(t *testing.T) {
	f := newFixture(t)
	f.exchanger.tokens.RefreshToken = ""
	if _, err := f.service.Finish(context.Background(), "google", f.start(t), "code"); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("error = %v, want ErrConsentRequired", err)
	}

	unreadable := grant.Sealed{DEKWrapped: []byte{1, 2, 3}}
	f.store.current = &unreadable
	if _, err := f.service.Finish(context.Background(), "google", f.start(t), "code"); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("unreadable grant error = %v, want ErrConsentRequired", err)
	}
	if len(f.issuer.holders) != 0 {
		t.Fatal("a session was issued without a grant")
	}
}

func TestFinishRefusals(t *testing.T) {
	cases := []struct {
		name  string
		setup func(*fixture)
		want  error
	}{
		{"unverified email", func(f *fixture) { f.exchanger.identity.EmailVerified = false }, ErrEmailUnverified},
		{"bad email", func(f *fixture) { f.exchanger.identity.Email = "not-an-email" }, oauth.ErrInvalidIDToken},
		{"exchange rejected", func(f *fixture) { f.exchanger.exchangeErr = oauth.ErrExchangeRejected }, oauth.ErrExchangeRejected},
		{"id token", func(f *fixture) { f.exchanger.identifyErr = oauth.ErrInvalidIDToken }, oauth.ErrInvalidIDToken},
		{"account exists", func(f *fixture) { f.store.linkErr = ErrAccountExists }, ErrAccountExists},
	}
	for _, tc := range cases {
		f := newFixture(t)
		tc.setup(f)
		if _, err := f.service.Finish(context.Background(), "google", f.start(t), "code"); !errors.Is(err, tc.want) {
			t.Fatalf("%s: error = %v, want %v", tc.name, err, tc.want)
		}
		if len(f.issuer.holders) != 0 {
			t.Fatalf("%s: a session was issued", tc.name)
		}
	}
}

func TestStateIsOneTimeAndBoundToItsProvider(t *testing.T) {
	f := newFixture(t)
	state := f.start(t)
	if _, err := f.service.Finish(context.Background(), "google", state, "code"); err != nil {
		t.Fatalf("Finish: %v", err)
	}
	if _, err := f.service.Finish(context.Background(), "google", state, "code"); !errors.Is(err, oauth.ErrUnknownState) {
		t.Fatalf("replay error = %v", err)
	}
	if _, err := f.service.Finish(context.Background(), "microsoft", f.start(t), "code"); !errors.Is(err, ErrUnknownProvider) {
		t.Fatalf("unknown provider error = %v", err)
	}
	if len(f.exchanger.codes) != 1 {
		t.Fatalf("exchanged %d codes, want 1", len(f.exchanger.codes))
	}
}

func TestRequestShapeIsCheckedBeforeTheStateIsSpent(t *testing.T) {
	f := newFixture(t)
	state := f.start(t)
	for _, tc := range []struct{ state, code string }{{"", "code"}, {state, ""}, {strings.Repeat("s", 129), "code"}, {state, strings.Repeat("c", 2049)}} {
		if _, err := f.service.Finish(context.Background(), "google", tc.state, tc.code); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("error = %v, want ErrInvalidRequest", err)
		}
	}
	if _, err := f.service.Finish(context.Background(), "google", state, "code"); err != nil {
		t.Fatalf("state was spent by a malformed request: %v", err)
	}
}

func TestStartRefusesUnknownProviderAndBadRedirect(t *testing.T) {
	f := newFixture(t)
	if _, err := f.service.Start(context.Background(), "microsoft", redirect, false); !errors.Is(err, ErrUnknownProvider) {
		t.Fatalf("error = %v", err)
	}
	if _, err := f.service.Start(context.Background(), "google", "http://example.com/oauth/callback", false); !errors.Is(err, oauth.ErrInvalidRedirect) {
		t.Fatalf("error = %v", err)
	}
}

func TestDisplayName(t *testing.T) {
	cases := map[string]string{
		"  Ninette N.  ":         "Ninette N.",
		"bad\u0000name":          "",
		strings.Repeat("a", 150): strings.Repeat("a", 100),
		"":                       "",
	}
	for in, want := range cases {
		if got := displayName(in); got != want {
			t.Fatalf("displayName(%q) = %q, want %q", in, got, want)
		}
	}
}
