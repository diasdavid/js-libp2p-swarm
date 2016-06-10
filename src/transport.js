'use strict'

const contains = require('lodash.contains')
const Duplexify = require('duplexify')
const debug = require('debug')

const connHandler = require('./default-handler')

const log = debug('libp2p:swarm:transport')

module.exports = function (swarm) {
  return {
    add (key, transport, options, callback) {
      if (typeof options === 'function') {
        callback = options
        options = {}
      }
      if (!callback) { callback = noop }

      if (swarm.transports[key]) {
        throw new Error('There is already a transport with this key')
      }

      log('adding %s', key)
      swarm.transports[key] = transport
      callback()
    },

    dial (key, multiaddrs, callback) {
      const t = swarm.transports[key]

      if (!Array.isArray(multiaddrs)) {
        multiaddrs = [multiaddrs]
      }

      // a) filter the multiaddrs that are actually valid for this transport (use a func from the transport itself) (maybe even make the transport do that)
      multiaddrs = dialables(t, multiaddrs)

      log('dialing to %s', multiaddrs.map((m) => m.toString()))
      // b) if multiaddrs.length = 1, return the conn from the
      // transport, otherwise, create a passthrough
      if (multiaddrs.length === 1) {
        const conn = t.dial(multiaddrs.shift(), {
          ready: () => {
            const cb = callback
            callback = noop // this is done to avoid connection drops as connect errors
            cb(null, conn)
          }
        })
        conn.once('error', () => {
          callback(new Error('failed to connect to every multiaddr'))
        })
        return conn
      }

      // c) multiaddrs should already be a filtered list
      // specific for the transport we are using
      const pt = new Duplexify()

      next(multiaddrs.shift())
      return pt
      function next (multiaddr) {
        const conn = t.dial(multiaddr, {ready: () => {
          pt.setReadable(conn)
          pt.setWritable(conn)
          pt.getObservedAddrs = conn.getObservedAddrs.bind(conn)
          const cb = callback
          callback = noop // this is done to avoid connection drops as connect errors
          cb(null, pt)
        }})

        conn.once('error', () => {
          if (multiaddrs.length === 0) {
            return callback(new Error('failed to connect to every multiaddr'))
          }
          next(multiaddrs.shift())
        })
      }
    },

    listen (key, options, handler, callback) {
      // if no callback is passed, we pass conns to connHandler
      if (!handler) {
        handler = connHandler.bind(null, swarm.protocols)
      }

      const multiaddrs = dialables(swarm.transports[key], swarm._peerInfo.multiaddrs)

      log('listening to %s', multiaddrs.map((m) => m.toString()))
      swarm.transports[key].createListener(multiaddrs, handler, (err, maUpdate) => {
        if (err) {
          return callback(err)
        }
        if (maUpdate) {
          // because we can listen on port 0...
          swarm._peerInfo.multiaddr.replace(multiaddrs, maUpdate)
        }

        callback()
      })
    },

    close (key, callback) {
      const transport = swarm.transports[key]

      if (!transport) {
        return callback(new Error(`Trying to close non existing transport: ${key}`))
      }

      log('closing transport: %s', key)
      transport.close(callback)
    }
  }
}

// transform given multiaddrs to a list of dialable addresses
// for the given transport `tp`.
function dialables (tp, multiaddrs) {
  return tp.filter(multiaddrs.map((addr) => {
    // webrtc-star needs the /ipfs/QmHash
    if (addr.toString().indexOf('webrtc-star') > 0) {
      return addr
    }

    // ipfs multiaddrs are not dialable so we drop them here
    if (contains(addr.protoNames(), 'ipfs')) {
      return addr.decapsulate('ipfs')
    }

    return addr
  }))
}

function noop () {}
