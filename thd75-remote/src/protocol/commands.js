'use strict';
/**
 * TH-D75 CAT protocol constants, recovered from ARFC-D75 1.0.8717.20672.
 *
 * Wire format (ISO-8859-1 / ASCII):
 *   request:  "CMD params\r"   (params begin with a single space when present)
 *   response: "CMD payload\r"  (2-letter command, 1 separator char, payload)
 *   error:    "?"
 * Serial: 115200 8N1, DTR+RTS asserted, no flow control.
 * Minimum gap between requests: 5 ms; response timeout: 3000 ms.
 */

const BAND = Object.freeze({ A: 0, B: 1 });

/** RX/TX mode, wire value = index. Names from english.lng [General]. */
const MODE = Object.freeze([
  'FM', 'NFM', 'WFM', 'AM', 'LSB', 'USB', 'CW', '', '', 'DV',
]);

/** Coarse step in Hz, wire value for SF (set: decimal value as HEX). */
const STEPS_HZ = Object.freeze([5000, 6250, 8330, 9000, 10000, 12500, 15000, 20000, 25000, 30000, 50000, 100000]);

/** Fine tuning step, wire value = index (0..3). */
const FINE_STEPS_HZ = Object.freeze([20, 100, 500, 1000]);

/** Tune increments for UP/DW, wire value = index (000..005). */
const TUNE_STEPS = Object.freeze([1, 2, 5, 10, 50, 100]);

/** USB output select (IO), wire value = index. */
const IO_MODE = Object.freeze({ AF: 0, IF: 1, DETECT: 2 });

/** VFO mode (VM), wire value = index. */
const VFO_MODE = Object.freeze(['VFO', 'Memory', 'Call', 'Weather']);

/** TNC/APRS PC output mode (TN first field). */
const TNC_MODE = Object.freeze({ OFF: 0, _: 1, ON: 2 });

/** Power status levels (PS), observed 0..5. */
const POWER_MAX = 5;

/** Regions decoded from TY responses. */
const REGIONS = Object.freeze({ J: 'Japan', E: 'Europe', K: 'Korea', M: 'Other' });

/** CTCSS tone list, Hz (tone select value = Hz as decimal string). */
const CTCSS_HZ = Object.freeze([
  670, 693, 719, 744, 770, 797, 825, 854, 885, 915, 948, 974, 1000, 1035,
  1072, 1109, 1148, 1188, 1230, 1273, 1318, 1365, 1413, 1462, 1514, 1567,
  1598, 1622, 1655, 1679, 1713, 1738, 1773, 1799, 1835, 1862, 1899, 1928,
  1966, 1995, 2035, 2065, 2107, 2181, 2291, 2336, 2418, 2503, 2541, 17500,
]);

/** Frame terminator. */
const CR = '\r';

/** Enters transceiver-control mode during the connect handshake. */
const ENTER_CONTROL_SEQUENCE = Object.freeze(['', '', '\x03', '\rTC 1', '\r']);

const MIN_COMMAND_GAP_MS = 5;
const RESPONSE_TIMEOUT_MS = 3000;

module.exports = {
  BAND,
  MODE,
  STEPS_HZ,
  FINE_STEPS_HZ,
  TUNE_STEPS,
  IO_MODE,
  VFO_MODE,
  TNC_MODE,
  POWER_MAX,
  REGIONS,
  CTCSS_HZ,
  CR,
  ENTER_CONTROL_SEQUENCE,
  MIN_COMMAND_GAP_MS,
  RESPONSE_TIMEOUT_MS,
};
