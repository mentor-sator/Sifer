package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mentor-sator/Sifer/services/identity/internal/account"
	"github.com/mentor-sator/Sifer/services/identity/internal/session"
)

const (
	uniqueViolation     = "23505"
	liveEmailConstraint = "user_account_email_live"
)

type Accounts struct {
	pool *pgxpool.Pool
}

func NewAccounts(pool *pgxpool.Pool) *Accounts {
	return &Accounts{pool: pool}
}

func (a *Accounts) CreateAccount(ctx context.Context, fresh account.NewAccount) (account.Account, error) {
	created := account.Account{Email: fresh.Email, DisplayName: fresh.DisplayName, Locale: fresh.Locale}
	err := a.pool.QueryRow(ctx,
		`INSERT INTO identity.user_account (email, password_hash, display_name, locale)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id::text, created_at`,
		fresh.Email, fresh.PasswordHash, fresh.DisplayName, fresh.Locale,
	).Scan(&created.ID, &created.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation && pgErr.ConstraintName == liveEmailConstraint {
			return account.Account{}, account.ErrEmailTaken
		}
		return account.Account{}, fmt.Errorf("create account: %w", err)
	}
	return created, nil
}

func (a *Accounts) FindCredentials(ctx context.Context, email string) (session.Credentials, error) {
	var credentials session.Credentials
	err := a.pool.QueryRow(ctx,
		`SELECT id::text, email, coalesce(password_hash, '')
		 FROM identity.user_account
		 WHERE email = $1 AND deleted_at IS NULL`,
		email,
	).Scan(&credentials.UserID, &credentials.Email, &credentials.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return session.Credentials{}, session.ErrUnknownAccount
	}
	if err != nil {
		return session.Credentials{}, fmt.Errorf("find credentials: %w", err)
	}
	return credentials, nil
}

func (a *Accounts) UpdatePasswordHash(ctx context.Context, userID, hash string) error {
	if _, err := a.pool.Exec(ctx,
		`UPDATE identity.user_account SET password_hash = $2 WHERE id = $1::uuid AND deleted_at IS NULL`,
		userID, hash,
	); err != nil {
		return fmt.Errorf("update password hash: %w", err)
	}
	return nil
}
