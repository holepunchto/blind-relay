const { Duplex } = require('streamx')
const relay = require('..')

exports.withSocket = function withSocket (t, udx) {
  const socket = udx.createSocket()
  socket.bind()
  t.teardown(() => socket.close(), { order: 3 })
  return socket
}

exports.withServer = function withServer (t, createStream) {
  const server = new relay.Server({ createStream })
  t.teardown(() => server.close(), { order: 2 })
  return server
}

exports.withClient = function withClient (t, server) {
  const serverStream = new Duplex({
    write (data, cb) {
      clientStream.push(data)
      cb(null)
    }
  })

  const clientStream = new Duplex({
    write (data, cb) {
      serverStream.push(data)
      cb(null)
    }
  })

  const session = server.accept(serverStream)

  session.on('error', (err) => t.fail(err))

  const client = new relay.Client(clientStream)
  t.teardown(() => client.end(), { order: 1 })
  return client
}
