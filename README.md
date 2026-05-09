# Features
- override request/response
- replay requests (can modify before replaying)
- block urls/processes
- supports HTTP/HTTPS
- AMQP capture doesnt work well

# Setup
## Build and install yourself:
1. build service using `build_win.bat`
2. copy `service\dist\pepe-service.exe` into `client\resources\`
3. run `npm run dist`
4. run `client\dist-electron\PEPE Setup 1.0.0.exe`

## Install from release
1. run pepe setup .exe

## First time running
- Click the "CA Cert" button, there's instructions how to install the self signed certificate. It's used to handle HTTPS traffic.
- Go to app settings and install and start the network sniffer service. Also runs on startup so you can leave the proxy configured to localhost and forget about it
