package account

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func field(t *testing.T, err error) string {
	t.Helper()
	var validation *ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("error %v is not a ValidationError", err)
	}
	return validation.Field
}

func TestNormalizeEmail(t *testing.T) {
	accepted := map[string]string{
		"  Ninette@Example.COM ":   "ninette@example.com",
		"first.last+tag@sub.co.rw": "first.last+tag@sub.co.rw",
	}
	for input, want := range accepted {
		got, err := NormalizeEmail(input)
		if err != nil || got != want {
			t.Errorf("NormalizeEmail(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	rejected := []string{
		"", "plain", "@example.com", "a@", "a@localhost", "a@.com", "a@example.", "a@exa..mple.com",
		"Ninette <ninette@example.com>", "a b@example.com", strings.Repeat("a", 250) + "@x.co",
	}
	for _, input := range rejected {
		if _, err := NormalizeEmail(input); field(t, err) != "email" {
			t.Errorf("NormalizeEmail(%q) accepted", input)
		}
	}
}

func TestNormalizeDisplayName(t *testing.T) {
	if got, err := NormalizeDisplayName("  Ninette Nsabimana "); err != nil || got != "Ninette Nsabimana" {
		t.Fatalf("got %q, %v", got, err)
	}
	for _, input := range []string{"tab\there", "zero\u200bwidth", strings.Repeat("n", 101)} {
		if _, err := NormalizeDisplayName(input); field(t, err) != "display_name" {
			t.Errorf("NormalizeDisplayName(%q) accepted", input)
		}
	}
}

func TestCheckPassword(t *testing.T) {
	email := "ninette@kigali.rw"
	for _, input := range []string{"correct horse battery staple", "Umusozi w'Imana 1990!", "\uff46\uff55\uff4c\uff4c\uff57\uff49\uff44\uff54\uff48 \uff50\uff41\uff53\uff53\uff57\uff4f\uff52\uff44"} {
		if _, err := CheckPassword(input, email); err != nil {
			t.Errorf("CheckPassword(%q): %v", input, err)
		}
	}
	rejected := []string{
		"short one",
		strings.Repeat("abcdefgh", 17),
		"aaaaaaaaaaaaaaaaaaaa",
		"ababababababababab12",
		"my name is Ninette, hello",
		"welcome to kigali city 2026",
		"i love my Sifer assistant",
		"line one\nline two here",
	}
	for _, input := range rejected {
		if _, err := CheckPassword(input, email); field(t, err) != "password" {
			t.Errorf("CheckPassword(%q) accepted", input)
		}
	}
}

func TestCheckPasswordNormalizesToNFKC(t *testing.T) {
	got, err := CheckPassword("\uff46\uff55\uff4c\uff4c\uff57\uff49\uff44\uff54\uff48 \uff50\uff41\uff53\uff53\uff57\uff4f\uff52\uff44", "a@b.co")
	if err != nil || got != "fullwidth password" {
		t.Fatalf("got %q, %v", got, err)
	}
}

type memoryStore struct {
	saved NewAccount
	err   error
}

func (m *memoryStore) CreateAccount(_ context.Context, account NewAccount) (Account, error) {
	m.saved = account
	if m.err != nil {
		return Account{}, m.err
	}
	return Account{ID: "id", Email: account.Email, DisplayName: account.DisplayName, Locale: account.Locale}, nil
}

type stubHasher struct{ calls int }

func (s *stubHasher) Hash(_ context.Context, password string) (string, error) {
	s.calls++
	return "$argon2id$stub$" + password, nil
}

func TestRegisterStoresNormalizedAccount(t *testing.T) {
	store, hasher := &memoryStore{}, &stubHasher{}
	service := NewService(store, hasher)
	account, err := service.Register(context.Background(), Registration{
		Email:       " Ninette@Example.com",
		Password:    "correct horse battery staple",
		DisplayName: " Ninette ",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if account.Email != "ninette@example.com" || store.saved.DisplayName != "Ninette" || store.saved.Locale != "en" {
		t.Fatalf("saved %+v, returned %+v", store.saved, account)
	}
	if store.saved.PasswordHash != "$argon2id$stub$correct horse battery staple" {
		t.Fatalf("hash = %q", store.saved.PasswordHash)
	}
}

func TestRegisterValidatesBeforeHashing(t *testing.T) {
	hasher := &stubHasher{}
	service := NewService(&memoryStore{}, hasher)
	if _, err := service.Register(context.Background(), Registration{Email: "bad", Password: "correct horse battery staple"}); field(t, err) != "email" {
		t.Fatal("bad email accepted")
	}
	if _, err := service.Register(context.Background(), Registration{Email: "a@b.co", Password: "short"}); field(t, err) != "password" {
		t.Fatal("short password accepted")
	}
	if hasher.calls != 0 {
		t.Fatalf("hashed %d times before validation passed", hasher.calls)
	}
}

func TestRegisterPassesEmailTakenThrough(t *testing.T) {
	service := NewService(&memoryStore{err: ErrEmailTaken}, &stubHasher{})
	_, err := service.Register(context.Background(), Registration{Email: "a@b.co", Password: "correct horse battery staple"})
	if !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("err = %v", err)
	}
}
