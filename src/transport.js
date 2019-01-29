'use strict'

/* eslint no-warning-comments: off */

const parallel = require('async/parallel')
const once = require('once')
const debug = require('debug')
const log = debug('libp2p:switch:transport')

const LimitDialer = require('./limit-dialer')

// number of concurrent outbound dials to make per peer, same as go-libp2p-swtch
const defaultPerPeerRateLimit = 8

// the amount of time a single dial has to succeed
// TODO this should be exposed as a option
const dialTimeout = 30 * 1000

/**
 * Manages the transports for the switch. This simplifies dialing and listening across
 * multiple transports.
 */
class TransportManager {
  constructor (_switch) {
    this.switch = _switch
    this.dialer = new LimitDialer(defaultPerPeerRateLimit, dialTimeout)

    // transports --
    // Map <<key>, {
    //     transport: <transport>,
    //     listeners: [<Listener>, <Listener>, ...]
    // }>
    // e.g:
    // Map { "tcp" => {
    //     transport: <tcp>,
    //     listeners: [<Listener>, <Listener>, ...]
    //   }
    // }
    this._transports = new Map()
  }

  /**
   * Adds a `Transport` to the list of transports on the switch, and assigns it to the given key
   *
   * @param {String} key
   * @param {Transport} transport
   * @returns {void}
   */
  add (key, transport) {
    log('adding %s', key)
    if (this._transports.get(key)) {
      throw new Error('There is already a transport with this key')
    }

    this._transports.set(key, {
      transport: transport,
      listeners: []
    })
  }

  /**
   * Returns the `Transport` for the given key
   *
   * @param {String} key
   * @returns {Transport}
   */
  get (key) {
    if (this._transports.has(key)) {
      return this._transports.get(key).transport
    } else {
      return null
    }
  }

  /**
   * Returns a map of all `Transports` on the form { key: transport }; e.g { tcp: <tcp> }
   *
   * @returns {Map<String,Transport>}
   */
  getAll () {
    return new Map([...this._transports].map(([k, v]) => [k, v.transport]))
  }

  /**
   * Returns an array of listeners for the `Transport` with the given key
   *
   * @param {String} key
   * @returns {Array<listener>}
   */
  getListeners (key) {
    if (!this._transports.has(key)) {
      return []
    } else {
      return this._transports.get(key).listeners
    }
  }

  /**
   * Closes connections for the given transport key
   * and removes it from the switch.
   *
   * @param {String} key
   * @param {function(Error)} callback
   * @returns {void}
   */
  remove (key, callback) {
    callback = callback || function () {}

    if (!this._transports.get(key)) {
      return callback()
    }

    this.close(key, (err) => {
      this._transports.delete(key)
      callback(err)
    })
  }

  /**
   * Calls `remove` on each transport the switch has
   *
   * @param {function(Error)} callback
   * @returns {void}
   */
  removeAll (callback) {
    const tasks = [...this._transports.keys()].map((key) => {
      return (cb) => {
        this.remove(key, cb)
      }
    })

    parallel(tasks, callback)
  }

  /**
   * For a given transport `key`, dial to all that transport multiaddrs
   *
   * @param {String} key Key of the `Transport` to dial
   * @param {PeerInfo} peerInfo
   * @param {function(Error, Connection)} callback
   * @returns {void}
   */
  dial (key, peerInfo, callback) {
    const transport = this._transports.get(key).transport
    let multiaddrs = peerInfo.multiaddrs.toArray()

    if (!Array.isArray(multiaddrs)) {
      multiaddrs = [multiaddrs]
    }

    // filter the multiaddrs that are actually valid for this transport
    multiaddrs = TransportManager.dialables(transport, multiaddrs, this.switch._peerInfo)
    log('dialing %s', key, multiaddrs.map((m) => m.toString()))

    // dial each of the multiaddrs with the given transport
    this.dialer.dialMany(peerInfo.id, transport, multiaddrs, (err, success) => {
      if (err) {
        return callback(err)
      }

      peerInfo.connect(success.multiaddr)
      this.switch._peerBook.put(peerInfo)
      callback(null, success.conn)
    })
  }

  /**
   * For a given Transport `key`, listen on all multiaddrs in the switch's `_peerInfo`.
   * If a `handler` is not provided, the Switch's `protocolMuxer` will be used.
   *
   * @param {String} key
   * @param {*} _options Currently ignored
   * @param {function(Connection)} handler
   * @param {function(Error)} callback
   * @returns {void}
   */
  listen (key, _options, handler, callback) {
    handler = this.switch._connectionHandler(key, handler)

    const transport = this._transports.get(key).transport
    const multiaddrs = TransportManager.dialables(
      transport,
      this.switch._peerInfo.multiaddrs.distinct()
    )

    let freshMultiaddrs = []

    const createListeners = multiaddrs.map((ma) => {
      return (cb) => {
        const done = once(cb)
        const listener = transport.createListener(handler)
        listener.once('error', done)

        listener.listen(ma, (err) => {
          if (err) {
            return done(err)
          }
          listener.removeListener('error', done)
          listener.getAddrs((err, addrs) => {
            if (err) {
              return done(err)
            }
            freshMultiaddrs = freshMultiaddrs.concat(addrs)
            this._transports.get(key).listeners.push(listener)
            done()
          })
        })
      }
    })

    parallel(createListeners, (err) => {
      if (err) {
        return callback(err)
      }

      // cause we can listen on port 0 or 0.0.0.0
      this.switch._peerInfo.multiaddrs.replace(multiaddrs, freshMultiaddrs)
      callback()
    })
  }

  /**
   * Closes the transport with the given key, by closing all of its listeners
   *
   * @param {String} key
   * @param {function(Error)} callback
   * @returns {void}
   */
  close (key, callback) {
    const transport = this._transports.get(key)

    if (!transport) {
      return callback(new Error(`Trying to close non existing transport: ${key}`))
    }

    parallel(this._transports.get(key).listeners.map((listener) => {
      return (cb) => {
        listener.close(cb)
      }
    }), callback)
  }

  /**
   * For a given transport, return its multiaddrs that match the given multiaddrs
   *
   * @param {Transport} transport
   * @param {Array<Multiaddr>} multiaddrs
   * @param {PeerInfo} peerInfo Optional - a peer whose addresses should not be returned
   * @returns {Array<Multiaddr>}
   */
  static dialables (transport, multiaddrs, peerInfo) {
    // If we dont have a proper transport, return no multiaddrs
    if (!transport || !transport.filter) return []

    const transportAddrs = transport.filter(multiaddrs)
    if (!peerInfo) {
      return transportAddrs
    }

    return transportAddrs.filter((addr) => {
      // If our address is in the destination address, filter it out
      return !peerInfo.multiaddrs.toArray().find((pAddr) => {
        try {
          addr.decapsulate(pAddr)
        } catch (err) {
          return false
        }
        return true
      })
    })
  }
}

module.exports = TransportManager
