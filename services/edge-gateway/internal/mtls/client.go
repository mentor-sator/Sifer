package mtls

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
)

func Client(caFile, certFile, keyFile string) (*tls.Config, error) {
	caPEM, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("read CA: %w", err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("%s holds no PEM certificate", caFile)
	}
	pair, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load client certificate: %w", err)
	}
	return &tls.Config{
		RootCAs:      roots,
		Certificates: []tls.Certificate{pair},
		MinVersion:   tls.VersionTLS13,
	}, nil
}
