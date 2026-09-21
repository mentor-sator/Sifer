package config

import (
	"fmt"
	"net"
	"os"
)

const (
	defaultAddr             = "127.0.0.1:8080"
	defaultOrchestratorAddr = "127.0.0.1:8083"
	defaultOTLPEndpoint     = "127.0.0.1:4317"
)

type Config struct {
	Addr             string
	OrchestratorAddr string
	OTLPEndpoint     string
}

func Load() (Config, error) {
	addr, err := hostPort("SIFER_GATEWAY_ADDR", defaultAddr)
	if err != nil {
		return Config{}, err
	}
	orchestratorAddr, err := hostPort("SIFER_ORCHESTRATOR_ADDR", defaultOrchestratorAddr)
	if err != nil {
		return Config{}, err
	}
	otlpEndpoint, err := hostPort("SIFER_OTLP_ENDPOINT", defaultOTLPEndpoint)
	if err != nil {
		return Config{}, err
	}
	return Config{Addr: addr, OrchestratorAddr: orchestratorAddr, OTLPEndpoint: otlpEndpoint}, nil
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
