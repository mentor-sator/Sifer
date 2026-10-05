package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mentor-sator/Sifer/services/identity/internal/federation"
	"github.com/mentor-sator/Sifer/services/identity/internal/grant"
	"github.com/mentor-sator/Sifer/services/identity/internal/session"
)

const (
	externalSubjectConstraint = "external_identity_subject"
	linkAttempts              = 2
)

var errLinkRaced = errors.New("concurrent sign-in created the same identity")

type Federated struct {
	pool *pgxpool.Pool
}

func NewFederated(pool *pgxpool.Pool) *Federated {
	return &Federated{pool: pool}
}

func (f *Federated) Link(ctx context.Context, link federation.Link, seal federation.SealFunc) (session.Holder, error) {
	for attempt := 1; ; attempt++ {
		var holder session.Holder
		err := pgx.BeginFunc(ctx, f.pool, func(tx pgx.Tx) error {
			var err error
			holder, err = f.resolve(ctx, tx, link)
			if err != nil {
				return err
			}
			return f.replaceGrant(ctx, tx, holder.UserID, link, seal)
		})
		switch {
		case err == nil:
			return holder, nil
		case errors.Is(err, errLinkRaced) && attempt < linkAttempts:
			continue
		case errors.Is(err, errLinkRaced):
			return session.Holder{}, federation.ErrAccountExists
		default:
			return session.Holder{}, err
		}
	}
}

func (f *Federated) resolve(ctx context.Context, tx pgx.Tx, link federation.Link) (session.Holder, error) {
	var holder session.Holder
	var live bool
	err := tx.QueryRow(ctx,
		`SELECT e.user_id::text, a.email, a.deleted_at IS NULL
		 FROM identity.external_identity e
		 JOIN identity.user_account a ON a.id = e.user_id
		 WHERE e.provider = $1 AND e.subject = $2
		 FOR UPDATE OF e`,
		link.Provider, link.Subject,
	).Scan(&holder.UserID, &holder.Email, &live)
	switch {
	case err == nil && !live:
		return session.Holder{}, federation.ErrAccountDisabled
	case err == nil:
		return holder, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return session.Holder{}, fmt.Errorf("find external identity: %w", err)
	}

	holder.Email = link.Email
	err = tx.QueryRow(ctx,
		`INSERT INTO identity.user_account (email, email_verified_at, display_name)
		 VALUES ($1, now(), $2)
		 RETURNING id::text`,
		link.Email, link.DisplayName,
	).Scan(&holder.UserID)
	if err != nil {
		return session.Holder{}, classify(err, "create federated account")
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO identity.external_identity (user_id, provider, subject) VALUES ($1::uuid, $2, $3)`,
		holder.UserID, link.Provider, link.Subject,
	); err != nil {
		return session.Holder{}, classify(err, "create external identity")
	}
	return holder, nil
}

func (f *Federated) replaceGrant(ctx context.Context, tx pgx.Tx, userID string, link federation.Link, seal federation.SealFunc) error {
	var currentID string
	var current grant.Sealed
	err := tx.QueryRow(ctx,
		`SELECT id::text, dek_wrapped, access_ct, refresh_ct
		 FROM identity.third_party_grant
		 WHERE user_id = $1::uuid AND provider = $2 AND revoked_at IS NULL
		 FOR UPDATE`,
		userID, link.Provider,
	).Scan(&currentID, &current.DEKWrapped, &current.AccessCT, &current.RefreshCT)
	var existing *grant.Sealed
	switch {
	case err == nil:
		existing = &current
	case !errors.Is(err, pgx.ErrNoRows):
		return fmt.Errorf("find grant: %w", err)
	}

	sealed, err := seal(userID, existing)
	if err != nil {
		return err
	}
	if existing != nil {
		if _, err := tx.Exec(ctx, `UPDATE identity.third_party_grant SET revoked_at = now() WHERE id = $1::uuid`, currentID); err != nil {
			return fmt.Errorf("revoke grant: %w", err)
		}
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO identity.third_party_grant (user_id, provider, scopes, dek_wrapped, access_ct, refresh_ct, expires_at)
		 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
		userID, link.Provider, link.Scopes, sealed.DEKWrapped, sealed.AccessCT, sealed.RefreshCT, link.ExpiresAt,
	); err != nil {
		return fmt.Errorf("store grant: %w", err)
	}
	return nil
}

func classify(err error, action string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		switch pgErr.ConstraintName {
		case liveEmailConstraint, externalSubjectConstraint:
			return errLinkRaced
		}
	}
	return fmt.Errorf("%s: %w", action, err)
}
