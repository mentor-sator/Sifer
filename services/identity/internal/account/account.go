package account

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const (
	MinPasswordRunes     = 15
	MaxPasswordRunes     = 128
	MaxDisplayNameRunes  = 100
	maxEmailLength       = 254
	minDistinctRunes     = 5
	minContextFragment   = 4
	defaultLocale        = "en"
	registrationDeadline = 10 * time.Second
)

var ErrEmailTaken = errors.New("email already registered")

type ValidationError struct {
	Field  string
	Reason string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Reason)
}

func invalid(field, reason string) error {
	return &ValidationError{Field: field, Reason: reason}
}

type Account struct {
	ID          string
	Email       string
	DisplayName string
	Locale      string
	CreatedAt   time.Time
}

type NewAccount struct {
	Email        string
	PasswordHash string
	DisplayName  string
	Locale       string
}

type Registration struct {
	Email       string
	Password    string
	DisplayName string
}

type Store interface {
	CreateAccount(ctx context.Context, account NewAccount) (Account, error)
}

type Hasher interface {
	Hash(ctx context.Context, password string) (string, error)
}

type Service struct {
	store  Store
	hasher Hasher
}

func NewService(store Store, hasher Hasher) *Service {
	return &Service{store: store, hasher: hasher}
}

func (s *Service) Register(ctx context.Context, registration Registration) (Account, error) {
	email, err := NormalizeEmail(registration.Email)
	if err != nil {
		return Account{}, err
	}
	displayName, err := NormalizeDisplayName(registration.DisplayName)
	if err != nil {
		return Account{}, err
	}
	password, err := CheckPassword(registration.Password, email)
	if err != nil {
		return Account{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, registrationDeadline)
	defer cancel()
	hash, err := s.hasher.Hash(ctx, password)
	if err != nil {
		return Account{}, err
	}
	return s.store.CreateAccount(ctx, NewAccount{
		Email:        email,
		PasswordHash: hash,
		DisplayName:  displayName,
		Locale:       defaultLocale,
	})
}

func NormalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	if email == "" {
		return "", invalid("email", "is required")
	}
	if len(email) > maxEmailLength {
		return "", invalid("email", "is longer than 254 characters")
	}
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email || parsed.Name != "" {
		return "", invalid("email", "is not a valid address")
	}
	at := strings.LastIndexByte(email, '@')
	domain := email[at+1:]
	if !strings.Contains(domain, ".") || strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") || strings.Contains(domain, "..") {
		return "", invalid("email", "is not a valid address")
	}
	return email, nil
}

func NormalizeDisplayName(raw string) (string, error) {
	name := strings.TrimSpace(norm.NFC.String(raw))
	if !utf8.ValidString(name) {
		return "", invalid("display_name", "is not valid UTF-8")
	}
	if utf8.RuneCountInString(name) > MaxDisplayNameRunes {
		return "", invalid("display_name", "is longer than 100 characters")
	}
	for _, r := range name {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return "", invalid("display_name", "contains control or formatting characters")
		}
	}
	return name, nil
}

func CheckPassword(raw, email string) (string, error) {
	if !utf8.ValidString(raw) {
		return "", invalid("password", "is not valid UTF-8")
	}
	password := norm.NFKC.String(raw)
	length := utf8.RuneCountInString(password)
	if length < MinPasswordRunes {
		return "", invalid("password", "must be at least 15 characters")
	}
	if length > MaxPasswordRunes {
		return "", invalid("password", "must be at most 128 characters")
	}
	distinct := map[rune]struct{}{}
	for _, r := range password {
		if unicode.IsControl(r) {
			return "", invalid("password", "contains control characters")
		}
		distinct[unicode.ToLower(r)] = struct{}{}
	}
	if len(distinct) < minDistinctRunes {
		return "", invalid("password", "repeats too few different characters")
	}
	lowered := strings.ToLower(password)
	for _, fragment := range contextFragments(email) {
		if strings.Contains(lowered, fragment) {
			return "", invalid("password", "must not contain your email address or the product name")
		}
	}
	return password, nil
}

func contextFragments(email string) []string {
	fragments := []string{"sifer"}
	local, domain, _ := strings.Cut(email, "@")
	for _, part := range []string{local, strings.Split(domain, ".")[0]} {
		if utf8.RuneCountInString(part) >= minContextFragment {
			fragments = append(fragments, part)
		}
	}
	return fragments
}
