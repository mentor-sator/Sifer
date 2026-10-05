package oauth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

const (
	maxTokenResponse = 64 << 10
	clockLeeway      = 60 * time.Second
)

var (
	ErrExchangeRejected = errors.New("provider rejected the authorization code")
	ErrExchangeFailed   = errors.New("provider token endpoint failed")
	ErrInvalidIDToken   = errors.New("provider id token is not valid")
)

type TokenSet struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
	Scopes       []string
	IDToken      string
}

type Identity struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
}

type Exchanger struct {
	client *http.Client
	now    func() time.Time
}

func NewExchanger(client *http.Client, now func() time.Time) *Exchanger {
	return &Exchanger{client: client, now: now}
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	Scope        string `json:"scope"`
	IDToken      string `json:"id_token"`
	TokenType    string `json:"token_type"`
}

func (e *Exchanger) Exchange(ctx context.Context, provider Provider, pending Pending, code string) (TokenSet, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", pending.RedirectURI)
	form.Set("client_id", provider.ClientID)
	form.Set("code_verifier", pending.Verifier)
	if provider.ClientSecret != "" {
		form.Set("client_secret", provider.ClientSecret)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return TokenSet{}, fmt.Errorf("%w: %v", ErrExchangeFailed, err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")

	response, err := e.client.Do(request)
	if err != nil {
		return TokenSet{}, fmt.Errorf("%w: %v", ErrExchangeFailed, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxTokenResponse))
	if err != nil {
		return TokenSet{}, fmt.Errorf("%w: %v", ErrExchangeFailed, err)
	}
	switch {
	case response.StatusCode == http.StatusBadRequest || response.StatusCode == http.StatusUnauthorized:
		return TokenSet{}, fmt.Errorf("%w: status %d, error %q", ErrExchangeRejected, response.StatusCode, providerError(body))
	case response.StatusCode != http.StatusOK:
		return TokenSet{}, fmt.Errorf("%w: status %d", ErrExchangeFailed, response.StatusCode)
	}

	var parsed tokenResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return TokenSet{}, fmt.Errorf("%w: response is not JSON", ErrExchangeFailed)
	}
	if parsed.AccessToken == "" || parsed.IDToken == "" || parsed.ExpiresIn <= 0 || !strings.EqualFold(parsed.TokenType, "Bearer") {
		return TokenSet{}, fmt.Errorf("%w: response is missing required fields", ErrExchangeFailed)
	}
	return TokenSet{
		AccessToken:  parsed.AccessToken,
		RefreshToken: parsed.RefreshToken,
		ExpiresAt:    e.now().UTC().Add(time.Duration(parsed.ExpiresIn) * time.Second),
		Scopes:       strings.Fields(parsed.Scope),
		IDToken:      parsed.IDToken,
	}, nil
}

type idClaims struct {
	Issuer        string          `json:"iss"`
	Subject       string          `json:"sub"`
	Audience      json.RawMessage `json:"aud"`
	Expiry        int64           `json:"exp"`
	IssuedAt      int64           `json:"iat"`
	Nonce         string          `json:"nonce"`
	Email         string          `json:"email"`
	EmailVerified json.RawMessage `json:"email_verified"`
	Name          string          `json:"name"`
}

func (e *Exchanger) Identify(provider Provider, pending Pending, idToken string) (Identity, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return Identity{}, fmt.Errorf("%w: not a compact JWT", ErrInvalidIDToken)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Identity{}, fmt.Errorf("%w: payload encoding", ErrInvalidIDToken)
	}
	var claims idClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return Identity{}, fmt.Errorf("%w: payload is not JSON", ErrInvalidIDToken)
	}

	now := e.now()
	switch {
	case !slices.Contains(provider.Issuers, claims.Issuer):
		return Identity{}, fmt.Errorf("%w: issuer %q", ErrInvalidIDToken, claims.Issuer)
	case !audienceContains(claims.Audience, provider.ClientID):
		return Identity{}, fmt.Errorf("%w: audience", ErrInvalidIDToken)
	case claims.Subject == "":
		return Identity{}, fmt.Errorf("%w: no subject", ErrInvalidIDToken)
	case claims.Nonce != pending.Nonce:
		return Identity{}, fmt.Errorf("%w: nonce", ErrInvalidIDToken)
	case !now.Before(time.Unix(claims.Expiry, 0).Add(clockLeeway)):
		return Identity{}, fmt.Errorf("%w: expired", ErrInvalidIDToken)
	case time.Unix(claims.IssuedAt, 0).After(now.Add(clockLeeway)):
		return Identity{}, fmt.Errorf("%w: issued in the future", ErrInvalidIDToken)
	}
	return Identity{
		Subject:       claims.Subject,
		Email:         claims.Email,
		EmailVerified: verified(claims.EmailVerified),
		Name:          claims.Name,
	}, nil
}

func audienceContains(raw json.RawMessage, clientID string) bool {
	var single string
	if json.Unmarshal(raw, &single) == nil {
		return single == clientID
	}
	var many []string
	if json.Unmarshal(raw, &many) == nil {
		return slices.Contains(many, clientID)
	}
	return false
}

func verified(raw json.RawMessage) bool {
	var flag bool
	if json.Unmarshal(raw, &flag) == nil {
		return flag
	}
	var text string
	return json.Unmarshal(raw, &text) == nil && text == "true"
}

func providerError(body []byte) string {
	var parsed struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &parsed) != nil {
		return ""
	}
	return parsed.Error
}
