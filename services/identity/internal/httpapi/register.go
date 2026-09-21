package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mentor-sator/Sifer/services/identity/internal/account"
)

const maxRegisterBody = 4 << 10

type Registrar interface {
	Register(ctx context.Context, registration account.Registration) (account.Account, error)
}

type registerRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

type accountResponse struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Locale      string `json:"locale"`
	CreatedAt   string `json:"created_at"`
}

func (a *api) register(c *gin.Context) {
	var request registerRequest
	if status, code := decodeStrict(c, maxRegisterBody, &request); status != 0 {
		writeError(c, status, code, "request body must be one JSON object with email, password and optional display_name")
		return
	}

	created, err := a.accounts.Register(c.Request.Context(), account.Registration{
		Email:       request.Email,
		Password:    request.Password,
		DisplayName: request.DisplayName,
	})
	var validation *account.ValidationError
	switch {
	case err == nil:
		c.JSON(http.StatusCreated, accountResponse{
			ID:          created.ID,
			Email:       created.Email,
			DisplayName: created.DisplayName,
			Locale:      created.Locale,
			CreatedAt:   created.CreatedAt.UTC().Format(time.RFC3339),
		})
	case errors.As(err, &validation):
		writeError(c, http.StatusBadRequest, "invalid_"+validation.Field, validation.Field+" "+validation.Reason)
	case errors.Is(err, account.ErrEmailTaken):
		writeError(c, http.StatusConflict, "email_taken", "an account with this email already exists")
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		writeError(c, http.StatusServiceUnavailable, "busy", "the service is busy; try again shortly")
	default:
		a.logger.ErrorContext(c.Request.Context(), "registration failed", "error", err)
		writeError(c, http.StatusInternalServerError, "internal", "registration failed")
	}
}

func decodeStrict(c *gin.Context, limit int64, target any) (int, string) {
	body := http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return http.StatusRequestEntityTooLarge, "body_too_large"
		}
		return http.StatusBadRequest, "invalid_json"
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return http.StatusBadRequest, "invalid_json"
	}
	return 0, ""
}

func writeError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": code, "message": message})
}
