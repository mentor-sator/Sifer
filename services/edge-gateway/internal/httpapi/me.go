package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/mentor-sator/Sifer/services/edge-gateway/internal/auth"
)

const principalKey = "sifer.principal"

type Verifier interface {
	Verify(ctx context.Context, raw string) (auth.Principal, error)
}

func requireAuth(verifier Verifier) gin.HandlerFunc {
	return func(c *gin.Context) {
		scheme, raw, found := strings.Cut(c.GetHeader("Authorization"), " ")
		if !found || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(raw) == "" {
			c.Header("WWW-Authenticate", `Bearer realm="sifer"`)
			writeError(c, http.StatusUnauthorized, "unauthenticated", "an access token is required")
			c.Abort()
			return
		}
		principal, err := verifier.Verify(c.Request.Context(), strings.TrimSpace(raw))
		switch {
		case errors.Is(err, auth.ErrNoKeys):
			writeError(c, http.StatusServiceUnavailable, "auth_unavailable", "token verification is not ready yet")
			c.Abort()
			return
		case err != nil:
			c.Header("WWW-Authenticate", `Bearer realm="sifer", error="invalid_token"`)
			writeError(c, http.StatusUnauthorized, "invalid_token", "the access token is invalid or expired")
			c.Abort()
			return
		}
		c.Set(principalKey, principal)
		c.Next()
	}
}

func me(c *gin.Context) {
	principal := c.MustGet(principalKey).(auth.Principal)
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"id": principal.UserID, "email": principal.Email})
}
