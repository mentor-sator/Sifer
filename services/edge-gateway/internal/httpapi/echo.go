package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/encoding/protojson"

	siferv1 "github.com/mentor-sator/Sifer/gen/go/sifer/v1"
	"github.com/mentor-sator/Sifer/services/edge-gateway/internal/contract"
)

const (
	maxBodyBytes    = 1 << 20
	upstreamTimeout = 5 * time.Second
)

func (a *api) echo(c *gin.Context) {
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(c, http.StatusRequestEntityTooLarge, "body_too_large", "request body exceeds 1 MiB")
			return
		}
		writeError(c, http.StatusBadRequest, "unreadable_body", "request body could not be read")
		return
	}

	envelope := &siferv1.Envelope{}
	if err := protojson.Unmarshal(body, envelope); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_envelope", "body is not a valid Envelope")
		return
	}

	if received := envelope.GetSchemaMajor(); received != contract.SchemaMajor {
		c.JSON(http.StatusConflict, gin.H{
			"error":    "schema_major_mismatch",
			"message":  "Sifer needs updating",
			"expected": contract.SchemaMajor,
			"received": received,
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), upstreamTimeout)
	defer cancel()

	reply, err := a.orchestrator.Echo(ctx, &siferv1.EchoRequest{Envelope: envelope})
	if err != nil {
		writeUpstreamError(c, err)
		return
	}

	payload, err := protojson.Marshal(reply.GetEnvelope())
	if err != nil {
		writeError(c, http.StatusInternalServerError, "encode_failed", "response could not be encoded")
		return
	}
	c.Data(http.StatusOK, "application/json", payload)
}
