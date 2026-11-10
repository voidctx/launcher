export async function genError(status,err){
	let html = error.replace('{status}',status).replace('{err}',err);
	return html;
}
export const error = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Internal Server Error</title>
  <style>
    body { font-family: sans-serif; text-align: center; padding: 50px; }
    h1 { color: #b00; }
  </style>
</head>
<body>
  <h1>{status} - Internal Server Error</h1>
  <pre>{err}</pre>
</body>
</html>
`;
export const e500 = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Internal Server Error</title>
  <style>
    body { font-family: sans-serif; text-align: center; padding: 50px; }
    h1 { color: #b00; }
  </style>
</head>
<body>
  <h1>500 - Internal Server Error</h1>
  <pre>{err}</pre>
</body>
</html>
`;
export const e404 = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Not Found</title>
  <style>
    body { font-family: sans-serif; text-align: center; padding: 50px; }
    h1 { color: #b00; }
  </style>
</head>
<body>
  <h1>404 - Page Not Found</h1>
  <p>Sorry, we couldn’t find the page you requested.</p>
  <pre>{err}</pre>
</body>
</html>
`;
export const e400 = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bad Request</title>
  <style>
    body { font-family: sans-serif; text-align: center; padding: 50px; }
    h1 { color: #b00; }
  </style>
</head>
<body>
  <h1>400 - Bad Request</h1>
  <p>.</p>
</body>
</html>
`;
export const tg = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Telegram Mini App</title>
  <style>
  	body {
  	  font-family: Arial, sans-serif;
  	  padding: 20px;
  	}
  	button {
  	  padding: 10px 20px;
  	  font-size: 16px;
  	  cursor: pointer;
  	}
  </style>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
  <h1 id="user">Guest</h1>
  <p id="data"></p>
  <button id="sendBtn">Send Data</button>
  <script>
  	const tg = window.Telegram.WebApp;
  	const user = tg.initDataUnsafe.user;
  	const data = document.getElementById("data");
  	const invoice = "__INVOICE__";
  	document.getElementById("user").innerText =
  	  user ? user.first_name : "No user data";
  	document.getElementById("sendBtn").onclick = () => {
  	  tg.openInvoice(invoice);
  	};
  	tg.onEvent("invoiceClosed", (result) => {
  	  data.innerText ="Invoice closed:";
  	  data.innerText += result.status;
  	});
  	tg.onEvent("messageReceived", (msg) => {
  	  if (msg.text && msg.text.startsWith("INVOICE_LINK:")) {
  	    const link = msg.text.replace("INVOICE_LINK:", "").trim();
  	    tg.openInvoice(link);
  	  }
  	});
  </script>
</body>
</html>
`
