package mtls

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type authority struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	pem  []byte
}

func newAuthority(t *testing.T) authority {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "sifer-test-ca"},
		NotBefore:             time.Now().Add(-time.Minute),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return authority{cert: cert, key: key, pem: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})}
}

func (a authority) issue(t *testing.T, name string, usage x509.ExtKeyUsage) (certPEM, keyPEM []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: name},
		DNSNames:     []string{name},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{usage},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, a.cert, &key.PublicKey, a.key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
}

func write(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func serve(t *testing.T, ca authority) string {
	t.Helper()
	certPEM, keyPEM := ca.issue(t, "orchestrator", x509.ExtKeyUsageServerAuth)
	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	clients := x509.NewCertPool()
	clients.AddCert(ca.cert)
	listener, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{pair},
		ClientCAs:    clients,
		ClientAuth:   tls.RequireAndVerifyClientCert,
		MinVersion:   tls.VersionTLS13,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				if err := conn.(*tls.Conn).Handshake(); err == nil {
					conn.Write([]byte("ok"))
				}
			}()
		}
	}()
	return listener.Addr().String()
}

func roundTrip(config *tls.Config, addr string) error {
	config = config.Clone()
	config.ServerName = "orchestrator"
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 2 * time.Second}, "tcp", addr, config)
	if err != nil {
		return err
	}
	defer conn.Close()
	buffer := make([]byte, 2)
	_, err = conn.Read(buffer)
	return err
}

func TestClientCompletesMutualTLS(t *testing.T) {
	ca := newAuthority(t)
	addr := serve(t, ca)
	dir := t.TempDir()
	certPEM, keyPEM := ca.issue(t, "edge-gateway", x509.ExtKeyUsageClientAuth)

	config, err := Client(write(t, dir, "ca.crt", ca.pem), write(t, dir, "gateway.crt", certPEM), write(t, dir, "gateway.key", keyPEM))
	if err != nil {
		t.Fatalf("Client: %v", err)
	}
	if err := roundTrip(config, addr); err != nil {
		t.Fatalf("mutual TLS failed: %v", err)
	}
}

func TestServerRejectsAClientFromAnotherAuthority(t *testing.T) {
	ca := newAuthority(t)
	addr := serve(t, ca)
	stranger := newAuthority(t)
	dir := t.TempDir()
	certPEM, keyPEM := stranger.issue(t, "edge-gateway", x509.ExtKeyUsageClientAuth)

	config, err := Client(write(t, dir, "ca.crt", ca.pem), write(t, dir, "gateway.crt", certPEM), write(t, dir, "gateway.key", keyPEM))
	if err != nil {
		t.Fatalf("Client: %v", err)
	}
	if err := roundTrip(config, addr); err == nil {
		t.Fatal("server accepted a certificate signed by another authority")
	}
}

func TestClientRejectsUnusableFiles(t *testing.T) {
	dir := t.TempDir()
	notPEM := write(t, dir, "junk", []byte("not a certificate"))
	if _, err := Client(filepath.Join(dir, "missing"), notPEM, notPEM); err == nil {
		t.Fatal("Client accepted a missing CA file")
	}
	if _, err := Client(notPEM, notPEM, notPEM); err == nil {
		t.Fatal("Client accepted a CA file without PEM")
	}
	ca := newAuthority(t)
	if _, err := Client(write(t, dir, "ca.crt", ca.pem), notPEM, notPEM); err == nil {
		t.Fatal("Client accepted an unusable key pair")
	}
}
