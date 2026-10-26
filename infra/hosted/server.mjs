import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createHostedHandler } from './http.mjs'

// A loopback-only source adapter, not a production listener/proxy/TLS rollout.
export function listenHosted(options) {
  const handler = createHostedHandler(options)
  const server = createServer(async (req,res) => {
    try {
      const abort = new AbortController(); req.on('aborted',() => abort.abort())
      const url = new URL(req.url,`http://${req.headers.host}`)
      // HTTP fixture origin is explicit; production TLS/proxy support is NOT guessed.
      const request = new Request(url,{method:req.method,headers:req.headers,
        body:['GET','HEAD'].includes(req.method)?undefined:Readable.toWeb(req),duplex:'half',signal:abort.signal})
      const response = await handler(request)
      res.writeHead(response.status,Object.fromEntries(response.headers))
      if (!response.body) return res.end()
      const stream = Readable.fromWeb(response.body)
      res.on('close',() => stream.destroy())
      stream.pipe(res)
    } catch { if (!res.headersSent) res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"Request failed"}') }
  })
  server.maxConnections=32;server.requestTimeout=10000;server.headersTimeout=10000
  server.keepAliveTimeout=1000;server.maxRequestsPerSocket=10
  return server
}
