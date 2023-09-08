const { Duplex } = require('streamx')
const relay = require('..')

exports.withSocket = function withSocket (t, udx) {
  const socket = udx.createSocket()
  socket.bind()
  t.teardown(() => socket.close())
  return socket
}

exports.withServer = function withServer (t, createStream) {
  const server = new relay.Server({ createStream })
  t.teardown(() => server.close())
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

  server.accept(serverStream)

  const client = new relay.Client(clientStream)
  t.teardown(() => client.close())
  return client
}
