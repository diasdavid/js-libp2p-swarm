'use strict'

const Connection = require('interface-connection').Connection
const ConnectionFSM = require('./connection')
const getPeerInfo = require('./get-peer-info')
const once = require('once')

const debug = require('debug')
const log = debug('libp2p:switch:dial')

function maybePerformHandshake ({ protocol, proxyConnection, connection, callback }) {
  if (protocol) {
    return connection.shake(protocol, (err, conn) => {
      if (!conn) {
        return callback(err)
      }

      proxyConnection.setPeerInfo(connection.theirPeerInfo)
      proxyConnection.setInnerConn(conn)
      callback(null, proxyConnection)
    })
  }

  callback()
}

/**
 * Returns a Dialer generator that when called, will immediately begin dialing
 * to the given `peer`.
 *
 * @param {Switch} _switch
 * @returns {function(PeerInfo, string, function(Error, Connection))}
 */
function dial (_switch) {
  /**
   * Creates a new dialer and immediately begins dialing to the given `peer`
   *
   * @param {PeerInfo} peer
   * @param {string} protocol
   * @param {function(Error, Connection)} callback
   * @returns {Connection}
   */
  return (peer, protocol, callback) => {
    if (typeof protocol === 'function') {
      callback = protocol
      protocol = null
    }

    callback = once(callback || function noop () {})

    const peerInfo = getPeerInfo(peer, _switch._peerBook)
    const b58Id = peerInfo.id.toB58String()

    log(`${_switch._peerInfo.id.toB58String().slice(0, 8)} dial request to ${b58Id.slice(0, 8)} with protocol ${protocol}`)

    let connection = _switch.muxedConns[b58Id] || _switch.conns[b58Id]

    if (!ConnectionFSM.isConnection(connection)) {
      connection = new ConnectionFSM({
        _switch,
        peerInfo,
        muxer: _switch.muxedConns[b58Id] || null
      })
    }

    const proxyConnection = new Connection()
    proxyConnection.setPeerInfo(peerInfo)

    connection.once('error', (err) => callback(err))
    connection.once('connected', () => connection.protect())
    connection.once('private', () => connection.encrypt())
    connection.once('encrypted', () => connection.upgrade())
    connection.once('muxed', () => {
      maybePerformHandshake({
        protocol,
        proxyConnection,
        connection,
        callback
      })
    })
    connection.once('unmuxed', () => {
      maybePerformHandshake({
        protocol,
        proxyConnection,
        connection,
        callback
      })
    })

    // If we have a connection, maybe perform the protocol handshake
    // TODO: The basic connection probably shouldnt be reused
    const state = connection.getState()
    if (state === 'CONNECTED' || state === 'MUXED') {
      maybePerformHandshake({
        protocol,
        proxyConnection,
        connection,
        callback
      })
    } else {
      connection.dial()
    }

    return proxyConnection
  }
}

module.exports = dial
