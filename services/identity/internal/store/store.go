package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/pgxpool"
)

const applicationName = "sifer-identity"

var ErrInvalidURL = errors.New("identity database url cannot be parsed (details withheld to keep credentials out of logs)")

type Target struct {
	User     string
	Host     string
	Port     uint16
	Database string
}

func PoolConfig(databaseURL string) (*pgxpool.Config, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, ErrInvalidURL
	}
	cfg.MaxConns = 10
	cfg.MinConns = 0
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnLifetimeJitter = 5 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.ConnConfig.RuntimeParams["application_name"] = applicationName
	cfg.ConnConfig.Tracer = otelpgx.NewTracer()
	return cfg, nil
}

func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, Target, error) {
	cfg, err := PoolConfig(databaseURL)
	if err != nil {
		return nil, Target{}, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, Target{}, fmt.Errorf("identity database pool: %w", err)
	}
	target := Target{
		User:     cfg.ConnConfig.User,
		Host:     cfg.ConnConfig.Host,
		Port:     cfg.ConnConfig.Port,
		Database: cfg.ConnConfig.Database,
	}
	return pool, target, nil
}
