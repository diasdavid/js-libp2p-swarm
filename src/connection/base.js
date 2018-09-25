'use strict'

const EventEmitter = require('events').EventEmitter
const debug = require('debug')

class BaseConnection extends EventEmitter {
  constructor({ _switch, logName }) {
    super()

    this.switch = _switch
    this.ourPeerInfo = this.switch._peerInfo
    this.log = debug(logName)
  }

  /**
   * Puts the state into encrypting mode
   *
   * @returns {void}
   */
  encrypt () {
    this._state('encrypt')
  }

  /**
   * Puts the state into privatizing mode
   *
   * @returns {void}
   */
  protect () {
    this._state('privatize')
  }

  /**
   * Puts the state into muxing mode
   *
   * @returns {void}
   */
  upgrade () {
    this._state('upgrade')
  }

   /**
   * Wraps this.conn with the Switch.protector for private connections
   *
   * @private
   * @fires ConnectionFSM#error
   * @returns {void}
   */
  _onPrivatizing () {
    if (!this.switch.protector) {
      return this._state('done')
    }

    this.conn = this.switch.protector.protect(this.conn, (err) => {
      if (err) {
        this.emit('error', err)
        return this._state('disconnect')
      }

      this.log(`successfully privatized conn to ${this.theirB58Id}`)
      this.conn.setPeerInfo(this.theirPeerInfo)
      this._state('done')
    })
  }
}

module.exports = BaseConnection