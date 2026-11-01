# TH-D75 Remote

Cross-platform remote control for the JVCKENWOOD **TH-D75** handheld
transceiver — a community reimplementation of the protocol used by the
Windows-only *ARFC-D75* software.

**Build, setup and run instructions live in the
[repository README](../README.md).** The full reverse-engineered
protocol specification is [`../PROTOCOL.md`](../PROTOCOL.md).

## Layout

```
src/protocol/commands.js   wire constants (bands, modes, steps, tones…)
src/protocol/connection.js protocol engine: framing, queue, parsers, commands
src/main.js                Electron main: serialport, IPC whitelist, polling
src/main/audio.js          speaker-monitor loopback via pactl
src/preload.js             contextBridge API
src/renderer/              UI (vanilla HTML/CSS/JS)
test/                      unit tests against a mock transport (no radio)
cli.js                     read-only live probe: node cli.js /dev/ttyACM0
```

The protocol engine is deliberately Electron-free and transport-agnostic —
`THD75Connection` takes anything with `write(str)` and `on('data')`, so it
can be reused from plain Node scripts or tests.

## License / scope

MIT for this code. The original ARFC-D75 remains JVCKENWOOD's software
and is not redistributed here.
