'use strict'

const Connection = require('interface-connection').Connection
const debug = require('debug')
const log = debug('libp2p:swarm:dial')

module.exports = function dial (swarm) {
  return (pi, protocol, callback) => {
    if (typeof protocol === 'function') {
      callback = protocol
      protocol = null
    }

    callback = callback || function noop () {}

    const proxyConn = new Connection()
    const connHandler = swarm.connHandler(pi, protocol, proxyConn)

    const b58Id = pi.id.toB58String()
    log('dialing %s', b58Id)

    if (!swarm.muxedConns[b58Id]) {
      if (!swarm.conns[b58Id]) {
        attemptDial(pi, (err, conn) => {
          if (err) {
            return callback(err)
          }
          connHandler.handleNew(conn, callback)
        })
      } else {
        const conn = swarm.conns[b58Id]
        swarm.conns[b58Id] = undefined
        connHandler.handleWarmedUp(conn, callback)
      }
    } else {
      if (!protocol) {
        return callback()
      }
      connHandler.gotMuxer(swarm.muxedConns[b58Id].muxer, callback)
    }

    return proxyConn

    function attemptDial (pi, cb) {
      const tKeys = swarm.availableTransports(pi)

      if (tKeys.length === 0) {
        return cb(new Error('No available transport to dial to'))
      }

      nextTransport(tKeys.shift())

      function nextTransport (key) {
        swarm.transport.dial(key, pi, (err, conn) => {
          if (err) {
            if (tKeys.length === 0) {
              return cb(new Error('Could not dial in any of the transports'))
            }
            return nextTransport(tKeys.shift())
          }

          cb(null, conn)
        })
      }
    }
  }
}
