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

	"github.com/mentor-sator/Sifer/services/identity/internal/signing"
)

const (
	serviceName  = "identity"
	readyTimeout = 2 * time.Second
)

type Pinger interface {
	Ping(ctx context.Context) error
}

type KeySet interface {
	JWKS() signing.JWKSet
}

type Dependencies struct {
	DB       Pinger
	Accounts Registrar
	Sessions Sessions
	Keys     KeySet
	Logger   *slog.Logger
}

type api struct {
	db       Pinger
	accounts Registrar
	sessions Sessions
	keys     KeySet
	logger   *slog.Logger
}

func NewRouter(deps Dependencies) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(
		gin.Recovery(),
		otelgin.Middleware(serviceName, otelgin.WithFilter(notProbe)),
		traceResponse,
	)

	handlers := &api{db: deps.DB, accounts: deps.Accounts, sessions: deps.Sessions, keys: deps.Keys, logger: deps.Logger}
	router.GET("/healthz", health)
	router.GET("/readyz", handlers.ready)
	router.GET("/.well-known/jwks.json", handlers.jwks)
	router.POST("/v1/register", handlers.register)
	router.POST("/v1/login", handlers.login)
	router.POST("/v1/refresh", handlers.refresh)
	router.POST("/v1/logout", handlers.logout)
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

func (a *api) jwks(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=300")
	c.JSON(http.StatusOK, a.keys.JWKS())
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
