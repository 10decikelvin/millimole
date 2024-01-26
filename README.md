# Millimole
A very tiny mole that digs underneath proxies to protect your privacy.
##  About
Tired of the swathe of VPN ads that tell you to 'protect your privacy'?

Annoyed by the fact that VPN services offers limited visibility as to how they work?

Want control over how your network traffic is managed? 

**Look no further.**

Millimole tunnels HTTP connections firstly through a HTTP CONNECT proxy (a common type of proxy used in corporate settings), and then tunnels them through a self-hosted HTTP/S server before accessing the internet. The server and client code combined is less than 250 lines, giving you full transparency over how this works.

What millimole does do:
- Hides your IP address sent during HTTP requests by browsers.
- Hides the final destination server from your ISP.
- Able to intelligently _not_ tunnel requests if it is directly available from the proxy (to speed up connection lags).

What millimole does not do:
- Does not provide extra encryption. HTTPS by default should be sufficiently robust.
- Does not try to pretend to be normal web traffic.
- Does not automatically tunnel your entire computer. You control what apps should go through this proxy by using tools such as Proxifier.


## Usage
### Part 1: Host a server by running the following in your server:
```bash
PORT=1080 TOKEN=SUPER_SECRET_TOKEN node server.js
```
Options:
* `PORT` The port to host the server on
* `TOKEN` The token used to authenticate and prove ownership of the server

> **Caution:**
> The current code assumes that the server environment will _autoconfigure ssl_, as is common in most web hosting services. If self-hosting at home, ensure to use adequate SSL certs by simply swapping out the `node:http` module with the `node:https` one.


### Part 2: Host a client on your local computer
```bash
PRI_PROXY=http://username:password@corporate-proxy.com:80 SEC_PROXY=posts://SUPER_SECRET_TOKEN@yourownserver.com:443
```
Environment variables:
* `PRI_PROXY` URL of your corporate proxy, in the format `http://username:password@address:port` or `http://address:port`

* `SEC_PROXY` URL of your own hosted server, in the format `post(s)://token@address:port`

* `SMART_ROUTING`: leave this unset to force tunnel all connections through both PRI_PROXY and SEC_PROXY. set this to 1 in order to skip tunneling through SEC_PROXY as much as possible, sacrificing privacy for lower ping.
### Step 3: Direct your traffic

Point all your traffic towards the HTTP CONNECT proxy set up at localhost:59400, by using apps such as Proxifier, using environment variables or using application settings.




## License
Copyright 2023 Kelvin Chan

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
