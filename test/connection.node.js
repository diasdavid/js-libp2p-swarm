/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const PeerBook = require('peer-book')
const WS = require('libp2p-websockets')
const parallel = require('async/parallel')
const secio = require('libp2p-secio')
const pull = require('pull-stream')
const multiplex = require('libp2p-mplex')
const Connection = require('interface-connection').Connection
const Protector = require('libp2p-pnet')
const generatePSK = Protector.generate

const psk = Buffer.alloc(95)
generatePSK(psk)

const ConnectionFSM = require('../src/connection')
const Switch = require('../src')
const createInfos = require('./utils').createInfos

describe('ConnectionFSM', () => {
  let listenerSwitch
  let dialerSwitch

  before((done) => {
    createInfos(2, (err, infos) => {
      if (err) {
        return done(err)
      }

      dialerSwitch = new Switch(infos.shift(), new PeerBook())
      dialerSwitch._peerInfo.multiaddrs.add('/ip4/0.0.0.0/tcp/15451/ws')
      dialerSwitch.connection.crypto(secio.tag, secio.encrypt)
      dialerSwitch.connection.addStreamMuxer(multiplex)
      dialerSwitch.transport.add('ws', new WS())

      listenerSwitch = new Switch(infos.shift(), new PeerBook())
      listenerSwitch._peerInfo.multiaddrs.add('/ip4/0.0.0.0/tcp/15452/ws')
      listenerSwitch.connection.crypto(secio.tag, secio.encrypt)
      listenerSwitch.connection.addStreamMuxer(multiplex)
      listenerSwitch.transport.add('ws', new WS())

      parallel([
        (cb) => dialerSwitch.start(cb),
        (cb) => listenerSwitch.start(cb)
      ], (err) => {
        done(err)
      })
    })
  })

  after((done) => {
    parallel([
      (cb) => dialerSwitch.stop(cb),
      (cb) => listenerSwitch.stop(cb)
    ], () => {
      done()
    })
  })

  it('should have a default state of disconnected', () => {
    const connection = new ConnectionFSM({
      _switch: dialerSwitch,
      peerInfo: listenerSwitch._peerInfo
    })

    expect(connection.getState()).to.equal('DISCONNECTED')
  })

  it('should emit an error with an invalid transition', (done) => {
    const connection = new ConnectionFSM({
      _switch: dialerSwitch,
      peerInfo: listenerSwitch._peerInfo
    })

    expect(connection.getState()).to.equal('DISCONNECTED')

    connection.once('error', (err) => {
      expect(err).to.have.property('code', 'INVALID_STATE_TRANSITION')
      done()
    })
    connection.upgrade()
  })

  it('.dial should create a basic connection', (done) => {
    const connection = new ConnectionFSM({
      _switch: dialerSwitch,
      peerInfo: listenerSwitch._peerInfo
    })

    connection.once('connected', (conn) => {
      expect(conn).to.be.an.instanceof(Connection)
      done()
    })

    connection.dial()
  })

  it('should be able to encrypt a basic connection', (done) => {
    const connection = new ConnectionFSM({
      _switch: dialerSwitch,
      peerInfo: listenerSwitch._peerInfo
    })

    connection.once('connected', (conn) => {
      expect(conn).to.be.an.instanceof(Connection)
      connection.encrypt()
    })
    connection.once('encrypted', (conn) => {
      expect(conn).to.be.an.instanceof(Connection)
      done()
    })

    connection.dial()
  })

  it('should be able to upgrade an encrypted connection', (done) => {
    const connection = new ConnectionFSM({
      _switch: dialerSwitch,
      peerInfo: listenerSwitch._peerInfo
    })

    connection.once('connected', (conn) => {
      expect(conn).to.be.an.instanceof(Connection)
      connection.encrypt()
    })
    connection.once('encrypted', (conn) => {
      expect(conn).to.be.an.instanceof(Connection)
      connection.upgrade()
    })
    connection.once('muxed', (conn) => {
      expect(conn.multicodec).to.equal(multiplex.multicodec)
      done()
    })

    connection.dial()
  })

  it('should be able to handshake a protocol over a muxed connection', (done) => {
    const connection = new ConnectionFSM({
      _switch: dialerSwitch,
      peerInfo: listenerSwitch._peerInfo
    })

    listenerSwitch.handle('/muxed-conn-test/1.0.0', (_, conn) => {
      return pull(conn, conn)
    })

    connection.once('connected', (conn) => {
      expect(conn).to.be.an.instanceof(Connection)
      connection.encrypt()
    })
    connection.once('encrypted', (conn) => {
      expect(conn).to.be.an.instanceof(Connection)
      connection.upgrade()
    })
    connection.once('muxed', (conn) => {
      expect(conn.multicodec).to.equal(multiplex.multicodec)

      connection.shake('/muxed-conn-test/1.0.0', (err, protocolConn) => {
        expect(err).to.not.exist()
        expect(protocolConn).to.be.an.instanceof(Connection)
        done()
      })
    })

    connection.dial()
  })

  it('should not return a connection when handshaking with no protocol', (done) => {
    const connection = new ConnectionFSM({
      _switch: dialerSwitch,
      peerInfo: listenerSwitch._peerInfo
    })

    listenerSwitch.handle('/muxed-conn-test/1.0.0', (_, conn) => {
      return pull(conn, conn)
    })

    connection.once('connected', (conn) => {
      expect(conn).to.be.an.instanceof(Connection)
      connection.encrypt()
    })
    connection.once('encrypted', (conn) => {
      expect(conn).to.be.an.instanceof(Connection)
      connection.upgrade()
    })
    connection.once('muxed', (conn) => {
      expect(conn.multicodec).to.equal(multiplex.multicodec)

      connection.shake(null, (err, protocolConn) => {
        expect(err).to.not.exist()
        expect(protocolConn).to.not.exist()
        done()
      })
    })

    connection.dial()
  })

  describe('with no muxers', () => {
    let oldMuxers
    before(() => {
      oldMuxers = dialerSwitch.muxers
      dialerSwitch.muxers = {}
    })

    after(() => {
      dialerSwitch.muxers = oldMuxers
    })

    it('should be able to handshake a protocol over a basic connection', (done) => {
      const connection = new ConnectionFSM({
        _switch: dialerSwitch,
        peerInfo: listenerSwitch._peerInfo
      })

      listenerSwitch.handle('/unmuxed-conn-test/1.0.0', (_, conn) => {
        return pull(conn, conn)
      })

      connection.once('connected', (conn) => {
        expect(conn).to.be.an.instanceof(Connection)
        connection.encrypt()
      })
      connection.once('encrypted', (conn) => {
        expect(conn).to.be.an.instanceof(Connection)
        connection.upgrade()
      })
      connection.once('muxed', () => {
        throw new Error('connection shouldnt be muxed')
      })
      connection.once('unmuxed', (conn) => {
        expect(conn).to.be.an.instanceof(Connection)

        connection.shake('/unmuxed-conn-test/1.0.0', (err, protocolConn) => {
          expect(err).to.not.exist()
          expect(protocolConn).to.be.an.instanceof(Connection)
          done()
        })
      })

      connection.dial()
    })
  })

  describe('with a protector', () => {
    // Restart the switches with protectors
    before((done) => {
      parallel([
        (cb) => dialerSwitch.stop(cb),
        (cb) => listenerSwitch.stop(cb)
      ], () => {
        dialerSwitch.protector = new Protector(psk)
        listenerSwitch.protector = new Protector(psk)

        parallel([
          (cb) => dialerSwitch.start(cb),
          (cb) => listenerSwitch.start(cb)
        ], done)
      })
    })

    it('should be able to protect a basic connection', (done) => {
      const connection = new ConnectionFSM({
        _switch: dialerSwitch,
        peerInfo: listenerSwitch._peerInfo
      })

      connection.once('private', (conn) => {
        expect(conn).to.be.an.instanceof(Connection)
        done()
      })

      connection.once('connected', (conn) => {
        expect(conn).to.be.an.instanceof(Connection)
        connection.protect()
      })

      connection.dial()
    })

    it('should be able to encrypt a protected connection', (done) => {
      const connection = new ConnectionFSM({
        _switch: dialerSwitch,
        peerInfo: listenerSwitch._peerInfo
      })

      connection.once('connected', (conn) => {
        expect(conn).to.be.an.instanceof(Connection)
        connection.protect()
      })
      connection.once('private', (conn) => {
        expect(conn).to.be.an.instanceof(Connection)
        connection.encrypt()
      })
      connection.once('encrypted', (conn) => {
        expect(conn).to.be.an.instanceof(Connection)
        done()
      })

      connection.dial()
    })
  })
})
