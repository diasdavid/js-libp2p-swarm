'use strict'

const pull = require('pull-stream')
const EventEmitter = require('events')

module.exports = (swarm) => {
  const observer = Object.assign(new EventEmitter(), {
    incoming: observe('in'),
    outgoing: observe('out')
  })

  swarm.on('peer-mux-established', (peerInfo) => {
    observer.emit('peer:connected', peerInfo.id.toB58String())
  })

  swarm.on('peer-mux-closed', (peerInfo) => {
    observer.emit('peer:closed', peerInfo.id.toB58String())
  })

  return observer

  function observe (direction) {
    return (transport, protocol, peerInfo) => {
      const peerId = peerInfo && peerInfo.id.toB58String()
      return pull.map((buffer) => {
        willObserve(peerId, transport, protocol, direction, buffer.length)
        return buffer
      })
    }
  }

  function willObserve (peerId, transport, protocol, direction, bufferLength) {
    setImmediate(() => observer.emit('message', peerId, transport, protocol, direction, bufferLength))
  }
}
