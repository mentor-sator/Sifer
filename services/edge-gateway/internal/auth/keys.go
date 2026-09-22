package auth

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

const (
	refreshInterval  = 10 * time.Minute
	minForceInterval = time.Minute
	fetchTimeout     = 3 * time.Second
	maxJWKSBytes     = 64 << 10
	initialBackoff   = 5 * time.Second
	maxBackoff       = 5 * time.Minute
)

var (
	ErrNoKeys     = errors.New("no signing keys loaded yet")
	ErrUnknownKey = errors.New("token signed by an unknown key")
)

type Keys struct {
	url    string
	client *http.Client
	logger *slog.Logger
	now    func() time.Time

	mu   sync.RWMutex
	keys map[string]ed25519.PublicKey

	forceMu    sync.Mutex
	lastForced time.Time
}

func NewKeys(url string, client *http.Client, logger *slog.Logger) *Keys {
	return &Keys{url: url, client: client, logger: logger, now: time.Now, keys: map[string]ed25519.PublicKey{}}
}

func (k *Keys) Run(ctx context.Context) {
	backoff := initialBackoff
	for {
		wait := refreshInterval
		if err := k.Refresh(ctx); err != nil {
			k.logger.WarnContext(ctx, "jwks refresh failed", "url", k.url, "error", err)
			if !k.Loaded() {
				wait = backoff
				backoff = min(backoff*2, maxBackoff)
			}
		} else {
			backoff = initialBackoff
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

func (k *Keys) Loaded() bool {
	k.mu.RLock()
	defer k.mu.RUnlock()
	return len(k.keys) > 0
}

func (k *Keys) Lookup(ctx context.Context, kid string) (ed25519.PublicKey, error) {
	if key, ok := k.get(kid); ok {
		return key, nil
	}
	k.forceMu.Lock()
	defer k.forceMu.Unlock()
	if key, ok := k.get(kid); ok {
		return key, nil
	}
	if k.now().Sub(k.lastForced) >= minForceInterval {
		k.lastForced = k.now()
		if err := k.Refresh(ctx); err != nil {
			k.logger.WarnContext(ctx, "jwks refresh for unknown kid failed", "error", err)
		}
		if key, ok := k.get(kid); ok {
			return key, nil
		}
	}
	if !k.Loaded() {
		return nil, ErrNoKeys
	}
	return nil, ErrUnknownKey
}

func (k *Keys) Refresh(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, k.url, nil)
	if err != nil {
		return err
	}
	response, err := k.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks answered %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxJWKSBytes+1))
	if err != nil {
		return err
	}
	if len(body) > maxJWKSBytes {
		return errors.New("jwks document is too large")
	}
	keys, err := parseJWKS(body)
	if err != nil {
		return err
	}
	k.mu.Lock()
	k.keys = keys
	k.mu.Unlock()
	return nil
}

func (k *Keys) get(kid string) (ed25519.PublicKey, bool) {
	k.mu.RLock()
	defer k.mu.RUnlock()
	key, ok := k.keys[kid]
	return key, ok
}

type jwk struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
}

func parseJWKS(body []byte) (map[string]ed25519.PublicKey, error) {
	var document struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.Unmarshal(body, &document); err != nil {
		return nil, fmt.Errorf("jwks document: %w", err)
	}
	keys := map[string]ed25519.PublicKey{}
	for _, candidate := range document.Keys {
		if candidate.Kty != "OKP" || candidate.Crv != "Ed25519" || candidate.Kid == "" {
			continue
		}
		if (candidate.Use != "" && candidate.Use != "sig") || (candidate.Alg != "" && candidate.Alg != "EdDSA") {
			continue
		}
		raw, err := base64.RawURLEncoding.Strict().DecodeString(candidate.X)
		if err != nil || len(raw) != ed25519.PublicKeySize {
			continue
		}
		keys[candidate.Kid] = ed25519.PublicKey(raw)
	}
	if len(keys) == 0 {
		return nil, errors.New("jwks contains no usable Ed25519 signing keys")
	}
	return keys, nil
}
