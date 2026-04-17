import test from 'brittle'
import UDX from 'udx-native'

import relay from './index.js'
import { withSocket, withServer, withClient } from './test/helpers.js'

test('basic', (t) => {
  t.plan(8)

  const udx = new UDX()
  const socket = withSocket(t, udx)

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()

  {
    const client = withClient(t, server)
    const stream = createStream()

    client.on('pair', (...args) => t.alike(args, [true, token, stream, 4]))

    const request = client.pair(true, token, stream)

    request
      .on('error', (err) => t.fail(err))
      .on('data', (remoteId) => {
        t.pass(`paired with ${remoteId}`)

        request.stream
          .on('error', () => {})
          .on('close', () => t.pass('stream closed'))
          .on('data', (data) => t.alike(data.toString(), 'initiatee'))
          .on('connect', () => {
            request.stream.end('initiator')
            console.log('stream connected')
          })
          .connect(socket, remoteId, socket.address().port)
      })
  }

  {
    const client = withClient(t, server)
    const stream = createStream()

    client.on('pair', (...args) => t.alike(args, [false, token, stream, 3]))

    const request = client.pair(false, token, stream)

    request
      .on('error', (err) => t.fail(err))
      .on('data', (remoteId) => {
        t.pass(`paired with ${remoteId}`)

        request.stream
          .on('error', () => {})
          .on('close', () => t.pass('stream closed'))
          .on('data', (data) => t.alike(data.toString(), 'initiator'))
          .on('connect', () => {
            console.log('non-initiator connected')
            request.stream.end('initiatee')
          })
          .connect(socket, remoteId, socket.address().port)
      })
  }
})

test('unpair after pair', (t) => {
  t.plan(2)

  const udx = new UDX()

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()

  {
    const client = withClient(t, server)
    const stream = createStream()

    const request = client.pair(true, token, stream)

    request
      .on('error', (err) => t.fail(err))
      .on('data', () => t.pass('paired'))
      .on('close', () => client.unpair(token))
  }

  {
    const client = withClient(t, server)
    const stream = createStream()

    const request = client.pair(false, token, stream)

    request
      .on('error', (err) => t.fail(err))
      .on('data', () => t.pass('paired'))
      .on('close', () => client.unpair(token))
  }
})

test.solo('initiator can send a message immediately after pairing', (t) => {
  t.plan(8)

  const udx = new UDX()
  const socket = withSocket(t, udx)

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()

  {
    const client = withClient(t, server)
    const stream = createStream()

    client.on('pair', (...args) => t.alike(args, [true, token, stream, 4]))

    const request = client.pair(true, token, stream)

    request
      .on('error', (err) => t.fail(err))
      .on('data', (remoteId) => {
        t.pass(`initiator paired with ${remoteId}`)
        request.stream
          .on('error', () => {})
          .on('close', () => {
            const { packetsDroppedByKernel, packetsReceived, packetsTransmitted } = udx
            const { rtoCount, retransmits, fastRecoveries, inflight } = stream
            console.log('initiator UDX stats', { packetsDroppedByKernel, packetsReceived, packetsTransmitted })
            console.log('initiator UDX stream stats', { rtoCount, retransmits, fastRecoveries, inflight })

            t.pass('initiator stream closed')
          })
          .on('end', () => { request.stream.end() })
          .on('data', (data) => {
            console.log('data', data.toString())
          })
          .connect(socket, remoteId, socket.address().port)

        // COMMENT NEXT LINE TO MAKE IT HANG (the write)
        // Obervations:
        //   - if no write is made, the stream never times out
        //      (even if the other side timed out)
        //   - Streams only transmit data if BOTH sides send at least one message
        //   - The INITIATOR always has 1 DROPPED PACKET (when the streams transmit data)
        //   - Adding a small delay to sending this message gets rid of the dropped packet
        //      (with setImmediate it stops triggering always, while with a 10ms delay it hardly ever triggers anymore on my machine)
        request.stream.write('message from initiator')
      })
  }

  {
    const client = withClient(t, server)
    const stream = createStream()

    client.on('pair', (...args) => t.alike(args, [false, token, stream, 3]))

    const request = client.pair(false, token, stream)

    request
      .on('error', (err) => t.fail(err))
      .on('data', (remoteId) => {
        t.pass(`non-initiator paired with ${remoteId}`)

        request.stream
          .on('error', () => {})
          .on('close', () => {
            const { packetsDroppedByKernel, packetsReceived, packetsTransmitted } = udx
            const { rtoCount, retransmits, fastRecoveries, inflight } = stream
            console.log('non-initiator UDX stats', { packetsDroppedByKernel, packetsReceived, packetsTransmitted })
            console.log('non-initiator UDX stream stats', { rtoCount, retransmits, fastRecoveries, inflight })

            t.pass('non-initiator stream closed')
          })
          .on('data', (data) => {
            t.is(data.toString(), 'message from initiator', 'non-initiator received message')
            request.stream.end()
          })
          .on('end', () => {
            t.pass('non-initiator received end message')
            request.stream.end()
          })
          .connect(socket, remoteId, socket.address().port)

        request.stream.write('message from non-initiator')
      })
  }
})
