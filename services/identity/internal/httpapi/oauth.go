package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/mentor-sator/Sifer/services/identity/internal/federation"
	"github.com/mentor-sator/Sifer/services/identity/internal/oauth"
	"github.com/mentor-sator/Sifer/services/identity/internal/session"
)

const maxOAuthBody = 8 << 10

type Federation interface {
	Start(ctx context.Context, provider, redirectURI string, forceConsent bool) (string, error)
	Finish(ctx context.Context, provider, state, code string) (session.Tokens, error)
}

type oauthStartRequest struct {
	RedirectURI  string `json:"redirect_uri"`
	ForceConsent bool   `json:"force_consent"`
}

type oauthStartResponse struct {
	AuthorizationURL string `json:"authorization_url"`
	ExpiresIn        int64  `json:"expires_in"`
}

type oauthFinishRequest struct {
	State string `json:"state"`
	Code  string `json:"code"`
}

func (a *api) oauthStart(c *gin.Context) {
	noStore(c)
	if a.federation == nil {
		writeError(c, http.StatusNotFound, "unknown_provider", "this sign-in provider is not configured")
		return
	}
	var request oauthStartRequest
	if status, code := decodeStrict(c, maxOAuthBody, &request); status != 0 {
		writeError(c, status, code, "request body must be one JSON object with redirect_uri and optional force_consent")
		return
	}
	authURL, err := a.federation.Start(c.Request.Context(), c.Param("provider"), request.RedirectURI, request.ForceConsent)
	switch {
	case err == nil:
		c.JSON(http.StatusOK, oauthStartResponse{AuthorizationURL: authURL, ExpiresIn: int64(oauth.FlowTTL.Seconds())})
	case errors.Is(err, federation.ErrUnknownProvider):
		writeError(c, http.StatusNotFound, "unknown_provider", "this sign-in provider is not configured")
	case errors.Is(err, oauth.ErrInvalidRedirect):
		writeError(c, http.StatusBadRequest, "invalid_redirect_uri", "redirect_uri must be http://127.0.0.1:<port>/oauth/callback")
	case errors.Is(err, oauth.ErrTooManyFlows):
		writeError(c, http.StatusServiceUnavailable, "busy", "too many sign-ins in progress; try again shortly")
	default:
		a.logger.ErrorContext(c.Request.Context(), "oauth start failed", "error", err)
		writeError(c, http.StatusInternalServerError, "internal", "request failed")
	}
}

func (a *api) oauthFinish(c *gin.Context) {
	noStore(c)
	if a.federation == nil {
		writeError(c, http.StatusNotFound, "unknown_provider", "this sign-in provider is not configured")
		return
	}
	var request oauthFinishRequest
	if status, code := decodeStrict(c, maxOAuthBody, &request); status != 0 {
		writeError(c, status, code, "request body must be one JSON object with state and code")
		return
	}
	provider := c.Param("provider")
	tokens, err := a.federation.Finish(c.Request.Context(), provider, request.State, request.Code)
	if err == nil {
		a.respondTokens(c, tokens, nil)
		return
	}
	status, code, message := oauthFailure(err)
	if status >= http.StatusInternalServerError {
		a.logger.ErrorContext(c.Request.Context(), "oauth sign-in failed", "provider", provider, "error", err)
	} else {
		a.logger.InfoContext(c.Request.Context(), "oauth sign-in refused", "provider", provider, "reason", code)
	}
	writeError(c, status, code, message)
}

func oauthFailure(err error) (int, string, string) {
	switch {
	case errors.Is(err, federation.ErrUnknownProvider):
		return http.StatusNotFound, "unknown_provider", "this sign-in provider is not configured"
	case errors.Is(err, federation.ErrInvalidRequest):
		return http.StatusBadRequest, "invalid_request", "state and code are required"
	case errors.Is(err, oauth.ErrUnknownState):
		return http.StatusBadRequest, "invalid_state", "this sign-in attempt expired; start again"
	case errors.Is(err, oauth.ErrExchangeRejected):
		return http.StatusBadRequest, "invalid_grant", "the provider refused this sign-in; start again"
	case errors.Is(err, federation.ErrEmailUnverified):
		return http.StatusForbidden, "email_unverified", "the provider has not verified this email address"
	case errors.Is(err, federation.ErrAccountDisabled):
		return http.StatusForbidden, "account_disabled", "this account is closed"
	case errors.Is(err, federation.ErrAccountExists):
		return http.StatusConflict, "account_exists", "an account with this email already exists; sign in with your password"
	case errors.Is(err, federation.ErrConsentRequired):
		return http.StatusConflict, "consent_required", "start again with force_consent"
	case errors.Is(err, oauth.ErrExchangeFailed), errors.Is(err, oauth.ErrInvalidIDToken):
		return http.StatusBadGateway, "provider_unavailable", "the provider could not complete the sign-in"
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return http.StatusServiceUnavailable, "busy", "the service is busy; try again shortly"
	default:
		return http.StatusInternalServerError, "internal", "request failed"
	}
}
