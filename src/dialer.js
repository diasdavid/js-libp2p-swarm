'use strict'

const Connection = require('interface-connection').Connection
const queue = require('async/queue')
const map = require('async/map')
const timeout = require('async/timeout')
const pull = require('pull-stream')
const debug = require('debug')

const log = debug('libp2p:swarm:dialer')

/**
 * Track dials per peer and limited them.
 */
class Dialer {
  /**
   * Create a new dialer.
   *
   * @param {number} perPeerLimit
   * @param {number} dialTimeout
   */
  constructor (perPeerLimit, dialTimeout) {
    log('create: %s peer limit, %s dial timeout', perPeerLimit, dialTimeout)
    this.perPeerLimit = perPeerLimit
    this.dialTimeout = dialTimeout
    this.queues = new Map()
  }

  /**
   * Dial a list of multiaddrs on the given transport.
   *
   * @param {PeerId} peer
   * @param {SwarmTransport} transport
   * @param {Array<Multiaddr>} addrs
   * @param {function(Error, Connection)} callback
   * @returns {void}
   */
  dialMany (peer, transport, addrs, callback) {
    log('dialMany:start')
    // we use a token to track if we want to cancel following dials
    const token = {cancel: false}
    map(addrs, (m, cb) => {
      this.dialSingle(peer, transport, m, token, cb)
    }, (err, results) => {
      if (err) {
        return callback(err)
      }

      const success = results.filter((res) => res.conn)
      if (success.length > 0) {
        log('dialMany:success')
        return callback(null, success[0].conn)
      }

      log('dialMany:error')
      const error = new Error('Failed to dial any provided address')
      error.errors = results
        .filter((res) => res.error)
        .map((res) => res.error)
      return callback(error)
    })
  }

  /**
   * Dial a single multiaddr on the given transport.
   *
   * @param {PeerId} peer
   * @param {SwarmTransport} transport
   * @param {Multiaddr} addr
   * @param {CancelToken} token
   * @param {function(Error, Connection)} callback
   * @returns {void}
   */
  dialSingle (peer, transport, addr, token, callback) {
    const ps = peer.toB58String()
    log('dialSingle: %s:%s', ps, addr.toString())
    let q
    if (this.queues.has(ps)) {
      q = this.queues.get(ps)
    } else {
      q = new DialQueue(this.perPeerLimit, this.dialTimeout)
      this.queues.set(ps, q)
    }

    q.push(transport, addr, token, callback)
  }
}

/**
 * Queue up the amount of dials to a given peer.
 */
class DialQueue {
  /**
   * Create a new dial queue.
   *
   * @param {number} limit
   * @param {number} dialTimeout
   */
  constructor (limit, dialTimeout) {
    this.dialTimeout = dialTimeout

    this.queue = queue((task, cb) => {
      this._doWork(task.transport, task.addr, task.token, cb)
    }, limit)
  }

  /**
   * The actual work done by the queue.
   *
   * @param {SwarmTransport} transport
   * @param {Multiaddr} addr
   * @param {CancelToken} token
   * @param {function(Error, Connection)} callback
   * @returns {void}
   * @private
   */
  _doWork (transport, addr, token, callback) {
    log('dialQueue:work')
    this._dialWithTimeout(
      transport,
      addr,
      (err, conn) => {
        if (err) {
          log('dialQueue:work:error')
          return callback(null, {error: err})
        }

        if (token.cancel) {
          log('dialQueue:work:cancel')
          // clean up already done dials
          pull(pull.empty(), conn)
          // TODO: proper cleanup once the connection interface supports it
          // return conn.close(() => callback(new Error('Manual cancel'))
          return callback(null, {cancel: true})
        }

        // one is enough
        token.cancel = true

        log('dialQueue:work:success')

        const proxyConn = new Connection()
        proxyConn.setInnerConn(conn)
        callback(null, {conn})
      }
    )
  }

  /**
   * Dial the given transport, timing out with the set timeout.
   *
   * @param {SwarmTransport} transport
   * @param {Multiaddr} addr
   * @param {function(Error, Connection)} callback
   * @returns {void}
   *
   * @private
   */
  _dialWithTimeout (transport, addr, callback) {
    timeout((cb) => {
      const conn = transport.dial(addr, (err) => {
        if (err) {
          return cb(err)
        }

        cb(null, conn)
      })
    }, this.dialTimeout)(callback)
  }

  /**
   * Add new work to the queue.
   *
   * @param {SwarmTransport} transport
   * @param {Multiaddr} addr
   * @param {CancelToken} token
   * @param {function(Error, Connection)} callback
   * @returns {void}
   */
  push (transport, addr, token, callback) {
    this.queue.push({transport, addr, token}, callback)
  }
}

module.exports = Dialer
