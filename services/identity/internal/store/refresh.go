package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mentor-sator/Sifer/services/identity/internal/session"
)

type RefreshTokens struct {
	pool *pgxpool.Pool
}

func NewRefreshTokens(pool *pgxpool.Pool) *RefreshTokens {
	return &RefreshTokens{pool: pool}
}

func (r *RefreshTokens) CreateRefresh(ctx context.Context, userID string, hash []byte, expiresAt time.Time) error {
	if _, err := r.pool.Exec(ctx,
		`WITH fresh AS (SELECT gen_random_uuid() AS id)
		 INSERT INTO identity.refresh_token (id, family_id, user_id, token_hash, expires_at)
		 SELECT id, id, $1::uuid, $2, $3 FROM fresh`,
		userID, hash, expiresAt,
	); err != nil {
		return fmt.Errorf("create refresh token: %w", err)
	}
	return nil
}

func (r *RefreshTokens) RotateRefresh(ctx context.Context, presented, next []byte, expiresAt time.Time) (session.Holder, error) {
	var holder session.Holder
	reused := false
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var id, familyID string
		var used, live bool
		err := tx.QueryRow(ctx,
			`SELECT t.id::text, t.family_id::text, t.user_id::text, a.email,
			        t.used_at IS NOT NULL,
			        t.revoked_at IS NULL AND t.expires_at > now() AND a.deleted_at IS NULL
			 FROM identity.refresh_token t
			 JOIN identity.user_account a ON a.id = t.user_id
			 WHERE t.token_hash = $1
			 FOR UPDATE OF t`,
			presented,
		).Scan(&id, &familyID, &holder.UserID, &holder.Email, &used, &live)
		if errors.Is(err, pgx.ErrNoRows) {
			return session.ErrInvalidRefresh
		}
		if err != nil {
			return err
		}
		if !live {
			return session.ErrInvalidRefresh
		}
		if used {
			reused = true
			_, err := tx.Exec(ctx,
				`UPDATE identity.refresh_token SET revoked_at = now()
				 WHERE family_id = $1::uuid AND revoked_at IS NULL`,
				familyID,
			)
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE identity.refresh_token SET used_at = now() WHERE id = $1::uuid`, id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx,
			`INSERT INTO identity.refresh_token (family_id, parent_id, user_id, token_hash, expires_at)
			 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)`,
			familyID, id, holder.UserID, next, expiresAt,
		)
		return err
	})
	switch {
	case errors.Is(err, session.ErrInvalidRefresh):
		return session.Holder{}, err
	case err != nil:
		return session.Holder{}, fmt.Errorf("rotate refresh token: %w", err)
	case reused:
		return session.Holder{}, session.ErrRefreshReused
	}
	return holder, nil
}

func (r *RefreshTokens) RevokeRefreshFamily(ctx context.Context, presented []byte) error {
	if _, err := r.pool.Exec(ctx,
		`UPDATE identity.refresh_token SET revoked_at = now()
		 WHERE revoked_at IS NULL
		   AND family_id = (SELECT family_id FROM identity.refresh_token WHERE token_hash = $1)`,
		presented,
	); err != nil {
		return fmt.Errorf("revoke refresh family: %w", err)
	}
	return nil
}
