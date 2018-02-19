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
      return pull.map((buffer) => {
        willObserve(peerInfo, transport, protocol, direction, buffer.length)
        return buffer
      })
    }
  }

  function willObserve (peerInfo, transport, protocol, direction, bufferLength) {
    peerInfo.then((pi) => {
      const peerId = pi.id.toB58String()
      setImmediate(() => observer.emit('message', peerId, transport, protocol, direction, bufferLength))
    })
  }
}
