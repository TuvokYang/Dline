# Dline Protobuf and ProtoBus Development Guide

Dline uses Protobuf for typed contracts across the Webview, core Controller, standalone gRPC surfaces, and host bridges.

The VS Code Webview transport is ProtoBus envelopes over `postMessage`. Generated APIs may look gRPC-like, but a Webview RPC is not a network gRPC socket.

## Source layout

- application and Webview services: `proto/dline/*.proto`;
- provider/model messages: `proto/dline/models/` and `proto/dline/provider/`;
- IDE host services: `proto/dline/host/*.proto`;
- shared messages: `proto/dline/common.proto`.

Use `package dline...` namespaces and imports rooted under `dline/`. Follow the existing domain file rather than creating a catch-all service.

Naming conventions:

- services: `PascalCaseService`;
- RPC methods: `camelCase`;
- messages and enums: `PascalCase`;
- fields: `snake_case` in Proto, projected to TypeScript by the generator.

Use an existing common request/response only when its semantics match. Define a domain message when validation, evolution, or multiple fields matter.

## Development workflow

### 1. Define the contract

Add the message and RPC to the owning file under `proto/dline/` or `proto/dline/host/`.

Specify:

- request and response ownership;
- optional, repeated, and default semantics;
- unary or streaming behavior;
- error/cancellation expectations;
- compatibility with existing field numbers and consumers.

Never reuse or renumber an existing field for a different meaning. Reserve removed field numbers/names when compatibility requires it.

### 2. Regenerate all projections

Run from the repository root:

```text
npm run protos
```

`scripts/build-proto.mjs` regenerates and cleans generated outputs, including:

- `src/shared/proto/` TypeScript message types and Dline barrel files;
- `src/generated/grpc-js/` service definitions;
- `src/generated/nice-grpc/` promise clients;
- `src/generated/hosts/` ProtoBus and host-bridge glue;
- `webview-ui/src/services/grpc-client.ts` Webview clients;
- `dist-standalone/proto/descriptor_set.pb`.

Do not edit generated files manually. If generated output is wrong, change the Proto or generator.

### 3. Implement the owning handler

Application RPC handlers normally live under `src/core/controller/<domain>/`. Host bridge handlers live under `src/hosts/vscode/hostbridge/<service>/`.

Generated registries discover handlers according to service/method names. Follow an existing RPC in the same service and verify the generated registration instead of maintaining a second manual registry.

Keep transport DTOs at the boundary. Convert to domain/runtime types before applying business rules.

### 4. Call through the generated client

The Webview imports generated clients from `webview-ui/src/services/grpc-client.ts` and message types from `@shared/proto/dline/...`.

Core/standalone and host adapters use the generated grpc-js, nice-grpc, or host client interfaces appropriate to their transport.

Do not send an ad-hoc `postMessage` object when an RPC contract owns the interaction.

## Enum and message conversion

Some persisted/UI message enums also require explicit compatibility conversion in `src/shared/proto-conversions/`. Search for both conversion directions before adding a value.

Adding a Proto field does not automatically make it part of Controller state projection, Webview defaults, CLI settings, persistence, or validation. Trace the full round trip.

## Verification

After generation:

1. inspect the generated diff for unexpected deletions or namespace drift;
2. run `npm run check-types`;
3. run `npm run lint` for Proto lint and code lint;
4. run focused handler, conversion, and transport tests;
5. test streaming cancellation and disposal for streaming RPCs;
6. test Webview/host integration when the RPC crosses process or IDE boundaries;
7. run `git diff --check` and verify generated files are not manually edited.

A successful `npm run protos` alone does not prove the handler is registered or the consumer uses the new contract.
