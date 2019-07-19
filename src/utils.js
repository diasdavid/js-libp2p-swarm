'use strict'

const Multistream = require('multistream-select')

/**
 * For a given multistream, registers to handle the given connection
 * @param {MultistreamDialer} multistream
 * @param {Connection} connection
 * @returns {Promise}
 */
module.exports.msHandle = (multistream, connection) => {
  return new Promise((resolve, reject) => {
    multistream.handle(connection, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/**
 * For a given multistream, selects the given protocol
 * @param {MultistreamDialer} multistream
 * @param {string} protocol
 * @returns {Promise} Resolves the selected Connection
 */
module.exports.msSelect = (multistream, protocol) => {
  return new Promise((resolve, reject) => {
    multistream.select(protocol, (err, connection) => {
      if (err) return reject(err)
      resolve(connection)
    })
  })
}

/**
 * Takes a stream and handshakes on the given `protocol`.
 * The stream for that protocol will be returned in the `callback`.
 * @param {Connection} connection A connection to create a sub stream on
 * @param {string} protocol The protocol to communicate on
 * @param {function(Error, Stream)} callback
 */
module.exports.newStream = (connection, protocol, callback) => {
  const ms = new Multistream.Dialer()
  ms.handle(connection, (err) => {
    if (err) return callback(err)
    ms.select(protocol, (err, stream) => {
      if (err) return callback(err)
      callback(null, stream)
    })
  })
}

/**
 * Get unique values from `arr` using `getValue` to determine
 * what is used for uniqueness
 * @param {Array} arr The array to get unique values for
 * @param {function(value)} getValue The function to determine what is compared
 * @returns {Array}
 */
module.exports.uniqueBy = (arr, getValue) => {
  return [...new Map(arr.map((i) => [getValue(i), i])).values()]
}
