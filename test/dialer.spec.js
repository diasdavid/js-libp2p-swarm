/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(require('chai-checkmark'))
chai.use(dirtyChai)
const sinon = require('sinon')

const PeerBook = require('peer-book')
const Queue = require('../src/dialer/queue')
const QueueManager = require('../src/dialer/queueManager')
const Switch = require('../src')

const utils = require('./utils')
const createInfos = utils.createInfos

describe('dialer', () => {
  let switchA

  before((done) => createInfos(1, (err, infos) => {
    expect(err).to.not.exist()

    switchA = new Switch(infos[0], new PeerBook())

    done()
  }))

  afterEach(() => {
    sinon.restore()
  })

  describe('queue', () => {
    it('should blacklist forever after 5 blacklists', () => {
      const queue = new Queue('QM', switchA)
      for (var i = 0; i < 4; i++) {
        queue.blacklist()
        expect(queue.blackListed).to.be.a('number')
        expect(queue.blackListed).to.not.eql(Infinity)
      }

      queue.blacklist()
      expect(queue.blackListed).to.eql(Infinity)
    })
  })

  describe('queue manager', () => {
    let queueManager
    before(() => {
      queueManager = new QueueManager(switchA)
    })

    it('should abort cold calls when the queue is full', (done) => {
      sinon.stub(queueManager._coldCallQueue, 'size').value(switchA.dialer.MAX_COLD_CALLS)
      const dialRequest = {
        peerInfo: {
          id: { toB58String: () => 'QmA' }
        },
        protocol: null,
        useFSM: true,
        callback: (err) => {
          expect(err.code).to.eql('DIAL_ABORTED')
          done()
        }
      }

      queueManager.add(dialRequest)
    })

    it('should add a protocol dial to the normal queue', () => {
      const dialRequest = {
        peerInfo: {
          id: { toB58String: () => 'QmA' },
          isConnected: () => null
        },
        protocol: '/echo/1.0.0',
        useFSM: true,
        callback: () => {}
      }

      const runSpy = sinon.stub(queueManager, 'run')
      const addSpy = sinon.stub(queueManager._queue, 'add')

      queueManager.add(dialRequest)

      expect(runSpy.called).to.eql(true)
      expect(addSpy.called).to.eql(true)
      expect(addSpy.getCall(0).args[0]).to.eql('QmA')
    })

    it('should add a cold call to the cold call queue', () => {
      const dialRequest = {
        peerInfo: {
          id: { toB58String: () => 'QmA' },
          isConnected: () => null
        },
        protocol: null,
        useFSM: true,
        callback: () => {}
      }

      const runSpy = sinon.stub(queueManager, 'run')
      const addSpy = sinon.stub(queueManager._coldCallQueue, 'add')

      queueManager.add(dialRequest)

      expect(runSpy.called).to.eql(true)
      expect(addSpy.called).to.eql(true)
      expect(addSpy.getCall(0).args[0]).to.eql('QmA')
    })

    it('should abort a cold call if it\'s in the normal queue', (done) => {
      const dialRequest = {
        peerInfo: {
          id: { toB58String: () => 'QmA' },
          isConnected: () => null
        },
        protocol: null,
        useFSM: true,
        callback: (err) => {
          expect(runSpy.called).to.eql(false)
          expect(hasSpy.called).to.eql(true)
          expect(hasSpy.getCall(0).args[0]).to.eql('QmA')
          expect(err.code).to.eql('DIAL_ABORTED')
          done()
        }
      }

      const runSpy = sinon.stub(queueManager, 'run')
      const hasSpy = sinon.stub(queueManager._queue, 'has').returns(true)

      queueManager.add(dialRequest)
    })
  })
})
