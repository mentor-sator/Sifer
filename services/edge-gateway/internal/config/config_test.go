package config

import "testing"

var variables = []string{"SIFER_GATEWAY_ADDR", "SIFER_ORCHESTRATOR_ADDR", "SIFER_OTLP_ENDPOINT"}

func clearEnv(t *testing.T) {
	t.Helper()
	for _, name := range variables {
		t.Setenv(name, "")
	}
}

func TestLoadDefaultsToLoopback(t *testing.T) {
	clearEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Config{Addr: defaultAddr, OrchestratorAddr: defaultOrchestratorAddr, OTLPEndpoint: defaultOTLPEndpoint}
	if cfg != want {
		t.Fatalf("Load = %+v, want %+v", cfg, want)
	}
}

func TestLoadHonoursOverrides(t *testing.T) {
	clearEnv(t)
	t.Setenv("SIFER_GATEWAY_ADDR", "127.0.0.1:18080")
	t.Setenv("SIFER_ORCHESTRATOR_ADDR", "127.0.0.1:18083")
	t.Setenv("SIFER_OTLP_ENDPOINT", "127.0.0.1:14317")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Config{Addr: "127.0.0.1:18080", OrchestratorAddr: "127.0.0.1:18083", OTLPEndpoint: "127.0.0.1:14317"}
	if cfg != want {
		t.Fatalf("Load = %+v, want %+v", cfg, want)
	}
}

func TestLoadRejectsMalformedAddresses(t *testing.T) {
	for _, name := range variables {
		t.Run(name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv(name, "8080")
			if _, err := Load(); err == nil {
				t.Fatalf("Load accepted %s without host:port", name)
			}
		})
	}
}
