import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';
import { createPacResolver } from 'pac-resolver';
import { readFile } from "node:fs/promises";
import { setLogLevel, log } from './logging.js';
import { getQuickJS } from 'quickjs-emscripten';

setLogLevel(2);
let PORT = parseInt(process.env.PORT) || 59400;

//ohhhhhhhhhhhhhhh god the proxy file shenanigans

const wpadFile = process.env.PAC_FILE_LOCATION ? await readFile(process.env.PAC_FILE_LOCATION, "utf8") : undefined;
const FindProxyForURL = wpadFile ? createPacResolver(await getQuickJS(), wpadFile) : undefined;
const moddedFile = wpadFile ? `
function FindProxyForURL(url, host){
  ${wpadFile.replace(/FindProxyForURL/g, "_FindProxyForURL")}
  var result = _FindProxyForURL(url, host);
  var catchAll = _FindProxyForURL("https://google.com:443", "google.com");
  if(result === catchAll){
    return "PROXY localhost:${port}"
  }else{
    return result; //NOTE: "evil" corporate proxies may exploit this to make blocked sites point to defunct proxies. In this case, just don't specify a PAC file.
  }
}` : undefined;



let PRI_PROXY = null;
if(process.env.PRI_PROXY){
    let results = /^(http):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/.exec(process.env.PRI_PROXY);
    if(results !== null){
      PRI_PROXY = {
        useTLS: false, // Only plain text CONNECT proxies are supported right now
        username: results[2],
        password: results[3],
        hostname: results[4],
        port: parseInt(results[5])
      }
    }else{
      log(2, "PRI_PROXY: Invalid configuration for primary proxy.");
      process.exit(0);
    }
}else{
  log(0, "PRI_PROXY: Skipping using primary proxy")
}

var SEC_PROXY = null;
if(process.env.SEC_PROXY){
    let results = /^(posts?):\/\/([^@]+)@([^:]+):(\d+)$/.exec(process.env.SEC_PROXY);
    if(results !== null){
        SEC_PROXY = {
            useTLS: results[1] === "post" ? false : results[1] === "posts" ? true : (() => {throw new Error("Bad SEC proxy protocol")})(),
            token: results[2],
            hostname: results[3],
            port: parseInt(results[4])
        }
    }else{
      log(2, "SEC_PROXY: Invalid configuration for secondary proxy.");
      process.exit(0)
    }
}else{
  console.log("SEC_PROXY: No secondary proxy provided.")
  process.exit(0)
}

let SMART_ROUTING = !!process.env.SMART_ROUTING;

/**
 * Gets a stream to some address
 * @param {"DIRECT" | string} mode specify direct to use direct connection; other values result in PRI_PROXY being used
 * @param {*} dest 
 * @returns {Promise<import("net").Socket>}
 */
function getStream(mode, dest){
  if(mode === "DIRECT"){
    return new Promise(res => {
      let serverSocket = net.connect(dest.port, dest.hostname, () => {
        if(!dest.useTLS) return res(serverSocket);
        res(new tls.TLSSocket(serverSocket));
      })
    });
  }else{
    return new Promise((res, rej) => {
      let serverSocket = net.connect(PRI_PROXY.port, PRI_PROXY.hostname, async () => {
          let head = `CONNECT ${dest.hostname}:${dest.port} HTTP/1.1\r\nHost: ${dest.hostname}\r\n`;
          if(PRI_PROXY.username && PRI_PROXY.password){
              head += `Proxy-Authorization: Basic ${btoa(PRI_PROXY.username + ":" + PRI_PROXY.password)}\r\n`
          }
          head += "\r\n";
          serverSocket.write(head);
          let data = await waitForData(serverSocket);
          let statusCode = parseInt(splitFirstBuffer(data, newLine).toString("ascii").split(" ")[1]);
          if(statusCode === 407){
            return rej(new Error(`Invalid PRI_PROXY auth credentials.`))
          }
          if(statusCode !== 200) return rej(statusCode)
          if(!dest.useTLS) return res(serverSocket);
          res(new tls.TLSSocket(serverSocket));
      });
    })
  }
}

const proxy = http.createServer((req, res) => {
  if(req.url === "/wpad"){
    res.end(moddedFile);
  }else{
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end();
  }
});

let blocked = new Set();
proxy.on('connect', async ({url}, clientSocket, _) => {
  const { port, hostname } = new URL(`http://${url}`);
  if(!port) return console.log("skipping request since no port", hostname);
  // if no pri proxy, direct
  // if there is a pac, follow the pac
  // if there is no pac, follow PRI_PROXT
  let mode = PRI_PROXY === null ? "DIRECT" : (FindProxyForURL ? await FindProxyForURL(`http${port === 443 ? "s" : ""}://${hostname}:${port}`) : "PROXY");

  if(!SMART_ROUTING || blocked.has(hostname)){
    //bypass proxy if smart routing is disabled OR its blocked
    await foreignBounce(mode, clientSocket, {hostname, port: port });
  }else{
    try{
      await noBounce(mode, clientSocket, {hostname, port: port });
    }catch(e){
      console.log(`!!! ${hostname}:${port} added to bypass list (errcode ${e})`);
      await blocked.add(hostname);
      await foreignBounce(mode, clientSocket, {hostname, port: port });
    }
  }
});
proxy.listen(PORT)
console.log(`HTTP CONNECT Proxy listening on port ${PORT}`)
/**
 * 
 * NoBounce: take the shortest path possible to the destination
 * 
 */
async function noBounce(mode, clientSocket, {hostname, port}){
  let serverSocket = await getStream(mode, {hostname, port, useTLS: false}); //don't use TLS as the client itself should negotiate it
  serverSocket.pipe(clientSocket);
  clientSocket.pipe(serverSocket);
  serverSocket.on("error", console.error);
  clientSocket.on("error", console.error);
  serverSocket.on("close", () => clientSocket.closed || clientSocket.end())
  clientSocket.on("close", () => serverSocket.closed || serverSocket.end())
  //ready
  clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: Node.js-Proxy\r\n\r\n');
}
/**
 * 
 * Bounce: bounce through the post(s) server 
 * 
 */
async function foreignBounce(mode, clientSocket, {hostname, port}){
  const sessionNumber = Math.round((Date.now() * 36 * 36 + Math.random() * 36 * 36) % 36 ** 4).toString(36);
  console.log(`[${sessionNumber}] ${hostname}:${port} Bypassing proxy...`)
  let zeroLengthChunkReceived = false;
  let serverSocket = await getStream(mode, SEC_PROXY);
  console.log("connected")
  serverSocket.write(`POST / HTTP/1.1\r\nHost: ${SEC_PROXY.hostname}:${SEC_PROXY.port}\r\nauthorization: Bearer ${SEC_PROXY.token}\r\nx-dest-hostname: ${hostname}\r\nx-dest-port: ${port}\r\nx-sessionid: ${sessionNumber}\r\nTransfer-Encoding: chunked\r\n\r\n`)
  await waitForData(serverSocket);
  console.log(`[${sessionNumber}] ${hostname}:${port} Connection established.`)
  let parseData = parseChunkEncoding();
  serverSocket.on("data", _d => {
    let chunks = parseData(_d);
    for(let chunk of chunks){
      if(chunk.length === 0){
        console.log(`[${sessionNumber}] ${hostname}:${port} Ending connection...`);
        zeroLengthChunkReceived = true;
        clientSocket.end();
        return;
      }else{
        clientSocket.write(chunk);
      }
    }
  })
  clientSocket.on("data", d => {
    let buf1 = Buffer.from(d.length.toString("16") + "\r\n", "ascii");
    let buf2 = Buffer.from("\r\n","ascii");
    serverSocket.write(Buffer.concat([buf1, d, buf2]));
  })
  clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: Node.js-Proxy\r\n\r\n');

  serverSocket.on("error", e => {
    if(e?.code === "ECONNRESET" && zeroLengthChunkReceived){
      console.log(`[${sessionNumber}] ${hostname}:${port} Connection ended.`);//expected this ending, its fiiiine
      return;
    }
    console.error(`[${sessionNumber}] ${hostname}:${port} Server ${e?.code}`)
  })
  clientSocket.on("error", e => console.error(`[${sessionNumber}] ${hostname}:${port} Client ${e?.code}`))
  serverSocket.on("close", () => clientSocket.closed || clientSocket.end())
  clientSocket.on("close", () => serverSocket.closed || serverSocket.end())
}

/**
 * Utility functions for buffer parsing
 * /
/**
 * Hehehehhe TODO THIS ISNT VERY RELIABLE AS ONE MSG MAY TRIGGER TWO ON DATA CALLBACKS
 * @param {ReadableStream} stream 
 */
function waitForData(stream){
  return new Promise(res => stream.on("data", d => res(d)))
}
const newLine = Buffer.from("\r\n", "ascii")
function splitFirstBuffer(b, splitWith) {
    let i = b.indexOf(splitWith);
    if (i >= 0) {
        return [b.subarray(0, i), b.subarray(i + splitWith.length)]
    }else{
        return [b]
    }
}
function parseChunkEncoding(){
    let chunk = Buffer.alloc(0);
    let anticipatedSize = null;
    /**
    * @param {Buffer} buf 
    */
    function digest(buf){
        if(buf) chunk = Buffer.concat([chunk, buf]);
        //console.log("read mode", anticipatedSize === null ? "scan size" : "read body", "chunk", chunk)
        if(anticipatedSize === null){
            let [sizeChunk, remainingChunk] = splitFirstBuffer(chunk, newLine);//split a line break
            if(sizeChunk && remainingChunk){
              anticipatedSize = parseInt(sizeChunk.toString("ascii"), 16);
              chunk = remainingChunk;
              return digest();//attempt to digest the rest of the content
            }
            return [];//nothing we can do about it
        }else{
            if(chunk.length >= anticipatedSize + newLine.length){
                let section = chunk.subarray(0, anticipatedSize)
                let supposedNewline = chunk.subarray(anticipatedSize, anticipatedSize + newLine.length)
                if(supposedNewline.toString() !== newLine.toString()){
                  let actualMextNewLine = chunk.indexOf(newLine)
                  throw new Error(`Found ${supposedNewline.toString("hex")} instead, actual newline at ${actualMextNewLine}`)
                }
                chunk = chunk.subarray(anticipatedSize + newLine.length)
                anticipatedSize = null
                return [section, ...digest()]
            }else{
                return []
            }
        }
    }
    return digest
}