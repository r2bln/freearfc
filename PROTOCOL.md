# TH-D75 PC-remote protocol specification

Reverse-engineered from **ARFC-D75 1.0.8717.20672** (JVCKENWOOD, setup.exe
MD5 `7072584d3dabb58a71ecc061486e7933`, `arfc_d75.exe` SHA-256
`9de828cb22884ea0d716b88fe9f90ccd91848103b625dcf4f922bee82d858405`).
Sources: decompiled .NET code (`decomp/`) + **live verification against a
real TH-D75 (fw 1.03, region J) on 2026-11-01**: every command in the
reference table below was executed read-only and answered as documented.
Confidence: high (wire-verified) unless noted.

## Physical layer

| Parameter | Value |
|---|---|
| Transport | USB CDC virtual COM (menu 980 = `COM + AF/IF Output`) or Bluetooth SPP (menu 930 = On) |
| Baud | 115200 |
| Framing | 8N1, no flow control |
| Lines | DTR asserted, RTS asserted |
| Encoding | ISO-8859-1 (ASCII transparent) |
| Frame terminator | CR (`0x0D`), both directions |
| Inter-command gap | ≥ 5 ms |
| Response timeout | 3000 ms |

### Quirk: batched replies (live-verified, critical)

The virtual COM board only processes its RX queue **when another byte
arrives**. A lone request sits unanswered until either the next request or
an internal ~3 s timer fires; when woken, the radio first flushes all
queued replies (FIFO), then answers the new frame. Practical consequence:
after sending a request, poke the port with a single bare `\r` (≈80 ms
later) — the reply (and a trailing `?` answering the poke) arrives
immediately. The `?` frames answering raw/empty handshake frames also
arrive batched and late, so a lone `?` must never be attributed to a
specific pending command.
| RX buffer flush | 4096 B read buffer, 2048 B write buffer |

## Frame format

Request: `CMD params\r` — params (when present) begin with one space.
Response: `CMD payload\r` — 2-letter command, one separator char, payload
(without the separator). `?` alone = command rejected.

The original parser (`a/o.cs`): command = first 2 chars, payload =
`substring(3)` of the frame.

## Connect handshake

After opening the port (`a/u.cs r()`), the original sends raw frames with
no response expectation:

```
"\r"          # empty frame (reset)
"\r"          # empty frame
"\x03\r"      # ETX - cancel any half-entered command
"\rTC 1\r"    # enter transceiver-control mode
"\r"          # terminating empty frame
```
(300 ms sleep after the first two frames in the original.)

Then (`frmMainViewModel` connect flow):

1. `ID` — must answer with model string containing `TH-D75`
2. `GW` — **must be 0**; ARFC refuses to connect while the DV gateway is active
3. full state sync (below)

## State sync on connect

`TY`, `PS`, `FV`, `AI`, `AI 1` (enable auto-information), `RX`, `FR`, `GP`,
`TN`, `DL`, `BC`, then per band 0/1: `FQ`, `MD`, `VM`, `RA`, `SF`, `SH`,
plus `AG`, `FS`, `FT`, `BY`, `SM 0/1`, `IO`.

Polling while connected: `PS`, `SM 0`, `SM 1`, `BY 0`, `BY 1` (1 s timer;
the original also polls `PS` every 60 s via a second timer).

## Command reference

Fields: `b` = band `0` (A) / `1` (B). "idx" = wire value is the enum index,
not the human value.

| Command | Set format | Read | Response payload | Meaning |
|---|---|---|---|---|
| `ID` | — | `ID` | model string | Radio identity |
| `FV` | — | `FV` | firmware string | Firmware version |
| `TY` | — | `TY` | `X,n` — first char: `J`/`E`/`K`/`M` region (live: `J,0`) |
| `PS` | — | `PS` | `0..5` | Power status |
| `GW` | — | `GW` | `0..2` | DV gateway mode (must be 0 to connect) |
| `AI` | `AI 0\|1` | `AI` | `0\|1` | Auto-information on/off; async frames follow changes |
| `RX` | — | `RX` | — | Receiver reset (sent once during init) |
| `FQ` | `FQ b,ffffffffff` | `FQ b` | `b,ffffffffff` | Frequency, **D10 in HERTZ** (live: `0144800000` = 144.800 MHz) |
| `UP` | `UP nnn` | — | — | Frequency +N steps, nnn = index into [1,2,5,10,50,100] = `000..005` |
| `DW` | `DW nnn` | — | — | Frequency −N steps, same encoding |
| `MD` | `MD b,m` | `MD b` | `b,m` | Mode, m = 0 FM, 1 NFM, 2 WFM, 3 AM, 4 LSB, 5 USB, 6 CW, 9 DV |
| `VM` | `VM b,v` | `VM b` | `b,v` | VFO mode v = 0 VFO, 1 Memory, 2 Call, 3 Weather |
| `SF` | `SF b,X` | `SF b` | `b,s` | Step: set `X` = step **INDEX in uppercase hex** (live: `SF 1,1` → 6.25 kHz, `SF 1,B` → 100 kHz); response `s` = decimal index `0..11`. Values: 5000,6250,8330,9000,10000,12500,15000,20000,25000,30000,50000,100000 |
| `FS` | `FS i` | `FS` | `i` | Fine step idx: 0→20 Hz, 1→100, 2→500, 3→1000 |
| `FT` | `FT 0\|1` | `FT` | `0\|1` | Fine tuning on/off |
| `AG` | `AG nnn` | `AG` | `nnn` | AF gain level, 3 digits (live: `006`); range not clamped |
| `IO` | `IO i` | `IO` | `i` | USB output: 0 AF, 1 IF, 2 Detect |
| `RA` | `RA b,0\|1` | `RA b` | `b,0\|1` | Attenuator |
| `BC` | `BC b,0\|1` | `BC` | `b,0\|1` | Beat cancel |
| `BY` | — | `BY b` | `b,0\|1` | Busy channel |
| `SM` | — | `SM b` | `b,l` | S-meter level `0..9` |
| `TN` | `TN t,b` | `TN` | `t,b` | TNC mode t: 0 off, 1?, 2 on; b = data band |
| `GP` | `GP g,p` | `GP` | `g,p` | GPS on/off, GPS→PC output on/off |
| `GW` | — | `GW` | `0..2` | DV gateway (read-only check) |
| `DL` | `DL 0\|1` | `DL` | `0\|1` | Single(1)/dual(0) band |
| `FR` | `FR 0\|1` | `FR` | `0\|1` | FM broadcast radio mode |
| `VX` | `VX 0\|1` | `VX` | `0\|1` | VOX on/off (menu 150); voice-activated transmit from the radio's own mic |
| `BT` | — | `BT` | `n` | Battery type (live: `BT 0`) |
| `BL` | — | `BL` | `n` | Battery level, live `0..3` scale (live: `BL 3` full) |
| `BS` | — | `BS` | `n` | Battery status (live: `BS 1`) |
| `RT` | — | `RT` | `yymmddhhmmss` | Real-time clock (live-confirmed, matches wall clock) |
| `PT` | `PT n` | `PT` | `0..3` | APRS beacon mode: 0 manual, 1 PTT, 2 auto, 3 SmartBeaconing |
| `LC` | — | `LC` | `n` | LCD/backlight level? (live: `LC 3`) |
| `MS`/`GM`/`AS` | — | — | — | Answer on D75 (live); meaning per TH-D74 docs (memory scan / GPS mode / TNC baud) |

## PTT (live-verified)

- `TX` **without parameters** keys the radio up on its current TX band;
  the radio answers with the echo `TX b` naming that band (live: `TX 1`,
  band B). This matches hamlib's thd74 backend (`TX`/`RX`, no argument).
- `RX` **without parameters** unkeys; confirmed by an `RX` echo.
- A parameterized `TX n` is invalid syntax — answered with `?`
  (the `b` in the echo is read-only).
- Out-of-region key-ups are refused: this JP unit (TY = `J`) transmits
  on 2 m and 70 cm only, so a bare `TX` while the TX band sits on e.g.
  446 MHz does not key up.

## Commands NOT supported by the TH-D75 firmware (live-verified)

- `CS`, `DC`, `BE`, `SQ`, `SR`, `GS`, `AE`, `MR`, `FO`, `DS`, `PC` —
  answered with `?` (part of the TH-D74 command set, absent here).

## USB audio

The USB composite device exposes CDC×2 + one UAC **capture-only**
endpoint (`/proc/asound/THD75/stream0`: mono S16_LE 48 kHz, endpoint
0x83 IN). There is **no playback endpoint**: PC→radio audio injection
over USB is impossible; the capture stream carries the AF/IF/Detect
signal selected by `IO`.

## Async (AI) frames

With `AI 1`, the radio pushes the same `CMD payload` frames whenever state
changes (FQ/MD/BY/SM/…). The client updates its mirrored state from them;
unmatched frames are ignored.

## SET-command semantics (live-verified)

- SET frames are answered either by a **single-char frame** — `N` when
  the radio refuses (e.g. FQ/UP/SF while the band is in Memory mode,
  `VM != 0`), `?` for raw/wake frames — or, when applied, by a burst of
  AI-style frames confirming the new state (e.g. `VM 1,1` triggers
  `MD`/`FQ`/`SF`/`VM` updates). The original client resolves the oldest
  waiter on ANY single-char frame; mirror that instead of waiting for a
  command echo.
- An applied `FQ` set is **absolute**: targets on the step grid are applied
  exactly (live: 446.100/446.200/446.050 MHz applied as sent); off-grid
  targets snap DOWN to the grid (446.123456 with a 5 kHz step → 446.120000).
- An `SF` set carries the step index in hex; an earlier note claiming
  Hz-as-hex (and a "silently refused per mode" 8330 case) was wrong —
  that wire format is simply ignored by the radio.
- VFO tuning (FQ/UP/DW/SF sets) only applies in VFO mode; switch with
  `VM b,0|1` first. Switching VFO→Memory triggers an AI burst restoring the
  channel's FQ/MD/SF/VM state (live: recall of 446.093750/CW/6250).
- In single-band mode (`DL 1`, set/echo live-verified) SETs targeting the
  inactive band are refused with `N` — e.g. `VM 0,n` while only band B is
  active. `DL 0` re-enables both bands.

## Error handling

- `?` frame — answer to an invalid/raw/wake frame; never attributable to
  a specific pending request. Resolve-and-continue like the original.
- `N` frame — the radio refused the preceding SET (mode conflict).
- ReadTimeout is 1000 ms at the SerialPort level; logical wait is 3000 ms.
- Original surfaces "Cannot connect" when the port is a KISS TNC
  (radio in KISS mode), absent, or occupied.

## Obfuscation notes (for future digging)

- Assembly: .NET Framework 4.8 WPF (Livet MVVM), x86, Dotfuscator
  community control-flow + string encryption.
- String decryptor: `a.j.c(string, int)` — per-char XOR with an
  auto-incrementing int32 key, bytes swapped after XOR; key =
  `341633829 + arg + 190`. Keys are materialized as `int a_ = N;` right
  before each call site.
- Class map: `a/v.cs` serial wrapper (class `v`), `a/p.cs` transport/queue
  (class `p`), `a/u.cs` command layer (class `u`), `a/t.cs` response
  parsers (class `t`), `a/o.cs` frame object, `a/r.cs` serial interface,
  `ARFC_D75/ConnectState.cs` mirrored state.
- This software does **not** program the memory channel bank — that is
  MCP-D75, a separate product. ARFC-D75 only remotely controls RX
  (frequency/mode/steps/GPS/TNC/IF-output) and stores local PC-side
  frequency lists.
