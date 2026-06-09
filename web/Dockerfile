# syntax=docker/dockerfile:1

# Build stage: compile the WASM frontend and the native server binary.
FROM golang:1.26 AS build
WORKDIR /src

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

# 1) Frontend -> WebAssembly, served at /web/app.wasm.
RUN GOOS=js GOARCH=wasm go build -o web/app.wasm .
# 2) Native server binary.
RUN CGO_ENABLED=0 go build -o /out/server .

# Run stage: minimal image with just the server and static assets.
FROM gcr.io/distroless/base-debian12
WORKDIR /app
COPY --from=build /out/server /app/server
COPY --from=build /src/web /app/web
ENV PORT=8080
EXPOSE 8080
CMD ["/app/server"]
