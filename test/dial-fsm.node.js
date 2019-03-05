/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(require('chai-checkmark'))
chai.use(dirtyChai)
const PeerBook = require('peer-book')
const parallel = require('async/parallel')
const WS = require('libp2p-websockets')
const TCP = require('libp2p-tcp')
const secio = require('libp2p-secio')
const multiplex = require('pull-mplex')
const pull = require('pull-stream')
const identify = require('libp2p-identify')

const utils = require('./utils')
const createInfos = utils.createInfos
const Switch = require('../src')

describe('dialFSM', () => {
  let switchA
  let switchB
  let switchC
  let protocol

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

    switchA.connection.reuse()
    switchB.connection.reuse()
    switchC.connection.reuse()

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

  afterEach(() => {
    switchA.unhandle(protocol)
    switchB.unhandle(protocol)
    switchC.unhandle(protocol)
    protocol = null
  })

  it('should emit `error:connection_attempt_failed` when a transport fails to dial', (done) => {
    protocol = '/warn/1.0.0'
    switchC.handle(protocol, () => { })

    const connFSM = switchA.dialFSM(switchC._peerInfo, protocol, () => { })

    connFSM.once('error:connection_attempt_failed', (errors) => {
      expect(errors).to.be.an('array')
      expect(errors).to.have.length(1)
      done()
    })
  })

  it('should emit an `error` event when a it cannot dial a peer', (done) => {
    protocol = '/error/1.0.0'
    switchC.handle(protocol, () => { })

    const connFSM = switchA.dialFSM(switchC._peerInfo, protocol, () => { })

    connFSM.once('error', (err) => {
      expect(err).to.be.exist()
      expect(err).to.have.property('code', 'CONNECTION_FAILED')
      done()
    })
  })

  it('should emit a `closed` event when closed', (done) => {
    protocol = '/closed/1.0.0'
    switchB.handle(protocol, () => { })

    const connFSM = switchA.dialFSM(switchB._peerInfo, protocol, (err) => {
      expect(err).to.not.exist()
      expect(switchA.connection.getAllById(switchB._peerInfo.id.toB58String())).to.have.length(1)
      connFSM.close()
    })

    connFSM.once('close', () => {
      expect(switchA.connection.getAllById(switchB._peerInfo.id.toB58String())).to.have.length(0)
      done()
    })
  })

  it('should have the peers protocols after muxing', (done) => {
    protocol = '/lscheck/1.0.0'
    switchB.handle(protocol, () => { })

    // Clear the protocols so we have a clean slate to check
    switchA._peerBook.get(switchB._peerInfo).protocols.clear()

    const connFSM = switchA.dialFSM(switchB._peerInfo, protocol, (err) => {
      expect(err).to.not.exist()
    })

    connFSM.once('muxed', () => {
      const peer = switchA._peerBook.get(switchB._peerInfo)
      const protocols = Array.from(peer.protocols.values())
      expect(protocols).to.eql([
        multiplex.multicodec,
        identify.multicodec,
        protocol
      ])
      connFSM.close()
    })
    connFSM.once('close', done)
  })

  it('should close when the receiver closes', (done) => {
    const peerIdA = switchA._peerInfo.id.toB58String()
    protocol = '/closed/1.0.0'

    // wait for the expects to happen
    expect(2).checks(() => {
      switchB.connection.getOne(peerIdA).close()
    })

    switchB.handle(protocol, () => { })
    switchB.on('peer-mux-established', (peerInfo) => {
      if (peerInfo.id.toB58String() === peerIdA) {
        switchB.removeAllListeners('peer-mux-established')
        expect(switchB.connection.getAllById(peerIdA)).to.have.length(1).mark()
      }
    })

    const connFSM = switchA.dialFSM(switchB._peerInfo, protocol, (err) => {
      expect(err).to.not.exist().mark()
    })
    connFSM.once('close', () => {
      expect(switchA.connection.getAllById(switchB._peerInfo.id.toB58String())).to.have.length(0)
      done()
    })
  })

  it('parallel dials to one another should disconnect on hangup', function (done) {
    this.timeout(10e3)
    protocol = '/parallel/1.0.0'

    switchA.handle(protocol, (_, conn) => { pull(conn, conn) })
    switchB.handle(protocol, (_, conn) => { pull(conn, conn) })

    // 4 close checks and 1 hangup check
    expect(5).checks(() => {
      switchA.removeAllListeners('peer-mux-closed')
      switchB.removeAllListeners('peer-mux-closed')
      done()
    })

    switchA.on('peer-mux-closed', (peerInfo) => {
      expect(peerInfo.id.toB58String()).to.eql(switchB._peerInfo.id.toB58String()).mark()
    })
    switchB.on('peer-mux-closed', (peerInfo) => {
      expect(peerInfo.id.toB58String()).to.eql(switchA._peerInfo.id.toB58String()).mark()
    })

    const conn = switchA.dialFSM(switchB._peerInfo, protocol, () => {
      // Hangup and verify the connections are closed
      switchA.hangUp(switchB._peerInfo, (err) => {
        expect(err).to.not.exist().mark()
      })
    })

    // Hold the dial from A, until switch B is done dialing to ensure
    // we have both incoming and outgoing connections
    conn._state.on('DIALING:enter', (cb) => {
      switchB.dialFSM(switchA._peerInfo, protocol, () => {
        cb()
      })
    })
  })

  it('parallel dials to one another should disconnect on stop', (done) => {
    protocol = '/parallel/1.0.0'
    switchA.handle(protocol, (_, conn) => { pull(conn, conn) })
    switchB.handle(protocol, (_, conn) => { pull(conn, conn) })

    // 4 close checks and 1 hangup check
    expect(5).checks(() => {
      switchA.removeAllListeners('peer-mux-closed')
      switchB.removeAllListeners('peer-mux-closed')
      done()
    })

    switchA.on('peer-mux-closed', (peerInfo) => {
      expect(peerInfo.id.toB58String()).to.eql(switchB._peerInfo.id.toB58String()).mark()
    })
    switchB.on('peer-mux-closed', (peerInfo) => {
      expect(peerInfo.id.toB58String()).to.eql(switchA._peerInfo.id.toB58String()).mark()
    })

    const conn = switchA.dialFSM(switchB._peerInfo, protocol, () => {
      // Hangup and verify the connections are closed
      switchA.stop((err) => {
        expect(err).to.not.exist().mark()
      })
    })

    // Hold the dial from A, until switch B is done dialing to ensure
    // we have both incoming and outgoing connections
    conn._state.on('DIALING:enter', (cb) => {
      switchB.dialFSM(switchA._peerInfo, protocol, () => {
        cb()
      })
    })
  })
})
