'use strict'

const EventEmitter = require('events')

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
  'dataSent'
]

const directionToEvent = {
  in: 'dataReceived',
  out: 'dataSent'
}

module.exports = (observer, _options) => {
  const options = Object.assign({}, defaultOptions, _options)
  const globalStats = new Stat(initialCounters, options)

  const stats = Object.assign(new EventEmitter(), {
    stop: stop,
    global: globalStats,
    peers: () => Array.from(peerStats.keys()),
    forPeer: (peerId) => peerStats.get(peerId),
    transports: () => Array.from(transportStats.keys()),
    forTransport: (transport) => transportStats.get(transport),
    protocols: () => Array.from(protocolStats.keys()),
    forProtocol: (protocol) => protocolStats.get(protocol)
  })

  globalStats.on('update', propagateChange)

  const peerStats = new Map()
  const transportStats = new Map()
  const protocolStats = new Map()

  observer.on('message', (peerId, transportTag, protocolTag, direction, bufferLength) => {
    const event = directionToEvent[direction]

    // global stats
    globalStats.push(event, bufferLength)

    // peer stats
    let peer = peerStats.get(peerId)
    if (!peer) {
      peer = new Stat(initialCounters, options)
      peer.on('update', propagateChange)
      peerStats.set(peerId, peer)
    }
    peer.push(event, bufferLength)

    // transport stats
    let transport = transportStats.get(transportTag)
    if (!transport) {
      transport = new Stat(initialCounters, options)
      transport.on('update', propagateChange)
      transportStats.set(transportTag, transport)
    }
    transport.push(event, bufferLength)

    // protocol stats
    let protocol = protocolStats.get(protocolTag)
    if (!protocol) {
      protocol = new Stat(initialCounters, options)
      protocol.on('update', propagateChange)
      protocolStats.set(protocolTag, transport)
    }
    protocol.push(event, bufferLength)
  })

  observer.on('peer:closed', (peerId) => {
    const peer = peerStats.get(peerId)
    if (peer) {
      peer.removeListener('update', propagateChange)
      peer.stop()
      peerStats.delete(peerId)
    }
  })

  return stats

  function stop () {
    globalStats.stop()
    for (let peerStat of peerStats.values()) {
      peerStat.stop()
    }
    for (let transportStat of transportStats.values()) {
      transportStat.stop()
    }
  }

  function propagateChange () {
    stats.emit('update')
  }
}
