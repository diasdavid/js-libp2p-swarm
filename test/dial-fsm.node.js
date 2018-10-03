/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const PeerBook = require('peer-book')
const parallel = require('async/parallel')
const WS = require('libp2p-websockets')
const TCP = require('libp2p-tcp')
const secio = require('libp2p-secio')
const multiplex = require('libp2p-mplex')

const utils = require('./utils')
const createInfos = utils.createInfos
const Switch = require('../src')

describe('dialFSM', () => {
  let switchA
  let switchB
  let switchC

  before((done) => createInfos(3, (err, infos) => {
    expect(err).to.not.exist()

    const peerA = infos[0]
    const peerB = infos[1]
    const peerC = infos[2]

    peerA.multiaddrs.add('/ip4/0.0.0.0/tcp/0')
    peerB.multiaddrs.add('/ip4/0.0.0.0/tcp/0')
    peerC.multiaddrs.add('/ip4/0.0.0.0/tcp/0/ws')
    // Give peer C a tcp address we wont actually support
    peerC.multiaddrs.add('/ip4/0.0.0.0/tcp/0')

    switchA = new Switch(peerA, new PeerBook())
    switchB = new Switch(peerB, new PeerBook())
    switchC = new Switch(peerC, new PeerBook())

    switchA.transport.add('tcp', new TCP())
    switchB.transport.add('tcp', new TCP())
    switchC.transport.add('ws', new WS())

    switchA.connection.crypto(secio.tag, secio.encrypt)
    switchB.connection.crypto(secio.tag, secio.encrypt)
    switchC.connection.crypto(secio.tag, secio.encrypt)

    switchA.connection.addStreamMuxer(multiplex)
    switchB.connection.addStreamMuxer(multiplex)
    switchC.connection.addStreamMuxer(multiplex)

    parallel([
      (cb) => switchA.transport.listen('tcp', {}, null, cb),
      (cb) => switchB.transport.listen('tcp', {}, null, cb),
      (cb) => switchC.transport.listen('ws', {}, null, cb)
    ], done)
  }))

  after((done) => {
    parallel([
      (cb) => switchA.stop(cb),
      (cb) => switchB.stop(cb),
      (cb) => switchC.stop(cb)
    ], done)
  })

  it('should emit `error:connection_attempt_failed` when a transport fails to dial', (done) => {
    switchC.handle('/warn/1.0.0', () => { })

    const connFSM = switchA.dialFSM(switchC._peerInfo, '/warn/1.0.0', () => { })

    connFSM.once('error:connection_attempt_failed', (errors) => {
      expect(errors).to.be.an('array')
      expect(errors).to.have.length(1)
      expect(errors[0]).to.have.property('code', 'EADDRNOTAVAIL')
      done()
    })
  })

  it('should emit an `error` event when a it cannot dial a peer', (done) => {
    switchC.handle('/error/1.0.0', () => { })

    const connFSM = switchA.dialFSM(switchC._peerInfo, '/error/1.0.0', () => { })

    connFSM.once('error', (err) => {
      expect(err).to.be.exist()
      expect(err).to.have.property('code', 'CONNECTION_FAILED')
      done()
    })
  })

  it('should emit a `closed` event when closed', (done) => {
    switchB.handle('/closed/1.0.0', () => { })

    const connFSM = switchA.dialFSM(switchB._peerInfo, '/closed/1.0.0', (err) => {
      expect(err).to.not.exist()
      expect(switchA.muxedConns).to.have.property(switchB._peerInfo.id.toB58String())
      connFSM.close()
    })

    connFSM.once('close', () => {
      expect(switchA.muxedConns).to.not.have.any.keys([
        switchB._peerInfo.id.toB58String()
      ])
      done()
    })
  })
})
