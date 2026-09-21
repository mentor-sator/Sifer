package config

import "testing"

func TestLoadDefaultsToLoopback(t *testing.T) {
	t.Setenv("SIFER_GATEWAY_ADDR", "")
	t.Setenv("SIFER_ORCHESTRATOR_ADDR", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != defaultAddr || cfg.OrchestratorAddr != defaultOrchestratorAddr {
		t.Fatalf("Load = %+v", cfg)
	}
}

func TestLoadHonoursOverrides(t *testing.T) {
	t.Setenv("SIFER_GATEWAY_ADDR", "127.0.0.1:18080")
	t.Setenv("SIFER_ORCHESTRATOR_ADDR", "127.0.0.1:18083")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != "127.0.0.1:18080" || cfg.OrchestratorAddr != "127.0.0.1:18083" {
		t.Fatalf("Load = %+v", cfg)
	}
}

func TestLoadRejectsMalformedAddresses(t *testing.T) {
	for _, name := range []string{"SIFER_GATEWAY_ADDR", "SIFER_ORCHESTRATOR_ADDR"} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("SIFER_GATEWAY_ADDR", "")
			t.Setenv("SIFER_ORCHESTRATOR_ADDR", "")
			t.Setenv(name, "8080")
			if _, err := Load(); err == nil {
				t.Fatalf("Load accepted %s without host:port", name)
			}
		})
	}
}
