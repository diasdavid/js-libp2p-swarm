'use strict'

const Stat = require('./stat')

const defaultOptions = {
  enabled: true,
  computeThrottleMaxQueueSize: 1000,
  computeThrottleTimeout: 2000,
  movingAverageIntervals: [
    60 * 1000, // 1 minute
    5 * 60 * 1000, // 5 minutes
    15 * 60 * 1000 // 15 minutes
  ]
}

const initialCounters = [
  'dataReceived',
  'dataSent',
  'peerCount'
]

const directionToEvent = {
  in: 'dataReceived',
  out: 'dataSent'
}

module.exports = (observer, _options) => {
  const options = Object.assign({}, defaultOptions, _options)
  const globalStats = new Stat(initialCounters, options)
  const peerStats = new Map()
  const transportStats = new Map()

  observer.on('message', (peerId, transportTag, protocol, direction, bufferLength) => {
    console.log('m', peerId, transportTag, protocol, direction, bufferLength)
    const event = directionToEvent[direction]

    // global stats
    globalStats.push(event, bufferLength)

    // peer stats
    let peer = peerStats.get(peerId)
    if (!peer) {
      peer = new Stat(initialCounters, options)
      peerStats.set(peerId, peer)
    }
    peer.push(event, bufferLength)

    // transport stats
    let transport = transportStats.get(transportTag)
    if (!transport) {
      transport = new Stat(initialCounters, options)
      transportStats.set(transportTag, transport)
    }
    transport.push(event, bufferLength)
  })

  observer.on('peer:connected', (peerId) => {
    // TODO: count
  })

  observer.on('peer:closed', (peerId) => {
    peerStats.delete(peerId)
  })

  return {
    global: globalStats,
    peers: Array.from(peerStats.keys()),
    forPeer: (peerId) => peerStats.get(peerId),
    transports: Array.from(transportStats.keys()),
    forTransport: (transport) => transportStats.get(transport)
  }
}
