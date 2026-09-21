package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

const (
	serviceName  = "identity"
	readyTimeout = 2 * time.Second
)

type Pinger interface {
	Ping(ctx context.Context) error
}

type api struct {
	db     Pinger
	logger *slog.Logger
}

func NewRouter(db Pinger, logger *slog.Logger) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(
		gin.Recovery(),
		otelgin.Middleware(serviceName, otelgin.WithFilter(notProbe)),
		traceResponse,
	)

	handlers := &api{db: db, logger: logger}
	router.GET("/healthz", health)
	router.GET("/readyz", handlers.ready)
	return router
}

func notProbe(request *http.Request) bool {
	return request.URL.Path != "/healthz" && request.URL.Path != "/readyz"
}

func traceResponse(c *gin.Context) {
	otel.GetTextMapPropagator().Inject(c.Request.Context(), propagation.HeaderCarrier(c.Writer.Header()))
	c.Next()
}

func health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (a *api) ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), readyTimeout)
	defer cancel()
	if err := a.db.Ping(ctx); err != nil {
		a.logger.WarnContext(ctx, "database not ready", "error", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable", "database": "unreachable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "database": "ok"})
}
