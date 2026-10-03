package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"

	siferv1 "github.com/mentor-sator/Sifer/gen/go/sifer/v1"
)

const serviceName = "edge-gateway"

type api struct {
	orchestrator siferv1.OrchestratorServiceClient
}

func NewRouter(orchestrator siferv1.OrchestratorServiceClient, verifier Verifier) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(
		gin.Recovery(),
		otelgin.Middleware(serviceName, otelgin.WithFilter(notHealthCheck)),
		traceResponse,
	)

	handlers := &api{orchestrator: orchestrator}
	router.GET("/healthz", health)
	router.POST("/v1/echo", handlers.echo)
	router.GET("/v1/me", requireAuth(verifier), me)
	return router
}

func notHealthCheck(request *http.Request) bool {
	return request.URL.Path != "/healthz"
}

func traceResponse(c *gin.Context) {
	otel.GetTextMapPropagator().Inject(c.Request.Context(), propagation.HeaderCarrier(c.Writer.Header()))
	c.Next()
}

func health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
