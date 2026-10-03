package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
)

const (
	defaultAddr             = "127.0.0.1:8080"
	defaultOrchestratorAddr = "127.0.0.1:8083"
	defaultOTLPEndpoint     = "127.0.0.1:4317"
	defaultIdentityJWKSURL  = "http://127.0.0.1:8081/.well-known/jwks.json"
	orchestratorTLSPrefix   = "SIFER_ORCHESTRATOR_TLS"
)

type TLSFiles struct {
	CA   string
	Cert string
	Key  string
}

func (f TLSFiles) Enabled() bool {
	return f != TLSFiles{}
}

type Config struct {
	Addr             string
	OrchestratorAddr string
	OTLPEndpoint     string
	IdentityJWKSURL  string
	OrchestratorTLS  TLSFiles
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
	identityJWKSURL, err := httpURL("SIFER_IDENTITY_JWKS_URL", defaultIdentityJWKSURL)
	if err != nil {
		return Config{}, err
	}
	orchestratorTLS, err := tlsFiles(orchestratorTLSPrefix)
	if err != nil {
		return Config{}, err
	}
	return Config{
		Addr:             addr,
		OrchestratorAddr: orchestratorAddr,
		OTLPEndpoint:     otlpEndpoint,
		IdentityJWKSURL:  identityJWKSURL,
		OrchestratorTLS:  orchestratorTLS,
	}, nil
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

func httpURL(name, fallback string) (string, error) {
	value := os.Getenv(name)
	if value == "" {
		value = fallback
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", fmt.Errorf("%s %q: must be an http or https URL", name, value)
	}
	return value, nil
}

func tlsFiles(prefix string) (TLSFiles, error) {
	files := TLSFiles{
		CA:   os.Getenv(prefix + "_CA"),
		Cert: os.Getenv(prefix + "_CERT"),
		Key:  os.Getenv(prefix + "_KEY"),
	}
	set := 0
	for _, value := range []string{files.CA, files.Cert, files.Key} {
		if value != "" {
			set++
		}
	}
	if set != 0 && set != 3 {
		return TLSFiles{}, fmt.Errorf("%s_CA, %s_CERT and %s_KEY must be set together", prefix, prefix, prefix)
	}
	return files, nil
}
