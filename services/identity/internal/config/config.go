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

var ErrDatabaseURLMissing = errors.New("SIFER_IDENTITY_DATABASE_URL is not set")

type Config struct {
	Addr         string
	OTLPEndpoint string
	DatabaseURL  string
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
	return Config{Addr: addr, OTLPEndpoint: otlpEndpoint, DatabaseURL: databaseURL}, nil
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
