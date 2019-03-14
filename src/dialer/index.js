'use strict'

const DialerQueue = require('./queue')

module.exports = function (_switch, returnFSM) {
  const dialerQueue = new DialerQueue(_switch, returnFSM)

  /**
   * Dial
   * @param {PeerInfo} peerInfo
   * @param {string} protocol
   * @param {function(Error, Connection)} callback
   */
  return function dial (peerInfo, protocol, callback) {
    if (typeof protocol === 'function') {
      callback = protocol
      protocol = null
    }

    // Add it to the queue, it will automatically get executed
    dialerQueue.add(peerInfo, protocol, callback)
  }
}
