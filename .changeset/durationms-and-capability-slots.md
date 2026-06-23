---
"@agora/diagnostics": patch
---

Two faithful-port fixes against the NestJS source of truth:

- Re-add the optional `durationMs` field to the POINT `DiagnosticEvent` envelope and to `EmitOptions`. `emit(lib, event, payload, { durationMs })` now stamps it onto the published envelope (only when provided, via conditional spread), so observers can build duration histograms. Restores the cross-repo wire contract.
- Make the `capability()` protocol load-bearing: every global-slot key (`EMIT_SLOT`, `CONTEXT_ACCESSOR`, the diagnostics accessor/registry/subscribers slots, and the OTel `TRACEPARENT_SLOT`) is now minted through `capability(lib, name)` instead of a hand-rolled `Symbol.for(...)` literal. The produced `@agora/<lib>:<name>` wire strings are byte-identical to before. A new contract spec runs `assertCapabilityNaming(...)` against the real exported slot keys.
