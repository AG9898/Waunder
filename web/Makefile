.PHONY: wasm server run tidy clean

# Compile the frontend to WebAssembly (served at /web/app.wasm).
wasm:
	GOOS=js GOARCH=wasm go build -o web/app.wasm .

# Build the native server binary.
server:
	go build -o bin/server .

# Build everything and run locally (defaults to :8000).
run: wasm server
	./bin/server

tidy:
	go mod tidy

clean:
	rm -f web/app.wasm
	rm -rf bin
