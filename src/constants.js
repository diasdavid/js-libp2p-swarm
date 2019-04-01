'use strict'

module.exports = {
  BLACK_LIST_TTL: 5 * 60 * 1e3, // How long before an errored peer can be dialed again
  DIAL_TIMEOUT: 30e3, // How long in ms a dial attempt is allowed to take
  MAX_COLD_CALLS: 50, // How many dials w/o protocols that can be queued
  MAX_PARALLEL_DIALS: 100 // Maximum allowed concurrent dials
}
