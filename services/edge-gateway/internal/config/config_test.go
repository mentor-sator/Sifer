package config

import "testing"

func TestLoadDefaultsToLoopback(t *testing.T) {
	t.Setenv("SIFER_GATEWAY_ADDR", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != defaultAddr {
		t.Fatalf("Addr = %q, want %q", cfg.Addr, defaultAddr)
	}
}

func TestLoadHonoursOverride(t *testing.T) {
	t.Setenv("SIFER_GATEWAY_ADDR", "127.0.0.1:18080")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != "127.0.0.1:18080" {
		t.Fatalf("Addr = %q, want 127.0.0.1:18080", cfg.Addr)
	}
}

func TestLoadRejectsMalformedAddress(t *testing.T) {
	t.Setenv("SIFER_GATEWAY_ADDR", "8080")
	if _, err := Load(); err == nil {
		t.Fatal("Load accepted an address that is not host:port")
	}
}
