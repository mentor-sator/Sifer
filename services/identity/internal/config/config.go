package config

import (
	"errors"
	"fmt"
	"net"
	"os"
)

const (
	defaultAddr         = "127.0.0.1:8081"
	defaultOTLPEndpoint = "127.0.0.1:4317"
)

var (
	ErrDatabaseURLMissing = errors.New("SIFER_IDENTITY_DATABASE_URL is not set")
	ErrSigningKeyMissing  = errors.New("SIFER_IDENTITY_SIGNING_KEY is not set")
	ErrGoogleIncomplete   = errors.New("SIFER_GOOGLE_CLIENT_ID and SIFER_GOOGLE_CLIENT_SECRET must be set together")
	ErrGrantKeyMissing    = errors.New("SIFER_IDENTITY_GRANT_KEY is required when a sign-in provider is configured")
)

type Config struct {
	Addr               string
	OTLPEndpoint       string
	DatabaseURL        string
	SigningKey         string
	GoogleClientID     string
	GoogleClientSecret string
	GrantKey           string
}

func (c Config) GoogleEnabled() bool {
	return c.GoogleClientID != ""
}

func Load() (Config, error) {
	addr, err := hostPort("SIFER_IDENTITY_ADDR", defaultAddr)
	if err != nil {
		return Config{}, err
	}
	otlpEndpoint, err := hostPort("SIFER_OTLP_ENDPOINT", defaultOTLPEndpoint)
	if err != nil {
		return Config{}, err
	}
	databaseURL := os.Getenv("SIFER_IDENTITY_DATABASE_URL")
	if databaseURL == "" {
		return Config{}, ErrDatabaseURLMissing
	}
	signingKey := os.Getenv("SIFER_IDENTITY_SIGNING_KEY")
	if signingKey == "" {
		return Config{}, ErrSigningKeyMissing
	}
	cfg := Config{
		Addr:               addr,
		OTLPEndpoint:       otlpEndpoint,
		DatabaseURL:        databaseURL,
		SigningKey:         signingKey,
		GoogleClientID:     os.Getenv("SIFER_GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("SIFER_GOOGLE_CLIENT_SECRET"),
		GrantKey:           os.Getenv("SIFER_IDENTITY_GRANT_KEY"),
	}
	if (cfg.GoogleClientID == "") != (cfg.GoogleClientSecret == "") {
		return Config{}, ErrGoogleIncomplete
	}
	if cfg.GoogleEnabled() && cfg.GrantKey == "" {
		return Config{}, ErrGrantKeyMissing
	}
	return cfg, nil
}

func hostPort(name, fallback string) (string, error) {
	value := os.Getenv(name)
	if value == "" {
		value = fallback
	}
	if _, _, err := net.SplitHostPort(value); err != nil {
		return "", fmt.Errorf("%s %q: %w", name, value, err)
	}
	return value, nil
}
