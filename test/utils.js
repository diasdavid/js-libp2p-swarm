'use strict'

const PeerInfo = require('peer-info')
const parallel = require('run-parallel')

exports.createInfos = (num, cb) => {
  const tasks = []
  const infos = []

  for (let i = 0; i < num; i++) {
    tasks.push((cb) => {
      PeerInfo.create((err, info) => {
        if (err) {
          return cb(err)
        }

        infos.push(info)
        cb()
      })
    })
  }

  parallel(tasks, (err) => {
    if (err) {
      return cb(err)
    }

    cb(null, infos)
  })
}
