'use strict'

const once = require('once')
const Queue = require('./queue')
const noop = () => {}

class DialQueueManager {
  /**
   * @constructor
   * @param {Switch} _switch
   */
  constructor (_switch) {
    this._queue = new Set()
    this._queues = {}
    this.switch = _switch
    this.dials = 0
  }

  /**
   * Iterates over all items in the DialerQueue
   * and executes there callback with an error.
   *
   * This causes the entire DialerQueue to be drained
   */
  abort () {
    // Clear the general queue
    this._queue.clear()

    // Abort the individual peer queues
    const queues = Object.values(this._queues)
    queues.forEach(dialQueue => {
      dialQueue.abort()
    })
  }

  /**
   * Adds the `dialRequest` to the queue and ensures the queue is running
   *
   * @param {DialRequest} dialRequest
   * @returns {void}
   */
  add ({ peerInfo, protocol, useFSM, callback }) {
    callback = callback ? once(callback) : noop

    // Add the dial to its respective queue
    const targetQueue = this.getQueue(peerInfo)
    targetQueue.add(protocol, useFSM, callback)

    // Add the id to the general queue set if the queue isn't running
    if (!targetQueue.isRunning) {
      this._queue.add(targetQueue.id)
    }

    this.run()
  }

  /**
   * Will execute up to `MAX_PARALLEL_DIALS` dials
   */
  run () {
    if (this.dials < this.switch.dialer.MAX_PARALLEL_DIALS && this._queue.size > 0) {
      let nextQueue = this._queue.values().next()
      if (nextQueue.done) return

      this._queue.delete(nextQueue.value)
      let targetQueue = this._queues[nextQueue.value]
      if (targetQueue.start()) {
        this.dials++
      }
    }
  }

  /**
   * Will remove the `peerInfo` from the dial blacklist
   * @param {PeerInfo} peerInfo
   */
  clearBlacklist (peerInfo) {
    this.getQueue(peerInfo).blackListed = null
  }

  /**
   * A handler for when dialing queues stop. This will trigger
   * `run()` in order to keep the queue processing.
   * @private
   */
  _onQueueStopped () {
    this.dials--
    this.run()
  }

  /**
   * Returns the `Queue` for the given `peerInfo`
   * @param {PeerInfo} peerInfo
   * @returns {Queue}
   */
  getQueue (peerInfo) {
    const id = peerInfo.id.toB58String()

    this._queues[id] = this._queues[id] || new Queue(id, this.switch, this._onQueueStopped.bind(this))
    return this._queues[id]
  }
}

module.exports = DialQueueManager
