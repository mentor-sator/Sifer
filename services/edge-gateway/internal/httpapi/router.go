package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	siferv1 "github.com/mentor-sator/Sifer/gen/go/sifer/v1"
)

type api struct {
	orchestrator siferv1.OrchestratorServiceClient
}

func NewRouter(orchestrator siferv1.OrchestratorServiceClient) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())

	handlers := &api{orchestrator: orchestrator}
	router.GET("/healthz", health)
	router.POST("/v1/echo", handlers.echo)
	return router
}

func health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
