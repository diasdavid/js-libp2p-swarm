/*
 * Identify is one of the protocols swarms speaks in order to
 * broadcast and learn about the ip:port pairs a specific peer
 * is available through and to know when a new stream muxer is
 * established, so a conn can be reused
 */

'use strict'

const multistream = require('multistream-select')
const fs = require('fs')
const path = require('path')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const multiaddr = require('multiaddr')
const bl = require('bl')
const lpstream = require('length-prefixed-stream')
const protobuf = require('protocol-buffers')
const debug = require('debug')

const schema = fs.readFileSync(path.join(__dirname, 'identify.proto'))
const idPb = protobuf(schema)

exports = module.exports
exports.multicodec = '/ipfs/id/1.0.0'

exports.exec = (rawConn, muxer, pInfo, callback) => {
  const log = debug('libp2p:swarm:identify:exec')

  // 1. open a stream
  // 2. multistream into identify
  // 3. send what I see from this other peer (extract from conn)
  // 4. receive what the other peer sees from me
  // 5. callback with (err, peerInfo)

  log('1. opening stream')
  const conn = muxer.newStream()

  const ms = new multistream.Dialer()
  ms.handle(conn, (err) => {
    if (err) {
      return callback(err)
    }

    log('2. multistreaming into identify')
    ms.select(exports.multicodec, (err, conn) => {
      if (err) {
        return callback(err)
      }

      const encode = lpstream.encode()
      const decode = lpstream.decode()

      encode.pipe(conn)
      conn.pipe(decode)

      decode.once('error', callback)
      decode.once('data', (data) => {
        const msg = idPb.Identify.decode(data)
        log('4. receiving info from peer', msg)

        if (msg.observedAddr.length > 0) {
          pInfo.multiaddr.addSafe(multiaddr(msg.observedAddr))
        }

        const pId = PeerId.createFromPubKey(msg.publicKey)
        const otherPInfo = new PeerInfo(pId)
        msg.listenAddrs.forEach((ma) => {
          otherPInfo.multiaddr.add(multiaddr(ma))
        })

        log('5. calling back', otherPInfo)
        callback(null, otherPInfo)
      })

      const obsMultiaddr = rawConn.getObservedAddrs()[0]

      let publicKey = new Buffer(0)
      if (pInfo.id.pubKey) {
        publicKey = pInfo.id.pubKey.bytes
      }

      const data = {
        protocolVersion: 'na',
        agentVersion: 'na',
        publicKey: publicKey,
        listenAddrs: pInfo.multiaddrs.map((mh) => mh.buffer),
        observedAddr: obsMultiaddr ? obsMultiaddr.buffer : new Buffer('')
      }

      log('3. sending data', data)
      encode.write(idPb.Identify.encode(data))
      encode.end()
    })
  })
}

exports.handler = (pInfo, swarm) => {
  const log = debug('libp2p:swarm:identify:handler')
  log.error = debug('libp2p:swarm:identify:handler:error')

  return (conn) => {
    // 1. receive incoming observed info about me
    // 2. update my own information (on peerInfo)
    // 3. send back what I see from the other (get from swarm.muxedConns[incPeerID].conn.getObservedAddrs()

    const encode = lpstream.encode()
    const decode = lpstream.decode()

    log('start')
    encode
      .pipe(conn)
      .pipe(decode)
      .pipe(bl((err, data) => {
        if (err) {
          log.error(new Error('Failed to decode lpm from identify'))
          return
        }
        const msg = idPb.Identify.decode(data)
        log('1. receiving incoming data', data)

        if (msg.observedAddr.length > 0) {
          const addr = multiaddr(msg.observedAddr)
          log('2. updating own info: %s', addr.toString())
          pInfo.multiaddr.addSafe(addr)
        }

        const pId = PeerId.createFromPubKey(msg.publicKey)
        const conn = swarm.muxedConns[pId.toB58String()].conn
        const obsMultiaddr = conn.getObservedAddrs()[0]

        let publicKey = new Buffer(0)
        if (pInfo.id.pubKey) {
          publicKey = pInfo.id.pubKey.bytes
        }

        const outgoingData = {
          protocolVersion: 'na',
          agentVersion: 'na',
          publicKey: publicKey,
          listenAddrs: pInfo.multiaddrs.map((ma) => ma.buffer),
          observedAddr: obsMultiaddr ? obsMultiaddr.buffer : new Buffer('')
        }

        log('3. sending data', outgoingData)
        encode.write(idPb.Identify.encode(outgoingData))
        encode.end()
      }))
  }
}
