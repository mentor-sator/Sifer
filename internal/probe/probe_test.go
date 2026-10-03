package probe

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func server(t *testing.T, status int) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	_, port, err := net.SplitHostPort(srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	return net.JoinHostPort("0.0.0.0", port)
}

func TestCheckPassesOnHealthyServer(t *testing.T) {
	if err := Check(context.Background(), server(t, http.StatusOK)); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestCheckFailsOnUnhealthyServer(t *testing.T) {
	if err := Check(context.Background(), server(t, http.StatusServiceUnavailable)); err == nil {
		t.Fatal("Check passed on a 503")
	}
}

func TestCheckFailsWhenNothingListens(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	listener.Close()
	if err := Check(context.Background(), addr); err == nil {
		t.Fatal("Check passed with nothing listening")
	}
}
