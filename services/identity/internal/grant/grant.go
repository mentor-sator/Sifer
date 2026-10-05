package grant

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

const (
	KeySize = 32
	version = byte(1)
	label   = "sifer.grant.v1"
)

var (
	ErrInvalidKey = errors.New("grant key must be 32 bytes, standard base64")
	ErrCorrupt    = errors.New("grant ciphertext cannot be opened")
)

type Sealed struct {
	DEKWrapped []byte
	AccessCT   []byte
	RefreshCT  []byte
}

type Secrets struct {
	Access  string
	Refresh string
}

type Binding struct {
	UserID   string
	Provider string
}

type Sealer struct {
	kek cipher.AEAD
}

func Generate() (string, error) {
	key := make([]byte, KeySize)
	if _, err := rand.Read(key); err != nil {
		return "", fmt.Errorf("grant key: %w", err)
	}
	return base64.StdEncoding.EncodeToString(key), nil
}

func ParseKey(encoded string) ([]byte, error) {
	key, err := base64.StdEncoding.Strict().DecodeString(strings.TrimSpace(encoded))
	if err != nil || len(key) != KeySize {
		return nil, ErrInvalidKey
	}
	return key, nil
}

func NewSealer(key []byte) (*Sealer, error) {
	if len(key) != KeySize {
		return nil, ErrInvalidKey
	}
	kek, err := newAEAD(key)
	if err != nil {
		return nil, err
	}
	return &Sealer{kek: kek}, nil
}

func (s *Sealer) Seal(binding Binding, secrets Secrets) (Sealed, error) {
	dek := make([]byte, KeySize)
	if _, err := rand.Read(dek); err != nil {
		return Sealed{}, fmt.Errorf("grant data key: %w", err)
	}
	data, err := newAEAD(dek)
	if err != nil {
		return Sealed{}, err
	}
	wrapped, err := seal(s.kek, dek, binding.context("dek"))
	if err != nil {
		return Sealed{}, err
	}
	access, err := seal(data, []byte(secrets.Access), binding.context("access"))
	if err != nil {
		return Sealed{}, err
	}
	refresh, err := seal(data, []byte(secrets.Refresh), binding.context("refresh"))
	if err != nil {
		return Sealed{}, err
	}
	return Sealed{DEKWrapped: wrapped, AccessCT: access, RefreshCT: refresh}, nil
}

func (s *Sealer) Open(binding Binding, sealed Sealed) (Secrets, error) {
	dek, err := open(s.kek, sealed.DEKWrapped, binding.context("dek"))
	if err != nil {
		return Secrets{}, err
	}
	data, err := newAEAD(dek)
	if err != nil {
		return Secrets{}, ErrCorrupt
	}
	access, err := open(data, sealed.AccessCT, binding.context("access"))
	if err != nil {
		return Secrets{}, err
	}
	refresh, err := open(data, sealed.RefreshCT, binding.context("refresh"))
	if err != nil {
		return Secrets{}, err
	}
	return Secrets{Access: string(access), Refresh: string(refresh)}, nil
}

func (b Binding) context(field string) []byte {
	return []byte(label + "|" + b.UserID + "|" + b.Provider + "|" + field)
}

func newAEAD(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("grant cipher: %w", err)
	}
	return cipher.NewGCM(block)
}

func seal(aead cipher.AEAD, plaintext, context []byte) ([]byte, error) {
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("grant nonce: %w", err)
	}
	out := make([]byte, 0, 1+len(nonce)+len(plaintext)+aead.Overhead())
	out = append(out, version)
	out = append(out, nonce...)
	return aead.Seal(out, nonce, plaintext, context), nil
}

func open(aead cipher.AEAD, sealed, context []byte) ([]byte, error) {
	header := 1 + aead.NonceSize()
	if len(sealed) < header+aead.Overhead() || sealed[0] != version {
		return nil, ErrCorrupt
	}
	plaintext, err := aead.Open(nil, sealed[1:header], sealed[header:], context)
	if err != nil {
		return nil, ErrCorrupt
	}
	return plaintext, nil
}
