import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';

let PRI_PROXY = null;
if(process.env.PRI_PROXY){
    let results = /^(http):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/.exec(process.env.PRI_PROXY)
    if(results){
        PRI_PROXY = {
            useTLS: false, // Only plain text CONNECT proxies are supported right now
            username: results[2],
            password: results[3],
            hostname: results[4],
            port: parseInt(results[5])
        }
    }
}
let SEC_PROXY = null;
if(process.env.SEC_PROXY){
    let results = /^(posts?):\/\/([^@]+)@([^:]+):(\d+)$/.exec(process.env.SEC_PROXY);
    if(results){
        SEC_PROXY = {
            useTLS: results[1] === "post" ? false : results[1] === "posts" ? true : (() => {throw new Error("Bad primary proxy protocol")})(),
            token: results[2],
            hostname: results[3],
            port: parseInt(results[4])
        }
    }
}

let SMART_ROUTING = !!process.env.SMART_ROUTING;

if(!PRI_PROXY || !SEC_PROXY){
    throw new Error("Double check BOTH your primary and secondary proxy configurations")
}

function getConnectStream(dest){
  return new Promise((res, rej) => {
    let serverSocket = net.connect(PRI_PROXY.port, PRI_PROXY.hostname, async () => {
        let head = `CONNECT ${dest.hostname}:${dest.port} HTTP/1.1\r\nHost: ${dest.hostname}\r\n`;
        if(PRI_PROXY.username && PRI_PROXY.password){
            head += `Proxy-Authorization: ${bota(PRI_PROXY.username + ":" + PRI_PROXY.password)}\r\n`
        }
        head += "\r\n";
        serverSocket.write(head);
        let data = await waitForData(serverSocket);
        let statusCode = parseInt(splitFirstBuffer(data, newLine).toString("ascii").split(" ")[1]);
        if(statusCode !== 200) return rej(statusCode)
        if(!dest.useTLS) return res(serverSocket);
        res(new tls.TLSSocket(serverSocket));
    });
  })
}

const proxy = http.createServer((req, res) => {
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end();
});

let blocked = new Set();
proxy.on('connect', async ({url}, clientSocket, _) => {
  const { port, hostname } = new URL(`http://${url}`);
  if(!port){
    console.log("skipping request since no port", hostname);
    return;
  }
  if(!SMART_ROUTING || blocked.has(hostname)){
    //bypass proxy if smart routing is disabled OR its blocked
    await bypassProxy(clientSocket, {hostname, port: port });
  }else{
    try{
      await normalProxy(clientSocket, {hostname, port: port });
    }catch(e){
      console.log(`!!! ${hostname}:${port} added to bypass list (errcode ${e})`);
      await blocked.add(hostname);
      await bypassProxy(clientSocket, {hostname, port: port });
    }
  }
});
proxy.listen(59400)
console.log("HTTP CONNECT Proxy listening on port 59400")
/**
 * 
 * Strategy 1: USe the school proxy like a normal child. Throws errors if blocked by school
 * 
 */
async function normalProxy(clientSocket, {hostname, port}){
  let serverSocket = await getConnectStream({hostname, port, useTLS: false});
  clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: Node.js-Proxy\r\n\r\n');
  serverSocket.pipe(clientSocket);
  clientSocket.pipe(serverSocket);
  serverSocket.on("error", console.error);
  clientSocket.on("error", console.error);
  serverSocket.on("close", () => clientSocket.closed || clientSocket.end())
  clientSocket.on("close", () => serverSocket.closed || serverSocket.end())
}
/**
 * 
 * Strategy 2: Bypass the school proxy like the pros
 * 
 */
async function bypassProxy(clientSocket, {hostname, port}){
  const sessionNumber = Math.round((Date.now() * 36 * 36 + Math.random() * 36 * 36) % 36 ** 4).toString(36);
  console.log(`[${sessionNumber}] ${hostname}:${port} Bypassing proxy...`)
  let zeroLengthChunkReceived = false;
  let serverSocket = await getConnectStream(SEC_PROXY);
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