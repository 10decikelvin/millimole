import http from 'node:http';
import net from 'node:net';

const TOKEN = process.env.TOKEN;
const proxy = http.createServer(function (req, res) {
  if(req.headers["authorization"] !== "Bearer " + TOKEN) {
    //don't let people know ur hosting sneaky stuff
    res.statusCode = 301;
    res.setHeader("location", "https://10decikelvin.github.io");
    res.end();
    return;
  };
  let sessionid = req.headers["x-sessionid"];
  let hostname = req.headers["x-dest-hostname"];
  let port = parseInt(req.headers["x-dest-port"]);
  if(!port || !hostname || !sessionid){
    res.statusCode = 400;
    res.setHeader("x-description", `One of the following is invalid (port, hostname, sid): ${port}, ${hostname}, ${sessionid}`);
    res.end();
    return;
  }
  // Connect to an origin server
  console.log(`[${sessionid}] ${hostname} ${port}`);
  let serverSocket = net.connect(port, hostname, function() {
    console.log(`[${sessionid}] Connected`);
    res.statusCode = 200;
    res.flushHeaders();
    //do not use .write as it can cause severe buffering headaches
    serverSocket.pipe(res);
    req.pipe(serverSocket);
  });
  serverSocket.on("error", e => console.log("server", hostname, port, e))
  serverSocket.on("close", destroy);
  req.on("close", destroy)
  let destroyed = false;
  function destroy (){
    if(destroyed) return;
    destroyed = true;
    console.log(`[${sessionid}] Destroy`);
    req.destroy();
    res.destroy();
    serverSocket.destroy();
  }
});
proxy.listen(process.env.PORT || 7002)
console.log(`Listening on port ${process.env.PORT || 7002}`)