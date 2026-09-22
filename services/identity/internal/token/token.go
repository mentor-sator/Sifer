package token

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/mentor-sator/Sifer/internal/accesstoken"
	"github.com/mentor-sator/Sifer/services/identity/internal/signing"
)

type Issuer struct {
	key *signing.Key
	now func() time.Time
}

func NewIssuer(key *signing.Key) *Issuer {
	return &Issuer{key: key, now: time.Now}
}

func (i *Issuer) Access(userID, email string) (string, time.Time, error) {
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return "", time.Time{}, fmt.Errorf("token id: %w", err)
	}
	now := i.now().UTC().Truncate(time.Second)
	expires := now.Add(accesstoken.TTL)
	claims := accesstoken.Claims{
		Email: email,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    accesstoken.Issuer,
			Subject:   userID,
			Audience:  jwt.ClaimStrings{accesstoken.Audience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expires),
			ID:        base64.RawURLEncoding.EncodeToString(id),
		},
	}
	unsigned := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	unsigned.Header["kid"] = i.key.ID()
	unsigned.Header["typ"] = accesstoken.Type
	signed, err := unsigned.SignedString(i.key.Private())
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign access token: %w", err)
	}
	return signed, expires, nil
}
