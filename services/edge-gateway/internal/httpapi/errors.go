package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func writeError(c *gin.Context, httpStatus int, code, message string) {
	c.JSON(httpStatus, gin.H{"error": code, "message": message})
}

func writeUpstreamError(c *gin.Context, err error) {
	upstream := status.Convert(err)
	switch upstream.Code() {
	case codes.InvalidArgument:
		writeError(c, http.StatusBadRequest, "invalid_argument", upstream.Message())
	case codes.FailedPrecondition:
		writeError(c, http.StatusConflict, "failed_precondition", upstream.Message())
	case codes.DeadlineExceeded:
		writeError(c, http.StatusGatewayTimeout, "upstream_timeout", "orchestrator did not answer in time")
	case codes.Unavailable:
		writeError(c, http.StatusServiceUnavailable, "upstream_unavailable", "orchestrator is unavailable")
	default:
		writeError(c, http.StatusBadGateway, "upstream_error", "orchestrator failed")
	}
}
