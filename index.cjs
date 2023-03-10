// node express libraries 
const express = require('express');
const bodyParser = require('body-parser');
const https = require('https');
const fs = require('fs');

// configuration with .env file
require('dotenv').config()

// internal dependancies
const { verifyWebhook } = require('./modules/webhookVerification.cjs');
const { processWebhook } = require('./modules/webhook.cjs');

// run node express server
const PORT = 3000;
const options = {
    cert: fs.readFileSync(process.env.SSL_CERT_FULLCHAIN_PEM_PATH),
    key: fs.readFileSync(process.env.SSL_CERT_PRIVKEY_PEM_PATH)
};
const app = express();
app.use(bodyParser.json());

// register whatsapp webhhoks
app.get('/webhook', verifyWebhook);
app.post('/webhook', processWebhook);

// start the server
https.createServer(options, app).listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});