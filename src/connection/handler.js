'use strict'

const FSM = require('fsm-event')
const debug = require('debug')
const multistream = require('multistream-select')

const observeConn = require('../observe-connection')
const BaseConnection = require('./base')

class IncomingConnectionFSM extends BaseConnection {
  constructor ({ connection, _switch, transportKey }) {
    super({
      _switch,
      logName: `libp2p:switch:inc_connection:${_switch._peerInfo.id.toB58String().slice(0, 8)}`
    })
    this.conn = connection
    this.theirPeerInfo = null
    this.ourPeerInfo = this.switch._peerInfo
    this.transportKey = transportKey
    this.protocolMuxer = this.switch.protocolMuxer(this.transportKey)

    this._state = FSM('DIALED', {
      DISCONNECTED: { },
      DIALED: { // Base connection to peer established
        privatize: 'PRIVATIZING',
        encrypt: 'ENCRYPTING'
      },
      PRIVATIZING: { // Protecting the base connection
        done: 'PRIVATIZED',
        disconnect: 'DISCONNECTING'
      },
      PRIVATIZED: { // Base connection is protected
        encrypt: 'ENCRYPTING'
      },
      ENCRYPTING: { // Encrypting the base connection
        done: 'ENCRYPTED',
        disconnect: 'DISCONNECTING'
      },
      ENCRYPTED: { // Upgrading could not happen, the connection is encrypted and waiting
        upgrade: 'UPGRADING',
        disconnect: 'DISCONNECTING'
      },
      UPGRADING: { // Attempting to upgrade the connection with muxers
        done: 'MUXED'
      },
      MUXED: {
        disconnect: 'DISCONNECTING'
      },
      DISCONNECTING: { // Shutting down the connection
        done: 'DISCONNECTED'
      }
    })

    this._state.on('PRIVATIZING', () => this._onPrivatizing())
    this._state.on('PRIVATIZED', () => this._onPrivatized())
    this._state.on('ENCRYPTING', () => this._onEncrypting())
    this._state.on('ENCRYPTED', () => {
      this.log(`successfully encrypted connection to ${this.theirB58Id || 'unknown peer'}`)
      this.emit('encrypted', this.conn)
    })
    this._state.on('UPGRADING', () => this._onUpgrading())
    this._state.on('MUXED', () => {
      this.log(`successfully muxed connection to ${this.theirB58Id || 'unknown peer'}`)
      this.emit('muxed', this.conn)
    })
    this._state.on('DISCONNECTING', () => {
      if (this.theirPeerInfo) {
        this.theirPeerInfo.disconnect()
      }
    })
  }

  /**
   * Gets the current state of the connection
   *
   * @returns {string} The current state of the connection
   */
  getState () {
    return this._state._state
  }

  // TODO: We need to handle N+1 crypto libraries
  _onEncrypting () {
    // If the connection is for a specific transport, observe it
    if (this.transportKey) {
      this.conn = observeConn(this.transportKey, null, this.conn, this.switch.observer)
    }

    this.log(`encrypting connection via ${this.switch.crypto.tag}`)

    const ms = new multistream.Listener()

    ms.addHandler(this.switch.crypto.tag, (protocol, _conn) => {
      const conn = observeConn(null, protocol, _conn, this.switch.observer)
      this.conn = this.switch.crypto.encrypt(this.ourPeerInfo.id, conn, undefined, (err) => {
        if (err) {
          this.emit('error', err)
          return this._state('disconnect')
        }
        this.conn.getPeerInfo((_, peerInfo) => {
          this.theirPeerInfo = peerInfo
          this._state('done')
        })
      })
    }, null)

    ms.handle(this.conn, (err) => {
      if (err) {
        this.emit('crypto handshaking failed', err)
      }
    })
  }

  _onPrivatized () {
    this.log(`successfully privatized incoming connection`)
    this.emit('private', this.conn)
  }

  _onUpgrading () {
    this.log('adding the protocol muxer to the connection')
    this.protocolMuxer(this.conn)
    this._state('done')
  }
}

function listener (_switch) {
  const log = debug(`libp2p:switch:listener`)

  /**
   * Takes a transport key and returns a connection handler function
   *
   * @param {string} transportKey The key of the transport to handle connections for
   * @param {function} handler A custom handler to use
   * @returns {function(Connection)} A connection handler function
   */
  return (transportKey, handler) => {
    /**
     * Takes a base connection and manages listening behavior
     *
     * @param {Connection} connection The connection to manage
     * @returns {void}
     */
    return (connection) => {
      log('received incoming connection')
      const connFSM = new IncomingConnectionFSM({ connection, _switch, transportKey })

      connFSM.once('error', (err) => log(err))
      connFSM.once('private', (conn) => {
        if (handler) {
          return handler(conn)
        }
        connFSM.encrypt()
      })
      connFSM.once('encrypted', () => connFSM.upgrade())

      connFSM.protect()
    }
  }
}

module.exports = listener