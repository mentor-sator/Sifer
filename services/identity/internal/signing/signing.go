package signing

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

var ErrInvalidKey = errors.New("signing key must be a base64 PKCS#8 Ed25519 private key (details withheld)")

type Key struct {
	private ed25519.PrivateKey
	public  ed25519.PublicKey
	id      string
}

type JWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
}

type JWKSet struct {
	Keys []JWK `json:"keys"`
}

func Generate() (string, error) {
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", fmt.Errorf("generate ed25519 key: %w", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		return "", fmt.Errorf("encode ed25519 key: %w", err)
	}
	return base64.StdEncoding.EncodeToString(der), nil
}

func Parse(encoded string) (*Key, error) {
	der, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, ErrInvalidKey
	}
	parsed, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, ErrInvalidKey
	}
	private, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, ErrInvalidKey
	}
	public := private.Public().(ed25519.PublicKey)
	return &Key{private: private, public: public, id: thumbprint(public)}, nil
}

func (k *Key) ID() string {
	return k.id
}

func (k *Key) Private() ed25519.PrivateKey {
	return k.private
}

func (k *Key) Public() ed25519.PublicKey {
	return k.public
}

func (k *Key) JWKS() JWKSet {
	return JWKSet{Keys: []JWK{{
		Kty: "OKP",
		Crv: "Ed25519",
		X:   base64.RawURLEncoding.EncodeToString(k.public),
		Kid: k.id,
		Use: "sig",
		Alg: "EdDSA",
	}}}
}

func thumbprint(public ed25519.PublicKey) string {
	canonical := `{"crv":"Ed25519","kty":"OKP","x":"` + base64.RawURLEncoding.EncodeToString(public) + `"}`
	sum := sha256.Sum256([]byte(canonical))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
