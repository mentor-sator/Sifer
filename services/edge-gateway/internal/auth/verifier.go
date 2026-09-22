package auth

import (
	"context"
	"crypto/ed25519"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/mentor-sator/Sifer/internal/accesstoken"
)

const leeway = 30 * time.Second

var ErrInvalidToken = errors.New("access token is not valid")

type KeySource interface {
	Lookup(ctx context.Context, kid string) (ed25519.PublicKey, error)
}

type Principal struct {
	UserID string
	Email  string
}

type Verifier struct {
	keys   KeySource
	parser *jwt.Parser
}

func NewVerifier(keys KeySource) *Verifier {
	return &Verifier{
		keys: keys,
		parser: jwt.NewParser(
			jwt.WithValidMethods([]string{accesstoken.Algorithm}),
			jwt.WithIssuer(accesstoken.Issuer),
			jwt.WithAudience(accesstoken.Audience),
			jwt.WithExpirationRequired(),
			jwt.WithIssuedAt(),
			jwt.WithLeeway(leeway),
		),
	}
}

func (v *Verifier) Verify(ctx context.Context, raw string) (Principal, error) {
	var lookupErr error
	claims := &accesstoken.Claims{}
	_, err := v.parser.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if typ, _ := token.Header["typ"].(string); typ != accesstoken.Type {
			return nil, ErrInvalidToken
		}
		kid, _ := token.Header["kid"].(string)
		if kid == "" {
			return nil, ErrInvalidToken
		}
		key, err := v.keys.Lookup(ctx, kid)
		if err != nil {
			lookupErr = err
			return nil, err
		}
		return key, nil
	})
	if errors.Is(lookupErr, ErrNoKeys) {
		return Principal{}, ErrNoKeys
	}
	if err != nil || claims.Subject == "" || claims.Email == "" {
		return Principal{}, ErrInvalidToken
	}
	return Principal{UserID: claims.Subject, Email: claims.Email}, nil
}
