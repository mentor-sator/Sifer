package accesstoken

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	Issuer    = "sifer-identity"
	Audience  = "sifer"
	Type      = "at+jwt"
	Algorithm = "EdDSA"
	TTL       = 15 * time.Minute
)

type Claims struct {
	Email string `json:"email"`
	jwt.RegisteredClaims
}
