package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"

	siferv1 "github.com/mentor-sator/Sifer/gen/go/sifer/v1"
	"github.com/mentor-sator/Sifer/internal/probe"
	"github.com/mentor-sator/Sifer/internal/telemetry"
	"github.com/mentor-sator/Sifer/services/edge-gateway/internal/config"
	"github.com/mentor-sator/Sifer/services/edge-gateway/internal/httpapi"
	"github.com/mentor-sator/Sifer/services/edge-gateway/internal/mtls"
)

const (
	serviceName    = "edge-gateway"
	shutdownGrace  = 10 * time.Second
	telemetryFlush = 3 * time.Second
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("edge-gateway stopped", "error", err)
		os.Exit(1)
	}
}

func healthcheck() int {
	cfg, err := config.Load()
	if err == nil {
		err = probe.Check(context.Background(), cfg.Addr)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "unhealthy:", err)
		return 1
	}
	return 0
}

func orchestratorCredentials(cfg config.Config) (credentials.TransportCredentials, error) {
	if !cfg.OrchestratorTLS.Enabled() {
		return insecure.NewCredentials(), nil
	}
	files := cfg.OrchestratorTLS
	tlsConfig, err := mtls.Client(files.CA, files.Cert, files.Key)
	if err != nil {
		return nil, fmt.Errorf("orchestrator mTLS: %w", err)
	}
	return credentials.NewTLS(tlsConfig), nil
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	shutdownTelemetry, err := telemetry.Setup(context.Background(), serviceName, cfg.OTLPEndpoint)
	if err != nil {
		return err
	}
	defer func() {
		flushCtx, cancel := context.WithTimeout(context.Background(), telemetryFlush)
		defer cancel()
		if err := shutdownTelemetry(flushCtx); err != nil {
			logger.Warn("telemetry flush failed", "error", err)
		}
	}()

	transport, err := orchestratorCredentials(cfg)
	if err != nil {
		return err
	}

	conn, err := grpc.NewClient(
		cfg.OrchestratorAddr,
		grpc.WithTransportCredentials(transport),
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
	)
	if err != nil {
		return fmt.Errorf("orchestrator client %s: %w", cfg.OrchestratorAddr, err)
	}
	defer conn.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.NewRouter(siferv1.NewOrchestratorServiceClient(conn)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("edge-gateway listening", "addr", cfg.Addr, "orchestrator", cfg.OrchestratorAddr, "otlp", cfg.OTLPEndpoint, "mtls", cfg.OrchestratorTLS.Enabled())
		serveErr <- server.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}

	logger.Info("edge-gateway shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}
