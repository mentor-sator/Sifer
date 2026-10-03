package password

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

type Params struct {
	Memory      uint32
	Iterations  uint32
	Parallelism uint8
	SaltLength  uint32
	KeyLength   uint32
}

var Default = Params{Memory: 64 * 1024, Iterations: 3, Parallelism: 4, SaltLength: 16, KeyLength: 32}

const (
	maxMemory     = 256 * 1024
	maxIterations = 10
	maxKeyLength  = 64
)

var (
	ErrMismatch      = errors.New("password does not match")
	ErrMalformedHash = errors.New("malformed argon2id hash")
)

var encoding = base64.RawStdEncoding

type Hasher struct {
	params Params
	slots  chan struct{}
}

func NewHasher(params Params, concurrency int) *Hasher {
	if concurrency < 1 {
		concurrency = 1
	}
	return &Hasher{params: params, slots: make(chan struct{}, concurrency)}
}

func (h *Hasher) Hash(ctx context.Context, password string) (string, error) {
	salt := make([]byte, h.params.SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("password salt: %w", err)
	}
	key, err := h.derive(ctx, password, salt, h.params)
	if err != nil {
		return "", err
	}
	return encode(h.params, salt, key), nil
}

func (h *Hasher) Verify(ctx context.Context, password, encoded string) (bool, error) {
	params, salt, want, err := decode(encoded)
	if err != nil {
		return false, err
	}
	got, err := h.derive(ctx, password, salt, params)
	if err != nil {
		return false, err
	}
	if subtle.ConstantTimeCompare(got, want) != 1 {
		return false, ErrMismatch
	}
	return params != h.params, nil
}

func (h *Hasher) derive(ctx context.Context, password string, salt []byte, params Params) ([]byte, error) {
	select {
	case h.slots <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-h.slots }()
	return argon2.IDKey([]byte(password), salt, params.Iterations, params.Memory, params.Parallelism, params.KeyLength), nil
}

func encode(params Params, salt, key []byte) string {
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, params.Memory, params.Iterations, params.Parallelism,
		encoding.EncodeToString(salt), encoding.EncodeToString(key))
}

func decode(encoded string) (Params, []byte, []byte, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return Params{}, nil, nil, ErrMalformedHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return Params{}, nil, nil, ErrMalformedHash
	}
	var params Params
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &params.Memory, &params.Iterations, &params.Parallelism); err != nil {
		return Params{}, nil, nil, ErrMalformedHash
	}
	salt, err := encoding.Strict().DecodeString(parts[4])
	if err != nil || len(salt) < 8 {
		return Params{}, nil, nil, ErrMalformedHash
	}
	key, err := encoding.Strict().DecodeString(parts[5])
	if err != nil || len(key) < 16 || len(key) > maxKeyLength {
		return Params{}, nil, nil, ErrMalformedHash
	}
	if params.Memory < 8*uint32(params.Parallelism) || params.Memory > maxMemory ||
		params.Iterations < 1 || params.Iterations > maxIterations || params.Parallelism < 1 {
		return Params{}, nil, nil, ErrMalformedHash
	}
	params.SaltLength = uint32(len(salt))
	params.KeyLength = uint32(len(key))
	return params, salt, key, nil
}
