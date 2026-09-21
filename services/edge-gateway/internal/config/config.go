package config

import (
	"fmt"
	"net"
	"os"
)

const defaultAddr = "127.0.0.1:8080"

type Config struct {
	Addr string
}

func Load() (Config, error) {
	addr := os.Getenv("SIFER_GATEWAY_ADDR")
	if addr == "" {
		addr = defaultAddr
	}
	if _, _, err := net.SplitHostPort(addr); err != nil {
		return Config{}, fmt.Errorf("SIFER_GATEWAY_ADDR %q: %w", addr, err)
	}
	return Config{Addr: addr}, nil
}
