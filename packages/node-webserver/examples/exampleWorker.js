const { buffer } = require('stream/consumers');

module.exports = async (event, callback) => {
  // the body of the request is a stream, read it before answering
  const body = await buffer(event.bodyStream);

  callback({
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=0',
      // lets clients verify that the request body arrived
      'X-Request-Body-Length': String(body.length),
    },
    body: `
    <html>
      <head>
        <title>Example</title>
      </head>
      <body>
        <h1>It works!</h1>
        <p id="time"></p>
        <script type="text/javascript">
          (function() {
            var timeHolder = document.getElementById('time');
            function connect() {
              var w = new WebSocket('ws://' + window.location.host + '/websocket/exampleWorker.js');
              w.addEventListener('message', e => {
                var d = JSON.parse(e.data);
                var now = new Date(d.now);
                timeHolder.innerHTML = "Server time is " + now.toLocaleTimeString();
                w.send(JSON.stringify({ received: true }));
              });
              w.addEventListener('close', function () {
                setTimeout(function() {
                  location.reload();
                }, 5000);
              });
            }
            // the server sends its time every second, and the page reloads when the connection closes.
            // Keep the page above 1 KiB: the load test needs it to be big enough for compressed.localhost to compress it.
            connect();
          })();
        </script>
      </body>
    </html>
    `,
    isBase64Encoded: false,
  });
};
