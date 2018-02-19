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

  observer.on('message', (peerId, protocol, direction, bufferLength) => {
    console.log('m', peerId, protocol, direction, bufferLength)
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
  })

  observer.on('peer:closed', (peerId) => {
    peerStats.delete(peerId)
  })

  return {
    global: globalStats,
    forPeer: (peerId) => peerStats.get(peerId)
  }
}
