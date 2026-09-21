package config

import "testing"

var variables = []string{
	"SIFER_GATEWAY_ADDR",
	"SIFER_ORCHESTRATOR_ADDR",
	"SIFER_OTLP_ENDPOINT",
	"SIFER_ORCHESTRATOR_TLS_CA",
	"SIFER_ORCHESTRATOR_TLS_CERT",
	"SIFER_ORCHESTRATOR_TLS_KEY",
}

func clearEnv(t *testing.T) {
	t.Helper()
	for _, name := range variables {
		t.Setenv(name, "")
	}
}

func TestLoadDefaultsToLoopbackWithoutTLS(t *testing.T) {
	clearEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Config{Addr: defaultAddr, OrchestratorAddr: defaultOrchestratorAddr, OTLPEndpoint: defaultOTLPEndpoint}
	if cfg != want {
		t.Fatalf("Load = %+v, want %+v", cfg, want)
	}
	if cfg.OrchestratorTLS.Enabled() {
		t.Fatal("TLS enabled with no files configured")
	}
}

func TestLoadHonoursOverrides(t *testing.T) {
	clearEnv(t)
	t.Setenv("SIFER_GATEWAY_ADDR", "127.0.0.1:18080")
	t.Setenv("SIFER_ORCHESTRATOR_ADDR", "127.0.0.1:18083")
	t.Setenv("SIFER_OTLP_ENDPOINT", "127.0.0.1:14317")
	t.Setenv("SIFER_ORCHESTRATOR_TLS_CA", "ca.crt")
	t.Setenv("SIFER_ORCHESTRATOR_TLS_CERT", "gateway.crt")
	t.Setenv("SIFER_ORCHESTRATOR_TLS_KEY", "gateway.key")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Config{
		Addr:             "127.0.0.1:18080",
		OrchestratorAddr: "127.0.0.1:18083",
		OTLPEndpoint:     "127.0.0.1:14317",
		OrchestratorTLS:  TLSFiles{CA: "ca.crt", Cert: "gateway.crt", Key: "gateway.key"},
	}
	if cfg != want {
		t.Fatalf("Load = %+v, want %+v", cfg, want)
	}
	if !cfg.OrchestratorTLS.Enabled() {
		t.Fatal("TLS not enabled with all three files configured")
	}
}

func TestLoadRejectsMalformedAddresses(t *testing.T) {
	for _, name := range variables[:3] {
		t.Run(name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv(name, "8080")
			if _, err := Load(); err == nil {
				t.Fatalf("Load accepted %s without host:port", name)
			}
		})
	}
}

func TestLoadRejectsPartialTLS(t *testing.T) {
	for _, name := range variables[3:] {
		t.Run(name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv(name, "only-this-one")
			if _, err := Load(); err == nil {
				t.Fatalf("Load accepted %s without the other two TLS files", name)
			}
		})
	}
}
