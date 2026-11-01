'use strict';
/* Browser copy of protocol constants (see src/protocol/commands.js). */
const MODE = ['FM', 'DV', 'AM', 'LSB', 'USB', 'CW', 'NFM', '', 'WFM', 'CW-R'];
const STEPS_HZ = [5000, 6250, 8330, 9000, 10000, 12500, 15000, 20000, 25000, 30000, 50000, 100000];
const FINE_STEPS_HZ = [20, 100, 500, 1000];
const TUNE_STEPS = [1, 2, 5, 10, 50, 100];
