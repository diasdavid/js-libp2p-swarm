'use strict'

const DialerQueue = require('./queue')
const getPeerInfo = require('../get-peer-info')

module.exports = function (_switch) {
  const dialerQueue = new DialerQueue(_switch)

  /**
   * @param {object} options
   * @param {PeerInfo} options.peerInfo
   * @param {string} options.protocol
   * @param {boolean} options.useFSM If `callback` should return a ConnectionFSM
   * @param {function(Error, Connection)} options.callback
   * @returns {void}
   */
  function _dial ({ peerInfo, protocol, useFSM, callback }) {
    if (typeof protocol === 'function') {
      callback = protocol
      protocol = null
    }

    try {
      peerInfo = getPeerInfo(peerInfo, _switch._peerBook)
    } catch (err) {
      return callback(err)
    }

    // Add it to the queue, it will automatically get executed
    dialerQueue.add({ peerInfo, protocol, useFSM, callback })
  }

  /**
   * Adds the dial request to the queue for the given `peerInfo`
   * @param {PeerInfo} peerInfo
   * @param {string} protocol
   * @param {function(Error, Connection)} callback
   */
  function dial (peerInfo, protocol, callback) {
    _dial({ peerInfo, protocol, useFSM: false, callback })
  }

  /**
   * Behaves like dial, except it calls back with a ConnectionFSM
   *
   * @param {PeerInfo} peerInfo
   * @param {string} protocol
   * @param {function(Error, ConnectionFSM)} callback
   */
  function dialFSM (peerInfo, protocol, callback) {
    _dial({ peerInfo, protocol, useFSM: true, callback })
  }

  return {
    dial,
    dialFSM
  }
}
