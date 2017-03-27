'use strict'

const multistream = require('multistream-select')
const protocolMuxer = require('./protocol-muxer')

const debug = require('debug')
const log = debug('libp2p:swarm:handle')

module.exports = function process (swarm) {
  return (pi, protocol, proxyConn) => {
    const b58Id = pi.id.toB58String()

    function cryptoDial (conn, cb) {
      const ms = new multistream.Dialer()
      ms.handle(conn, (err) => {
        if (err) {
          return cb(err)
        }

        const id = swarm._peerInfo.id
        log('selecting crypto: %s', swarm.crypto.tag)
        ms.select(swarm.crypto.tag, (err, conn) => {
          if (err) {
            return cb(err)
          }

          const wrapped = swarm.crypto.encrypt(id, id.privKey, conn)
          cb(null, wrapped)
        })
      })
    }

    function gotWarmedUpConn (conn, cb) {
      conn.setPeerInfo(pi)
      attemptMuxerUpgrade(conn, (err, muxer) => {
        if (!protocol) {
          if (err) {
            swarm.conns[b58Id] = conn
          }
          return cb()
        }

        if (err) {
          // couldn't upgrade to Muxer, it is ok
          protocolHandshake(conn, protocol, cb)
        } else {
          gotMuxer(muxer, cb)
        }
      })
    }

    function attemptMuxerUpgrade (conn, cb) {
      const muxers = Object.keys(swarm.muxers)
      if (muxers.length === 0) {
        return cb(new Error('no muxers available'))
      }

      // 1. try to handshake in one of the muxers available
      // 2. if succeeds
      //  - add the muxedConn to the list of muxedConns
      //  - add incomming new streams to connHandler

      const ms = new multistream.Dialer()
      ms.handle(conn, (err) => {
        if (err) {
          return cb(new Error('multistream not supported'))
        }

        nextMuxer(muxers.shift())
      })

      function nextMuxer (key) {
        log('selecting %s', key)
        ms.select(key, (err, conn) => {
          if (err) {
            if (muxers.length === 0) {
              cb(new Error('could not upgrade to stream muxing'))
            } else {
              nextMuxer(muxers.shift())
            }
            return
          }

          const muxedConn = swarm.muxers[key].dialer(conn)
          swarm.muxedConns[b58Id] = {}
          swarm.muxedConns[b58Id].muxer = muxedConn
          // should not be needed anymore - swarm.muxedConns[b58Id].conn = conn

          swarm.emit('peer-mux-established', pi)

          muxedConn.once('close', () => {
            const b58Str = pi.id.toB58String()
            delete swarm.muxedConns[b58Str]
            pi.disconnect()
            swarm._peerBook.get(b58Str).disconnect()
            swarm.emit('peer-mux-closed', pi)
          })

          // For incoming streams, in case identify is on
          muxedConn.on('stream', (conn) => {
            protocolMuxer(swarm.protocols, conn)
          })

          cb(null, muxedConn)
        })
      }
    }

    function openConnInMuxedConn (muxer, cb) {
      cb(muxer.newStream())
    }

    function protocolHandshake (conn, protocol, cb) {
      const ms = new multistream.Dialer()
      ms.handle(conn, (err) => {
        if (err) {
          return cb(err)
        }
        ms.select(protocol, (err, conn) => {
          if (err) {
            return cb(err)
          }
          proxyConn.setInnerConn(conn)
          cb(null, proxyConn)
        })
      })
    }

    function handleNew (conn, cb) {
      cryptoDial(conn, (err, conn) => {
        if (err) {
          log(err)
          return cb(err)
        }
        gotWarmedUpConn(conn, cb)
      })
    }

    function handleWarmedUp (conn, cb) {
      gotWarmedUpConn(conn, cb)
    }

    function gotMuxer (muxer, cb) {
      if (swarm.identify) {
        // TODO: Consider:
        // 1. overload getPeerInfo
        // 2. exec identify (through getPeerInfo)
        // 3. update the peerInfo that is already stored in the conn
      }

      openConnInMuxedConn(muxer, (conn) => {
        protocolHandshake(conn, protocol, cb)
      })
    }

    return {
      handleNew: handleNew,
      handleWarmedUp: handleWarmedUp,
      gotMuxer: gotMuxer
    }
  }
}
