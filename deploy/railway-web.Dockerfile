# syntax=docker/dockerfile:1

FROM golang:1.26 AS build
WORKDIR /src

COPY web/go.mod web/go.sum* ./
RUN go mod download

COPY web/ .

RUN GOOS=js GOARCH=wasm go build -o web/app.wasm .
RUN CGO_ENABLED=0 go build -o /out/server .

FROM gcr.io/distroless/base-debian12
WORKDIR /app
COPY --from=build /out/server /app/server
COPY --from=build /src/web /app/web
ENV PORT=8080
EXPOSE 8080
CMD ["/app/server"]
