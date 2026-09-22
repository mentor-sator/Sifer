package config

import (
	"errors"
	"testing"
)

const (
	databaseURL = "postgresql://sifer_identity:secret@127.0.0.1:5433/sifer?sslmode=disable"
	signingKey  = "MC4CAQAwBQYDK2VwBCIEIJ1hsZ3v/VpguoRK9JLsLMREScVpezJpGXA7rAMcrn9g"
)

func setEnv(t *testing.T, values map[string]string) {
	t.Helper()
	for _, name := range []string{"SIFER_IDENTITY_ADDR", "SIFER_OTLP_ENDPOINT", "SIFER_IDENTITY_DATABASE_URL", "SIFER_IDENTITY_SIGNING_KEY"} {
		t.Setenv(name, values[name])
	}
}

func TestLoadDefaultsToLoopback(t *testing.T) {
	setEnv(t, map[string]string{"SIFER_IDENTITY_DATABASE_URL": databaseURL, "SIFER_IDENTITY_SIGNING_KEY": signingKey})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Config{Addr: defaultAddr, OTLPEndpoint: defaultOTLPEndpoint, DatabaseURL: databaseURL, SigningKey: signingKey}
	if cfg != want {
		t.Fatalf("Load = %+v, want %+v", cfg, want)
	}
}

func TestLoadHonoursOverrides(t *testing.T) {
	setEnv(t, map[string]string{
		"SIFER_IDENTITY_ADDR":         "0.0.0.0:18081",
		"SIFER_OTLP_ENDPOINT":         "otel:4317",
		"SIFER_IDENTITY_DATABASE_URL": databaseURL,
		"SIFER_IDENTITY_SIGNING_KEY":  signingKey,
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != "0.0.0.0:18081" || cfg.OTLPEndpoint != "otel:4317" {
		t.Fatalf("Load = %+v", cfg)
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	setEnv(t, nil)
	if _, err := Load(); !errors.Is(err, ErrDatabaseURLMissing) {
		t.Fatalf("Load error = %v, want ErrDatabaseURLMissing", err)
	}
}

func TestLoadRequiresSigningKey(t *testing.T) {
	setEnv(t, map[string]string{"SIFER_IDENTITY_DATABASE_URL": databaseURL})
	if _, err := Load(); !errors.Is(err, ErrSigningKeyMissing) {
		t.Fatalf("Load error = %v, want ErrSigningKeyMissing", err)
	}
}

func TestLoadRejectsMalformedAddress(t *testing.T) {
	setEnv(t, map[string]string{"SIFER_IDENTITY_ADDR": "8081", "SIFER_IDENTITY_DATABASE_URL": databaseURL, "SIFER_IDENTITY_SIGNING_KEY": signingKey})
	if _, err := Load(); err == nil {
		t.Fatal("Load accepted an address without a host")
	}
}
