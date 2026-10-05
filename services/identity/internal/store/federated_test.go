package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mentor-sator/Sifer/services/identity/internal/account"
	"github.com/mentor-sator/Sifer/services/identity/internal/federation"
	"github.com/mentor-sator/Sifer/services/identity/internal/grant"
)

func livePool(t *testing.T) *pgxpool.Pool {
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
	return pool
}

func newLink(t *testing.T) federation.Link {
	t.Helper()
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		t.Fatal(err)
	}
	id := hex.EncodeToString(buf)
	return federation.Link{
		Provider:    "google",
		Subject:     "sub-" + id,
		Email:       "oauth-" + id + "@sifer.test",
		DisplayName: "OAuth Test",
		Scopes:      []string{"openid", "email", "profile"},
		ExpiresAt:   time.Now().Add(time.Hour),
	}
}

type recordingSeal struct {
	mu       sync.Mutex
	userIDs  []string
	currents []*grant.Sealed
	next     byte
	err      error
}

func (r *recordingSeal) seal(userID string, current *grant.Sealed) (grant.Sealed, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.userIDs = append(r.userIDs, userID)
	r.currents = append(r.currents, current)
	if r.err != nil {
		return grant.Sealed{}, r.err
	}
	r.next++
	return grant.Sealed{DEKWrapped: []byte{r.next}, AccessCT: []byte{r.next, 1}, RefreshCT: []byte{r.next, 2}}, nil
}

func liveGrants(t *testing.T, pool *pgxpool.Pool, userID string) (live, revoked int) {
	t.Helper()
	err := pool.QueryRow(context.Background(),
		`SELECT count(*) FILTER (WHERE revoked_at IS NULL), count(*) FILTER (WHERE revoked_at IS NOT NULL)
		 FROM identity.third_party_grant WHERE user_id = $1::uuid`, userID,
	).Scan(&live, &revoked)
	if err != nil {
		t.Fatal(err)
	}
	return live, revoked
}

func TestLinkCreatesAccountIdentityAndGrant(t *testing.T) {
	pool := livePool(t)
	federated := NewFederated(pool)
	link := newLink(t)
	recorder := &recordingSeal{}

	holder, err := federated.Link(context.Background(), link, recorder.seal)
	if err != nil {
		t.Fatalf("Link: %v", err)
	}
	if len(holder.UserID) != 36 || holder.Email != link.Email || recorder.currents[0] != nil {
		t.Fatalf("holder = %+v, current = %v", holder, recorder.currents[0])
	}
	var verified bool
	var displayName string
	var hasPassword bool
	if err := pool.QueryRow(context.Background(),
		`SELECT email_verified_at IS NOT NULL, display_name, password_hash IS NOT NULL FROM identity.user_account WHERE id = $1::uuid`,
		holder.UserID,
	).Scan(&verified, &displayName, &hasPassword); err != nil {
		t.Fatal(err)
	}
	if !verified || displayName != "OAuth Test" || hasPassword {
		t.Fatalf("account: verified=%v name=%q password=%v", verified, displayName, hasPassword)
	}
	if live, revoked := liveGrants(t, pool, holder.UserID); live != 1 || revoked != 0 {
		t.Fatalf("grants live=%d revoked=%d", live, revoked)
	}
}

func TestLinkAgainFindsTheSameAccountAndReplacesTheGrant(t *testing.T) {
	pool := livePool(t)
	federated := NewFederated(pool)
	link := newLink(t)
	recorder := &recordingSeal{}

	first, err := federated.Link(context.Background(), link, recorder.seal)
	if err != nil {
		t.Fatal(err)
	}
	link.Email = "changed-" + link.Email
	second, err := federated.Link(context.Background(), link, recorder.seal)
	if err != nil {
		t.Fatalf("second Link: %v", err)
	}
	if second.UserID != first.UserID || second.Email != first.Email {
		t.Fatalf("second = %+v, first = %+v", second, first)
	}
	current := recorder.currents[1]
	if current == nil || current.DEKWrapped[0] != 1 || current.RefreshCT[1] != 2 {
		t.Fatalf("seal did not receive the previous grant: %+v", current)
	}
	if live, revoked := liveGrants(t, pool, first.UserID); live != 1 || revoked != 1 {
		t.Fatalf("grants live=%d revoked=%d", live, revoked)
	}
}

func TestLinkNeverMatchesAnExistingAccountByEmail(t *testing.T) {
	pool := livePool(t)
	link := newLink(t)
	if _, err := NewAccounts(pool).CreateAccount(context.Background(), account.NewAccount{Email: link.Email, PasswordHash: hash, Locale: "en"}); err != nil {
		t.Fatal(err)
	}
	if _, err := NewFederated(pool).Link(context.Background(), link, (&recordingSeal{}).seal); !errors.Is(err, federation.ErrAccountExists) {
		t.Fatalf("error = %v, want ErrAccountExists", err)
	}
	var identities int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM identity.external_identity WHERE provider = 'google' AND subject = $1`, link.Subject,
	).Scan(&identities); err != nil {
		t.Fatal(err)
	}
	if identities != 0 {
		t.Fatal("an external identity was linked to the password account")
	}
}

func TestLinkRollsBackWhenSealingFails(t *testing.T) {
	pool := livePool(t)
	link := newLink(t)
	recorder := &recordingSeal{err: federation.ErrConsentRequired}
	if _, err := NewFederated(pool).Link(context.Background(), link, recorder.seal); !errors.Is(err, federation.ErrConsentRequired) {
		t.Fatalf("error = %v, want ErrConsentRequired", err)
	}
	var accounts int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM identity.user_account WHERE email = $1`, link.Email).Scan(&accounts); err != nil {
		t.Fatal(err)
	}
	if accounts != 0 {
		t.Fatal("the account survived a failed sign-in")
	}
}

func TestLinkRefusesAClosedAccount(t *testing.T) {
	pool := livePool(t)
	federated := NewFederated(pool)
	link := newLink(t)
	holder, err := federated.Link(context.Background(), link, (&recordingSeal{}).seal)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE identity.user_account SET deleted_at = now() WHERE id = $1::uuid`, holder.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := federated.Link(context.Background(), link, (&recordingSeal{}).seal); !errors.Is(err, federation.ErrAccountDisabled) {
		t.Fatalf("error = %v, want ErrAccountDisabled", err)
	}
}

func TestConcurrentFirstSignInsShareOneAccount(t *testing.T) {
	pool := livePool(t)
	federated := NewFederated(pool)
	link := newLink(t)
	recorder := &recordingSeal{}

	const racers = 5
	holders := make([]string, racers)
	errs := make([]error, racers)
	var wg sync.WaitGroup
	for i := range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			holder, err := federated.Link(context.Background(), link, recorder.seal)
			holders[i], errs[i] = holder.UserID, err
		}()
	}
	wg.Wait()
	for i := range racers {
		if errs[i] != nil {
			t.Fatalf("racer %d: %v", i, errs[i])
		}
		if holders[i] != holders[0] {
			t.Fatalf("racers got different accounts: %v", holders)
		}
	}
	if live, revoked := liveGrants(t, pool, holders[0]); live != 1 || revoked != racers-1 {
		t.Fatalf("grants live=%d revoked=%d", live, revoked)
	}
}
