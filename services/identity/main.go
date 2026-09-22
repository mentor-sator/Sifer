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

	"github.com/mentor-sator/Sifer/internal/probe"
	"github.com/mentor-sator/Sifer/internal/telemetry"
	"github.com/mentor-sator/Sifer/services/identity/internal/account"
	"github.com/mentor-sator/Sifer/services/identity/internal/config"
	"github.com/mentor-sator/Sifer/services/identity/internal/httpapi"
	"github.com/mentor-sator/Sifer/services/identity/internal/password"
	"github.com/mentor-sator/Sifer/services/identity/internal/signing"
	"github.com/mentor-sator/Sifer/services/identity/internal/store"
)

const (
	serviceName        = "identity"
	shutdownGrace      = 10 * time.Second
	telemetryFlush     = 3 * time.Second
	hashingConcurrency = 2
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "healthcheck":
			os.Exit(healthcheck())
		case "keygen":
			os.Exit(keygen())
		}
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("identity stopped", "error", err)
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

func keygen() int {
	encoded, err := signing.Generate()
	if err != nil {
		fmt.Fprintln(os.Stderr, "keygen:", err)
		return 1
	}
	fmt.Println(encoded)
	return 0
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	key, err := signing.Parse(cfg.SigningKey)
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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, target, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	accounts := account.NewService(store.NewAccounts(pool), password.NewHasher(password.Default, hashingConcurrency))

	server := &http.Server{
		Addr: cfg.Addr,
		Handler: httpapi.NewRouter(httpapi.Dependencies{
			DB:       pool,
			Accounts: accounts,
			Keys:     key,
			Logger:   logger,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("identity listening",
			"addr", cfg.Addr,
			"otlp", cfg.OTLPEndpoint,
			"db_user", target.User,
			"db_host", target.Host,
			"db_port", target.Port,
			"db_name", target.Database,
			"signing_kid", key.ID(),
		)
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

	logger.Info("identity shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}
