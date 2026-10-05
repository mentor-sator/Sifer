package federation

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/mentor-sator/Sifer/services/identity/internal/account"
	"github.com/mentor-sator/Sifer/services/identity/internal/grant"
	"github.com/mentor-sator/Sifer/services/identity/internal/oauth"
	"github.com/mentor-sator/Sifer/services/identity/internal/session"
)

const (
	finishDeadline = 20 * time.Second
	maxCodeLength  = 2048
	maxStateLength = 128
)

var (
	ErrUnknownProvider = errors.New("sign-in provider is not configured")
	ErrInvalidRequest  = errors.New("state and code are required")
	ErrEmailUnverified = errors.New("provider has not verified this email address")
	ErrAccountExists   = errors.New("an account with this email already exists; sign in with the password")
	ErrAccountDisabled = errors.New("the linked account is closed")
	ErrConsentRequired = errors.New("provider returned no refresh token; consent must be given again")
)

type Link struct {
	Provider    string
	Subject     string
	Email       string
	DisplayName string
	Scopes      []string
	ExpiresAt   time.Time
}

type SealFunc func(userID string, current *grant.Sealed) (grant.Sealed, error)

type Store interface {
	Link(ctx context.Context, link Link, seal SealFunc) (session.Holder, error)
}

type Exchanger interface {
	Exchange(ctx context.Context, provider oauth.Provider, pending oauth.Pending, code string) (oauth.TokenSet, error)
	Identify(provider oauth.Provider, pending oauth.Pending, idToken string) (oauth.Identity, error)
}

type Sealer interface {
	Seal(binding grant.Binding, secrets grant.Secrets) (grant.Sealed, error)
	Open(binding grant.Binding, sealed grant.Sealed) (grant.Secrets, error)
}

type Issuer interface {
	Issue(ctx context.Context, holder session.Holder) (session.Tokens, error)
}

type Service struct {
	providers map[string]oauth.Provider
	flows     *oauth.Flows
	exchanger Exchanger
	store     Store
	sealer    Sealer
	sessions  Issuer
}

func NewService(providers []oauth.Provider, flows *oauth.Flows, exchanger Exchanger, store Store, sealer Sealer, sessions Issuer) *Service {
	byName := make(map[string]oauth.Provider, len(providers))
	for _, provider := range providers {
		byName[provider.Name] = provider
	}
	return &Service{providers: byName, flows: flows, exchanger: exchanger, store: store, sealer: sealer, sessions: sessions}
}

func (s *Service) Start(_ context.Context, providerName, redirectURI string, forceConsent bool) (string, error) {
	provider, ok := s.providers[providerName]
	if !ok {
		return "", ErrUnknownProvider
	}
	authURL, _, err := s.flows.Begin(provider, redirectURI, forceConsent)
	return authURL, err
}

func (s *Service) Finish(ctx context.Context, providerName, state, code string) (session.Tokens, error) {
	provider, ok := s.providers[providerName]
	if !ok {
		return session.Tokens{}, ErrUnknownProvider
	}
	if state == "" || code == "" || len(state) > maxStateLength || len(code) > maxCodeLength {
		return session.Tokens{}, ErrInvalidRequest
	}
	pending, err := s.flows.Take(state)
	if err != nil {
		return session.Tokens{}, err
	}
	if pending.Provider != provider.Name {
		return session.Tokens{}, oauth.ErrUnknownState
	}

	ctx, cancel := context.WithTimeout(ctx, finishDeadline)
	defer cancel()

	tokens, err := s.exchanger.Exchange(ctx, provider, pending, code)
	if err != nil {
		return session.Tokens{}, err
	}
	identity, err := s.exchanger.Identify(provider, pending, tokens.IDToken)
	if err != nil {
		return session.Tokens{}, err
	}
	if !identity.EmailVerified {
		return session.Tokens{}, ErrEmailUnverified
	}
	email, err := account.NormalizeEmail(identity.Email)
	if err != nil {
		return session.Tokens{}, fmt.Errorf("%w: email claim", oauth.ErrInvalidIDToken)
	}
	scopes := tokens.Scopes
	if len(scopes) == 0 {
		scopes = provider.Scopes
	}

	holder, err := s.store.Link(ctx, Link{
		Provider:    provider.Name,
		Subject:     identity.Subject,
		Email:       email,
		DisplayName: displayName(identity.Name),
		Scopes:      scopes,
		ExpiresAt:   tokens.ExpiresAt,
	}, s.sealWith(provider.Name, tokens))
	if err != nil {
		return session.Tokens{}, err
	}
	return s.sessions.Issue(ctx, holder)
}

func (s *Service) sealWith(providerName string, tokens oauth.TokenSet) SealFunc {
	return func(userID string, current *grant.Sealed) (grant.Sealed, error) {
		binding := grant.Binding{UserID: userID, Provider: providerName}
		refresh := tokens.RefreshToken
		if refresh == "" {
			if current == nil {
				return grant.Sealed{}, ErrConsentRequired
			}
			previous, err := s.sealer.Open(binding, *current)
			if err != nil {
				return grant.Sealed{}, ErrConsentRequired
			}
			refresh = previous.Refresh
		}
		return s.sealer.Seal(binding, grant.Secrets{Access: tokens.AccessToken, Refresh: refresh})
	}
}

func displayName(name string) string {
	name = strings.TrimSpace(name)
	if strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return ""
	}
	runes := []rune(name)
	if len(runes) > account.MaxDisplayNameRunes {
		runes = runes[:account.MaxDisplayNameRunes]
	}
	return strings.TrimSpace(string(runes))
}
