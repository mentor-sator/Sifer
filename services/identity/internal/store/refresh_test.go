package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/mentor-sator/Sifer/services/identity/internal/account"
	"github.com/mentor-sator/Sifer/services/identity/internal/session"
)

func randomHash(t *testing.T) []byte {
	t.Helper()
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	return sum[:]
}

func liveUser(t *testing.T) (*Accounts, *RefreshTokens, account.Account) {
	t.Helper()
	accounts := liveAccounts(t)
	created, err := accounts.CreateAccount(context.Background(), account.NewAccount{Email: uniqueEmail(t), PasswordHash: hash, Locale: "en"})
	if err != nil {
		t.Fatal(err)
	}
	return accounts, NewRefreshTokens(accounts.pool), created
}

func TestFindCredentials(t *testing.T) {
	accounts, _, created := liveUser(t)
	credentials, err := accounts.FindCredentials(context.Background(), created.Email)
	if err != nil || credentials.UserID != created.ID || credentials.PasswordHash != hash {
		t.Fatalf("FindCredentials = %+v, %v", credentials, err)
	}
	if _, err := accounts.FindCredentials(context.Background(), uniqueEmail(t)); !errors.Is(err, session.ErrUnknownAccount) {
		t.Fatalf("unknown email: %v", err)
	}
}

func TestRotationAndReuseDetection(t *testing.T) {
	_, refresh, created := liveUser(t)
	ctx := context.Background()
	expires := time.Now().Add(time.Hour)
	root, second, third := randomHash(t), randomHash(t), randomHash(t)
	if err := refresh.CreateRefresh(ctx, created.ID, root, expires); err != nil {
		t.Fatalf("CreateRefresh: %v", err)
	}
	holder, err := refresh.RotateRefresh(ctx, root, second, expires)
	if err != nil || holder.UserID != created.ID || holder.Email != created.Email {
		t.Fatalf("first rotation = %+v, %v", holder, err)
	}
	if _, err := refresh.RotateRefresh(ctx, root, third, expires); !errors.Is(err, session.ErrRefreshReused) {
		t.Fatalf("replaying the root: %v, want ErrRefreshReused", err)
	}
	if _, err := refresh.RotateRefresh(ctx, second, third, expires); !errors.Is(err, session.ErrInvalidRefresh) {
		t.Fatalf("the legitimate successor after reuse: %v, want ErrInvalidRefresh (family revoked)", err)
	}
	if _, err := refresh.RotateRefresh(ctx, randomHash(t), third, expires); !errors.Is(err, session.ErrInvalidRefresh) {
		t.Fatalf("unknown token: %v", err)
	}
}

func TestExpiredRefreshIsRefused(t *testing.T) {
	_, refresh, created := liveUser(t)
	ctx := context.Background()
	token := randomHash(t)
	if err := refresh.CreateRefresh(ctx, created.ID, token, time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond)
	if _, err := refresh.RotateRefresh(ctx, token, randomHash(t), time.Now().Add(time.Hour)); !errors.Is(err, session.ErrInvalidRefresh) {
		t.Fatalf("expired token: %v", err)
	}
}

func TestConcurrentRotationLetsOnlyOneWin(t *testing.T) {
	_, refresh, created := liveUser(t)
	ctx := context.Background()
	expires := time.Now().Add(time.Hour)
	root := randomHash(t)
	if err := refresh.CreateRefresh(ctx, created.ID, root, expires); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 5)
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := refresh.RotateRefresh(ctx, root, randomHash(t), expires)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, session.ErrRefreshReused), errors.Is(err, session.ErrInvalidRefresh):
		default:
			t.Errorf("unexpected error: %v", err)
		}
	}
	if wins != 1 {
		t.Fatalf("%d concurrent rotations succeeded, want exactly 1", wins)
	}
}

func TestLogoutRevokesTheWholeFamily(t *testing.T) {
	_, refresh, created := liveUser(t)
	ctx := context.Background()
	expires := time.Now().Add(time.Hour)
	root, second := randomHash(t), randomHash(t)
	if err := refresh.CreateRefresh(ctx, created.ID, root, expires); err != nil {
		t.Fatal(err)
	}
	if _, err := refresh.RotateRefresh(ctx, root, second, expires); err != nil {
		t.Fatal(err)
	}
	if err := refresh.RevokeRefreshFamily(ctx, root); err != nil {
		t.Fatal(err)
	}
	if _, err := refresh.RotateRefresh(ctx, second, randomHash(t), expires); !errors.Is(err, session.ErrInvalidRefresh) {
		t.Fatalf("after logout: %v", err)
	}
}
