package oauth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	FlowTTL          = 10 * time.Minute
	maxPendingFlows  = 1024
	randomBytes      = 32
	loopbackHost     = "127.0.0.1"
	loopbackPath     = "/oauth/callback"
	minLoopbackPort  = 1024
	maxLoopbackPort  = 65535
	googleAuthURL    = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL   = "https://oauth2.googleapis.com/token"
	googleIssuer     = "https://accounts.google.com"
	googleIssuerBare = "accounts.google.com"
)

var (
	ErrInvalidRedirect = errors.New("redirect uri must be http://127.0.0.1:<port>/oauth/callback")
	ErrUnknownState    = errors.New("sign-in attempt is unknown, expired or already used")
	ErrTooManyFlows    = errors.New("too many sign-in attempts in progress")
)

type Provider struct {
	Name          string
	AuthURL       string
	TokenURL      string
	ClientID      string
	ClientSecret  string
	Scopes        []string
	Issuers       []string
	AuthParams    map[string]string
	ConsentParams map[string]string
}

func Google(clientID, clientSecret string) Provider {
	return Provider{
		Name:          "google",
		AuthURL:       googleAuthURL,
		TokenURL:      googleTokenURL,
		ClientID:      clientID,
		ClientSecret:  clientSecret,
		Scopes:        []string{"openid", "email", "profile"},
		Issuers:       []string{googleIssuer, googleIssuerBare},
		AuthParams:    map[string]string{"access_type": "offline", "include_granted_scopes": "true"},
		ConsentParams: map[string]string{"prompt": "consent"},
	}
}

type Pending struct {
	Provider    string
	Verifier    string
	Nonce       string
	RedirectURI string
	ExpiresAt   time.Time
}

type Flows struct {
	mu      sync.Mutex
	pending map[string]Pending
	now     func() time.Time
}

func NewFlows(now func() time.Time) *Flows {
	return &Flows{pending: make(map[string]Pending), now: now}
}

func (f *Flows) Begin(provider Provider, redirectURI string, forceConsent bool) (string, Pending, error) {
	if err := ValidateRedirect(redirectURI); err != nil {
		return "", Pending{}, err
	}
	state, err := random()
	if err != nil {
		return "", Pending{}, err
	}
	verifier, err := random()
	if err != nil {
		return "", Pending{}, err
	}
	nonce, err := random()
	if err != nil {
		return "", Pending{}, err
	}
	pending := Pending{
		Provider:    provider.Name,
		Verifier:    verifier,
		Nonce:       nonce,
		RedirectURI: redirectURI,
		ExpiresAt:   f.now().Add(FlowTTL),
	}
	if err := f.store(state, pending); err != nil {
		return "", Pending{}, err
	}
	return provider.authorizationURL(state, pending, forceConsent), pending, nil
}

func (f *Flows) Take(state string) (Pending, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	pending, ok := f.pending[state]
	delete(f.pending, state)
	if !ok || !f.now().Before(pending.ExpiresAt) {
		return Pending{}, ErrUnknownState
	}
	return pending, nil
}

func (f *Flows) store(state string, pending Pending) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := f.now()
	for key, existing := range f.pending {
		if !now.Before(existing.ExpiresAt) {
			delete(f.pending, key)
		}
	}
	if len(f.pending) >= maxPendingFlows {
		return ErrTooManyFlows
	}
	f.pending[state] = pending
	return nil
}

func (p Provider) authorizationURL(state string, pending Pending, forceConsent bool) string {
	query := url.Values{}
	query.Set("response_type", "code")
	query.Set("client_id", p.ClientID)
	query.Set("redirect_uri", pending.RedirectURI)
	query.Set("scope", strings.Join(p.Scopes, " "))
	query.Set("state", state)
	query.Set("nonce", pending.Nonce)
	query.Set("code_challenge", Challenge(pending.Verifier))
	query.Set("code_challenge_method", "S256")
	for key, value := range p.AuthParams {
		query.Set(key, value)
	}
	if forceConsent {
		for key, value := range p.ConsentParams {
			query.Set(key, value)
		}
	}
	return p.AuthURL + "?" + query.Encode()
}

func Challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func ValidateRedirect(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != loopbackPath {
		return ErrInvalidRedirect
	}
	host, portText, err := net.SplitHostPort(parsed.Host)
	if err != nil || host != loopbackHost {
		return ErrInvalidRedirect
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < minLoopbackPort || port > maxLoopbackPort || strconv.Itoa(port) != portText {
		return ErrInvalidRedirect
	}
	return nil
}

func random() (string, error) {
	raw := make([]byte, randomBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("oauth random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
