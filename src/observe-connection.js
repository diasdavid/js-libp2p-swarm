'use strict'

const Connection = require('interface-connection').Connection
const pull = require('pull-stream')

module.exports = (transport, protocol, _conn, observer) => {
  const peerInfo = new Promise((resolve, reject) => {
    if (_conn.peerInfo) {
      conn.setPeerInfo(_conn.peerInfo)
      return resolve(_conn.peerInfo)
    }

    _conn.setPeerInfo = (pi) => {
      conn.setPeerInfo(pi)
      resolve(pi)
    }
  })

  const conn = new Connection()

  const stream = {
    source: pull(_conn.source, observer.incoming(transport, protocol, peerInfo)),
    sink: pull(observer.outgoing(transport, protocol, peerInfo), _conn.sink)
  }
  conn.setInnerConn(stream, _conn.info)

  return conn
}
