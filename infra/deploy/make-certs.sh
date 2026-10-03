#!/usr/bin/env bash
set -euo pipefail

out="${1:?usage: make-certs.sh <output-dir>}"
days=2
mkdir -p "$out"
cd "$out"

openssl req -x509 -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout ca.key -out ca.crt -days "$days" -subj "/CN=sifer-deploy-ca" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"

issue() {
  local name="$1" usage="$2"
  openssl req -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -keyout "$name.key" -out "$name.csr" -subj "/CN=$name"
  openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "$name.crt" -days "$days" \
    -extfile <(printf 'subjectAltName=DNS:%s\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=%s\n' "$name" "$usage")
  rm "$name.csr"
}

issue orchestrator serverAuth
issue edge-gateway clientAuth
rm ca.key ca.srl
chmod 0444 ca.crt orchestrator.crt edge-gateway.crt
chmod 0400 orchestrator.key edge-gateway.key
