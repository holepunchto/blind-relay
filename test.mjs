import test from 'brittle'
import UDX from 'udx-native'

import relay from './index.js'
import { withSocket, withServer, withClient } from './test/helpers.js'

test('basic', (t) => {
  t.plan(4)

  const udx = new UDX()
  const socket = withSocket(t, udx)

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()

  {
    const client = withClient(t, server)

    const request = client.pair(true, token, createStream())

    request
      .on('error', (err) => t.fail(err))
      .on('data', (remoteId) => {
        t.pass(`paired with ${remoteId}`)

        request.stream
          .on('error', () => {})
          .on('data', (data) => t.alike(data.toString(), 'initiatee'))
          .connect(socket, remoteId, socket.address().port)

        request.stream.end('initiator')
      })
  }

  {
    const client = withClient(t, server)

    const request = client.pair(false, token, createStream())

    request
      .on('error', (err) => t.fail(err))
      .on('data', (remoteId) => {
        t.pass(`paired with ${remoteId}`)

        request.stream
          .on('error', () => {})
          .on('data', (data) => t.alike(data.toString(), 'initiator'))
          .connect(socket, remoteId, socket.address().port)

        request.stream.end('initiatee')
      })
  }
})
