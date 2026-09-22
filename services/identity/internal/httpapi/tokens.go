package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mentor-sator/Sifer/services/identity/internal/session"
)

const maxTokenBody = 4 << 10

type Sessions interface {
	Login(ctx context.Context, email, password string) (session.Tokens, error)
	Refresh(ctx context.Context, refreshToken string) (session.Tokens, error)
	Logout(ctx context.Context, refreshToken string) error
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type tokenResponse struct {
	AccessToken      string `json:"access_token"`
	TokenType        string `json:"token_type"`
	ExpiresIn        int64  `json:"expires_in"`
	RefreshToken     string `json:"refresh_token"`
	RefreshExpiresIn int64  `json:"refresh_expires_in"`
}

func (a *api) login(c *gin.Context) {
	noStore(c)
	var request loginRequest
	if status, code := decodeStrict(c, maxTokenBody, &request); status != 0 {
		writeError(c, status, code, "request body must be one JSON object with email and password")
		return
	}
	tokens, err := a.sessions.Login(c.Request.Context(), request.Email, request.Password)
	a.respondTokens(c, tokens, err)
}

func (a *api) refresh(c *gin.Context) {
	noStore(c)
	var request refreshRequest
	if status, code := decodeStrict(c, maxTokenBody, &request); status != 0 {
		writeError(c, status, code, "request body must be one JSON object with refresh_token")
		return
	}
	tokens, err := a.sessions.Refresh(c.Request.Context(), request.RefreshToken)
	if errors.Is(err, session.ErrRefreshReused) {
		a.logger.WarnContext(c.Request.Context(), "refresh token reuse detected; family revoked", "client_ip", c.ClientIP())
	}
	a.respondTokens(c, tokens, err)
}

func (a *api) logout(c *gin.Context) {
	noStore(c)
	var request refreshRequest
	if status, code := decodeStrict(c, maxTokenBody, &request); status != 0 {
		writeError(c, status, code, "request body must be one JSON object with refresh_token")
		return
	}
	if err := a.sessions.Logout(c.Request.Context(), request.RefreshToken); err != nil {
		a.logger.ErrorContext(c.Request.Context(), "logout failed", "error", err)
		writeError(c, http.StatusInternalServerError, "internal", "logout failed")
		return
	}
	c.Status(http.StatusNoContent)
}

func (a *api) respondTokens(c *gin.Context, tokens session.Tokens, err error) {
	switch {
	case err == nil:
		now := time.Now()
		c.JSON(http.StatusOK, tokenResponse{
			AccessToken:      tokens.AccessToken,
			TokenType:        "Bearer",
			ExpiresIn:        int64(tokens.AccessExpiresAt.Sub(now).Round(time.Second).Seconds()),
			RefreshToken:     tokens.RefreshToken,
			RefreshExpiresIn: int64(tokens.RefreshExpiresAt.Sub(now).Round(time.Second).Seconds()),
		})
	case errors.Is(err, session.ErrInvalidCredentials):
		writeError(c, http.StatusUnauthorized, "invalid_credentials", "email or password is incorrect")
	case errors.Is(err, session.ErrInvalidRefresh), errors.Is(err, session.ErrRefreshReused):
		writeError(c, http.StatusUnauthorized, "invalid_refresh_token", "sign in again")
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		writeError(c, http.StatusServiceUnavailable, "busy", "the service is busy; try again shortly")
	default:
		a.logger.ErrorContext(c.Request.Context(), "token request failed", "error", err)
		writeError(c, http.StatusInternalServerError, "internal", "request failed")
	}
}

func noStore(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
}
