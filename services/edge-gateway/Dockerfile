FROM golang:1.27.1-trixie@sha256:433790e515d27dc6003e847e644cc0af956985cf315c1c58a3b73ee2dd305183 AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-trimpath
COPY go.mod go.sum ./
RUN go mod download
COPY gen/go gen/go
COPY internal internal
COPY services/edge-gateway services/edge-gateway
RUN go build -ldflags="-s -w" -o /out/edge-gateway ./services/edge-gateway

FROM gcr.io/distroless/static-debian13:nonroot@sha256:e2e927ec666bae08560abb3c55d0659eceabb657f56b6782ab500a9fc7f555e3
COPY --from=build /out/edge-gateway /edge-gateway
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/edge-gateway"]
