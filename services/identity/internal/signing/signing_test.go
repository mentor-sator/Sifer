package signing

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"testing"
)

const (
	rfc8037Seed       = "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A"
	rfc8037X          = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
	rfc8037Thumbprint = "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k"
)

func rfcKey(t *testing.T) string {
	t.Helper()
	seed, err := base64.RawURLEncoding.DecodeString(rfc8037Seed)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(ed25519.NewKeyFromSeed(seed))
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(der)
}

func TestParseMatchesRFC8037Vector(t *testing.T) {
	key, err := Parse(rfcKey(t) + "\r\n")
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	jwk := key.JWKS().Keys[0]
	if jwk.X != rfc8037X {
		t.Fatalf("x = %s, want %s", jwk.X, rfc8037X)
	}
	if key.ID() != rfc8037Thumbprint || jwk.Kid != rfc8037Thumbprint {
		t.Fatalf("kid = %s, want %s", key.ID(), rfc8037Thumbprint)
	}
	if jwk.Kty != "OKP" || jwk.Crv != "Ed25519" || jwk.Alg != "EdDSA" || jwk.Use != "sig" {
		t.Fatalf("jwk = %+v", jwk)
	}
}

func TestGenerateRoundTrips(t *testing.T) {
	encoded, err := Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	key, err := Parse(encoded)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	message := []byte("sifer")
	if !ed25519.Verify(key.Public(), message, ed25519.Sign(key.Private(), message)) {
		t.Fatal("signature does not verify")
	}
	other, _ := Generate()
	if other == encoded {
		t.Fatal("two generated keys are equal")
	}
}

func TestParseRejectsOtherKeys(t *testing.T) {
	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ecDER, err := x509.MarshalPKCS8PrivateKey(ecKey)
	if err != nil {
		t.Fatal(err)
	}
	for name, input := range map[string]string{
		"empty":     "",
		"not b64":   "!!!",
		"not pkcs8": base64.StdEncoding.EncodeToString([]byte("hello world")),
		"p256":      base64.StdEncoding.EncodeToString(ecDER),
	} {
		if _, err := Parse(input); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}
