'use strict'

const multistream = require('multistream-select')
const observeConn = require('./observe-connection')

module.exports = function protocolMuxer (protocols, observer) {
  return (transport) => (conn) => {
    const ms = new multistream.Listener()

    Object.keys(protocols).forEach((protocol) => {
      if (!protocol) {
        return
      }

      const handler = (protocol, _conn) => {
        const conn = observeConn(transport, protocol, _conn, observer)
        protocols[protocol].handlerFunc(protocol, conn)
      }

      // const handler = protocols[protocol].handlerFunc

      ms.addHandler(protocol, handler, protocols[protocol].matchFunc)
    })

    ms.handle(conn, (err) => {
      if (err) {
        // the multistream handshake failed
      }
    })
  }
}
