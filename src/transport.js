'use strict'

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

module.exports = function (swtch) {
  const dialer = new LimitDialer(defaultPerPeerRateLimit, dialTimeout)

  return {
    add (key, transport, options) {
      options = options || {}

      log('adding %s', key)
      if (swtch.transports[key]) {
        throw new Error('There is already a transport with this key')
      }

      swtch.transports[key] = transport
      if (!swtch.transports[key].listeners) {
        swtch.transports[key].listeners = []
      }
    },

    dial (key, pi, callback) {
      const t = swtch.transports[key]
      let multiaddrs = pi.multiaddrs.toArray()

      if (!Array.isArray(multiaddrs)) {
        multiaddrs = [multiaddrs]
      }
      // filter the multiaddrs that are actually valid for this transport (use a func from the transport itself) (maybe even make the transport do that)
      multiaddrs = dialables(t, multiaddrs)
      log('dialing %s', key, multiaddrs.map((m) => m.toString()))

      dialer.dialMany(pi.id, t, multiaddrs, (err, success) => {
        if (err) {
          return callback(err)
        }

        pi.connect(success.multiaddr)
        swtch._peerBook.put(pi)
        callback(null, success.conn)
      })
    },

    listen (key, options, handler, callback) {
      // if no handler is passed, we pass conns to protocolMuxer
      if (!handler) {
        handler = swtch.protocolMuxer(key)
      }

      const multiaddrs = dialables(swtch.transports[key], swtch._peerInfo.multiaddrs.distinct())

      const transport = swtch.transports[key]

      if (!transport.listeners) {
        transport.listeners = []
      }

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
              transport.listeners.push(listener)
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
        swtch._peerInfo.multiaddrs.replace(multiaddrs, freshMultiaddrs)
        callback()
      })
    },

    close (key, callback) {
      const transport = swtch.transports[key]

      if (!transport) {
        return callback(new Error(`Trying to close non existing transport: ${key}`))
      }

      parallel(transport.listeners.map((listener) => {
        return (cb) => {
          listener.close(cb)
        }
      }), callback)
    }
  }
}

function dialables (tp, multiaddrs) {
  return tp.filter(multiaddrs)
}
