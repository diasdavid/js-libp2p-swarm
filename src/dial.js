'use strict'

const Connection = require('interface-connection').Connection
const debug = require('debug')
const log = debug('libp2p:swarm:dial')
log.err = debug('libp2p:swarm:error:dial')

const Circuit = require('libp2p-circuit')

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
      let tKeys = swarm.availableTransports(pi)

      if (tKeys.length === 0) {
        return cb(new Error('No available transport to dial to'))
      }

      tKeys = tKeys.filter((t) => t !== Circuit.tag) // remove Circuits
      nextTransport(tKeys.shift())

      function nextTransport (key) {
        if (!key) {
          return _tryCircuit((err, circuit) => {
            if (err) {
              return cb(new Error('Could not dial in any of the transports'))
            }

            cb(null, circuit)
          })
        }

        log(`dialing transport ${key}`)
        swarm.transport.dial(key, pi, (err, conn) => {
          if (err) {
            return nextTransport(tKeys.shift())
          }

          cb(null, conn)
        })
      }
    }

    function _tryCircuit (cb) {
      swarm.transport.dial(Circuit.tag, pi, (err, conn) => {
        if (err) {
          return cb(err)
        }

        cb(null, conn)
      })
    }
  }
}
