package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"golang.org/x/text/unicode/norm"

	"github.com/mentor-sator/Sifer/services/identity/internal/account"
)

const (
	RefreshTTL       = 30 * 24 * time.Hour
	refreshBytes     = 32
	refreshLength    = 43
	maxPasswordBytes = 1024
	loginDeadline    = 10 * time.Second
)

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrInvalidRefresh     = errors.New("refresh token is not valid")
	ErrRefreshReused      = errors.New("refresh token was already used; its family is revoked")
	ErrUnknownAccount     = errors.New("no live account with this email")
)

type Credentials struct {
	UserID       string
	Email        string
	PasswordHash string
}

type Holder struct {
	UserID string
	Email  string
}

type Tokens struct {
	AccessToken      string
	AccessExpiresAt  time.Time
	RefreshToken     string
	RefreshExpiresAt time.Time
}

type AccountStore interface {
	FindCredentials(ctx context.Context, email string) (Credentials, error)
	UpdatePasswordHash(ctx context.Context, userID, hash string) error
}

type RefreshStore interface {
	CreateRefresh(ctx context.Context, userID string, hash []byte, expiresAt time.Time) error
	RotateRefresh(ctx context.Context, presented, next []byte, expiresAt time.Time) (Holder, error)
	RevokeRefreshFamily(ctx context.Context, presented []byte) error
}

type Hasher interface {
	Hash(ctx context.Context, password string) (string, error)
	Verify(ctx context.Context, password, encoded string) (bool, error)
}

type Issuer interface {
	Access(userID, email string) (string, time.Time, error)
}

type Service struct {
	accounts  AccountStore
	refresh   RefreshStore
	hasher    Hasher
	issuer    Issuer
	dummyHash string
	now       func() time.Time
}

func NewService(ctx context.Context, accounts AccountStore, refresh RefreshStore, hasher Hasher, issuer Issuer) (*Service, error) {
	decoy, _, err := newRefresh()
	if err != nil {
		return nil, err
	}
	dummyHash, err := hasher.Hash(ctx, decoy)
	if err != nil {
		return nil, fmt.Errorf("decoy password hash: %w", err)
	}
	return &Service{accounts: accounts, refresh: refresh, hasher: hasher, issuer: issuer, dummyHash: dummyHash, now: time.Now}, nil
}

func (s *Service) Login(ctx context.Context, email, password string) (Tokens, error) {
	ctx, cancel := context.WithTimeout(ctx, loginDeadline)
	defer cancel()
	if len(password) > maxPasswordBytes {
		return Tokens{}, ErrInvalidCredentials
	}
	credentials, err := s.lookup(ctx, email)
	if err != nil {
		return Tokens{}, err
	}
	encoded := credentials.PasswordHash
	if encoded == "" {
		encoded = s.dummyHash
	}
	rehash, verifyErr := s.hasher.Verify(ctx, norm.NFKC.String(password), encoded)
	if errors.Is(verifyErr, context.DeadlineExceeded) || errors.Is(verifyErr, context.Canceled) {
		return Tokens{}, verifyErr
	}
	if verifyErr != nil || credentials.PasswordHash == "" {
		return Tokens{}, ErrInvalidCredentials
	}
	if rehash {
		if fresh, err := s.hasher.Hash(ctx, norm.NFKC.String(password)); err == nil {
			_ = s.accounts.UpdatePasswordHash(ctx, credentials.UserID, fresh)
		}
	}
	refresh, hash, err := newRefresh()
	if err != nil {
		return Tokens{}, err
	}
	refreshExpires := s.now().UTC().Add(RefreshTTL)
	if err := s.refresh.CreateRefresh(ctx, credentials.UserID, hash, refreshExpires); err != nil {
		return Tokens{}, err
	}
	return s.tokens(credentials.UserID, credentials.Email, refresh, refreshExpires)
}

func (s *Service) Refresh(ctx context.Context, presented string) (Tokens, error) {
	presentedHash, ok := hashRefresh(presented)
	if !ok {
		return Tokens{}, ErrInvalidRefresh
	}
	refresh, nextHash, err := newRefresh()
	if err != nil {
		return Tokens{}, err
	}
	refreshExpires := s.now().UTC().Add(RefreshTTL)
	holder, err := s.refresh.RotateRefresh(ctx, presentedHash, nextHash, refreshExpires)
	if err != nil {
		return Tokens{}, err
	}
	return s.tokens(holder.UserID, holder.Email, refresh, refreshExpires)
}

func (s *Service) Logout(ctx context.Context, presented string) error {
	presentedHash, ok := hashRefresh(presented)
	if !ok {
		return nil
	}
	return s.refresh.RevokeRefreshFamily(ctx, presentedHash)
}

func (s *Service) lookup(ctx context.Context, email string) (Credentials, error) {
	normalized, err := account.NormalizeEmail(email)
	if err != nil {
		return Credentials{}, nil
	}
	credentials, err := s.accounts.FindCredentials(ctx, normalized)
	if errors.Is(err, ErrUnknownAccount) {
		return Credentials{}, nil
	}
	return credentials, err
}

func (s *Service) tokens(userID, email, refresh string, refreshExpires time.Time) (Tokens, error) {
	access, accessExpires, err := s.issuer.Access(userID, email)
	if err != nil {
		return Tokens{}, err
	}
	return Tokens{AccessToken: access, AccessExpiresAt: accessExpires, RefreshToken: refresh, RefreshExpiresAt: refreshExpires}, nil
}

func newRefresh() (string, []byte, error) {
	raw := make([]byte, refreshBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("refresh token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	return token, sum[:], nil
}

func hashRefresh(token string) ([]byte, bool) {
	if len(token) != refreshLength {
		return nil, false
	}
	if raw, err := base64.RawURLEncoding.Strict().DecodeString(token); err != nil || len(raw) != refreshBytes {
		return nil, false
	}
	sum := sha256.Sum256([]byte(token))
	return sum[:], true
}
