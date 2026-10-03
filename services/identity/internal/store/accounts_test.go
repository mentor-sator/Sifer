package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/mentor-sator/Sifer/services/identity/internal/account"
)

func liveAccounts(t *testing.T) *Accounts {
	t.Helper()
	url := os.Getenv("SIFER_TEST_IDENTITY_DATABASE_URL")
	if url == "" {
		t.Skip("SIFER_TEST_IDENTITY_DATABASE_URL not set")
	}
	pool, _, err := Open(context.Background(), url)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(pool.Close)
	return NewAccounts(pool)
}

func uniqueEmail(t *testing.T) string {
	t.Helper()
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		t.Fatal(err)
	}
	return "test-" + hex.EncodeToString(buf) + "@sifer.test"
}

const hash = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g"

func TestCreateAccountRoundTrip(t *testing.T) {
	accounts := liveAccounts(t)
	email := uniqueEmail(t)
	created, err := accounts.CreateAccount(context.Background(), account.NewAccount{
		Email: email, PasswordHash: hash, DisplayName: "Test", Locale: "en",
	})
	if err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}
	if len(created.ID) != 36 || created.Email != email || time.Since(created.CreatedAt) > time.Minute {
		t.Fatalf("created = %+v", created)
	}
}

func TestCreateAccountReportsTakenEmail(t *testing.T) {
	accounts := liveAccounts(t)
	fresh := account.NewAccount{Email: uniqueEmail(t), PasswordHash: hash, Locale: "en"}
	if _, err := accounts.CreateAccount(context.Background(), fresh); err != nil {
		t.Fatalf("first CreateAccount: %v", err)
	}
	if _, err := accounts.CreateAccount(context.Background(), fresh); !errors.Is(err, account.ErrEmailTaken) {
		t.Fatalf("second CreateAccount: %v, want ErrEmailTaken", err)
	}
}

func TestDatabaseRefusesNonArgonHash(t *testing.T) {
	accounts := liveAccounts(t)
	_, err := accounts.CreateAccount(context.Background(), account.NewAccount{
		Email: uniqueEmail(t), PasswordHash: "$2b$10$bcrypt", Locale: "en",
	})
	if err == nil || errors.Is(err, account.ErrEmailTaken) {
		t.Fatalf("bcrypt hash stored: %v", err)
	}
}
