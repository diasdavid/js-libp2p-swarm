'use strict'

const debug = require('debug')

const connHandler = require('./default-handler')
const identify = require('./identify')

const log = debug('libp2p:swarm:connection')
log.error = debug('libp2p:swarm:connection:error')

module.exports = function connection (swarm) {
  return {
    addUpgrade () {},

    addStreamMuxer (muxer) {
      // for dialing
      swarm.muxers[muxer.multicodec] = muxer

      // for listening
      swarm.handle(muxer.multicodec, (conn) => {
        const muxedConn = muxer(conn, true)

        var peerIdForConn

        muxedConn.on('stream', (conn) => {
          function gotId () {
            if (peerIdForConn) {
              conn.peerId = peerIdForConn
              connHandler(swarm.protocols, conn)
            } else {
              setTimeout(gotId, 100)
            }
          }

          // If identify happened, when we have the Id of the conn
          if (swarm.identify) {
            return gotId()
          }

          connHandler(swarm.protocols, conn)
        })

        // in case identify is on
        muxedConn.on('stream', (conn) => {
          conn.peerId = peerIdForConn.id
          connHandler(swarm.protocols, conn)
        })
      })
    },

    reuse () {
      swarm.identify = true
      swarm.handle(identify.multicodec, identify.handler(swarm._peerInfo, swarm))
    }
  }
}
