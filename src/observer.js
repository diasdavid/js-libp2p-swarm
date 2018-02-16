'use strict'

const pull = require('pull-stream')

module.exports = () => {
  return {
    incoming: observe('in'),
    outgoing: observe('out')
  }

  function observe (direction) {
    return (protocol, peerInfo) => {
      const peerId = peerInfo && peerInfo.id.toB58String()
      return pull.map((buffer) => {
        console.log(peerId + ': + (' + protocol + '), (' + direction + '): ' + buffer.length)
        return buffer
      })
    }
  }
}
