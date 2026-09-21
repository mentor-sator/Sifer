package store

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

const databaseURL = "postgresql://sifer_identity:s3cret-value@127.0.0.1:5433/sifer?sslmode=disable"

func TestPoolConfigAppliesLimits(t *testing.T) {
	cfg, err := PoolConfig(databaseURL)
	if err != nil {
		t.Fatalf("PoolConfig: %v", err)
	}
	if cfg.MaxConns != 10 || cfg.MinConns != 0 {
		t.Fatalf("conns = %d..%d, want 0..10", cfg.MinConns, cfg.MaxConns)
	}
	if cfg.ConnConfig.ConnectTimeout != 5*time.Second {
		t.Fatalf("connect timeout = %s", cfg.ConnConfig.ConnectTimeout)
	}
	if got := cfg.ConnConfig.RuntimeParams["application_name"]; got != applicationName {
		t.Fatalf("application_name = %q", got)
	}
	if cfg.ConnConfig.Tracer == nil {
		t.Fatal("no tracer attached")
	}
}

func TestPoolConfigErrorHidesCredentials(t *testing.T) {
	_, err := PoolConfig("postgresql://sifer_identity:s3cret-value@127.0.0.1:notaport/sifer")
	if !errors.Is(err, ErrInvalidURL) {
		t.Fatalf("error = %v, want ErrInvalidURL", err)
	}
	if strings.Contains(err.Error(), "s3cret-value") {
		t.Fatalf("error leaks the password: %v", err)
	}
}

func TestOpenIsLazyAndReportsTarget(t *testing.T) {
	pool, target, err := Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer pool.Close()
	want := Target{User: "sifer_identity", Host: "127.0.0.1", Port: 5433, Database: "sifer"}
	if target != want {
		t.Fatalf("target = %+v, want %+v", target, want)
	}
}
