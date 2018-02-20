/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const parallel = require('async/parallel')
const TCP = require('libp2p-tcp')
const multiplex = require('libp2p-multiplex')
const pull = require('pull-stream')
const secio = require('libp2p-secio')
const PeerBook = require('peer-book')

const utils = require('./utils')
const createInfos = utils.createInfos
const tryEcho = utils.tryEcho
const Switch = require('../src')

describe('Stats', () => {
  let switchA
  let switchB

  before((done) => createInfos(2, (err, infos) => {
    expect(err).to.not.exist()

    const options = {
      stats: {
        computeThrottleTimeout: 100
      }
    }

    const peerA = infos[0]
    const peerB = infos[1]

    peerA.multiaddrs.add('/ip4/127.0.0.1/tcp/9001')
    peerB.multiaddrs.add('/ip4/127.0.0.1/tcp/9002')

    switchA = new Switch(peerA, new PeerBook(), options)
    switchB = new Switch(peerB, new PeerBook(), options)

    switchA.transport.add('tcp', new TCP())
    switchB.transport.add('tcp', new TCP())

    switchA.connection.crypto(secio.tag, secio.encrypt)
    switchB.connection.crypto(secio.tag, secio.encrypt)

    switchA.connection.addStreamMuxer(multiplex)
    switchB.connection.addStreamMuxer(multiplex)

    parallel([
      (cb) => switchA.transport.listen('tcp', {}, null, cb),
      (cb) => switchB.transport.listen('tcp', {}, null, cb)
    ], done)
  }))

  after(function (done) {
    this.timeout(3 * 1000)
    parallel([
      (cb) => switchA.stop(cb),
      (cb) => switchB.stop(cb)
    ], done)
  })

  before(() => {
    const echo = (protocol, conn) => pull(conn, conn)
    switchB.handle('/echo/1.0.0', echo)
    switchA.handle('/echo/1.0.0', echo)
  })

  it('dial A -> B', (done) => {
    switchA.dial(switchB._peerInfo, '/echo/1.0.0', (err, conn) => {
      expect(err).to.not.exist()
      tryEcho(conn, done)
    })
  })

  it('dial B -> A', (done) => {
    switchB.dial(switchA._peerInfo, '/echo/1.0.0', (err, conn) => {
      expect(err).to.not.exist()
      tryEcho(conn, done)
    })
  })

  it('waits a bit', (done) => setTimeout(done, 1000))

  it('both nodes have some global stats', () => {
    let snapshot = switchA.stats.global.snapshot
    expect(snapshot.dataReceived.toFixed()).to.equal('51')
    expect(snapshot.dataSent.toFixed()).to.equal('49')

    snapshot = switchB.stats.global.snapshot
    expect(snapshot.dataReceived.toFixed()).to.equal('51')
    expect(snapshot.dataSent.toFixed()).to.equal('49')
  })

  it('both nodes know some transports', () => {
    const expectedTransports = [
      '/mplex/6.7.0',
      '/secio/1.0.0'
    ]
    expect(switchA.stats.transports().sort()).to.deep.equal(expectedTransports)
    expect(switchB.stats.transports().sort()).to.deep.equal(expectedTransports)
  })

  it('both nodes know some protocols', () => {
    const expectedProtocols = [
      '/echo/1.0.0',
      '/mplex/6.7.0'
    ]
    expect(switchA.stats.protocols().sort()).to.deep.equal(expectedProtocols)
    expect(switchB.stats.protocols().sort()).to.deep.equal(expectedProtocols)
  })

  it('both nodes know about each other', () => {
    expect(switchA.stats.peers().sort()).to.deep.equal([switchB._peerInfo.id.toB58String()])
    expect(switchB.stats.peers().sort()).to.deep.equal([switchA._peerInfo.id.toB58String()])
  })
})
