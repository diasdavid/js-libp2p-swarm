'use strict'

const ConnectionFSM = require('../connection')
const Connection = require('interface-connection').Connection
const once = require('once')
const debug = require('debug')
const log = debug('libp2p:switch:dial')
log.error = debug('libp2p:switch:dial:error')

const noop = () => {}

/**
 * A convenience array wrapper for controlling
 * a per peer queue
 *
 * @returns {Queue}
 */
function Queue () {
  let queue = []
  let isRunning = false

  return {
    push: function (item) {
      queue.push(item)
    },
    shift: function () {
      return queue.shift()
    },
    isRunning: function () {
      return isRunning
    },
    size: function () {
      return queue.length
    },
    start: function () {
      isRunning = true
    },
    stop: function () {
      isRunning = false
    }
  }
}

class DialerQueue {
  /**
   * @constructor
   * @param {Switch} _switch
   */
  constructor (_switch) {
    this._queue = {}
    this.switch = _switch
  }

  /**
   * Adds the dial to the queue and ensures the queue is running
   *
   * @param {object} queueItem
   * @param {PeerInfo} queueItem.peerInfo
   * @param {string} queueItem.protocol
   * @param {boolean} queueItem.useFSM
   * @param {function(Error, Connection)} queueItem.callback
   */
  add ({ peerInfo, protocol, useFSM, callback }) {
    const id = peerInfo.id.toB58String()
    const proxyConnection = new Connection()
    proxyConnection.setPeerInfo(peerInfo)

    callback = once(callback || noop)

    let queue = this._queue[id] = this._queue[id] || new Queue()
    queue.push({ protocol, proxyConnection, useFSM, callback })

    if (!queue.isRunning()) {
      queue.start()
      this.run(peerInfo)
    }
  }

  /**
   * Attempts to find a muxed connection for the given peer. If one
   * isn't found, a new one will be created.
   *
   * Returns an array containing two items. The ConnectionFSM and wether
   * or not the ConnectionFSM was just created. The latter can be used
   * to determine dialing needs.
   *
   * @private
   * @param {PeerInfo} peerInfo
   * @returns {[ConnectionFSM, Boolean]}
   */
  getOrCreateConnection (peerInfo) {
    const id = peerInfo.id.toB58String()
    let connectionFSM = this.switch.connection.getOne(id)
    let didCreate = false

    if (!connectionFSM) {
      connectionFSM = new ConnectionFSM({
        _switch: this.switch,
        peerInfo,
        muxer: null,
        conn: null
      })

      this.switch.connection.add(connectionFSM)

      // Add control events and start the dialer
      connectionFSM.once('connected', () => connectionFSM.protect())
      connectionFSM.once('private', () => connectionFSM.encrypt())
      connectionFSM.once('encrypted', () => connectionFSM.upgrade())

      didCreate = true
    }

    return [connectionFSM, didCreate]
  }

  /**
   * Executes the next dial in the queue for the given peer
   * @private
   * @param {PeerInfo} peerInfo
   * @returns {void}
   */
  run (peerInfo) {
    const id = peerInfo.id.toB58String()

    // If we have no items in the queue, exit
    if (this._queue[id].size() < 1) {
      return this._queue[id].stop()
    }

    const next = once(() => {
      this.run(peerInfo)
    })

    let queuedDial = this._queue[id].shift()
    let connectionFSM
    let isNew
    [connectionFSM, isNew] = this.getOrCreateConnection(peerInfo)

    // If we can handshake protocols, get a new stream and call run again
    if (DialerQueue.canShake(connectionFSM)) {
      queuedDial.connection = connectionFSM
      DialerQueue.getStreamForProtocol(queuedDial)
      this.run(peerInfo)
      return
    }

    // If we error, error the queued dial
    // In the future, it may be desired to error the other queued dials,
    // depending on the error.
    connectionFSM.once('error', (err) => {
      queuedDial.callback(err)
    })

    connectionFSM.once('close', () => {
      next()
    })

    // If we're not muxed yet, add listeners
    connectionFSM.once('muxed', () => {
      queuedDial.connection = connectionFSM
      DialerQueue.getStreamForProtocol(queuedDial)
      next()
    })

    connectionFSM.once('unmuxed', () => {
      queuedDial.connection = connectionFSM
      DialerQueue.getStreamForProtocol(queuedDial)
      next()
    })

    if (queuedDial.useFSM) {
      queuedDial.callback(null, connectionFSM)
    }

    // If we have a new connection, start dialing
    if (isNew) {
      connectionFSM.dial()
    }
  }

  /**
   * Checks to see if the provided `connection` is capable of
   * performing a handshake with an application level protocol,
   * such as: /echo/1.0.0, /ipfs/kad/1.0.0, etc.
   *
   * @private
   * @static
   * @param {ConnectionFSM} connection
   * @returns {Boolean}
   */
  static canShake (connection) {
    return connection && (connection.getState() === 'MUXED' || connection.getState() === 'CONNECTED')
  }

  /**
   * Attempts to create a new connection or stream (when muxed),
   * via negotiation of the given `protocol`. If no `protocol` is
   * provided, no action will be taken and `callback` will be called
   * immediately with no error or values.
   *
   * @private
   * @static
   * @param {object} options
   * @param {string} options.protocol
   * @param {Connection} options.proxyConnection
   * @param {ConnectionFSM} options.connection
   * @param {function(Error, Connection)} options.callback
   * @returns {void}
   */
  static getStreamForProtocol ({ protocol, proxyConnection, connection, callback }) {
    if (!protocol) {
      return callback()
    }
    connection.shake(protocol, (err, conn) => {
      if (!conn) {
        return callback(err)
      }

      proxyConnection.setPeerInfo(connection.theirPeerInfo)
      proxyConnection.setInnerConn(conn)
      callback(null, proxyConnection)
    })
  }
}

module.exports = DialerQueue
