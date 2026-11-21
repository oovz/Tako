import { execFileSync } from "node:child_process"
import { X509Certificate } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { connect } from "node:net"
import { join } from "node:path"
import type { Duplex } from "node:stream"
import { startLocalMockServer } from "../e2e/fixtures/local-mock-server"
import {
  MANGAMILLION_LOCAL_API_PREFIX,
  MANGAMILLION_LOCAL_CDN_PREFIX,
  MANGAMILLION_LOCAL_SITE_PREFIX,
  registerMangaMillionLocalServerHandlers,
} from "../e2e/fixtures/mock-data/site-integrations/mangamillion/local-server"

const origins = {
  "mangamillion.shueisha.co.jp": MANGAMILLION_LOCAL_SITE_PREFIX,
  "api.mangamillion.shueisha.co.jp": MANGAMILLION_LOCAL_API_PREFIX,
  "img.mangamillion.shueisha.co.jp": MANGAMILLION_LOCAL_CDN_PREFIX,
}

export const mangaMillionSeries =
  "https://mangamillion.shueisha.co.jp/en/title/1"

export async function startMangaMillionFixture(directory: string) {
  const rootKeyPath = join(directory, "ca-key.pem")
  const rootCertPath = join(directory, "ca-cert.pem")
  const keyPath = join(directory, "fixture-key.pem")
  const requestPath = join(directory, "fixture.csr")
  const certPath = join(directory, "fixture-cert.pem")
  const extensionsPath = join(directory, "fixture-extensions.cnf")
  await writeFile(
    extensionsPath,
    [
      "basicConstraints=critical,CA:FALSE",
      "extendedKeyUsage=serverAuth",
      `subjectAltName=${Object.keys(origins)
        .map((host) => `DNS:${host}`)
        .join(",")}`,
    ].join("\n")
  )
  const openssl = (...args: string[]) =>
    execFileSync("openssl", args, { stdio: "pipe" })
  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=Tako Firefox fixture CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
    "-keyout",
    rootKeyPath,
    "-out",
    rootCertPath
  )
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=Tako Firefox fixture",
    "-keyout",
    keyPath,
    "-out",
    requestPath
  )
  openssl(
    "x509",
    "-req",
    "-in",
    requestPath,
    "-CA",
    rootCertPath,
    "-CAkey",
    rootKeyPath,
    "-set_serial",
    "1",
    "-days",
    "1",
    "-extfile",
    extensionsPath,
    "-out",
    certPath
  )
  const [key, cert, rootCert] = await Promise.all([
    readFile(keyPath),
    readFile(certPath),
    readFile(rootCertPath),
  ])
  const mock = await startLocalMockServer({
    tls: { key, cert },
    routePrefixes: origins,
    onRequest: () => undefined,
  })
  let pageGate: Promise<void> | undefined
  let releasePages: (() => void) | undefined
  let pageRequests = 0
  registerMangaMillionLocalServerHandlers(mock, async () => {
    pageRequests += 1
    await pageGate
  })

  // Keep the fixture's HTTPS URLs intact. This proxy never connects to the internet.
  const proxy = createServer((_request, response) =>
    response.writeHead(403).end()
  )
  const tunnels = new Set<Duplex>()
  proxy.on("connect", (request, client, head) => {
    const destination = request.url ?? ""
    if (!Object.keys(origins).some((host) => destination === `${host}:443`)) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n")
      return
    }
    tunnels.add(client)
    const upstream = connect(mock.port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length) upstream.write(head)
      client.pipe(upstream).pipe(client)
    })
    upstream.on("error", () => client.destroy())
    client.on("error", () => upstream.destroy())
    upstream.on("close", () => client.destroy())
    client.on("close", () => {
      tunnels.delete(client)
      upstream.destroy()
    })
  })
  const port = await new Promise<number>((resolve, reject) => {
    proxy.once("error", reject)
    proxy.listen(0, "127.0.0.1", () => {
      const address = proxy.address()
      if (address && typeof address !== "string") resolve(address.port)
      else reject(new Error("Unable to determine the Firefox proxy port"))
    })
  })
  return {
    port,
    certificate: new X509Certificate(rootCert).raw.toString("base64"),
    get pageRequests() {
      return pageRequests
    },
    holdPages() {
      const held = Promise.withResolvers<void>()
      pageGate = held.promise
      releasePages = () => {
        pageGate = undefined
        held.resolve()
      }
      return releasePages
    },
    async close() {
      releasePages?.()
      for (const client of tunnels) client.destroy()
      await new Promise<void>((resolve, reject) => {
        proxy.close((error) => (error ? reject(error) : resolve()))
      })
      await mock.close()
    },
  }
}
