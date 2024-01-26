import http from 'node:http';
import net from 'node:net';
import { URL } from 'node:url';
const proxy = http.createServer((req, res) => {
res.writeHead(200, { 'Content-Type': 'text/plain' });
res.end('The basic server says hi!');
});
proxy.on('connect', (req, clientSocket, head) => {
// Connect to an origin server
const { port, hostname } = new URL(`http://${req.url}`);
//console.log(`Forwarding connection to ${hostname}:${port}`)
const serverSocket = net.connect(port || 80, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                    'Proxy-agent: Node.js-Proxy\r\n' +
                    '\r\n');
    //serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    //serverSocket.on("data", d => console.log(d.toString()))
    clientSocket.pipe(serverSocket);
});
function cleanup(){
    if(!clientSocket.closed) clientSocket.end()
    if(!serverSocket.closed) serverSocket.end()
}
serverSocket.on("error", cleanup)
clientSocket.on("error", cleanup)
clientSocket.on("data", () => console.log("client sending data"))
serverSocket.on("close", cleanup)
clientSocket.on("close", cleanup)
});
proxy.listen(7000)