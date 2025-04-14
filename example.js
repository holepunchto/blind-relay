const DHT = require('hyperdht')
const RelayServer = require('.').Server

const dht = new DHT()

const relay = new RelayServer({
  createStream (opts) {
    return dht.createRawStream({ ...opts, framed: true })
  }
})

const server = dht.createServer((socket) => {
  const session = relay.accept(socket, {
    id: socket.remotePublicKey
  })

  // For timeouts, connection reset by peer etc.
  session.on('error', e => { console.error(e) })
})

server
  .listen()
  .then(() => console.log('Server listening on', server.publicKey.toString('hex')))
